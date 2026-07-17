import { Prisma, type DatabaseClient, withTenant } from "@incident/database";
import { correlationReferenceSchema, type CorrelationReference } from "@incident/queues";

const severityRank = { low: 1, medium: 2, high: 3, critical: 4 } as const;

export function highestSeverity(
  current: keyof typeof severityRank,
  incoming: keyof typeof severityRank,
) {
  return severityRank[incoming] > severityRank[current] ? incoming : current;
}

export function serviceSlug(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "unknown-service";
}

function serviceDisplayName(value: string) {
  return value
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function timelineType(source: string) {
  if (source === "prometheus") return "alert" as const;
  if (source === "opentelemetry") return "trace" as const;
  if (source === "github") return "deployment" as const;
  if (source === "kubernetes") return "kubernetes" as const;
  return "system" as const;
}

export async function correlateOperationalEvent(
  database: DatabaseClient,
  untrustedReference: CorrelationReference,
  correlationWindowMinutes: number,
) {
  const reference = correlationReferenceSchema.parse(untrustedReference);

  return withTenant(database, reference.organizationId, async (transaction) => {
    const event = await transaction.operationalEvent.findUnique({ where: { id: reference.eventId } });
    if (!event || event.organizationId !== reference.organizationId || event.incidentId) return event;

    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${reference.organizationId}:${event.fingerprint}`}, 0))
    `;

    const lockedEvent = await transaction.operationalEvent.findUniqueOrThrow({
      where: { id: reference.eventId },
    });
    if (lockedEvent.incidentId) return lockedEvent;

    const slug = serviceSlug(lockedEvent.service);
    const service = await transaction.service.upsert({
      where: {
        organizationId_slug_environment: {
          organizationId: reference.organizationId,
          slug,
          environment: lockedEvent.environment,
        },
      },
      update: {},
      create: {
        organizationId: reference.organizationId,
        slug,
        displayName: serviceDisplayName(lockedEvent.service) || "Unknown Service",
        ownerTeam: "Unassigned",
        environment: lockedEvent.environment,
        source: "alert",
        verificationStatus: "unverified",
        labels: { discoveredBy: "alert-ingestion" },
      },
    });

    const windowStart = new Date(lockedEvent.occurredAt.getTime() - correlationWindowMinutes * 60_000);
    let incident = await transaction.incident.findFirst({
      where: {
        organizationId: reference.organizationId,
        serviceId: service.id,
        fingerprint: lockedEvent.fingerprint,
        status: { not: "resolved" },
        startedAt: { gte: windowStart },
      },
      orderBy: { startedAt: "desc" },
    });

    if (!incident && lockedEvent.status === "firing") {
      const rows = await transaction.$queryRaw<Array<{ reference: string }>>`
        SELECT 'INC-' || nextval('incident_reference_seq')::text AS reference
      `;
      const incidentReference = rows[0]?.reference;
      if (!incidentReference) throw new Error("Failed to allocate incident reference.");

      incident = await transaction.incident.create({
        data: {
          organizationId: reference.organizationId,
          serviceId: service.id,
          reference: incidentReference,
          title: lockedEvent.title,
          summary: lockedEvent.description || null,
          severity: lockedEvent.severity,
          status: "triggered",
          fingerprint: lockedEvent.fingerprint,
          startedAt: lockedEvent.occurredAt,
        },
      });
    }

    if (!incident) return lockedEvent;

    const updatedIncident = await transaction.incident.update({
      where: { id: incident.id },
      data:
        lockedEvent.status === "firing"
          ? { severity: highestSeverity(incident.severity, lockedEvent.severity), status: "investigating" }
          : { status: "monitoring" },
    });

    await transaction.timelineEvent.upsert({
      where: {
        organizationId_source_sourceEventId: {
          organizationId: reference.organizationId,
          source: lockedEvent.source,
          sourceEventId: lockedEvent.sourceEventId,
        },
      },
      update: {},
      create: {
        organizationId: reference.organizationId,
        incidentId: updatedIncident.id,
        type: timelineType(lockedEvent.source),
        source: lockedEvent.source,
        sourceEventId: lockedEvent.sourceEventId,
        title: lockedEvent.title,
        detail: lockedEvent.description || null,
        payload: lockedEvent.rawPayload as Prisma.InputJsonValue,
        occurredAt: lockedEvent.occurredAt,
      },
    });

    const correlatedEvent = await transaction.operationalEvent.update({
      where: { id: lockedEvent.id },
      data: { incidentId: updatedIncident.id, correlatedAt: new Date() },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: reference.organizationId,
        actorType: "system",
        actorId: "incident-correlation-worker",
        action: "event.correlated",
        resourceType: "incident",
        resourceId: updatedIncident.id,
        correlationId: reference.correlationId,
        metadata: {
          eventId: correlatedEvent.id,
          incidentReference: updatedIncident.reference,
          serviceSource: service.source,
          serviceVerificationStatus: service.verificationStatus,
        },
      },
    });

    return correlatedEvent;
  });
}
