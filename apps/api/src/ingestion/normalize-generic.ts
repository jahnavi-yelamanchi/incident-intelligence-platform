import { createHash, randomUUID } from "node:crypto";
import { normalizedEventSchema, type NormalizedEvent } from "@incident/contracts";
import { z } from "zod";

export const genericEventSchema = z.object({
  source: z.enum(["generic_webhook", "opentelemetry", "kubernetes"]), sourceEventId: z.string().min(1).max(512), service: z.string().min(1).max(120), environment: z.string().min(1).max(80), severity: z.enum(["critical", "high", "medium", "low"]), title: z.string().min(1).max(240), description: z.string().max(10_000).default(""), status: z.enum(["firing", "resolved"]), occurredAt: z.string().datetime(), attributes: z.record(z.string(), z.string()).default({}), payload: z.record(z.string(), z.unknown()).default({}),
});

export function normalizeGenericEvent(input: z.infer<typeof genericEventSchema>, organizationId: string, receivedAt = new Date()): NormalizedEvent {
  const fingerprint = createHash("sha256").update([organizationId, input.service, input.environment, input.title, input.sourceEventId].join(":")) .digest("hex");
  return normalizedEventSchema.parse({ id: randomUUID(), organizationId, ...input, fingerprint, receivedAt: receivedAt.toISOString(), rawPayload: input.payload });
}
