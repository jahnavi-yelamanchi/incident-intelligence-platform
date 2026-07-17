import { withTenant, type DatabaseClient } from "@incident/database";
import { z } from "zod";
import type { ApiAuthContext } from "./security/auth0-access-token.js";

export const auditQuerySchema = z.object({ action: z.string().min(1).max(255).optional(), resourceType: z.string().min(1).max(255).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export async function listAuditEvents(database: DatabaseClient, context: ApiAuthContext, query: AuditQuery) {
  if (!context.roles.includes("administrator") && !context.roles.includes("incident-commander")) throw Object.assign(new Error("Administrator role required."), { statusCode: 403 });
  return withTenant(database, context.organizationId, async (transaction) => {
    const items = await transaction.auditEvent.findMany({ where: { ...(query.action ? { action: query.action } : {}), ...(query.resourceType ? { resourceType: query.resourceType } : {}) }, orderBy: { occurredAt: "desc" }, take: query.limit });
    return items.map((item) => ({ ...item, occurredAt: item.occurredAt.toISOString() }));
  });
}
