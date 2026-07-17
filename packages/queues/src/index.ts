import { normalizedEventSchema, type NormalizedEvent } from "@incident/contracts";
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";

export const queueNames = {
  ingestion: "event-ingestion-v1",
  correlation: "incident-correlation-v1",
  integrations: "integration-delivery-v1",
  realtime: "realtime-fanout-v1",
  deadLetter: "dead-letter-v1",
} as const;

export const queueEnvelopeSchema = z.object({
  organizationId: z.string().uuid(),
  eventId: z.string().uuid(),
  correlationId: z.string().min(1).max(128),
  enqueuedAt: z.string().datetime(),
  payload: normalizedEventSchema,
});

export type QueueEnvelope = z.infer<typeof queueEnvelopeSchema>;

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 3_600, count: 10_000 },
  removeOnFail: { age: 7 * 86_400, count: 100_000 },
};

export function createIngestionJobs(events: readonly NormalizedEvent[], correlationId: string) {
  return events.map((event) => {
    const payload = normalizedEventSchema.parse(event);
    const envelope = queueEnvelopeSchema.parse({
      organizationId: payload.organizationId,
      eventId: payload.id,
      correlationId,
      enqueuedAt: new Date().toISOString(),
      payload,
    });

    return {
      name: "normalized-event",
      data: envelope,
      opts: {
        jobId: `${payload.organizationId}-${payload.id}`,
        deduplication: {
          id: `${payload.organizationId}:${payload.source}:${payload.sourceEventId}`,
        },
      },
    };
  });
}

export function createQueueRuntime(redisUrl: string) {
  const protocol = new URL(redisUrl).protocol;
  if (protocol !== "redis:" && protocol !== "rediss:") {
    throw new Error("REDIS_URL must use the redis or rediss protocol.");
  }

  const connection = new Redis(redisUrl, {
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const ingestion = new Queue<QueueEnvelope>(queueNames.ingestion, {
    connection,
    defaultJobOptions,
  });

  return {
    ingestion,
    async publishEvents(events: readonly NormalizedEvent[], correlationId: string) {
      if (events.length === 0) return [];
      return ingestion.addBulk(createIngestionJobs(events, correlationId));
    },
    async readiness() {
      if (connection.status === "wait") await connection.connect();
      return (await connection.ping()) === "PONG" && !(await ingestion.isPaused());
    },
    async close() {
      await ingestion.close();
      if (connection.status !== "end") await connection.quit();
    },
  };
}

export type QueueRuntime = ReturnType<typeof createQueueRuntime>;
