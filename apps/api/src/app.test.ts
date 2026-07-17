import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

describe("API", () => {
  it("accepts a signed Alertmanager webhook and publishes normalized events", async () => {
    const publishEvents = vi.fn(async () => undefined);
    const app = await buildApp({
      logger: false,
      corsOrigins: ["http://localhost:3000"],
      getIntegrationCredential: async () => ({
        organizationId: "75c56ad8-d17d-4d28-a4e3-66be34d4f18a",
        secret: "webhook-secret",
        enabled: true,
      }),
      publishEvents,
      readiness: async () => ({ database: true, redis: true, queue: true }),
    });

    const payload = JSON.stringify({
      version: "4",
      groupKey: "service=checkout-api",
      status: "firing",
      receiver: "aegis",
      alerts: [
        {
          status: "firing",
          labels: { alertname: "HighLatency", service: "checkout-api", severity: "critical" },
          annotations: { summary: "Checkout latency is high" },
          startsAt: "2026-07-17T12:00:00.000Z",
          fingerprint: "prom-fingerprint",
        },
      ],
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "webhook-secret")
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/prometheus/integration-123",
      headers: {
        "content-type": "application/json",
        "x-webhook-timestamp": timestamp,
        "x-webhook-signature": `sha256=${signature}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true, eventCount: 1 });
    expect(publishEvents).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns not-ready when any required dependency is unavailable", async () => {
    const app = await buildApp({
      logger: false,
      corsOrigins: [],
      getIntegrationCredential: async () => null,
      publishEvents: async () => undefined,
      readiness: async () => ({ database: true, redis: false, queue: true }),
    });

    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe("not_ready");
    await app.close();
  });
});
