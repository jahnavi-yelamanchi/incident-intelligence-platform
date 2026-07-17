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
    typeof body.environment !== "string"
  ) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  const response = await fetch(`${apiBaseUrl}/v1/incidents/${body.incidentId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer aegis-demo" },
    body: JSON.stringify({
      actionType: "kubernetes.scale",
      target: { service: body.service, environment: body.environment },
      parameters: { replicas: 3 },
      reason: "Restore capacity while the incident is under investigation.",
    }),
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
