import { ActionStatus, Prisma, type DatabaseClient, withTenant } from "@incident/database";
import type { RemediationActivities } from "@incident/workflows";
import type { RemediationExecutor } from "./remediation-executor.js";

const terminalStatuses = new Set(["rejected", "expired", "cancelled", "succeeded", "failed"]);

function databaseStatus(status: string): ActionStatus | null {
  if (["rejected", "expired", "cancelled", "executing", "succeeded", "failed"].includes(status)) return status as ActionStatus;
  return null;
}

/**
 * Converts durable workflow transitions into tenant-isolated product state.
 * The concrete Kubernetes/AWS adapter is supplied separately; this bridge is
 * deliberately idempotent because Temporal may retry any activity.
 */
export function createRemediationActivities(database: DatabaseClient, executor: RemediationExecutor): RemediationActivities {
  return {
    async recordAuditEvent(input) {
      await withTenant(database, input.organizationId, async (transaction) => {
        await transaction.auditEvent.create({
          data: {
            organizationId: input.organizationId,
            actorType: "system",
            actorId: "temporal-remediation-worker",
            action: input.event,
            resourceType: "action_request",
            resourceId: input.actionRequestId,
            correlationId: input.actionRequestId,
            metadata: input.detail as Prisma.InputJsonValue,
          },
        });
      });
    },
    async publishState(input) {
      await withTenant(database, input.organizationId, async (transaction) => {
        const action = await transaction.actionRequest.findUnique({ where: { id: input.actionRequestId } });
        if (!action) throw new Error("Action request no longer exists.");
        const next = databaseStatus(input.status);
        if (next && !terminalStatuses.has(action.status)) {
          await transaction.actionRequest.update({ where: { id: action.id }, data: { status: next } });
        }
        await transaction.timelineEvent.upsert({
          where: { organizationId_source_sourceEventId: { organizationId: input.organizationId, source: "temporal", sourceEventId: `${input.actionRequestId}:${input.status}` } },
          update: { detail: input.message ?? null, occurredAt: new Date() },
          create: {
            organizationId: input.organizationId,
            incidentId: input.incidentId,
            type: "action",
            source: "temporal",
            sourceEventId: `${input.actionRequestId}:${input.status}`,
            title: `Remediation ${input.status.replace(/_/g, " ")}`,
            detail: input.message ?? null,
            payload: { actionRequestId: input.actionRequestId, status: input.status },
            occurredAt: new Date(),
          },
        });
      });
    },
    runPreflight: (input) => executor.runPreflight(input),
    async executeAction(input) {
      return withTenant(database, input.target.organizationId, async (transaction) => {
        const existing = await transaction.actionExecution.findUnique({ where: { actionRequestId: input.actionRequestId } });
        if (existing) {
          return {
            executionId: existing.id,
            changed: Boolean((existing.result as { changed?: boolean } | null)?.changed),
            previousState: (existing.preflight as Record<string, unknown>) ?? {},
            output: (existing.result as Record<string, unknown>) ?? {},
          };
        }
        const result = await executor.execute(input);
        const execution = await transaction.actionExecution.create({
          data: {
            organizationId: input.target.organizationId,
            actionRequestId: input.actionRequestId,
            executorJobId: `temporal:${input.actionRequestId}`,
            preflight: input.preflight.observedState as Prisma.InputJsonValue,
            result: { changed: result.changed, ...result.output } as Prisma.InputJsonValue,
            startedAt: new Date(),
            finishedAt: new Date(),
          },
        });
        return {
          executionId: execution.id,
          changed: result.changed,
          previousState: result.previousState,
          output: result.output,
        };
      });
    },
    verifyAction: (input) => executor.verify(input),
    compensateAction: (input) => executor.compensate(input),
  };
}
