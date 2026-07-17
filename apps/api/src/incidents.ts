import { type DatabaseClient, withTenant } from "@incident/database";
import { z } from "zod";
import type { ApiAuthContext } from "./security/auth0-access-token.js";

export const listIncidentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["triggered", "investigating", "identified", "monitoring", "resolved"]).optional(),
});

export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;

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
    const servicesById = new Map(services.map((service) => [service.id, service]));
    const ownersById = new Map(owners.map((owner) => [owner.id, owner]));

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
    }));
  });
}
