import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createQueueRuntime } from "@incident/queues";

const config = loadConfig();
const queues = createQueueRuntime(config.REDIS_URL);

const app = await buildApp({
  corsOrigins: config.CORS_ORIGINS.split(",").map((origin) => origin.trim()),
  // Production adapters are wired in the integration and queue packages.
  getIntegrationCredential: async () => null,
  publishEvents: async (events, correlationId) => {
    await queues.publishEvents(events, correlationId);
  },
  readiness: async () => {
    const ready = await queues.readiness().catch(() => false);
    return { database: false, redis: ready, queue: ready };
  },
});

const close = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await queues.close();
  process.exit(0);
};

process.once("SIGTERM", () => void close("SIGTERM"));
process.once("SIGINT", () => void close("SIGINT"));

await app.listen({ host: config.HOST, port: config.PORT });
