import { describe, expect, it, vi } from "vitest";
import type { V1Deployment, V1StatefulSet } from "@kubernetes/client-node";
import { KubernetesScaleExecutor, type KubernetesWorkloadClient } from "./remediation-executor.js";

const input = {
  actionRequestId: "action-1",
  actionType: "kubernetes.scale" as const,
  target: { organizationId: "org", incidentId: "incident", environment: "production", cluster: "prod-us-east-1", namespace: "checkout", resourceKind: "Deployment" as const, resourceName: "checkout-api" },
  parameters: { replicas: 3 },
  requestedBy: "operator", requiredApprovals: 1, expiresInMs: 60_000, idempotencyKey: "key-1",
};

function client(overrides: Partial<KubernetesWorkloadClient> = {}): KubernetesWorkloadClient {
  let deploymentReplicas = 2;
  return {
    readDeployment: vi.fn(async () => ({ spec: { replicas: deploymentReplicas }, status: { availableReplicas: 3 }, metadata: { resourceVersion: "42" } }) as unknown as V1Deployment),
    readStatefulSet: vi.fn(async () => ({ spec: { replicas: 2 }, status: { availableReplicas: 2 } }) as unknown as V1StatefulSet),
    scaleDeployment: vi.fn(async (_name, _namespace, replicas) => { deploymentReplicas = replicas; }),
    scaleStatefulSet: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("KubernetesScaleExecutor", () => {
  it("rejects an unallowlisted cluster before accessing the Kubernetes API", async () => {
    const kubernetes = client();
    const executor = new KubernetesScaleExecutor(kubernetes, "prod-us-east-1");
    const result = await executor.runPreflight({ ...input, target: { ...input.target, cluster: "other" } });
    expect(result.safe).toBe(false);
    expect(kubernetes.readDeployment).not.toHaveBeenCalled();
  });

  it("captures prior state, applies only scale, verifies availability, and compensates", async () => {
    const kubernetes = client();
    const executor = new KubernetesScaleExecutor(kubernetes, "prod-us-east-1");
    const preflight = await executor.runPreflight(input);
    expect(preflight).toMatchObject({ safe: true, observedState: { currentReplicas: 2 } });
    const execution = await executor.execute({ ...input, preflight });
    expect(kubernetes.scaleDeployment).toHaveBeenCalledWith("checkout-api", "checkout", 3);
    await expect(executor.verify({ ...input, execution })).resolves.toMatchObject({ healthy: true });
    await executor.compensate({ ...input, execution });
    expect(kubernetes.scaleDeployment).toHaveBeenLastCalledWith("checkout-api", "checkout", 2);
  });
});
