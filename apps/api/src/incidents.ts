import { Prisma, type DatabaseClient, withTenant } from "@incident/database";
import { z } from "zod";
import type { ApiAuthContext } from "./security/auth0-access-token.js";
import type { RemediationDispatcher } from "./remediation-dispatcher.js";
import type { RemediationPolicyEvaluator } from "./policy.js";

export const listIncidentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["triggered", "investigating", "identified", "monitoring", "resolved"]).optional(),
});

export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;

const kubernetesTargetSchema = z.object({
    service: z.string().min(1),
    environment: z.string().min(1),
    cluster: z.string().min(1).max(160),
    namespace: z.string().min(1).max(253),
    resourceKind: z.enum(["Deployment", "StatefulSet"]),
    resourceName: z.string().min(1).max(253),
});
const awsRdsTargetSchema = z.object({
  environment: z.string().min(1),
  region: z.string().regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/),
  dbClusterIdentifier: z.string().min(1).max(63).regex(/^[a-z][a-z0-9-]*$/),
  targetDbInstanceIdentifier: z.string().min(1).max(63).regex(/^[a-z][a-z0-9-]*$/).optional(),
});
export const createActionRequestSchema = z.discriminatedUnion("actionType", [
  z.object({ actionType: z.enum(["kubernetes.restart", "kubernetes.scale", "kubernetes.pause-rollout", "kubernetes.resume-rollout", "kubernetes.rollback"]), target: kubernetesTargetSchema, parameters: z.record(z.string(), z.unknown()), reason: z.string().min(10).max(1_000) }),
  z.object({ actionType: z.literal("aws.rds.failover"), target: awsRdsTargetSchema, parameters: z.object({}).strict(), reason: z.string().min(10).max(1_000) }),
]);

export type CreateActionRequest = z.infer<typeof createActionRequestSchema>;

export const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().max(1_000).optional(),
});

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export async function listIncidents(
  database: DatabaseClient,
  context: ApiAuthContext,
  query: ListIncidentsQuery,
) {
  return withTenant(database, context.organizationId, async (transaction) => {
    const incidents = await transaction.incident.findMany({
      ...(query.status ? { where: { status: query.status } } : {}),
      orderBy: { updatedAt: "desc" },
      take: query.limit,
    });

    const serviceIds = [...new Set(incidents.map((incident) => incident.serviceId))];
    const ownerIds = [...new Set(incidents.flatMap((incident) => (incident.ownerId ? [incident.ownerId] : [])))];
    const [services, owners] = await Promise.all([
      transaction.service.findMany({ where: { id: { in: serviceIds } } }),
      transaction.user.findMany({ where: { id: { in: ownerIds } } }),
    ]);
    const timeline = await transaction.timelineEvent.findMany({
      where: { incidentId: { in: incidents.map((incident) => incident.id) } },
      orderBy: { occurredAt: "desc" },
    });
    const servicesById = new Map(services.map((service) => [service.id, service]));
    const ownersById = new Map(owners.map((owner) => [owner.id, owner]));
    const timelineByIncident = new Map<string, typeof timeline>();
    for (const event of timeline) {
      const entries = timelineByIncident.get(event.incidentId) ?? [];
      entries.push(event);
      timelineByIncident.set(event.incidentId, entries);
    }

    return incidents.map((incident) => ({
      id: incident.id,
      reference: incident.reference,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      service: servicesById.get(incident.serviceId)?.displayName ?? "Unknown service",
      environment: servicesById.get(incident.serviceId)?.environment ?? "unknown",
      ownerName: incident.ownerId ? ownersById.get(incident.ownerId)?.displayName ?? null : null,
      startedAt: incident.startedAt.toISOString(),
      updatedAt: incident.updatedAt.toISOString(),
      timeline: (timelineByIncident.get(incident.id) ?? []).map((event) => ({
        occurredAt: event.occurredAt.toISOString(),
        type: event.type,
        title: event.title,
        detail: event.detail,
      })),
    }));
  });
}

