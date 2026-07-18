# Aegis Incident Intelligence

Aegis is an incident-intelligence and approved-remediation platform for production operations. It ingests signed operational signals, correlates incidents, retrieves cited runbook evidence, coordinates human approvals, and executes narrowly scoped Kubernetes or AWS actions through durable workflows.

![Aegis operational signal flowing through an approval gate to a Kubernetes service cluster](assets/readme/aegis-operations-flow.png)

## What it does

- Command-center console for incidents, services, runbooks, approvals, audit history, and integrations
- Signed ingestion for Prometheus Alertmanager, generic operational events, GitHub deployment status, Slack events, OpenTelemetry, and Kubernetes signals
- Tenant-scoped PostgreSQL data model with row-level security, encrypted integration credentials, immutable audit records, and `pgvector`
- Hybrid runbook retrieval with lexical ranking and OpenAI embeddings when `OPENAI_API_KEY` is configured
- Cited investigation hypotheses with structured outputs and prompt-injection safeguards
- Human-gated remediation workflows with policy checks, expiration, independent approvals, cancellation, preflight, verification, and idempotency
- Allowlisted Kubernetes restart, scale, pause/resume rollout, and rollback actions, plus guarded AWS RDS failover support
- Auth0 organization-aware access tokens, RBAC, authenticated WebSockets, Redis fan-out, BullMQ, and Temporal workflows
- Terraform and Helm deployment foundations for AWS/EKS

## Architecture

```mermaid
flowchart LR
  signals["Alerts, logs, deploys, Slack & GitHub events"] --> ingest["Signed ingestion\nFastify · Zod · HMAC"]
  ingest --> correlate["Correlation workers\nBullMQ · Redis"]
  correlate --> incident["Incident system of record\nPostgreSQL · Prisma · RLS"]
  incident --> console["Operations console\nNext.js · WebSockets"]
  incident --> retrieve["Evidence retrieval\npgvector · lexical ranking · OpenAI embeddings"]
  retrieve --> investigate["Cited investigation\nOpenAI structured outputs"]
  investigate --> gate["Approval gate\nOPA policies · Temporal"]
  gate --> execute["Typed remediation\nKubernetes client · AWS SDK"]
  execute --> incident
```

## Stack

Next.js · TypeScript · Fastify · PostgreSQL + pgvector · Redis · BullMQ · Temporal · Prisma · Auth0 · OpenAI · Kubernetes · AWS · Terraform · Helm

## Run locally

Requirements: Node.js 22.13+, pnpm 11, and Docker.

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm --filter @incident/database db:migrate
```

Start the interactive local environment in separate terminals:

```bash
DEMO_MODE=true pnpm --filter @incident/workers demo:seed
DEMO_MODE=true pnpm --filter @incident/api dev
DATABASE_URL=postgresql://incident_app:incident_app@localhost:5432/incident pnpm --filter @incident/workers dev
DEMO_MODE=true API_BASE_URL=http://localhost:4000 pnpm --filter @incident/web dev
```

Open the console at `http://localhost:3000`. API documentation is available at `http://localhost:4000/docs` and Temporal UI at `http://localhost:8080`.

## Configure providers

Add provider credentials only to your local `.env` or production secret manager—never commit them.

```env
OPENAI_API_KEY=
OPENAI_INVESTIGATION_MODEL=gpt-5.6
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

Integration endpoints, environment variables, and signed webhook contracts are documented in [INTEGRATIONS.md](docs/operations/INTEGRATIONS.md). Production release and recovery procedures are in [RELEASE.md](docs/operations/RELEASE.md).

## Verify

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
