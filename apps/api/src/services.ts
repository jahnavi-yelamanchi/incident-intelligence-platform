import { withTenant, type DatabaseClient } from "@incident/database";
import type { ApiAuthContext } from "./security/auth0-access-token.js";

export async function serviceGraph(database: DatabaseClient, context: ApiAuthContext) {
  return withTenant(database, context.organizationId, async (transaction) => {
    const [services, dependencies] = await Promise.all([transaction.service.findMany({ orderBy: { displayName: "asc" } }), transaction.serviceDependency.findMany({ orderBy: { observedAt: "desc" } })]);
    return {
      nodes: services.map((service) => ({ id: service.id, slug: service.slug, name: service.displayName, environment: service.environment, ownerTeam: service.ownerTeam, source: service.source, verificationStatus: service.verificationStatus })),
      edges: dependencies.map((dependency) => ({ id: dependency.id, sourceId: dependency.sourceId, targetId: dependency.targetId, kind: dependency.kind, criticality: dependency.criticality, observedAt: dependency.observedAt.toISOString() })),
    };
  });
}
