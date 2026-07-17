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

export const correlationReferenceSchema = z.object({
  organizationId: z.string().uuid(),
  eventId: z.string().uuid(),
  correlationId: z.string().min(1).max(128),
});

export const deadLetterSchema = z.object({
  sourceQueue: z.string().min(1),
  jobId: z.string().min(1),
  correlationId: z.string().min(1).max(128),
  failedAt: z.string().datetime(),
  error: z.object({ name: z.string(), message: z.string(), stack: z.string().optional() }),
  data: z.unknown(),
});

export type CorrelationReference = z.infer<typeof correlationReferenceSchema>;
export type DeadLetter = z.infer<typeof deadLetterSchema>;

export const realtimeEnvelopeSchema = z.object({
  organizationId: z.string().uuid(),
  type: z.string().min(1).max(128),
  payload: z.unknown(),
});

export type RealtimeEnvelope = z.infer<typeof realtimeEnvelopeSchema>;
const realtimeChannel = "aegis:realtime:v1";

export function createRealtimeRelay(redisUrl: string, onMessage: (message: RealtimeEnvelope) => void) {
  const publisher = new Redis(redisUrl, { enableReadyCheck: true, lazyConnect: true, maxRetriesPerRequest: 1 });
  const subscriber = new Redis(redisUrl, { enableReadyCheck: true, lazyConnect: true, maxRetriesPerRequest: null });
  subscriber.on("message", (channel, payload) => {
    if (channel !== realtimeChannel) return;
    try {
      const parsed = realtimeEnvelopeSchema.safeParse(JSON.parse(payload));
      if (parsed.success) onMessage(parsed.data);
    } catch {
      // Ignore malformed pub/sub messages; trusted publishers are schema-validated.
    }
  });
  return {
    async start() {
      await subscriber.subscribe(realtimeChannel);
    },
    async publish(message: RealtimeEnvelope) {
      const envelope = realtimeEnvelopeSchema.parse(message);
      return publisher.publish(realtimeChannel, JSON.stringify(envelope));
    },
    async close() {
      await Promise.all([subscriber.quit(), publisher.quit()]);
    },
  };
}

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
  const correlation = new Queue<CorrelationReference>(queueNames.correlation, {
    connection,
    defaultJobOptions,
  });
  const deadLetter = new Queue<DeadLetter>(queueNames.deadLetter, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 30 * 86_400, count: 100_000 },
      removeOnFail: false,
    },
  });

  return {
    ingestion,
    correlation,
    deadLetter,
    async publishEvents(events: readonly NormalizedEvent[], correlationId: string) {
      if (events.length === 0) return [];
      return ingestion.addBulk(createIngestionJobs(events, correlationId));
    },
    async publishCorrelation(reference: CorrelationReference) {
      const data = correlationReferenceSchema.parse(reference);
      return correlation.add("correlate-event", data, {
        jobId: `${data.organizationId}-${data.eventId}`,
        deduplication: { id: `${data.organizationId}:${data.eventId}` },
      });
    },
    async publishDeadLetter(deadLetterEvent: DeadLetter) {
      const data = deadLetterSchema.parse(deadLetterEvent);
      return deadLetter.add("terminal-failure", data, {
        jobId: `${data.sourceQueue}-${data.jobId}`,
      });
    },
    async readiness() {
      if (connection.status === "wait") await connection.connect();
      return (await connection.ping()) === "PONG" && !(await ingestion.isPaused());
    },
    async close() {
      await Promise.all([ingestion.close(), correlation.close(), deadLetter.close()]);
      if (connection.status !== "end") await connection.quit();
    },
  };
}

export function createWorkerConnection(redisUrl: string) {
  const protocol = new URL(redisUrl).protocol;
  if (protocol !== "redis:" && protocol !== "rediss:") {
    throw new Error("REDIS_URL must use the redis or rediss protocol.");
  }

  return new Redis(redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
  });
}

export type QueueRuntime = ReturnType<typeof createQueueRuntime>;
