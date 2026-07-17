import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { alertmanagerWebhookSchema, documentUpsertSchema, evidenceSearchSchema, type DocumentUpsert, type EvidenceSearch, type NormalizedEvent } from "@incident/contracts";
import Fastify, { LogController } from "fastify";
import websocket from "@fastify/websocket";
import rawBody from "fastify-raw-body";
import { z } from "zod";
import { normalizeAlertmanagerWebhook } from "./ingestion/normalize-alertmanager.js";
import { approvalDecisionSchema, createActionRequestSchema, listIncidentsQuerySchema, type ApprovalDecision, type CreateActionRequest, type ListIncidentsQuery } from "./incidents.js";
import type { ApiAuthContext } from "./security/auth0-access-token.js";
import { verifyWebhookSignature } from "./security/webhook-signature.js";
import { integrationUpsertSchema, type IntegrationUpsert } from "./integrations.js";
import { githubDeploymentStatusSchema, normalizeGitHubDeploymentStatus } from "./ingestion/normalize-github.js";
import { verifyGitHubSignature, verifySlackSignature } from "./security/integration-signatures.js";
import type { WebhookIntegration } from "./webhook-integrations.js";
import { accessTokenFromSocketProtocol, RealtimeHub, type RealtimeSocket } from "./realtime.js";
import type { SlackInboundResult } from "./slack-events.js";

export type IntegrationCredential = {
  organizationId: string;
  secret: string;
  enabled: boolean;
};

export type ApiDependencies = {
  corsOrigins: string[];
  getIntegrationCredential: (integrationId: string) => Promise<IntegrationCredential | null>;
  publishEvents: (events: NormalizedEvent[], correlationId: string) => Promise<void>;
  readiness: () => Promise<{ database: boolean; redis: boolean; queue: boolean }>;
  authenticate: (authorization: string | undefined) => Promise<ApiAuthContext | null>;
  listIncidents: (context: ApiAuthContext, query: ListIncidentsQuery) => Promise<unknown[]>;
  createActionRequest: (context: ApiAuthContext, incidentId: string, input: CreateActionRequest, correlationId: string) => Promise<unknown>;
  decideActionApproval: (context: ApiAuthContext, actionRequestId: string, input: ApprovalDecision, correlationId: string) => Promise<unknown>;
  cancelActionRequest: (context: ApiAuthContext, actionRequestId: string, reason: string, correlationId: string) => Promise<unknown>;
  upsertDocument: (context: ApiAuthContext, input: DocumentUpsert, correlationId: string) => Promise<unknown>;
  searchEvidence: (context: ApiAuthContext, input: EvidenceSearch) => Promise<unknown[]>;
  generateInvestigation: (context: ApiAuthContext, incidentId: string, correlationId: string) => Promise<unknown>;
  listHypotheses: (context: ApiAuthContext, incidentId: string) => Promise<unknown[]>;
  listIntegrations?: (context: ApiAuthContext) => Promise<unknown[]>;
  upsertIntegration?: (context: ApiAuthContext, input: IntegrationUpsert, correlationId: string) => Promise<unknown>;
  resolveWebhookIntegration?: (provider: "github" | "slack", connectionId: string) => Promise<WebhookIntegration | null>;
  beginSlackOAuth?: (context: ApiAuthContext) => Promise<string>;
  completeSlackOAuth?: (input: { code: string; state: string; correlationId: string }) => Promise<unknown>;
  processSlackEvent?: (organizationId: string, body: unknown, correlationId: string) => Promise<SlackInboundResult>;
  realtimeHub?: RealtimeHub;
  publishRealtime?: (organizationId: string, type: string, payload: unknown) => Promise<void>;
  logger?: boolean;
};

