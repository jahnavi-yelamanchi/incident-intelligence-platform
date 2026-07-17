import { createDatabaseClient } from "@incident/database";
import {
  createQueueRuntime,
  createWorkerConnection,
  queueEnvelopeSchema,
  queueNames,
  type QueueEnvelope,
} from "@incident/queues";
import { Worker } from "bullmq";
import pino from "pino";
import { loadWorkerConfig } from "./config.js";
import { isTerminalFailure, persistOperationalEvent } from "./ingestion.js";

const config = loadWorkerConfig();
const logger = pino({ level: config.LOG_LEVEL });
const database = createDatabaseClient(config.DATABASE_URL);
const queues = createQueueRuntime(config.REDIS_URL);
const connection = createWorkerConnection(config.REDIS_URL);

const ingestionWorker = new Worker<QueueEnvelope>(
  queueNames.ingestion,
  async (job) => {
    const envelope = queueEnvelopeSchema.parse(job.data);
    await job.updateProgress(10);
    const event = await persistOperationalEvent(database, queues, envelope);
    await job.updateProgress(100);
    return { eventId: event.id };
  },
  { connection, concurrency: config.INGESTION_CONCURRENCY },
);

ingestionWorker.on("completed", (job) => {
  logger.info({ jobId: job.id, eventId: job.data.eventId }, "operational event persisted");
});

ingestionWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, err: error }, "operational event ingestion failed");
  if (!job || !isTerminalFailure(job.attemptsMade, job.opts.attempts)) return;

  void queues
    .publishDeadLetter({
      sourceQueue: queueNames.ingestion,
      jobId: job.id ?? "unknown",
      correlationId: job.data.correlationId,
      failedAt: new Date().toISOString(),
      error: {
        name: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
      },
      data: job.data,
    })
    .catch((deadLetterError: unknown) => {
      logger.fatal({ err: deadLetterError, jobId: job.id }, "failed to publish dead letter");
    });
});

const close = async (signal: string) => {
  logger.info({ signal }, "shutting down ingestion worker");
  await ingestionWorker.close();
  await queues.close();
  await connection.quit();
  await database.$disconnect();
};

process.once("SIGTERM", () => void close("SIGTERM"));
process.once("SIGINT", () => void close("SIGINT"));

logger.info(
  { queue: queueNames.ingestion, concurrency: config.INGESTION_CONCURRENCY },
  "ingestion worker ready",
);
