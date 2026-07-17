CREATE TYPE "IntegrationProvider" AS ENUM ('github', 'slack');
CREATE TYPE "IntegrationStatus" AS ENUM ('active', 'disabled', 'error');

CREATE TABLE "integration_connections" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" uuid NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "external_id" text NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'active',
    "encrypted_credentials" text NOT NULL,
    "metadata" jsonb NOT NULL DEFAULT '{}',
    "token_expires_at" timestamptz(6),
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL,
    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "integration_connections_organization_id_provider_external_id_key" ON "integration_connections"("organization_id", "provider", "external_id");
CREATE INDEX "integration_connections_organization_id_provider_status_idx" ON "integration_connections"("organization_id", "provider", "status");

ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY "integration_connections_tenant_isolation" ON "integration_connections"
    USING (organization_id = current_organization_id()) WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "integration_connections" TO incident_app;
