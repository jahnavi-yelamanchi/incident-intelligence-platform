import { Auth0Client } from "@auth0/nextjs-auth0/server";

const requiredEnvironment = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "APP_BASE_URL",
] as const;

export const isAuthConfigured = requiredEnvironment.every((name) => Boolean(process.env[name]));

export const auth0 = isAuthConfigured
  ? new Auth0Client({
      authorizationParameters: {
        scope: "openid profile email offline_access",
        ...(process.env.AUTH0_AUDIENCE ? { audience: process.env.AUTH0_AUDIENCE } : {}),
      },
      session: {
        rolling: true,
        absoluteDuration: 60 * 60 * 12,
        inactivityDuration: 60 * 30,
      },
    })
  : null;

export const authClaims = {
  organizationId: "https://incident-intelligence.example/organization_id",
  roles: "https://incident-intelligence.example/roles",
} as const;
