import { describe, expect, it, vi } from "vitest";
import type { V1Deployment, V1StatefulSet } from "@kubernetes/client-node";
import { KubernetesScaleExecutor, RdsFailoverExecutor, type KubernetesWorkloadClient, type RdsClientAdapter } from "./remediation-executor.js";

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
    patchDeployment: vi.fn(async () => undefined),
    patchStatefulSet: vi.fn(async () => undefined),
    listReplicaSets: vi.fn(async () => []),
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

  it("pauses only Deployments and restores their prior pause state on compensation", async () => {
    const kubernetes = client();
    const executor = new KubernetesScaleExecutor(kubernetes, "prod-us-east-1");
    const pause = { ...input, actionType: "kubernetes.pause-rollout" as const, parameters: {} };
    const preflight = await executor.runPreflight(pause);
    expect(preflight.safe).toBe(true);
    const execution = await executor.execute({ ...pause, preflight });
    expect(kubernetes.patchDeployment).toHaveBeenCalledWith("checkout-api", "checkout", { spec: { paused: true } });
    await executor.compensate({ ...pause, execution });
    expect(kubernetes.patchDeployment).toHaveBeenLastCalledWith("checkout-api", "checkout", { spec: { paused: false } });
    await expect(executor.runPreflight({ ...pause, target: { ...pause.target, resourceKind: "StatefulSet" } })).resolves.toMatchObject({ safe: false });
  });

  it("allows RDS failover only for an inspected available cluster in an allowed region", async () => {
    const rds: RdsClientAdapter = { describeCluster: vi.fn(async () => ({ status: "available", writer: "writer-1", members: ["writer-1", "reader-1"] })), failoverCluster: vi.fn(async () => undefined) };
    const executor = new RdsFailoverExecutor(() => rds, new Set(["us-east-1"]));
    const rdsInput = { ...input, actionType: "aws.rds.failover" as const, target: { organizationId: "org", incidentId: "incident", environment: "production", region: "us-east-1", dbClusterIdentifier: "checkout-db", targetDbInstanceIdentifier: "reader-1" }, parameters: {} };
    const preflight = await executor.runPreflight(rdsInput);
    expect(preflight.safe).toBe(true);
    const execution = await executor.execute({ ...rdsInput, preflight });
    expect(rds.failoverCluster).toHaveBeenCalledWith("checkout-db", "reader-1");
    await expect(executor.verify({ ...rdsInput, execution })).resolves.toMatchObject({ healthy: false });
    await expect(executor.runPreflight({ ...rdsInput, target: { ...rdsInput.target, region: "eu-west-1" } })).resolves.toMatchObject({ safe: false });
  });
});
