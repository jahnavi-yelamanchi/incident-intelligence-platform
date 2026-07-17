import { normalizedEventSchema, type NormalizedEvent } from "@incident/contracts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const githubDeploymentStatusSchema = z.object({
  deployment_status: z.object({ id: z.number().int(), state: z.string().min(1), environment: z.string().optional(), created_at: z.string().datetime().optional(), description: z.string().optional(), target_url: z.string().url().optional() }),
  deployment: z.object({ id: z.number().int(), environment: z.string().optional(), ref: z.string().optional() }),
  repository: z.object({ full_name: z.string().min(1) }),
});

export function normalizeGitHubDeploymentStatus(payload: z.infer<typeof githubDeploymentStatusSchema>, organizationId: string, receivedAt = new Date()): NormalizedEvent {
  const environment = payload.deployment_status.environment ?? payload.deployment.environment ?? "unknown";
  const state = payload.deployment_status.state.toLowerCase();
  const resolved = ["success", "inactive", "destroyed"].includes(state);
  const severity: NormalizedEvent["severity"] = ["failure", "error"].includes(state) ? "high" : "low";
  return normalizedEventSchema.parse({
    id: randomUUID(), organizationId, source: "github", sourceEventId: `deployment-status:${payload.deployment_status.id}`,
    fingerprint: createHash("sha256").update(`${organizationId}:${payload.repository.full_name}:${environment}:${payload.deployment.id}`).digest("hex"),
    service: payload.repository.full_name, environment, severity,
    title: `GitHub deployment ${state}: ${payload.repository.full_name}`,
    description: payload.deployment_status.description ?? `Deployment ${payload.deployment.ref ?? payload.deployment.id} is ${state}.`,
    status: resolved ? "resolved" : "firing", occurredAt: payload.deployment_status.created_at ?? receivedAt.toISOString(), receivedAt: receivedAt.toISOString(),
    attributes: { repository: payload.repository.full_name, deploymentId: String(payload.deployment.id), state }, rawPayload: payload,
  });
}
