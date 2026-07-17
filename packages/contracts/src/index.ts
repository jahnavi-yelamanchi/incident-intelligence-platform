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

export type Incident = z.infer<typeof incidentSchema>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type ActionRequest = z.infer<typeof actionRequestSchema>;
