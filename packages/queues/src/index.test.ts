import { describe, expect, it } from "vitest";
import {
  correlationReferenceSchema,
  createIngestionJobs,
  deadLetterSchema,
  queueEnvelopeSchema,
} from "./index";

const event = {
  id: "91c15146-9f41-40ea-9f5f-7be0e8bd119b",
  organizationId: "75c56ad8-d17d-4d28-a4e3-66be34d4f18a",
  source: "prometheus" as const,
  sourceEventId: "alert-123",
  fingerprint: "fingerprint-1234567890",
  service: "checkout-api",
  environment: "production",
  severity: "critical" as const,
  title: "Checkout latency is high",
  description: "p99 exceeded the service objective",
  status: "firing" as const,
  occurredAt: "2026-07-17T12:00:00.000Z",
  receivedAt: "2026-07-17T12:00:01.000Z",
  attributes: {},
  rawPayload: {},
};

describe("ingestion queue jobs", () => {
  it("creates a tenant-scoped, replay-safe job", () => {
    const [job] = createIngestionJobs([event], "request-123");
    expect(job?.opts.jobId).toBe(`${event.organizationId}-${event.id}`);
    expect(job?.opts.deduplication.id).toBe(
      `${event.organizationId}:${event.source}:${event.sourceEventId}`,
    );
    expect(queueEnvelopeSchema.parse(job?.data).correlationId).toBe("request-123");
  });

  it("rejects an invalid normalized event before Redis", () => {
    expect(() => createIngestionJobs([{ ...event, organizationId: "wrong" }], "request-123")).toThrow();
  });
});

describe("downstream queue contracts", () => {
  it("requires tenant and correlation context", () => {
    expect(
      correlationReferenceSchema.parse({
        organizationId: event.organizationId,
        eventId: event.id,
        correlationId: "request-123",
      }),
    ).toBeTruthy();
    expect(() =>
      correlationReferenceSchema.parse({ eventId: event.id, correlationId: "request-123" }),
    ).toThrow();
  });

  it("preserves a structured terminal failure", () => {
    expect(
      deadLetterSchema.parse({
        sourceQueue: "event-ingestion-v1",
        jobId: "job-123",
        correlationId: "request-123",
        failedAt: "2026-07-17T12:00:00.000Z",
        error: { name: "Error", message: "database unavailable" },
        data: { eventId: event.id },
      }).error.message,
    ).toBe("database unavailable");
  });
});
