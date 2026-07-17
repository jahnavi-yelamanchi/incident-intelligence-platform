import { Prisma, type DatabaseClient, withTenant } from "@incident/database";
import { z } from "zod";
import type { ApiAuthContext } from "./security/auth0-access-token.js";
import { encryptIntegrationCredentials } from "./security/integration-credentials.js";

export const integrationUpsertSchema = z.object({
  provider: z.enum(["github", "slack"]),
  externalId: z.string().min(1).max(255),
  credentials: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tokenExpiresAt: z.string().datetime().optional(),
});

export type IntegrationUpsert = z.infer<typeof integrationUpsertSchema>;

function canManageIntegrations(context: ApiAuthContext) {
  return context.roles.includes("administrator") || context.roles.includes("incident-commander");
}

export async function listIntegrations(database: DatabaseClient, context: ApiAuthContext) {
  return withTenant(database, context.organizationId, async (transaction) => {
    const integrations = await transaction.integrationConnection.findMany({ orderBy: { updatedAt: "desc" } });
    return integrations.map((integration) => ({
      id: integration.id,
      provider: integration.provider,
      externalId: integration.externalId,
      status: integration.status,
      metadata: integration.metadata,
      tokenExpiresAt: integration.tokenExpiresAt?.toISOString() ?? null,
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    }));
  });
}

export async function upsertIntegration(
  database: DatabaseClient,
  context: ApiAuthContext,
  input: IntegrationUpsert,
  encryptionKey: string | undefined,
  correlationId: string,
) {
  if (!canManageIntegrations(context)) throw Object.assign(new Error("Administrator role required."), { statusCode: 403 });
  if (!encryptionKey) throw Object.assign(new Error("Integration encryption is not configured."), { statusCode: 503 });
  const encryptedCredentials = encryptIntegrationCredentials(input.credentials, encryptionKey);
  return withTenant(database, context.organizationId, async (transaction) => {
    const integration = await transaction.integrationConnection.upsert({
      where: { organizationId_provider_externalId: { organizationId: context.organizationId, provider: input.provider, externalId: input.externalId } },
      update: { encryptedCredentials, metadata: input.metadata as Prisma.InputJsonValue, tokenExpiresAt: input.tokenExpiresAt ? new Date(input.tokenExpiresAt) : null, status: "active" },
      create: { organizationId: context.organizationId, provider: input.provider, externalId: input.externalId, encryptedCredentials, metadata: input.metadata as Prisma.InputJsonValue, tokenExpiresAt: input.tokenExpiresAt ? new Date(input.tokenExpiresAt) : null },
    });
    await transaction.auditEvent.create({
      data: { organizationId: context.organizationId, actorType: "user", actorId: context.subject, action: "integration.connection_upserted", resourceType: "integration_connection", resourceId: integration.id, correlationId, metadata: { provider: input.provider, externalId: input.externalId } },
    });
    return { id: integration.id, provider: integration.provider, externalId: integration.externalId, status: integration.status, updatedAt: integration.updatedAt.toISOString() };
  });
}
