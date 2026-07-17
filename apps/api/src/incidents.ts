import { type DatabaseClient, withTenant } from "@incident/database";
import { z } from "zod";
import type { ApiAuthContext } from "./security/auth0-access-token.js";

export const listIncidentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["triggered", "investigating", "identified", "monitoring", "resolved"]).optional(),
});

export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;

export const createActionRequestSchema = z.object({
  actionType: z.literal("kubernetes.scale"),
  target: z.object({ service: z.string().min(1), environment: z.string().min(1) }),
  parameters: z.object({ replicas: z.number().int().min(1).max(100) }),
  reason: z.string().min(10).max(1_000),
});

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
) {
  return withTenant(database, context.organizationId, async (transaction) => {
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
        target: input.target,
        parameters: input.parameters,
        reason: input.reason,
        riskSummary: "Availability-affecting change; verified by an independent production approver.",
        policySnapshot: { requiredApprovals: 1, selfApprovalAllowed: false, dryRunRequired: true },
        requiredApprovals: 1,
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
        metadata: { incidentId: incident.id, actionType: request.actionType, requiredApprovals: 1 },
      },
    });
    return { id: request.id, status: request.status, expiresAt: request.expiresAt.toISOString() };
  });
}

export async function decideActionApproval(
  database: DatabaseClient,
  context: ApiAuthContext,
  actionRequestId: string,
  input: ApprovalDecision,
  correlationId: string,
) {
  return withTenant(database, context.organizationId, async (transaction) => {
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
    return { id: updated.id, status: updated.status, approvalCount: approvals.length };
  });
}
