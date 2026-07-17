import { createHmac } from "node:crypto";
import type { NormalizedEvent } from "@incident/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

const context = {
  subject: "auth0|operator",
  organizationId: "75c56ad8-d17d-4d28-a4e3-66be34d4f18a",
  roles: ["responder"],
};

describe("API", () => {
  it("accepts a signed Alertmanager webhook and publishes normalized events", async () => {
    const publishEvents = vi.fn<
      (events: NormalizedEvent[], correlationId: string) => Promise<void>
    >(async () => undefined);
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
      authenticate: async () => context,
      listIncidents: async () => [],
      createActionRequest: async () => ({}),
      decideActionApproval: async () => ({}),
      cancelActionRequest: async () => ({}),
      upsertDocument: async () => ({}),
      searchEvidence: async () => [],
      generateInvestigation: async () => ({}),
      listHypotheses: async () => [],
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
    expect(publishEvents.mock.calls[0]?.[1]).toBeTypeOf("string");
    await app.close();
  });

  it("returns not-ready when any required dependency is unavailable", async () => {
    const app = await buildApp({
      logger: false,
      corsOrigins: [],
      getIntegrationCredential: async () => null,
      publishEvents: async () => undefined,
      readiness: async () => ({ database: true, redis: false, queue: true }),
      authenticate: async () => null,
      listIncidents: async () => [],
      createActionRequest: async () => ({}),
      decideActionApproval: async () => ({}),
      cancelActionRequest: async () => ({}),
      upsertDocument: async () => ({}),
      searchEvidence: async () => [],
      generateInvestigation: async () => ({}),
      listHypotheses: async () => [],
    });

    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe("not_ready");
    await app.close();
  });

  it("derives the tenant from an authenticated access token context", async () => {
    const listIncidents = vi.fn(async () => []);
    const app = await buildApp({
      logger: false,
      corsOrigins: [],
      getIntegrationCredential: async () => null,
      publishEvents: async () => undefined,
      readiness: async () => ({ database: true, redis: true, queue: true }),
      authenticate: async (authorization) => (authorization ? context : null),
      listIncidents,
      createActionRequest: async () => ({}),
      decideActionApproval: async () => ({}),
      cancelActionRequest: async () => ({}),
      upsertDocument: async () => ({}),
      searchEvidence: async () => [],
      generateInvestigation: async () => ({}),
      listHypotheses: async () => [],
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/incidents?status=investigating&limit=10",
      headers: { authorization: "Bearer signed-access-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(listIncidents).toHaveBeenCalledWith(context, { status: "investigating", limit: 10 });
    await app.close();
  });

  it("indexes documents and retrieves evidence only for the authenticated tenant", async () => {
    const upsertDocument = vi.fn(async () => ({ id: "document-id", chunkCount: 1 }));
    const searchEvidence = vi.fn(async () => []);
    const app = await buildApp({
      logger: false,
      corsOrigins: [],
      getIntegrationCredential: async () => null,
      publishEvents: async () => undefined,
      readiness: async () => ({ database: true, redis: true, queue: true }),
      authenticate: async () => context,
      listIncidents: async () => [],
      createActionRequest: async () => ({}),
      decideActionApproval: async () => ({}),
      cancelActionRequest: async () => ({}),
      upsertDocument,
      searchEvidence,
      generateInvestigation: async () => ({}),
      listHypotheses: async () => [],
    });

    const create = await app.inject({
      method: "POST",
      url: "/v1/documents",
      payload: { kind: "runbook", externalId: "checkout-v1", title: "Checkout runbook", content: "Verify checkout latency before scaling." },
    });
    const search = await app.inject({ method: "GET", url: "/v1/evidence/search?query=checkout%20latency" });
    expect(create.statusCode).toBe(201);
    expect(upsertDocument).toHaveBeenCalledWith(context, expect.objectContaining({ externalId: "checkout-v1" }), expect.any(String));
    expect(search.statusCode).toBe(200);
    expect(searchEvidence).toHaveBeenCalledWith(context, { query: "checkout latency", limit: 8 });
    await app.close();
  });

  it("starts an investigation with the authenticated tenant and incident identifier", async () => {
    const generateInvestigation = vi.fn(async () => ({ items: [] }));
    const app = await buildApp({
      logger: false,
      corsOrigins: [],
      getIntegrationCredential: async () => null,
      publishEvents: async () => undefined,
      readiness: async () => ({ database: true, redis: true, queue: true }),
      authenticate: async () => context,
      listIncidents: async () => [],
      createActionRequest: async () => ({}),
      decideActionApproval: async () => ({}),
      cancelActionRequest: async () => ({}),
      upsertDocument: async () => ({}),
      searchEvidence: async () => [],
      generateInvestigation,
      listHypotheses: async () => [],
    });
    const response = await app.inject({ method: "POST", url: "/v1/incidents/75c56ad8-d17d-4d28-a4e3-66be34d4f18a/investigation" });
    expect(response.statusCode).toBe(201);
    expect(generateInvestigation).toHaveBeenCalledWith(context, "75c56ad8-d17d-4d28-a4e3-66be34d4f18a", expect.any(String));
    await app.close();
  });

  it("keeps integration credentials behind an authenticated administrator boundary", async () => {
    const upsertIntegration = vi.fn(async () => ({ id: "integration-id" }));
    const app = await buildApp({
      logger: false, corsOrigins: [], getIntegrationCredential: async () => null, publishEvents: async () => undefined,
      readiness: async () => ({ database: true, redis: true, queue: true }), authenticate: async () => ({ ...context, roles: ["administrator"] }),
      listIncidents: async () => [], createActionRequest: async () => ({}), decideActionApproval: async () => ({}), cancelActionRequest: async () => ({}),
      upsertDocument: async () => ({}), searchEvidence: async () => [], generateInvestigation: async () => ({}), listHypotheses: async () => [],
      listIntegrations: async () => [], upsertIntegration,
    });
    const response = await app.inject({ method: "PUT", url: "/v1/integrations", payload: { provider: "github", externalId: "123", credentials: { webhookSecret: "not-returned" } } });
    expect(response.statusCode).toBe(201);
    expect(upsertIntegration).toHaveBeenCalledWith(expect.objectContaining({ roles: ["administrator"] }), expect.objectContaining({ provider: "github" }), expect.any(String));
    await app.close();
  });

  it("authenticates GitHub deployment webhooks before publishing normalized events", async () => {
    const publishEvents = vi.fn(async () => undefined);
    const app = await buildApp({
      logger: false, corsOrigins: [], getIntegrationCredential: async () => null, publishEvents,
      readiness: async () => ({ database: true, redis: true, queue: true }), authenticate: async () => null,
      listIncidents: async () => [], createActionRequest: async () => ({}), decideActionApproval: async () => ({}), cancelActionRequest: async () => ({}), upsertDocument: async () => ({}), searchEvidence: async () => [], generateInvestigation: async () => ({}), listHypotheses: async () => [],
      resolveWebhookIntegration: async () => ({ organizationId: context.organizationId, secret: "github-secret", enabled: true }),
    });
    const payload = JSON.stringify({ deployment_status: { id: 3, state: "failure", environment: "production", created_at: "2026-07-17T12:00:00.000Z" }, deployment: { id: 2 }, repository: { full_name: "acme/checkout" } });
    const signature = `sha256=${createHmac("sha256", "github-secret").update(payload).digest("hex")}`;
    const response = await app.inject({ method: "POST", url: "/v1/integrations/github/75c56ad8-d17d-4d28-a4e3-66be34d4f18a/webhook", headers: { "content-type": "application/json", "x-hub-signature-256": signature, "x-github-event": "deployment_status" }, payload });
    expect(response.statusCode).toBe(202);
    expect(publishEvents).toHaveBeenCalledOnce();
    await app.close();
  });

  it("redirects authorized users to Slack and completes only valid callback input", async () => {
    const app = await buildApp({
      logger: false, corsOrigins: [], getIntegrationCredential: async () => null, publishEvents: async () => undefined,
      readiness: async () => ({ database: true, redis: true, queue: true }), authenticate: async () => ({ ...context, roles: ["administrator"] }),
      listIncidents: async () => [], createActionRequest: async () => ({}), decideActionApproval: async () => ({}), cancelActionRequest: async () => ({}), upsertDocument: async () => ({}), searchEvidence: async () => [], generateInvestigation: async () => ({}), listHypotheses: async () => [],
      beginSlackOAuth: async () => "https://slack.com/oauth/v2/authorize?state=state", completeSlackOAuth: async () => ({ id: "slack-id" }),
    });
    const start = await app.inject({ method: "GET", url: "/v1/integrations/slack/authorize", headers: { authorization: "Bearer token" } });
    expect(start.statusCode).toBe(302);
    const callback = await app.inject({ method: "GET", url: "/v1/integrations/slack/callback?code=code&state=state" });
    expect(callback.statusCode).toBe(201);
    await app.close();
  });
});
