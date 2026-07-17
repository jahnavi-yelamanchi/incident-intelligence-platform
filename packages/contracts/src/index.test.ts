import { describe, expect, it } from "vitest";
import { alertmanagerWebhookSchema, normalizedEventSchema } from "./index";

describe("ingestion contracts", () => {
  it("rejects unbounded alert batches", () => {
    const alert = {
      status: "firing",
      labels: { alertname: "HighLatency", service: "checkout-api" },
      annotations: {},
      startsAt: "2026-07-17T12:00:00.000Z",
      fingerprint: "abc",
    };

    const result = alertmanagerWebhookSchema.safeParse({
      version: "4",
      groupKey: "service=checkout-api",
      status: "firing",
      receiver: "aegis",
      alerts: Array.from({ length: 1001 }, () => alert),
    });

    expect(result.success).toBe(false);
  });

  it("requires tenant identity on normalized events", () => {
    const result = normalizedEventSchema.safeParse({ source: "prometheus" });
    expect(result.success).toBe(false);
  });
});
