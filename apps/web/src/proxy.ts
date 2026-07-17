import { auth0, isAuthConfigured } from "@/lib/auth0";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  if (!isAuthConfigured || !auth0) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "identity_provider_unavailable", message: "Auth0 is not configured." },
        { status: 503 },
      );
    }

    return NextResponse.next();
  }

  return auth0.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
