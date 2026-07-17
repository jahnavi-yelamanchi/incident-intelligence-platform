import { Prisma, type DatabaseClient, withTenant } from "@incident/database";
import { queueEnvelopeSchema, type QueueEnvelope, type QueueRuntime } from "@incident/queues";

export async function persistOperationalEvent(
  database: DatabaseClient,
  queues: QueueRuntime,
  untrustedEnvelope: QueueEnvelope,
) {
  const envelope = queueEnvelopeSchema.parse(untrustedEnvelope);
  const { payload } = envelope;

  const event = await withTenant(database, envelope.organizationId, (transaction) =>
    transaction.operationalEvent.upsert({
      where: {
        organizationId_source_sourceEventId: {
          organizationId: envelope.organizationId,
          source: payload.source,
          sourceEventId: payload.sourceEventId,
        },
      },
      update: {},
      create: {
        id: envelope.eventId,
        organizationId: envelope.organizationId,
        source: payload.source,
        sourceEventId: payload.sourceEventId,
        fingerprint: payload.fingerprint,
        service: payload.service,
        environment: payload.environment,
        severity: payload.severity,
        title: payload.title,
        description: payload.description,
        status: payload.status,
        occurredAt: new Date(payload.occurredAt),
        receivedAt: new Date(payload.receivedAt),
        attributes: payload.attributes,
        rawPayload: payload.rawPayload as Prisma.InputJsonValue,
        correlationId: envelope.correlationId,
      },
      select: { id: true },
    }),
  );

  await queues.publishCorrelation({
    organizationId: envelope.organizationId,
    eventId: event.id,
    correlationId: envelope.correlationId,
  });

  return event;
}

export function isTerminalFailure(attemptsMade: number, configuredAttempts: number | undefined) {
  return attemptsMade >= (configuredAttempts ?? 1);
}
