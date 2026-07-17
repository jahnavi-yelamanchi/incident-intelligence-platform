import {
  normalizedEventSchema,
  type AlertmanagerWebhook,
  type NormalizedEvent,
} from "@incident/contracts";
import { createHash, randomUUID } from "node:crypto";

const severityMap: Record<string, NormalizedEvent["severity"]> = {
  critical: "critical",
  page: "critical",
  high: "high",
  warning: "medium",
  medium: "medium",
  info: "low",
  low: "low",
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeAlertmanagerWebhook(
  webhook: AlertmanagerWebhook,
  organizationId: string,
  receivedAt = new Date(),
): NormalizedEvent[] {
  return webhook.alerts.map((alert) => {
    const labels = { ...webhook.commonLabels, ...alert.labels };
    const annotations = { ...webhook.commonAnnotations, ...alert.annotations };
    const service = labels.service ?? labels.job ?? labels.app ?? "unknown-service";
    const environment = labels.environment ?? labels.env ?? labels.cluster ?? "unknown";
    const severity = severityMap[(labels.severity ?? "medium").toLowerCase()] ?? "medium";
    const sourceEventId = `${alert.fingerprint}:${alert.startsAt}:${alert.status}`;
    const correlationFingerprint = digest(
      [organizationId, service, environment, labels.alertname ?? "alert", alert.fingerprint].join(":"),
    );

    return normalizedEventSchema.parse({
      id: randomUUID(),
      organizationId,
      source: "prometheus",
      sourceEventId,
      fingerprint: correlationFingerprint,
      service,
      environment,
      severity,
      title: annotations.summary ?? labels.alertname ?? "Prometheus alert",
      description: annotations.description ?? "",
      status: alert.status,
      occurredAt: alert.startsAt,
      receivedAt: receivedAt.toISOString(),
      attributes: labels,
      rawPayload: alert,
    });
  });
}

