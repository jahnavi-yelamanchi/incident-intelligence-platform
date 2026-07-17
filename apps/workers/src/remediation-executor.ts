import { AppsV1Api, KubeConfig, type V1Deployment, type V1ReplicaSet, type V1StatefulSet } from "@kubernetes/client-node";
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
  patchDeployment: (name: string, namespace: string, body: Record<string, unknown>) => Promise<void>;
  patchStatefulSet: (name: string, namespace: string, body: Record<string, unknown>) => Promise<void>;
  listReplicaSets: (namespace: string) => Promise<V1ReplicaSet[]>;
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
    patchDeployment: async (name, namespace, body) => {
      await api.patchNamespacedDeployment({ name, namespace, body, fieldManager: "incident-intelligence", fieldValidation: "Strict" });
    },
    patchStatefulSet: async (name, namespace, body) => {
      await api.patchNamespacedStatefulSet({ name, namespace, body, fieldManager: "incident-intelligence", fieldValidation: "Strict" });
    },
    async listReplicaSets(namespace) {
      const result = await api.listNamespacedReplicaSet({ namespace });
      return result.items ?? [];
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
 * explicitly allowlisted workload operations. It never receives shell
 * commands, unrestricted credentials, or model-generated API paths.
 */
export class KubernetesScaleExecutor implements RemediationExecutor {
  constructor(private readonly client: KubernetesWorkloadClient, private readonly allowedCluster: string) {}

  async runPreflight(input: RemediationInput): Promise<PreflightResult> {
    if (!input.actionType.startsWith("kubernetes.")) return { safe: false, observedState: {}, changeSummary: "", reason: `Action ${input.actionType} is not enabled by this executor.` };
    if (input.target.cluster !== this.allowedCluster) return { safe: false, observedState: {}, changeSummary: "", reason: "Target cluster is not allowlisted for this executor." };
    const replicas = input.parameters.replicas;
    if (input.actionType === "kubernetes.scale" && (typeof replicas !== "number" || !Number.isInteger(replicas) || replicas < 1 || replicas > 100)) {
      return { safe: false, observedState: {}, changeSummary: "", reason: "Scale actions require an integer replicas value from 1 to 100." };
    }
    if (["kubernetes.pause-rollout", "kubernetes.resume-rollout", "kubernetes.rollback"].includes(input.actionType) && input.target.resourceKind !== "Deployment") {
      return { safe: false, observedState: {}, changeSummary: "", reason: `${input.actionType} is only available for Deployments.` };
    }
    try {
      const workload = await this.read(input);
      const currentReplicas = workload.spec?.replicas ?? 1;
      const observedState: Record<string, unknown> = {
        currentReplicas,
        resourceVersion: workload.metadata?.resourceVersion ?? null,
        paused: input.target.resourceKind === "Deployment" ? Boolean((workload as V1Deployment).spec?.paused) : false,
        template: workload.spec?.template ?? null,
      };
      if (input.actionType === "kubernetes.rollback") {
        const rollbackTemplate = await this.rollbackTemplate(input, workload as V1Deployment);
        if (!rollbackTemplate) return { safe: false, observedState, changeSummary: "", reason: "No prior Deployment revision is available for rollback." };
        observedState.rollbackTemplate = rollbackTemplate;
      }
      return {
        safe: true,
        observedState,
        changeSummary: this.changeSummary(input, currentReplicas),
      };
    } catch (error) {
      return { safe: false, observedState: {}, changeSummary: "", reason: `Unable to inspect target workload: ${error instanceof Error ? error.message : "unknown error"}` };
    }
  }

  async execute(input: RemediationInput & { preflight: PreflightResult }): Promise<ExecutionResult> {
    const operation = input.actionType;
    if (operation === "kubernetes.scale") await this.scale(input, input.parameters.replicas as number);
    if (operation === "kubernetes.restart") await this.patch(input, { spec: { template: { metadata: { annotations: { "incident-intelligence/restarted-at": new Date().toISOString() } } } } });
    if (operation === "kubernetes.pause-rollout") await this.patch(input, { spec: { paused: true } });
    if (operation === "kubernetes.resume-rollout") await this.patch(input, { spec: { paused: false } });
    if (operation === "kubernetes.rollback") await this.patch(input, { spec: { template: input.preflight.observedState.rollbackTemplate } });
    return {
      executionId: `kubernetes:${input.target.cluster}:${input.target.namespace}:${input.target.resourceName}:${input.idempotencyKey}`,
      changed: true,
      previousState: input.preflight.observedState,
      output: { actionType: operation, requestedReplicas: input.parameters.replicas ?? null, target: input.target },
    };
  }

  async verify(input: RemediationInput & { execution: ExecutionResult }): Promise<VerificationResult> {
    const workload = await this.read(input);
    const requested = input.parameters.replicas as number;
    const observed = workload.status?.availableReplicas ?? 0;
    const desired = workload.spec?.replicas ?? 0;
    if (input.actionType === "kubernetes.pause-rollout" || input.actionType === "kubernetes.resume-rollout") {
      const expected = input.actionType === "kubernetes.pause-rollout";
      const paused = Boolean((workload as V1Deployment).spec?.paused);
      return { healthy: paused === expected, checks: [{ name: "rollout_pause_state", passed: paused === expected, detail: `Paused: ${paused}; expected: ${expected}.` }] };
    }
    if (input.actionType === "kubernetes.restart" || input.actionType === "kubernetes.rollback") {
      return { healthy: observed >= Math.max(1, desired), checks: [{ name: "available_replicas", passed: observed >= Math.max(1, desired), detail: `Available replicas: ${observed}; desired: ${desired}.` }] };
    }
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
    if (input.actionType === "kubernetes.scale" && typeof previous === "number" && Number.isInteger(previous) && previous >= 0) await this.scale(input, previous);
    if (input.actionType === "kubernetes.pause-rollout" || input.actionType === "kubernetes.resume-rollout") await this.patch(input, { spec: { paused: input.execution.previousState.paused } });
    if (input.actionType === "kubernetes.rollback" && input.execution.previousState.template) await this.patch(input, { spec: { template: input.execution.previousState.template } });
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

  private async patch(input: RemediationInput, body: Record<string, unknown>) {
    if (input.target.resourceKind === "Deployment") await this.client.patchDeployment(input.target.resourceName, input.target.namespace, body);
    else await this.client.patchStatefulSet(input.target.resourceName, input.target.namespace, body);
  }

  private changeSummary(input: RemediationInput, currentReplicas: number) {
    const target = `${input.target.resourceKind}/${input.target.namespace}/${input.target.resourceName}`;
    if (input.actionType === "kubernetes.scale") return `Scale ${target} from ${currentReplicas} to ${input.parameters.replicas} replicas.`;
    if (input.actionType === "kubernetes.restart") return `Restart ${target} by changing only its pod template annotation.`;
    if (input.actionType === "kubernetes.pause-rollout") return `Pause rollout for ${target}.`;
    if (input.actionType === "kubernetes.resume-rollout") return `Resume rollout for ${target}.`;
    return `Roll back ${target} to its immediately preceding ReplicaSet template.`;
  }

  private async rollbackTemplate(input: RemediationInput, deployment: V1Deployment) {
    const deploymentUid = deployment.metadata?.uid;
    const currentRevision = Number(deployment.metadata?.annotations?.["deployment.kubernetes.io/revision"] ?? "0");
    const requestedRevision = input.parameters.revision;
    const targetRevision = typeof requestedRevision === "number" && Number.isInteger(requestedRevision) ? requestedRevision : currentRevision - 1;
    const candidate = (await this.client.listReplicaSets(input.target.namespace))
      .find((replicaSet) => replicaSet.metadata?.ownerReferences?.some((owner) => owner.uid === deploymentUid) && Number(replicaSet.metadata?.annotations?.["deployment.kubernetes.io/revision"] ?? "0") === targetRevision);
    return candidate?.spec?.template ?? null;
  }
}
