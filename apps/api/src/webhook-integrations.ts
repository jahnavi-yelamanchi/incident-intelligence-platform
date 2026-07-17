import { Prisma, type DatabaseClient } from "@incident/database";
import { decryptIntegrationCredentials } from "./security/integration-credentials.js";

export type WebhookIntegration = { organizationId: string; secret: string; enabled: boolean };

export async function resolveWebhookIntegration(database: DatabaseClient, provider: "github" | "slack", connectionId: string, encryptionKey: string | undefined): Promise<WebhookIntegration | null> {
  if (!encryptionKey) return null;
  const rows = await database.$queryRaw<Array<{ organization_id: string; encrypted_credentials: string; status: "active" | "disabled" | "error" }>>(
    Prisma.sql`SELECT * FROM resolve_integration_connection(${connectionId}::uuid, ${provider}::"IntegrationProvider")`,
  );
  const connection = rows[0];
  if (!connection) return null;
  const credentials = decryptIntegrationCredentials(connection.encrypted_credentials, encryptionKey);
  const secret = credentials.webhookSecret;
  return typeof secret === "string" ? { organizationId: connection.organization_id, secret, enabled: connection.status === "active" } : null;
}
