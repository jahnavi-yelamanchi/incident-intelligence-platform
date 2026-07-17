import { createDatabaseClient } from "@incident/database";
import {
  createQueueRuntime,
  createWorkerConnection,
  queueEnvelopeSchema,
  queueNames,
  type CorrelationReference,
  type QueueEnvelope,
} from "@incident/queues";
import { type Job, Worker } from "bullmq";
import pino from "pino";
import { loadWorkerConfig } from "./config.js";
import { correlateOperationalEvent } from "./correlation.js";
import { isTerminalFailure, persistOperationalEvent } from "./ingestion.js";

const config = loadWorkerConfig();
const logger = pino({ level: config.LOG_LEVEL });
const database = createDatabaseClient(config.DATABASE_URL);
const queues = createQueueRuntime(config.REDIS_URL);
const ingestionConnection = createWorkerConnection(config.REDIS_URL);
const correlationConnection = createWorkerConnection(config.REDIS_URL);

const ingestionWorker = new Worker<QueueEnvelope>(
  queueNames.ingestion,
  async (job) => {
    const envelope = queueEnvelopeSchema.parse(job.data);
    await job.updateProgress(10);
    const event = await persistOperationalEvent(database, queues, envelope);
    await job.updateProgress(100);
    return { eventId: event.id };
  },
  { connection: ingestionConnection, concurrency: config.INGESTION_CONCURRENCY },
);

ingestionWorker.on("completed", (job) => {
  logger.info({ jobId: job.id, eventId: job.data.eventId }, "operational event persisted");
});

const correlationWorker = new Worker<CorrelationReference>(
  queueNames.correlation,
  async (job) => {
    const event = await correlateOperationalEvent(database, job.data, config.CORRELATION_WINDOW_MINUTES);
    return { eventId: event?.id ?? job.data.eventId, incidentId: event?.incidentId ?? null };
  },
  { connection: correlationConnection, concurrency: config.CORRELATION_CONCURRENCY },
);

function routeTerminalFailure(
  queueName: string,
  job: Job<QueueEnvelope | CorrelationReference> | undefined,
  error: Error,
) {
  logger.error({ queue: queueName, jobId: job?.id, err: error }, "worker job failed");
  if (!job || !isTerminalFailure(job.attemptsMade, job.opts.attempts)) return;

  void queues
    .publishDeadLetter({
      sourceQueue: queueName,
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
}

ingestionWorker.on("failed", (job, error) => routeTerminalFailure(queueNames.ingestion, job, error));
correlationWorker.on("failed", (job, error) => routeTerminalFailure(queueNames.correlation, job, error));

correlationWorker.on("completed", (job, result) => {
  logger.info({ jobId: job.id, ...result }, "operational event correlated");
});

const close = async (signal: string) => {
  logger.info({ signal }, "shutting down ingestion worker");
  await Promise.all([ingestionWorker.close(), correlationWorker.close()]);
  await queues.close();
  await Promise.all([ingestionConnection.quit(), correlationConnection.quit()]);
  await database.$disconnect();
};

process.once("SIGTERM", () => void close("SIGTERM"));
process.once("SIGINT", () => void close("SIGINT"));

logger.info(
  {
    ingestion: { queue: queueNames.ingestion, concurrency: config.INGESTION_CONCURRENCY },
    correlation: { queue: queueNames.correlation, concurrency: config.CORRELATION_CONCURRENCY },
  },
  "workers ready",
);