export async function buildApp(dependencies: ApiDependencies) {
  const app = Fastify({
    logger: dependencies.logger ?? true,
    bodyLimit: 2 * 1024 * 1024,
    requestIdHeader: "x-correlation-id",
    logController: new LogController({ requestIdLogLabel: "correlationId" }),
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: dependencies.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(rawBody, { field: "rawBody", global: false, encoding: "utf8", runFirst: true });
  await app.register(websocket);
  await app.register(swagger, {
    openapi: {
      info: { title: "Incident Intelligence API", version: "1.0.0" },
      servers: [{ url: "/" }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  const publishRealtime = async (organizationId: string, type: string, payload: unknown) => {
    if (dependencies.publishRealtime) return dependencies.publishRealtime(organizationId, type, payload);
    dependencies.realtimeHub?.publish(organizationId, type, payload);
  };

  app.get("/health/live", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  app.get("/v1/realtime", { websocket: true }, async (connection, request) => {
    const token = accessTokenFromSocketProtocol(request.headers["sec-websocket-protocol"]);
    const context = token ? await dependencies.authenticate(`Bearer ${token}`) : null;
    const socket = connection.socket as unknown as RealtimeSocket & { on: (event: string, listener: () => void) => void };
    if (!context || !dependencies.realtimeHub) { socket.close(1008, "unauthorized"); return; }
    const remove = dependencies.realtimeHub.add(context.organizationId, socket);
    socket.on("close", remove);
    socket.send(JSON.stringify({ type: "realtime.connected", payload: { organizationId: context.organizationId }, occurredAt: new Date().toISOString() }));
    const incidents = await dependencies.listIncidents(context, { limit: 25 });
    socket.send(JSON.stringify({ type: "incident.snapshot", payload: { items: incidents }, occurredAt: new Date().toISOString() }));
  });
  app.get("/health/ready", { config: { rateLimit: false } }, async (_request, reply) => {
    const checks = await dependencies.readiness();
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready", checks });
  });

  app.get("/v1/incidents", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });

    const parsed = listIncidentsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_query",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    return { items: await dependencies.listIncidents(context, parsed.data) };
  });

  app.post<{ Params: { incidentId: string } }>("/v1/incidents/:incidentId/actions", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });
    if (!context.roles.includes("responder") && !context.roles.includes("incident-commander")) {
      return reply.code(403).send({ error: "insufficient_role" });
    }
    const parsed = createActionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_action_request" });
    const action = await dependencies.createActionRequest(context, request.params.incidentId, parsed.data, request.id);
    await publishRealtime(context.organizationId, "action.requested", action);
    return reply.code(201).send(action);
  });

  app.post<{ Params: { actionRequestId: string } }>("/v1/actions/:actionRequestId/approval", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });
    const parsed = approvalDecisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_approval" });
    const decision = await dependencies.decideActionApproval(context, request.params.actionRequestId, parsed.data, request.id);
    await publishRealtime(context.organizationId, "action.approval_decided", decision);
    return reply.send(decision);
  });

  app.post<{ Params: { actionRequestId: string } }>("/v1/actions/:actionRequestId/cancel", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });
    const body = z.object({ reason: z.string().min(3).max(1_000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_cancellation" });
    const cancelled = await dependencies.cancelActionRequest(context, request.params.actionRequestId, body.data.reason, request.id);
    await publishRealtime(context.organizationId, "action.cancelled", cancelled);
    return reply.send(cancelled);
  });

  app.post("/v1/documents", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });
    const parsed = documentUpsertSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_document" });
    return reply.code(201).send(await dependencies.upsertDocument(context, parsed.data, request.id));
  });

  app.get("/v1/evidence/search", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });
    const parsed = evidenceSearchSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_evidence_query" });
    return { items: await dependencies.searchEvidence(context, parsed.data) };
  });

  app.post<{ Params: { incidentId: string } }>("/v1/incidents/:incidentId/investigation", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });
    return reply.code(201).send(await dependencies.generateInvestigation(context, request.params.incidentId, request.id));
  });

  app.get<{ Params: { incidentId: string } }>("/v1/incidents/:incidentId/hypotheses", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });
    return { items: await dependencies.listHypotheses(context, request.params.incidentId) };
  });

  app.get("/v1/integrations", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });
    if (!dependencies.listIntegrations) return reply.code(503).send({ error: "integrations_unavailable" });
    return { items: await dependencies.listIntegrations(context) };
  });

  app.put("/v1/integrations", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });
    if (!dependencies.upsertIntegration) return reply.code(503).send({ error: "integrations_unavailable" });
    const parsed = integrationUpsertSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_integration" });
    return reply.code(201).send(await dependencies.upsertIntegration(context, parsed.data, request.id));
  });

  app.get("/v1/integrations/slack/authorize", async (request, reply) => {
    const context = await dependencies.authenticate(request.headers.authorization);
    if (!context) return reply.code(401).send({ error: "unauthorized" });
    if (!dependencies.beginSlackOAuth) return reply.code(503).send({ error: "slack_oauth_unavailable" });
    return reply.redirect(await dependencies.beginSlackOAuth(context));
  });

  app.get("/v1/integrations/slack/callback", async (request, reply) => {
    if (!dependencies.completeSlackOAuth) return reply.code(503).send({ error: "slack_oauth_unavailable" });
    const query = z.object({ code: z.string().min(1), state: z.string().min(1), error: z.string().optional() }).safeParse(request.query);
    if (!query.success || query.data.error) return reply.code(400).send({ error: "slack_oauth_denied" });
    return reply.code(201).send(await dependencies.completeSlackOAuth({ code: query.data.code, state: query.data.state, correlationId: request.id }));
  });

  app.post<{ Params: { connectionId: string } }>("/v1/integrations/slack/:connectionId/events", { config: { rawBody: true, rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!dependencies.resolveWebhookIntegration || !dependencies.processSlackEvent) return reply.code(503).send({ error: "integrations_unavailable" });
    const connection = await dependencies.resolveWebhookIntegration("slack", request.params.connectionId);
    if (!connection || !connection.enabled) return reply.code(404).send({ error: "integration_not_found" });
    const raw = typeof request.rawBody === "string" ? request.rawBody : request.rawBody?.toString("utf8") ?? "";
    if (!verifySlackSignature(raw, connection.secret, request.headers["x-slack-signature"] as string | undefined, request.headers["x-slack-request-timestamp"] as string | undefined)) return reply.code(401).send({ error: "invalid_signature" });
    const result = await dependencies.processSlackEvent(connection.organizationId, request.body, request.id);
    if (result.kind === "challenge") return reply.send({ challenge: result.challenge });
    return reply.code(200).send({ ok: true, result: result.kind });
  });

  app.post<{ Params: { connectionId: string } }>("/v1/integrations/github/:connectionId/webhook", { config: { rawBody: true, rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!dependencies.resolveWebhookIntegration) return reply.code(503).send({ error: "integrations_unavailable" });
    const connection = await dependencies.resolveWebhookIntegration("github", request.params.connectionId);
    if (!connection || !connection.enabled) return reply.code(404).send({ error: "integration_not_found" });
    const rawBody = typeof request.rawBody === "string" ? request.rawBody : request.rawBody?.toString("utf8") ?? "";
    if (!verifyGitHubSignature(rawBody, connection.secret, request.headers["x-hub-signature-256"] as string | undefined)) return reply.code(401).send({ error: "invalid_signature" });
    if (request.headers["x-github-event"] !== "deployment_status") return reply.code(202).send({ accepted: true, eventCount: 0 });
    const payload = githubDeploymentStatusSchema.safeParse(request.body);
    if (!payload.success) return reply.code(400).send({ error: "invalid_payload" });
    await dependencies.publishEvents([normalizeGitHubDeploymentStatus(payload.data, connection.organizationId)], request.id);
    return reply.code(202).send({ accepted: true, eventCount: 1 });
  });

  app.post<{ Params: { integrationId: string } }>(
    "/v1/ingest/prometheus/:integrationId",
    {
      config: { rawBody: true, rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        params: {
          type: "object",
          required: ["integrationId"],
          properties: { integrationId: { type: "string", minLength: 8, maxLength: 128 } },
        },
        response: {
          202: {
            type: "object",
            required: ["accepted", "eventCount"],
            properties: { accepted: { type: "boolean" }, eventCount: { type: "integer" } },
          },
        },
      },
    },
    async (request, reply) => {
      const credential = await dependencies.getIntegrationCredential(request.params.integrationId);
      if (!credential || !credential.enabled) {
        return reply.code(404).send({ error: "integration_not_found" });
      }

      const signature = verifyWebhookSignature({
        body:
          typeof request.rawBody === "string"
            ? request.rawBody
            : request.rawBody?.toString("utf8") ?? "",
        secret: credential.secret,
        signature: request.headers["x-webhook-signature"] as string | undefined,
        timestamp: request.headers["x-webhook-timestamp"] as string | undefined,
      });
      if (!signature.valid) {
        request.log.warn({ reason: signature.reason }, "rejected webhook signature");
        return reply.code(401).send({ error: "invalid_signature" });
      }

      const parsed = alertmanagerWebhookSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_payload",
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        });
      }

      const events = normalizeAlertmanagerWebhook(parsed.data, credential.organizationId);
      await dependencies.publishEvents(events, request.id);
      return reply.code(202).send({ accepted: true, eventCount: events.length });
    },
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    void reply.code(statusCode).send({
      error: statusCode < 500 ? "request_error" : "internal_error",
      correlationId: request.id,
    });
  });

  return app;
}