export async function createActionRequest(
  database: DatabaseClient,
  context: ApiAuthContext,
  incidentId: string,
  input: CreateActionRequest,
  correlationId: string,
  dispatcher: RemediationDispatcher,
  evaluatePolicy: RemediationPolicyEvaluator,
) {
  const policy = await evaluatePolicy(context, input);
  if (!policy.allow) throw Object.assign(new Error(policy.reason), { statusCode: 403 });
  const created = await withTenant(database, context.organizationId, async (transaction) => {
    const [incident, requester] = await Promise.all([
      transaction.incident.findUnique({ where: { id: incidentId } }),
      transaction.user.findUnique({
        where: { organizationId_auth0Subject: { organizationId: context.organizationId, auth0Subject: context.subject } },
      }),
    ]);
    if (!incident) throw Object.assign(new Error("Incident not found."), { statusCode: 404 });
    if (!requester) throw Object.assign(new Error("Authenticated user is not provisioned."), { statusCode: 403 });

    const request = await transaction.actionRequest.create({
      data: {
        organizationId: context.organizationId,
        incidentId: incident.id,
        requestedById: requester.id,
        actionType: input.actionType,
        target: input.target as Prisma.InputJsonValue,
        parameters: input.parameters as Prisma.InputJsonValue,
        reason: input.reason,
        riskSummary: policy.reason,
        policySnapshot: { ...policy, selfApprovalAllowed: false },
        requiredApprovals: policy.requiredApprovals,
        idempotencyKey: crypto.randomUUID(),
        status: "pending",
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorType: "user",
        actorId: context.subject,
        action: "action_request.created",
        resourceType: "action_request",
        resourceId: request.id,
        correlationId,
        metadata: { incidentId: incident.id, actionType: request.actionType, requiredApprovals: policy.requiredApprovals, policySource: policy.source },
      },
    });
    return { request, requesterSubject: requester.auth0Subject };
  });
  try {
    await dispatcher.start({
      actionRequestId: created.request.id,
      actionType: created.request.actionType as "kubernetes.restart" | "kubernetes.scale" | "kubernetes.pause-rollout" | "kubernetes.resume-rollout" | "kubernetes.rollback" | "aws.rds.failover",
      target: toWorkflowTarget(input.target, context.organizationId, incidentId),
      parameters: input.parameters,
      requestedBy: created.requesterSubject,
      requiredApprovals: created.request.requiredApprovals,
      expiresInMs: Math.max(60_000, created.request.expiresAt.getTime() - Date.now()),
      idempotencyKey: created.request.idempotencyKey,
    });
  } catch (error) {
    await withTenant(database, context.organizationId, async (transaction) => {
      await transaction.actionRequest.update({ where: { id: created.request.id }, data: { status: "cancelled" } });
      await transaction.auditEvent.create({
        data: {
          organizationId: context.organizationId, actorType: "system", actorId: "workflow-dispatcher",
          action: "action_request.workflow_start_failed", resourceType: "action_request", resourceId: created.request.id,
          correlationId, metadata: { error: error instanceof Error ? error.message : "unknown" },
        },
      });
    });
    throw Object.assign(new Error("Unable to start the durable remediation workflow."), { statusCode: 503 });
  }
  return { id: created.request.id, status: created.request.status, expiresAt: created.request.expiresAt.toISOString() };
}

