import { auth0, authClaims, isAuthConfigured } from "@/lib/auth0";
import { NextResponse } from "next/server";

export async function GET() {
  if (!isAuthConfigured || !auth0) {
    if (process.env.NODE_ENV === "development") {
      return NextResponse.json({
        user: { id: "local-operator", name: "Alex Morgan", email: "alex@example.test" },
        organizationId: "local-organization",
        roles: ["incident-commander", "production-approver"],
        developmentBypass: true,
      });
    }

    return NextResponse.json({ error: "identity_provider_unavailable" }, { status: 503 });
  }

  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const claims = session.user;
  const organizationId = claims[authClaims.organizationId];
  const roles = claims[authClaims.roles];

  if (typeof organizationId !== "string" || !Array.isArray(roles)) {
    return NextResponse.json({ error: "tenant_membership_required" }, { status: 403 });
  }

  return NextResponse.json({
    user: { id: claims.sub, name: claims.name, email: claims.email },
    organizationId,
    roles: roles.filter((role): role is string => typeof role === "string"),
    developmentBypass: false,
  });
}
