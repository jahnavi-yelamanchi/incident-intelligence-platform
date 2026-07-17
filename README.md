# Aegis Incident Intelligence

A production-oriented incident intelligence and runbook execution platform. Aegis ingests operational events, correlates incidents, retrieves cited evidence, coordinates human approvals, and executes narrowly scoped remediation through durable workflows.

## Architecture

- Next.js 16 command center with Auth0 enterprise identity
- Fastify API with signed webhook ingestion and OpenAPI
- PostgreSQL 17, Prisma, row-level security, immutable audit history, and `pgvector`
- Redis and BullMQ for ingestion, correlation, caching, locks, and real-time fan-out
- Temporal for crash-safe approval and remediation workflows
- Kubernetes and AWS executors using typed, allowlisted operations
- Terraform, Helm, EKS, RDS, ElastiCache, SQS, S3, KMS, Secrets Manager, CloudFront, and WAF

## Local development

Requirements: Node.js 22+, pnpm 11+, and Docker.

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm --filter @incident/database db:migrate
pnpm dev
```

Local services:

- Web console: `http://localhost:3000`
- API and OpenAPI: `http://localhost:4000/docs`
- Temporal UI: `http://localhost:8080`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

Auth0 is bypassed only in local development when its variables are absent. Production fails closed. See `docs/security/IDENTITY.md` for token claims and tenant mapping.

Database migrations use the owner-only `MIGRATION_DATABASE_URL`; application processes use the restricted `DATABASE_URL`. Never run the API with the migration owner because PostgreSQL superusers bypass row-level security.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Every pull request and `main` push runs this same verification set in GitHub Actions, plus dependency review. Production release gates and recovery validation are documented in [RELEASE.md](docs/operations/RELEASE.md).

Operational credentials must never be committed. Production workloads receive short-lived AWS credentials through IRSA and Kubernetes permissions through dedicated service accounts.

Integration setup and signed webhook contracts are documented in [INTEGRATIONS.md](docs/operations/INTEGRATIONS.md).

## Live local demo

Use separate terminals after starting Docker and applying migrations:

```bash
DEMO_MODE=true pnpm --filter @incident/workers demo:seed
DEMO_MODE=true pnpm --filter @incident/api dev
DATABASE_URL=postgresql://incident_app:incident_app@localhost:5432/incident pnpm --filter @incident/workers dev
DEMO_MODE=true API_BASE_URL=http://localhost:4000 pnpm --filter @incident/web dev
```

The demo token is accepted only when the API runs in development with `DEMO_MODE=true`. The console reads and selects real records from PostgreSQL; production continues to require verified Auth0 access tokens.
