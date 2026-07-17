import { Client, Connection } from "@temporalio/client";
import { remediationWorkflowId, type ApprovalSignal, type RemediationInput } from "@incident/workflows";

export type RemediationDispatcher = {
  start: (input: RemediationInput) => Promise<void>;
  submitApproval: (input: Pick<RemediationInput, "actionRequestId" | "target">, approval: ApprovalSignal) => Promise<void>;
  cancel: (input: Pick<RemediationInput, "actionRequestId" | "target">, cancellation: { actorId: string; reason: string }) => Promise<void>;
};

export function unavailableRemediationDispatcher(): RemediationDispatcher {
  const unavailable = async () => { throw Object.assign(new Error("Remediation workflow service is unavailable."), { statusCode: 503 }); };
  return { start: unavailable, submitApproval: unavailable, cancel: unavailable };
}

export async function createTemporalRemediationDispatcher(options: { address: string; namespace: string; taskQueue: string }) {
  const connection = await Connection.connect({ address: options.address });
  const client = new Client({ connection, namespace: options.namespace });
  return {
    async start(input: RemediationInput) {
      await client.workflow.start("remediationWorkflow", {
        taskQueue: options.taskQueue,
        workflowId: remediationWorkflowId(input),
        args: [input],
      });
    },
    async submitApproval(input: Pick<RemediationInput, "actionRequestId" | "target">, approval: ApprovalSignal) {
      await client.workflow.getHandle(remediationWorkflowId(input)).signal("submitApproval", approval);
    },
    async cancel(input: Pick<RemediationInput, "actionRequestId" | "target">, cancellation: { actorId: string; reason: string }) {
      await client.workflow.getHandle(remediationWorkflowId(input)).signal("cancelRemediation", cancellation);
    },
  } satisfies RemediationDispatcher;
}
