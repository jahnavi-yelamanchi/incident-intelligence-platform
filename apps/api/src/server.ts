import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const app = await buildApp({
  corsOrigins: config.CORS_ORIGINS.split(",").map((origin) => origin.trim()),
  // Production adapters are wired in the integration and queue packages.
  getIntegrationCredential: async () => null,
  publishEvents: async () => {
    throw new Error("Event publisher is not configured.");
  },
  readiness: async () => ({ database: false, redis: false, queue: false }),
});

const close = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.once("SIGTERM", () => void close("SIGTERM"));
process.once("SIGINT", () => void close("SIGINT"));

await app.listen({ host: config.HOST, port: config.PORT });
