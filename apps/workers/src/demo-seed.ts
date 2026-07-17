import { createDatabaseClient, withTenant } from "@incident/database";

const organizationId = process.env.DEMO_ORGANIZATION_ID ?? "00000000-0000-4000-8000-000000000001";
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://incident_app:incident_app@localhost:5432/incident";
const database = createDatabaseClient(databaseUrl);

const seed = [
  { reference: "INC-9001", slug: "payments-edge", title: "Payment gateway timeout rate elevated", severity: "high" as const, status: "investigating" as const },
  { reference: "INC-9002", slug: "checkout-api", title: "Checkout latency above service objective", severity: "critical" as const, status: "triggered" as const },
  { reference: "INC-9003", slug: "inventory-sync", title: "Inventory synchronization lag", severity: "medium" as const, status: "monitoring" as const },
];

async function main() {
  await withTenant(database, organizationId, async (transaction) => {
    await transaction.organization.upsert({
      where: { id: organizationId },
      update: { displayName: "Aegis Demo Operations" },
      create: { id: organizationId, auth0Id: "demo-local", slug: "aegis-demo", displayName: "Aegis Demo Operations" },
    });
    await transaction.user.upsert({
      where: { organizationId_auth0Subject: { organizationId, auth0Subject: "demo-operator" } },
      update: { roles: ["responder", "production-approver"] },
      create: {
        organizationId,
        auth0Subject: "demo-operator",
        email: "operator@aegis.demo",
        displayName: "Alex Morgan",
        roles: ["responder", "production-approver"],
      },
    });

    for (const [index, item] of seed.entries()) {
      const service = await transaction.service.upsert({
        where: { organizationId_slug_environment: { organizationId, slug: item.slug, environment: "production" } },
        update: { verificationStatus: "verified", source: "manual" },
        create: {
          organizationId,
          slug: item.slug,
          displayName: item.slug.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" "),
          ownerTeam: "Platform Reliability",
          environment: "production",
          source: "manual",
          verificationStatus: "verified",
        },
      });
      const startedAt = new Date(Date.now() - (index + 1) * 12 * 60_000);
      const incident = await transaction.incident.upsert({
        where: { organizationId_reference: { organizationId, reference: item.reference } },
        update: { status: item.status, severity: item.severity, title: item.title },
        create: {
          organizationId,
          serviceId: service.id,
          reference: item.reference,
          title: item.title,
          summary: "Generated through the local demo data pipeline.",
          severity: item.severity,
          status: item.status,
          fingerprint: `demo-${item.slug}`,
          startedAt,
        },
      });
      await transaction.timelineEvent.upsert({
        where: { organizationId_source_sourceEventId: { organizationId, source: "demo", sourceEventId: `${item.reference}-alert` } },
        update: {},
        create: {
          organizationId,
          incidentId: incident.id,
          type: "alert",
          source: "demo",
          sourceEventId: `${item.reference}-alert`,
          title: item.title,
          detail: "Demo event persisted through the incident platform.",
          payload: { source: "demo" },
          occurredAt: startedAt,
        },
      });
    }
  });
  process.stdout.write(`Seeded ${seed.length} live demo incidents for ${organizationId}\n`);
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await database.$disconnect();
  });
