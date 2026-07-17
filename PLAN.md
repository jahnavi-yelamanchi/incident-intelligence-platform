# Incident Intelligence and Runbook Execution Platform

## Product

Build one production release of a multi-tenant incident-operations SaaS on AWS/EKS. The product ingests operational signals, correlates incidents, retrieves relevant knowledge, produces cited AI investigation hypotheses, and executes narrowly scoped Kubernetes/AWS remediation only after policy checks and human approval. The responsive console uses an original black, charcoal, white, and gold visual system inspired by high-performance automotive interfaces without proprietary assets or fonts.

## Architecture and Data

- TypeScript monorepo: Next.js console, Fastify API, ingestion/correlation workers, AI investigation service, integration workers, action executor, and shared Zod/OpenAPI contracts.
- AWS infrastructure through Terraform and Helm: EKS, RDS PostgreSQL with `pgvector`, ElastiCache Redis, S3, SQS/DLQs, KMS, Secrets Manager, CloudFront/WAF, OpenTelemetry, multi-AZ backups, and restore procedures.
- Signed, replay-resistant ingestion for Alertmanager, generic webhooks, OpenTelemetry/logs, GitHub deployments, and Kubernetes events. Normalize into a tenant-scoped event envelope, deduplicate, preserve raw evidence, and correlate by service, environment, topology, fingerprint, deployment, and time window.
- Model organizations, users, roles, teams, services, dependencies, alerts, incidents, timelines, responders, documents, citations, hypotheses, policies, approvals, executions, integrations, and immutable audit events. Support incident ownership, severity/state, comments, attachments, merge/split, related incidents, postmortems, and live authenticated WebSocket replay.

## Investigation, Integrations, and Actions

- Index runbooks, service docs, GitHub content, incidents, and postmortems using tenant-scoped hybrid retrieval, metadata ACLs, reranking, freshness, citation-preserving chunks, and `pgvector` similarity search.
- Use a provider interface with an OpenAI production adapter for embeddings and structured hypotheses. Show confidence, supporting/conflicting evidence, recommended checks, and citations; never present uncited model output as verified fact.
- Ship real GitHub App and Slack OAuth integrations for repository/document sync, deploy history, issues/PRs, incident channels, notifications, ownership, approval prompts, and execution results.
- Execute versioned, allowlisted Kubernetes restart/scale/pause/resume/rollback and approved AWS actions through isolated jobs and short-lived credentials. Models can request only typed tools—never shell access or credentials.
- Enforce preflight/dry-run, policy evaluation, role/quorum approval, expiration, typed parameters, idempotency, cancellation, timeout, post-action verification, audit history, and compensating guidance.

## Security, Operations, and UX

- Enterprise OIDC/SAML SSO, MFA policy, organization membership, service accounts, scoped API keys, RBAC, service ownership, session controls, and break-glass access.
- Tenant isolation across SQL, vectors, queues, cache, storage, WebSockets, integrations, and audit data; encryption, token rotation, secret redaction, rate limits, CSRF/SSRF defenses, network/pod policies, signed images, SBOMs, and dependency/container/policy scanning.
- Command center, incident queue, service graph, investigation workspace, evidence/citations, runbook execution, approval inbox, integrations, policy administration, audit explorer, and organization settings. Meet WCAG AA with keyboard navigation, semantic markup, accessible charts, and reduced motion.
- Structured logs, traces, metrics, health/readiness, SLOs, queue and model-cost dashboards, alerting, controlled migrations, backup validation, disaster-recovery runbooks, and operator documentation.

## Quality and Acceptance

- Version all REST, webhook, and WebSocket contracts; publish OpenAPI and shared SDK types. Test schemas, tenant isolation, RBAC, signatures, deduplication, correlation, retrieval/citations, prompt injection, policy/approval races, action idempotency and verification, retries, replay, token rotation, and restore.
- Include unit, integration, contract, migration, security, load, failure-injection, and Playwright suites. Acceptance requires live Prometheus, Kubernetes, GitHub, Slack, SSO, OpenAI, and AWS paths; an approved remediation with complete audit history; denied unauthorized actions; verified isolation and recovery; production observability; and reproducible Terraform/Helm deployment.
- Work in small, meaningful commits and push frequently after the GitHub remote is confirmed. Never commit secrets, create empty activity commits, or push failing checkpoints to the protected release branch.

## Delivery Checkpoint

Initialize this repository and commit this plan first. Pause until the GitHub remote is connected and explicitly confirmed; only then begin implementation and pushing.
