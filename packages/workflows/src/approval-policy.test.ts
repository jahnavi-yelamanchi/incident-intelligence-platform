import { describe, expect, it } from "vitest";
import { acceptedApprovals, firstAuthorizedRejection } from "./approval-policy.js";
import type { ApprovalSignal } from "./types.js";

const signal = (overrides: Partial<ApprovalSignal>): ApprovalSignal => ({
  approverId: "approver-1",
  roles: ["production-approver"],
  decision: "approved",
  decidedAt: "2026-07-17T12:00:00.000Z",
  ...overrides,
});

describe("approval policy", () => {
  it("deduplicates approvers and excludes requester self-approval", () => {
    const signals = [signal({}), signal({}), signal({ approverId: "requester" })];
    expect(acceptedApprovals(signals, "requester")).toHaveLength(1);
  });

  it("ignores decisions without the production approver role", () => {
    expect(acceptedApprovals([signal({ roles: ["viewer"] })], "requester")).toHaveLength(0);
    expect(firstAuthorizedRejection([signal({ decision: "rejected", roles: ["viewer"] })])).toBeUndefined();
  });

  it("accepts an authorized rejection", () => {
    expect(firstAuthorizedRejection([signal({ decision: "rejected" })])?.approverId).toBe("approver-1");
  });
});
