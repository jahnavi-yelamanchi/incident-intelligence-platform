export type RemediationTarget = {
  organizationId: string;
  incidentId: string;
  environment: string;
  cluster: string;
  namespace: string;
  resourceKind: "Deployment" | "StatefulSet";
  resourceName: string;
};

export type RemediationInput = {
  actionRequestId: string;
  actionType:
    | "kubernetes.restart"
    | "kubernetes.scale"
    | "kubernetes.pause-rollout"
    | "kubernetes.resume-rollout"
    | "kubernetes.rollback"
    | "aws.rds.failover";
  target: RemediationTarget;
  parameters: Record<string, unknown>;
  requestedBy: string;
  requiredApprovals: number;
  expiresInMs: number;
  idempotencyKey: string;
};

export type ApprovalSignal = {
  approverId: string;
  roles: string[];
  decision: "approved" | "rejected";
  comment?: string;
  decidedAt: string;
};

export type WorkflowStatus =
  | "awaiting_approval"
  | "rejected"
  | "expired"
  | "cancelled"
  | "preflight"
  | "executing"
  | "verifying"
  | "compensating"
  | "succeeded"
  | "failed";

export type RemediationState = {
  status: WorkflowStatus;
  approvals: ApprovalSignal[];
  rejection?: ApprovalSignal;
  message?: string;
};

export type PreflightResult = {
  safe: boolean;
  observedState: Record<string, unknown>;
  changeSummary: string;
  reason?: string;
};

export type ExecutionResult = {
  executionId: string;
  changed: boolean;
  previousState: Record<string, unknown>;
  output: Record<string, unknown>;
};

export type VerificationResult = {
  healthy: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
};

