import { withTenant, type DatabaseClient } from "@incident/database";
import { z } from "zod";

const slackEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url_verification"), challenge: z.string().min(1) }),
  z.object({ type: z.literal("event_callback"), event_id: z.string().min(1).max(255), event: z.object({ type: z.literal("app_mention"), user: z.string().min(1).max(255), text: z.string().min(1).max(4_000), channel: z.string().min(1).max(255), ts: z.string().min(1).max(255) }) }),
]);

export type SlackInboundResult = { kind: "challenge"; challenge: string } | { kind: "ignored" } | { kind: "mention_recorded"; incidentReference: string };

function incidentReferenceFrom(text: string) {
  return text.match(/\bINC-\d+\b/i)?.[0]?.toUpperCase() ?? null;
}

export async function processSlackEvent(database: DatabaseClient, organizationId: string, body: unknown, correlationId: string): Promise<SlackInboundResult> {
  const parsed = slackEventSchema.safeParse(body);
  if (!parsed.success) throw Object.assign(new Error("Invalid Slack event payload."), { statusCode: 400 });
  if (parsed.data.type === "url_verification") return { kind: "challenge", challenge: parsed.data.challenge };
  const event = parsed.data.event;
  const eventId = parsed.data.event_id;
  const reference = incidentReferenceFrom(event.text);
  if (!reference) return { kind: "ignored" };
  const recorded = await withTenant(database, organizationId, async (transaction) => {
    const incident = await transaction.incident.findFirst({ where: { reference } });
    if (!incident) return false;
    await transaction.timelineEvent.create({ data: { organizationId, incidentId: incident.id, type: "comment", source: "slack", sourceEventId: eventId, title: "Slack mention received", detail: `${event.text}\n\nSlack channel: ${event.channel} · message: ${event.ts}`, payload: { channel: event.channel, slackUserId: event.user, eventId }, occurredAt: new Date(Number(event.ts) * 1_000) } });
    await transaction.auditEvent.create({ data: { organizationId, actorType: "integration", actorId: "slack", action: "integration.slack_mention_received", resourceType: "incident", resourceId: incident.id, correlationId, metadata: { reference, eventId, channel: event.channel } } });
    return true;
  });
  return recorded ? { kind: "mention_recorded", incidentReference: reference } : { kind: "ignored" };
}
