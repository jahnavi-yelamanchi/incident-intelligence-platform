import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createQueueRuntime } from "@incident/queues";
import { createDatabaseClient } from "@incident/database";
import { createActionRequest, decideActionApproval, listIncidents } from "./incidents.js";
import { createAuth0AccessTokenVerifier } from "./security/auth0-access-token.js";

const config = loadConfig();
const queues = createQueueRuntime(config.REDIS_URL);
const database = createDatabaseClient(config.DATABASE_URL);
const isDemoMode = config.NODE_ENV === "development" && config.DEMO_MODE === "true";
if (!isDemoMode && (!config.AUTH0_ISSUER_BASE_URL || !config.AUTH0_AUDIENCE)) {
  throw new Error("AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE are required to start the API.");
}
const authenticate = isDemoMode
  ? async (authorization: string | undefined) =>
      authorization === "Bearer aegis-demo"
        ? { subject: "demo-operator", organizationId: config.DEMO_ORGANIZATION_ID, roles: ["responder", "production-approver"] }
        : authorization === "Bearer aegis-demo-approver"
          ? { subject: "demo-approver", organizationId: config.DEMO_ORGANIZATION_ID, roles: ["production-approver"] }
        : null
  : createAuth0AccessTokenVerifier({
      issuer: config.AUTH0_ISSUER_BASE_URL!,
      audience: config.AUTH0_AUDIENCE!,
      organizationClaim: "https://incident-intelligence.example/organization_id",
      rolesClaim: "https://incident-intelligence.example/roles",
    });

const app = await buildApp({
  corsOrigins: config.CORS_ORIGINS.split(",").map((origin) => origin.trim()),
  // Production adapters are wired in the integration and queue packages.
  getIntegrationCredential: async () => null,
  publishEvents: async (events, correlationId) => {
    await queues.publishEvents(events, correlationId);
  },
  readiness: async () => {
    const ready = await queues.readiness().catch(() => false);
    const databaseReady = await database.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    return { database: databaseReady, redis: ready, queue: ready };
  },
  authenticate,
  listIncidents: (context, query) => listIncidents(database, context, query),
  createActionRequest: (context, incidentId, input, correlationId) =>
    createActionRequest(database, context, incidentId, input, correlationId),
  decideActionApproval: (context, actionRequestId, input, correlationId) =>
    decideActionApproval(database, context, actionRequestId, input, correlationId),
});

const close = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await queues.close();
  await database.$disconnect();
  process.exit(0);
};

process.once("SIGTERM", () => void close("SIGTERM"));
process.once("SIGINT", () => void close("SIGINT"));

await app.listen({ host: config.HOST, port: config.PORT });
