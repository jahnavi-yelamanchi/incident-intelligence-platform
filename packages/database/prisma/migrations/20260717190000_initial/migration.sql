-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Required for tenant-scoped semantic retrieval.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('triggered', 'investigating', 'identified', 'monitoring', 'resolved');

-- CreateEnum
CREATE TYPE "TimelineEventType" AS ENUM ('alert', 'log', 'trace', 'deployment', 'kubernetes', 'comment', 'ownership', 'action', 'system');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('runbook', 'service_documentation', 'past_incident', 'postmortem', 'github_document');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('draft', 'pending', 'approved', 'rejected', 'executing', 'succeeded', 'failed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('approved', 'rejected');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "auth0_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "auth0_subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "repository_url" TEXT,
    "runbook_url" TEXT,
    "owner_team" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "labels" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_dependencies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "criticality" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "owner_id" UUID,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'triggered',
    "fingerprint" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "type" "TimelineEventType" NOT NULL,
    "source" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "ingested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_url" TEXT,
    "checksum" TEXT NOT NULL,
    "access_control" JSONB NOT NULL DEFAULT '{}',
    "indexed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536),

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hypotheses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "supporting_evidence" JSONB NOT NULL,
    "conflicting_evidence" JSONB NOT NULL,
    "recommended_checks" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "parameters" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "risk_summary" TEXT NOT NULL,
    "policy_snapshot" JSONB NOT NULL,
    "required_approvals" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'draft',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "action_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "action_request_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_executions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "action_request_id" UUID NOT NULL,
    "executor_job_id" TEXT NOT NULL,
    "preflight" JSONB NOT NULL,
    "result" JSONB,
    "verification" JSONB,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "metadata" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_auth0_id_key" ON "organizations"("auth0_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "users_organization_id_email_idx" ON "users"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_organization_id_auth0_subject_key" ON "users"("organization_id", "auth0_subject");

-- CreateIndex
CREATE INDEX "services_organization_id_owner_team_idx" ON "services"("organization_id", "owner_team");

-- CreateIndex
CREATE UNIQUE INDEX "services_organization_id_slug_environment_key" ON "services"("organization_id", "slug", "environment");

-- CreateIndex
CREATE INDEX "service_dependencies_organization_id_target_id_idx" ON "service_dependencies"("organization_id", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_dependencies_organization_id_source_id_target_id_ki_key" ON "service_dependencies"("organization_id", "source_id", "target_id", "kind");

-- CreateIndex
CREATE INDEX "incidents_organization_id_status_severity_started_at_idx" ON "incidents"("organization_id", "status", "severity", "started_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_organization_id_fingerprint_started_at_idx" ON "incidents"("organization_id", "fingerprint", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "incidents_organization_id_reference_key" ON "incidents"("organization_id", "reference");

-- CreateIndex
CREATE INDEX "timeline_events_organization_id_incident_id_occurred_at_idx" ON "timeline_events"("organization_id", "incident_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "timeline_events_organization_id_source_source_event_id_key" ON "timeline_events"("organization_id", "source", "source_event_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_updated_at_idx" ON "documents"("organization_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "documents_organization_id_kind_external_id_key" ON "documents"("organization_id", "kind", "external_id");

-- CreateIndex
CREATE INDEX "document_chunks_organization_id_document_id_idx" ON "document_chunks"("organization_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_ordinal_key" ON "document_chunks"("document_id", "ordinal");

-- CreateIndex
CREATE INDEX "hypotheses_organization_id_incident_id_generated_at_idx" ON "hypotheses"("organization_id", "incident_id", "generated_at" DESC);

-- CreateIndex
CREATE INDEX "action_requests_organization_id_status_expires_at_idx" ON "action_requests"("organization_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "action_requests_organization_id_idempotency_key_key" ON "action_requests"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "approvals_organization_id_decided_at_idx" ON "approvals"("organization_id", "decided_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "approvals_action_request_id_approver_id_key" ON "approvals"("action_request_id", "approver_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_executions_action_request_id_key" ON "action_executions"("action_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_executions_executor_job_id_key" ON "action_executions"("executor_job_id");

-- CreateIndex
CREATE INDEX "action_executions_organization_id_started_at_idx" ON "action_executions"("organization_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_organization_id_occurred_at_idx" ON "audit_events"("organization_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_organization_id_resource_type_resource_id_idx" ON "audit_events"("organization_id", "resource_type", "resource_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_dependencies" ADD CONSTRAINT "service_dependencies_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_dependencies" ADD CONSTRAINT "service_dependencies_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_action_request_id_fkey" FOREIGN KEY ("action_request_id") REFERENCES "action_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_action_request_id_fkey" FOREIGN KEY ("action_request_id") REFERENCES "action_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain constraints that Prisma cannot fully express.
ALTER TABLE "hypotheses"
    ADD CONSTRAINT "hypotheses_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1);

ALTER TABLE "action_requests"
    ADD CONSTRAINT "action_requests_approval_count_positive" CHECK ("required_approvals" > 0),
    ADD CONSTRAINT "action_requests_expiry_after_creation" CHECK ("expires_at" > "created_at");

CREATE INDEX "document_chunks_embedding_hnsw_idx"
    ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL;

-- Every request transaction sets this variable after validating its Auth0 token.
CREATE FUNCTION current_organization_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid
$$;

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "organizations_tenant_isolation" ON "organizations"
    USING ("id" = current_organization_id())
    WITH CHECK ("id" = current_organization_id());

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'users', 'services', 'service_dependencies', 'incidents', 'timeline_events',
        'documents', 'document_chunks', 'hypotheses', 'action_requests', 'approvals',
        'action_executions', 'audit_events'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY %I ON %I USING (organization_id = current_organization_id()) WITH CHECK (organization_id = current_organization_id())',
            table_name || '_tenant_isolation',
            table_name
        );
    END LOOP;
END $$;

-- Audit data is append-only, including for application owners.
CREATE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit events are immutable';
END;
$$;

CREATE TRIGGER "audit_events_reject_update"
    BEFORE UPDATE ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TRIGGER "audit_events_reject_delete"
    BEFORE DELETE ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
