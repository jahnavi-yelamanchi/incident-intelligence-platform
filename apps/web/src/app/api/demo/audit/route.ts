import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV !== "development" || process.env.DEMO_MODE !== "true") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  const response = await fetch(`${apiBaseUrl}/v1/audit-events?limit=50`, { headers: { authorization: "Bearer aegis-demo" }, cache: "no-store" });
  return NextResponse.json(await response.json(), { status: response.status });
}