export async function decideActionApproval(
  database: DatabaseClient,
  context: ApiAuthContext,
  actionRequestId: string,
  input: ApprovalDecision,
  correlationId: string,
  dispatcher: RemediationDispatcher,
) {
  const result = await withTenant(database, context.organizationId, async (transaction) => {
    if (!context.roles.includes("production-approver")) {
      throw Object.assign(new Error("Production approver role required."), { statusCode: 403 });
    }
    const [action, approver] = await Promise.all([
      transaction.actionRequest.findUnique({ where: { id: actionRequestId } }),
      transaction.user.findUnique({
        where: { organizationId_auth0Subject: { organizationId: context.organizationId, auth0Subject: context.subject } },
      }),
    ]);
    if (!action || !approver) throw Object.assign(new Error("Action request not found."), { statusCode: 404 });
    if (action.requestedById === approver.id) throw Object.assign(new Error("Self-approval is prohibited."), { statusCode: 403 });
    if (action.status !== "pending") throw Object.assign(new Error("Action request is not awaiting approval."), { statusCode: 409 });
    if (action.expiresAt <= new Date()) {
      await transaction.actionRequest.update({ where: { id: action.id }, data: { status: "expired" } });
      throw Object.assign(new Error("Action request has expired."), { statusCode: 409 });
    }

    await transaction.approval.upsert({
      where: { actionRequestId_approverId: { actionRequestId: action.id, approverId: approver.id } },
      update: { decision: input.decision, comment: input.comment ?? null, decidedAt: new Date() },
      create: {
        organizationId: context.organizationId,
        actionRequestId: action.id,
        approverId: approver.id,
        decision: input.decision,
        comment: input.comment ?? null,
      },
    });
    const approvals = await transaction.approval.findMany({ where: { actionRequestId: action.id, decision: "approved" } });
    const nextStatus = input.decision === "rejected" ? "rejected" : approvals.length >= action.requiredApprovals ? "approved" : "pending";
    const updated = await transaction.actionRequest.update({ where: { id: action.id }, data: { status: nextStatus } });
    await transaction.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorType: "user",
        actorId: context.subject,
        action: `action_request.${input.decision}`,
        resourceType: "action_request",
        resourceId: action.id,
        correlationId,
        metadata: { requiredApprovals: action.requiredApprovals, approvalCount: approvals.length, status: nextStatus },
      },
    });
    return { updated, approver, approvalCount: approvals.length };
  });
  const target = createdTargetFromAction(result.updated.target, result.updated.actionType, context.organizationId, result.updated.incidentId);
  await dispatcher.submitApproval({ actionRequestId: result.updated.id, target }, {
    approverId: result.approver.auth0Subject,
    roles: context.roles,
    decision: input.decision,
    ...(input.comment ? { comment: input.comment } : {}),
    decidedAt: new Date().toISOString(),
  });
  return { id: result.updated.id, status: result.updated.status, approvalCount: result.approvalCount };
}

export async function cancelActionRequest(
  database: DatabaseClient,
  context: ApiAuthContext,
  actionRequestId: string,
  reason: string,
  correlationId: string,
  dispatcher: RemediationDispatcher,
) {
  const action = await withTenant(database, context.organizationId, async (transaction) => {
    const action = await transaction.actionRequest.findUnique({ where: { id: actionRequestId } });
    if (!action) throw Object.assign(new Error("Action request not found."), { statusCode: 404 });
    const requester = await transaction.user.findUnique({ where: { id: action.requestedById } });
    if (requester?.auth0Subject !== context.subject && !context.roles.includes("incident-commander")) {
      throw Object.assign(new Error("Only the requester or incident commander may cancel this action."), { statusCode: 403 });
    }
    if (!["pending", "approved"].includes(action.status)) throw Object.assign(new Error("Action request cannot be cancelled in its current state."), { statusCode: 409 });
    const updated = await transaction.actionRequest.update({ where: { id: action.id }, data: { status: "cancelled" } });
    await transaction.auditEvent.create({
      data: { organizationId: context.organizationId, actorType: "user", actorId: context.subject, action: "action_request.cancelled", resourceType: "action_request", resourceId: action.id, correlationId, metadata: { reason } },
    });
    return updated;
  });
  await dispatcher.cancel({ actionRequestId: action.id, target: createdTargetFromAction(action.target, action.actionType, context.organizationId, action.incidentId) }, { actorId: context.subject, reason });
  return { id: action.id, status: action.status };
}

function toWorkflowTarget(target: CreateActionRequest["target"], organizationId: string, incidentId: string) {
  return "dbClusterIdentifier" in target
    ? { organizationId, incidentId, environment: target.environment, region: target.region, dbClusterIdentifier: target.dbClusterIdentifier, ...(target.targetDbInstanceIdentifier ? { targetDbInstanceIdentifier: target.targetDbInstanceIdentifier } : {}) }
    : { organizationId, incidentId, environment: target.environment, cluster: target.cluster, namespace: target.namespace, resourceKind: target.resourceKind, resourceName: target.resourceName };
}

function createdTargetFromAction(value: unknown, actionType: string, organizationId: string, incidentId: string) {
  return toWorkflowTarget(actionType === "aws.rds.failover" ? awsRdsTargetSchema.parse(value) : kubernetesTargetSchema.parse(value), organizationId, incidentId);
}
