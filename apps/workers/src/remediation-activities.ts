import { ActionStatus, Prisma, type DatabaseClient, withTenant } from "@incident/database";
import type { RemediationActivities } from "@incident/workflows";

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
export function createRemediationActivities(database: DatabaseClient): RemediationActivities {
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
    async runPreflight(input) {
      const invalidTarget = !input.target.cluster || !input.target.namespace || !input.target.resourceName;
      if (invalidTarget) return { safe: false, observedState: {}, changeSummary: "", reason: "A concrete cluster, namespace, and workload are required." };
      return {
        safe: true,
        observedState: { target: input.target, actionType: input.actionType },
        changeSummary: `Preflight accepted ${input.actionType} for ${input.target.resourceKind}/${input.target.namespace}/${input.target.resourceName}.`,
      };
    },
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
        const result = { changed: false, executor: "not-configured", message: "No production executor has been configured for this action." };
        const execution = await transaction.actionExecution.create({
          data: {
            organizationId: input.target.organizationId,
            actionRequestId: input.actionRequestId,
            executorJobId: `temporal:${input.actionRequestId}`,
            preflight: input.preflight.observedState as Prisma.InputJsonValue,
            result: result as Prisma.InputJsonValue,
            startedAt: new Date(),
            finishedAt: new Date(),
          },
        });
        return {
          executionId: execution.id,
          changed: false,
          previousState: input.preflight.observedState,
          output: result,
        };
      });
    },
    async verifyAction() {
      return { healthy: false, checks: [{ name: "executor", passed: false, detail: "No production executor was configured." }] };
    },
    async compensateAction() {
      // An unavailable executor never changes state, so compensation is intentionally a no-op.
    },
  };
}
