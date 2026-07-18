import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  if (process.env.NODE_ENV !== "development" || process.env.DEMO_MODE !== "true") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || !("decision" in body) || !["approved", "rejected"].includes(String(body.decision))) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { actionId } = await params;
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  const response = await fetch(`${apiBaseUrl}/v1/actions/${actionId}/approval`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer aegis-demo-approver" }, body: JSON.stringify({ decision: body.decision, comment: "Demo production approver decision." }) });
  return NextResponse.json(await response.json(), { status: response.status });
}
