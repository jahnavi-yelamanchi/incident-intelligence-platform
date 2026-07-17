import { Client, Connection } from "@temporalio/client";
import type { RemediationInput } from "./types.js";

export * from "./approval-policy.js";
export * from "./activities.js";
export * from "./types.js";

export async function createWorkflowClient(address: string, namespace: string) {
  const connection = await Connection.connect({ address });
  return new Client({ connection, namespace });
}

export function remediationWorkflowId(input: Pick<RemediationInput, "target" | "actionRequestId">) {
  return `remediation:${input.target.organizationId}:${input.actionRequestId}`;
}

