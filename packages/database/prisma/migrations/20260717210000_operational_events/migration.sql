CREATE TABLE "operational_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "incident_id" UUID,
    "source" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "attributes" JSONB NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "correlated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_events_organization_id_source_source_event_id_key"
    ON "operational_events"("organization_id", "source", "source_event_id");
CREATE INDEX "operational_events_organization_id_fingerprint_occurred_at_idx"
    ON "operational_events"("organization_id", "fingerprint", "occurred_at" DESC);
CREATE INDEX "operational_events_organization_id_incident_id_occurred_at_idx"
    ON "operational_events"("organization_id", "incident_id", "occurred_at");

ALTER TABLE "operational_events"
    ADD CONSTRAINT "operational_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_events"
    ADD CONSTRAINT "operational_events_incident_id_fkey"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "operational_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operational_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "operational_events_tenant_isolation" ON "operational_events"
    USING ("organization_id" = current_organization_id())
    WITH CHECK ("organization_id" = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "operational_events" TO incident_app;
