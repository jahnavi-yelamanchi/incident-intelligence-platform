import type {
  ExecutionResult,
  PreflightResult,
  RemediationInput,
  VerificationResult,
} from "./types.js";

export type RemediationActivities = {
  recordAuditEvent(input: {
    actionRequestId: string;
    organizationId: string;
    event: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
  runPreflight(input: RemediationInput): Promise<PreflightResult>;
  executeAction(input: RemediationInput & { preflight: PreflightResult }): Promise<ExecutionResult>;
  verifyAction(input: RemediationInput & { execution: ExecutionResult }): Promise<VerificationResult>;
  compensateAction(input: RemediationInput & { execution: ExecutionResult }): Promise<void>;
  publishState(input: {
    organizationId: string;
    incidentId: string;
    actionRequestId: string;
    status: string;
    message?: string;
  }): Promise<void>;
};

