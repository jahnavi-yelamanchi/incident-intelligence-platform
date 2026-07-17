import { AppsV1Api, KubeConfig, type V1Deployment, type V1StatefulSet } from "@kubernetes/client-node";
import type { ExecutionResult, PreflightResult, RemediationInput, VerificationResult } from "@incident/workflows";

type Workload = V1Deployment | V1StatefulSet;

export type RemediationExecutor = {
  runPreflight: (input: RemediationInput) => Promise<PreflightResult>;
  execute: (input: RemediationInput & { preflight: PreflightResult }) => Promise<ExecutionResult>;
  verify: (input: RemediationInput & { execution: ExecutionResult }) => Promise<VerificationResult>;
  compensate: (input: RemediationInput & { execution: ExecutionResult }) => Promise<void>;
};

export type KubernetesWorkloadClient = {
  readDeployment: (name: string, namespace: string) => Promise<V1Deployment>;
  readStatefulSet: (name: string, namespace: string) => Promise<V1StatefulSet>;
  scaleDeployment: (name: string, namespace: string, replicas: number) => Promise<void>;
  scaleStatefulSet: (name: string, namespace: string, replicas: number) => Promise<void>;
};

export function createKubernetesWorkloadClient(kubeConfig = new KubeConfig()): KubernetesWorkloadClient {
  kubeConfig.loadFromDefault();
  const api = kubeConfig.makeApiClient(AppsV1Api);
  return {
    readDeployment: (name, namespace) => api.readNamespacedDeployment({ name, namespace }),
    readStatefulSet: (name, namespace) => api.readNamespacedStatefulSet({ name, namespace }),
    scaleDeployment: async (name, namespace, replicas) => {
      await api.patchNamespacedDeploymentScale({ name, namespace, body: { spec: { replicas } }, fieldManager: "incident-intelligence", fieldValidation: "Strict" });
    },
    scaleStatefulSet: async (name, namespace, replicas) => {
      await api.patchNamespacedStatefulSetScale({ name, namespace, body: { spec: { replicas } }, fieldManager: "incident-intelligence", fieldValidation: "Strict" });
    },
  };
}

export class UnavailableRemediationExecutor implements RemediationExecutor {
  async runPreflight(input: RemediationInput): Promise<PreflightResult> {
    return { safe: false, observedState: { target: input.target }, changeSummary: "", reason: "No production executor is configured for this action." };
  }
  async execute(): Promise<ExecutionResult> { throw new Error("Unreachable: preflight rejects unavailable executors."); }
  async verify(): Promise<VerificationResult> { return { healthy: false, checks: [{ name: "executor", passed: false, detail: "No production executor is configured." }] }; }
  async compensate(): Promise<void> { /* no state can be changed when preflight fails */ }
}

/**
 * A deliberately narrow executor. It accepts only a configured cluster and the
 * scale action currently exposed by the action API. It never receives shell
 * commands, unrestricted credentials, or model-generated API paths.
 */
export class KubernetesScaleExecutor implements RemediationExecutor {
  constructor(private readonly client: KubernetesWorkloadClient, private readonly allowedCluster: string) {}

  async runPreflight(input: RemediationInput): Promise<PreflightResult> {
    if (input.actionType !== "kubernetes.scale") return { safe: false, observedState: {}, changeSummary: "", reason: `Action ${input.actionType} is not enabled by this executor.` };
    if (input.target.cluster !== this.allowedCluster) return { safe: false, observedState: {}, changeSummary: "", reason: "Target cluster is not allowlisted for this executor." };
    const replicas = input.parameters.replicas;
    if (typeof replicas !== "number" || !Number.isInteger(replicas) || replicas < 1 || replicas > 100) {
      return { safe: false, observedState: {}, changeSummary: "", reason: "Scale actions require an integer replicas value from 1 to 100." };
    }
    try {
      const workload = await this.read(input);
      const currentReplicas = workload.spec?.replicas ?? 1;
      return {
        safe: true,
        observedState: { currentReplicas, resourceVersion: workload.metadata?.resourceVersion ?? null },
        changeSummary: `Scale ${input.target.resourceKind}/${input.target.namespace}/${input.target.resourceName} from ${currentReplicas} to ${replicas} replicas.`,
      };
    } catch (error) {
      return { safe: false, observedState: {}, changeSummary: "", reason: `Unable to inspect target workload: ${error instanceof Error ? error.message : "unknown error"}` };
    }
  }

  async execute(input: RemediationInput & { preflight: PreflightResult }): Promise<ExecutionResult> {
    const replicas = input.parameters.replicas as number;
    await this.scale(input, replicas);
    return {
      executionId: `kubernetes:${input.target.cluster}:${input.target.namespace}:${input.target.resourceName}:${input.idempotencyKey}`,
      changed: true,
      previousState: input.preflight.observedState,
      output: { requestedReplicas: replicas, target: input.target },
    };
  }

  async verify(input: RemediationInput & { execution: ExecutionResult }): Promise<VerificationResult> {
    const workload = await this.read(input);
    const requested = input.parameters.replicas as number;
    const observed = workload.status?.availableReplicas ?? 0;
    const desired = workload.spec?.replicas ?? 0;
    return {
      healthy: desired === requested && observed >= requested,
      checks: [
        { name: "desired_replicas", passed: desired === requested, detail: `Desired replicas: ${desired}; requested: ${requested}.` },
        { name: "available_replicas", passed: observed >= requested, detail: `Available replicas: ${observed}; requested: ${requested}.` },
      ],
    };
  }

  async compensate(input: RemediationInput & { execution: ExecutionResult }) {
    const previous = input.execution.previousState.currentReplicas;
    if (typeof previous === "number" && Number.isInteger(previous) && previous >= 0) await this.scale(input, previous);
  }

  private read(input: RemediationInput): Promise<Workload> {
    return input.target.resourceKind === "Deployment"
      ? this.client.readDeployment(input.target.resourceName, input.target.namespace)
      : this.client.readStatefulSet(input.target.resourceName, input.target.namespace);
  }

  private async scale(input: RemediationInput, replicas: number) {
    if (input.target.resourceKind === "Deployment") await this.client.scaleDeployment(input.target.resourceName, input.target.namespace, replicas);
    else await this.client.scaleStatefulSet(input.target.resourceName, input.target.namespace, replicas);
  }
}
