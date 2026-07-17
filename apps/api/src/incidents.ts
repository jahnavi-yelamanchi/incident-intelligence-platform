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
