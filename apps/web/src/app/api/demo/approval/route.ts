import { NextResponse } from "next/server";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development" || process.env.DEMO_MODE !== "true") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const body: unknown = await request.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("incidentId" in body) ||
    !("service" in body) ||
    !("environment" in body) ||
    typeof body.incidentId !== "string" ||
    typeof body.service !== "string" ||
    typeof body.environment !== "string" ||
    !("actionType" in body) ||
    !["kubernetes.scale", "kubernetes.restart", "kubernetes.pause-rollout", "kubernetes.resume-rollout", "kubernetes.rollback"].includes(String(body.actionType))
  ) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const actionType = body.actionType as string;
  const replicas = "replicas" in body && typeof body.replicas === "number" ? Math.max(1, Math.min(20, Math.floor(body.replicas))) : 3;
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  const response = await fetch(`${apiBaseUrl}/v1/incidents/${body.incidentId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer aegis-demo" },
    body: JSON.stringify({
      actionType,
      target: {
        service: body.service,
        environment: body.environment,
        cluster: "demo-cluster",
        namespace: "operations-demo",
        resourceKind: "Deployment",
        resourceName: body.service.toLowerCase().replace(/\s+/g, "-"),
      },
      parameters: actionType === "kubernetes.scale" ? { replicas } : {},
      reason: `Approved ${actionType.replace("kubernetes.", "").replaceAll("-", " ")} requested while the incident is under investigation.`,
    }),
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
