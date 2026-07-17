import { z } from "zod";

export const severitySchema = z.enum(["critical", "high", "medium", "low"]);
export const incidentStatusSchema = z.enum([
  "triggered",
  "investigating",
  "identified",
  "monitoring",
  "resolved",
]);

export const incidentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  reference: z.string().regex(/^INC-[0-9]+$/),
  title: z.string().min(1).max(160),
  service: z.string().min(1).max(120),
  severity: severitySchema,
  status: incidentStatusSchema,
  ownerName: z.string().min(1).max(120).nullable(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const evidenceCitationSchema = z.object({
  id: z.string().uuid(),
  sourceType: z.enum(["metric", "log", "trace", "deploy", "runbook", "incident"]),
  title: z.string().min(1),
  excerpt: z.string().min(1),
  observedAt: z.string().datetime(),
  sourceUrl: z.string().url().optional(),
});

export const documentKindSchema = z.enum([
  "runbook",
  "service_documentation",
  "past_incident",
  "postmortem",
  "github_document",
]);

export const documentUpsertSchema = z.object({
  kind: documentKindSchema,
  externalId: z.string().min(1).max(512),
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(2_000_000),
  sourceUrl: z.string().url().optional(),
  accessControl: z.record(z.string(), z.unknown()).default({}),
});

export const evidenceSearchSchema = z.object({
  query: z.string().min(2).max(1_000),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  kinds: z.array(documentKindSchema).max(5).optional(),
});

export const hypothesisSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  statement: z.string().min(1),
  confidence: z.number().min(0).max(1),
  citations: z.array(evidenceCitationSchema).min(1),
  recommendedChecks: z.array(z.string()).min(1),
  conflictingEvidence: z.array(z.string()),
  generatedAt: z.string().datetime(),
});

export const actionTypeSchema = z.enum([
  "kubernetes.restart",
  "kubernetes.scale",
  "kubernetes.pause-rollout",
  "kubernetes.resume-rollout",
  "kubernetes.rollback",
  "aws.rds.failover",
]);

export const actionRequestSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  incidentId: z.string().uuid(),
  actionType: actionTypeSchema,
  parameters: z.record(z.string(), z.unknown()),
  reason: z.string().min(10).max(1000),
  idempotencyKey: z.string().min(16).max(128),
  status: z.enum(["draft", "pending", "approved", "rejected", "executing", "succeeded", "failed", "cancelled", "expired"]),
  expiresAt: z.string().datetime(),
});

export const normalizedEventSourceSchema = z.enum([
  "prometheus",
  "generic_webhook",
  "opentelemetry",
  "github",
  "kubernetes",
]);

export const normalizedEventSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  source: normalizedEventSourceSchema,
  sourceEventId: z.string().min(1).max(512),
  fingerprint: z.string().min(16).max(256),
  service: z.string().min(1).max(120),
  environment: z.string().min(1).max(80),
  severity: severitySchema,
  title: z.string().min(1).max(240),
  description: z.string().max(10_000).default(""),
  status: z.enum(["firing", "resolved"]),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  attributes: z.record(z.string(), z.string()),
  rawPayload: z.record(z.string(), z.unknown()),
});

export const alertmanagerAlertSchema = z.object({
  status: z.enum(["firing", "resolved"]),
  labels: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.string()).default({}),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  generatorURL: z.string().url().optional(),
  fingerprint: z.string().min(1),
});

export const alertmanagerWebhookSchema = z.object({
  version: z.string().min(1),
  groupKey: z.string().min(1),
  status: z.enum(["firing", "resolved"]),
  receiver: z.string().min(1),
  groupLabels: z.record(z.string(), z.string()).default({}),
  commonLabels: z.record(z.string(), z.string()).default({}),
  commonAnnotations: z.record(z.string(), z.string()).default({}),
  externalURL: z.string().url().optional(),
  alerts: z.array(alertmanagerAlertSchema).min(1).max(1000),
});

export type Incident = z.infer<typeof incidentSchema>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type ActionRequest = z.infer<typeof actionRequestSchema>;
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type AlertmanagerWebhook = z.infer<typeof alertmanagerWebhookSchema>;
export type DocumentUpsert = z.infer<typeof documentUpsertSchema>;
export type EvidenceSearch = z.infer<typeof evidenceSearchSchema>;
