import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import { acceptedApprovals, firstAuthorizedRejection } from "./approval-policy.js";
import type { RemediationActivities } from "./activities.js";
import type { ApprovalSignal, RemediationInput, RemediationState } from "./types.js";

export const submitApproval = defineSignal<[ApprovalSignal]>("submitApproval");
export const cancelRemediation = defineSignal<[{ actorId: string; reason: string }]>("cancelRemediation");
export const remediationState = defineQuery<RemediationState>("remediationState");

const activities = proxyActivities<RemediationActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
  },
});

export async function remediationWorkflow(input: RemediationInput): Promise<RemediationState> {
  if (input.requiredApprovals < 1) throw new Error("At least one approval is required.");
  if (input.expiresInMs < 60_000) throw new Error("Approval window must be at least one minute.");

  const signals: ApprovalSignal[] = [];
  let cancelled: { actorId: string; reason: string } | undefined;
  let state: RemediationState = { status: "awaiting_approval", approvals: [] };

  setHandler(submitApproval, (signal) => {
    signals.push(signal);
    const approvals = acceptedApprovals(signals, input.requestedBy);
    const rejection = firstAuthorizedRejection(signals);
    state = { ...state, approvals, ...(rejection ? { rejection } : {}) };
  });
  setHandler(cancelRemediation, (signal) => {
    cancelled = signal;
  });
  setHandler(remediationState, () => state);

  await activities.publishState({
    organizationId: input.target.organizationId,
    incidentId: input.target.incidentId,
    actionRequestId: input.actionRequestId,
    status: state.status,
  });

  const resolvedBeforeExpiry = await condition(() => {
    const approvals = acceptedApprovals(signals, input.requestedBy);
    return Boolean(cancelled) || Boolean(firstAuthorizedRejection(signals)) || approvals.length >= input.requiredApprovals;
  }, input.expiresInMs);

  if (!resolvedBeforeExpiry) {
    state = { ...state, status: "expired", message: "Approval window expired." };
    await activities.publishState(stateEvent(input, state));
    return state;
  }
  if (cancelled) {
    state = { ...state, status: "cancelled", message: cancelled.reason };
    await activities.recordAuditEvent({
      actionRequestId: input.actionRequestId,
      organizationId: input.target.organizationId,
      event: "remediation.cancelled",
      detail: cancelled,
    });
    await activities.publishState(stateEvent(input, state));
    return state;
  }

  const rejection = firstAuthorizedRejection(signals);
  if (rejection) {
    state = { ...state, status: "rejected", rejection, message: rejection.comment ?? "Rejected by approver." };
    await activities.publishState(stateEvent(input, state));
    return state;
  }

  state = { ...state, status: "preflight" };
  await activities.publishState({ ...eventIdentity(input), status: state.status });
  const preflight = await activities.runPreflight(input);
  if (!preflight.safe) {
    state = { ...state, status: "failed", message: preflight.reason ?? "Preflight rejected the action." };
    await activities.publishState(stateEvent(input, state));
    return state;
  }

  state = { ...state, status: "executing" };
  await activities.publishState({ ...eventIdentity(input), status: state.status });
  const execution = await activities.executeAction({ ...input, preflight });

  state = { ...state, status: "verifying" };
  await activities.publishState({ ...eventIdentity(input), status: state.status });
  const verification = await activities.verifyAction({ ...input, execution });
  if (!verification.healthy) {
    state = { ...state, status: "compensating", message: "Verification failed; restoring prior state." };
    await activities.publishState(stateEvent(input, state));
    await activities.compensateAction({ ...input, execution });
    state = { ...state, status: "failed", message: "Action was compensated after failed verification." };
    await activities.publishState(stateEvent(input, state));
    return state;
  }

  state = { ...state, status: "succeeded", message: "Action completed and verification passed." };
  await activities.publishState(stateEvent(input, state));
  return state;
}

function eventIdentity(input: RemediationInput) {
  return {
    organizationId: input.target.organizationId,
    incidentId: input.target.incidentId,
    actionRequestId: input.actionRequestId,
  };
}

function stateEvent(input: RemediationInput, state: RemediationState) {
  return {
    ...eventIdentity(input),
    status: state.status,
    ...(state.message ? { message: state.message } : {}),
  };
}
