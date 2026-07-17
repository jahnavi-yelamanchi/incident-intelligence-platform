import { CommandCenter } from "@/components/command-center";
import type { IncidentView } from "@/components/data";
import { auth0, isAuthConfigured } from "@/lib/auth0";
import { redirect } from "next/navigation";

export default async function Home() {
  if (!isAuthConfigured || !auth0) {
    return <CommandCenter userName="Alex Morgan" initialIncidents={await loadIncidents("aegis-demo")} realtimeToken="aegis-demo" realtimeUrl={realtimeUrl()} />;
  }

  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const accessToken = await auth0.getAccessToken(
    process.env.AUTH0_AUDIENCE ? { audience: process.env.AUTH0_AUDIENCE } : {},
  );
  return <CommandCenter userName={session.user.name ?? session.user.email ?? "Operator"} initialIncidents={await loadIncidents(accessToken.token)} realtimeToken={accessToken.token} realtimeUrl={realtimeUrl()} />;
}

function realtimeUrl() {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  return `${apiBaseUrl.replace(/^http/, "ws")}/v1/realtime`;
}

async function loadIncidents(accessToken: string): Promise<IncidentView[]> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${apiBaseUrl}/v1/incidents?limit=50`, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { items?: IncidentView[] };
    return Array.isArray(payload.items) ? payload.items : [];
  } catch {
    return [];
  }
}
