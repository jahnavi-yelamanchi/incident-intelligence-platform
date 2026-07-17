import type { ApprovalSignal } from "./types.js";

export function acceptedApprovals(signals: ApprovalSignal[], requesterId: string): ApprovalSignal[] {
  const unique = new Map<string, ApprovalSignal>();
  for (const signal of signals) {
    if (signal.decision !== "approved") continue;
    if (signal.approverId === requesterId) continue;
    if (!signal.roles.includes("production-approver")) continue;
    unique.set(signal.approverId, signal);
  }
  return [...unique.values()];
}

export function firstAuthorizedRejection(signals: ApprovalSignal[]): ApprovalSignal | undefined {
  return signals.find(
    (signal) => signal.decision === "rejected" && signal.roles.includes("production-approver"),
  );
}

