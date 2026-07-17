import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { alertmanagerWebhookSchema, type NormalizedEvent } from "@incident/contracts";
import Fastify, { LogController } from "fastify";
import rawBody from "fastify-raw-body";
import { normalizeAlertmanagerWebhook } from "./ingestion/normalize-alertmanager.js";
import { verifyWebhookSignature } from "./security/webhook-signature.js";

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
  await app.register(swagger, {
    openapi: {
      info: { title: "Incident Intelligence API", version: "1.0.0" },
      servers: [{ url: "/" }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/health/live", { config: { rateLimit: false } }, async () => ({ status: "ok" }));
  app.get("/health/ready", { config: { rateLimit: false } }, async (_request, reply) => {
    const checks = await dependencies.readiness();
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready", checks });
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
