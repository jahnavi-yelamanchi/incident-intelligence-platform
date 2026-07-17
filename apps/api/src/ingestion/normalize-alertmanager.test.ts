import { describe, expect, it } from "vitest";
import { normalizeAlertmanagerWebhook } from "./normalize-alertmanager.js";

describe("normalizeAlertmanagerWebhook", () => {
  it("normalizes labels and creates stable correlation fingerprints", () => {
    const webhook = {
      version: "4",
      groupKey: "service=checkout-api",
      status: "firing" as const,
      receiver: "aegis",
      groupLabels: {},
      commonLabels: { environment: "production" },
      commonAnnotations: {},
      alerts: [
        {
          status: "firing" as const,
          labels: { alertname: "HighLatency", service: "checkout-api", severity: "critical" },
          annotations: { summary: "Checkout latency is high" },
          startsAt: "2026-07-17T12:00:00.000Z",
          fingerprint: "prom-fingerprint",
        },
      ],
    };

    const organizationId = "75c56ad8-d17d-4d28-a4e3-66be34d4f18a";
    const first = normalizeAlertmanagerWebhook(webhook, organizationId, new Date("2026-07-17T12:01:00Z"));
    const second = normalizeAlertmanagerWebhook(webhook, organizationId, new Date("2026-07-17T12:02:00Z"));

    expect(first[0]).toMatchObject({
      organizationId,
      service: "checkout-api",
      environment: "production",
      severity: "critical",
      title: "Checkout latency is high",
    });
    expect(first[0]?.fingerprint).toBe(second[0]?.fingerprint);
    expect(first[0]?.sourceEventId).toBe(second[0]?.sourceEventId);
    expect(first[0]?.id).not.toBe(second[0]?.id);
  });
});
