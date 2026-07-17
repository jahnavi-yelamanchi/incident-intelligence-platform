import { createRemoteJWKSet, jwtVerify } from "jose";

export type ApiAuthContext = {
  subject: string;
  organizationId: string;
  roles: string[];
};

export type Auth0AccessTokenConfig = {
  issuer: string;
  audience: string;
  organizationClaim: string;
  rolesClaim: string;
};

export function extractBearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export function createAuth0AccessTokenVerifier(config: Auth0AccessTokenConfig) {
  const issuer = config.issuer.replace(/\/$/, "");
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (authorization: string | undefined): Promise<ApiAuthContext | null> => {
    const token = extractBearerToken(authorization);
    if (!token) return null;

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: config.audience,
        algorithms: ["RS256"],
      });
      const organizationId = payload[config.organizationClaim];
      const roles = payload[config.rolesClaim];
      if (typeof payload.sub !== "string" || typeof organizationId !== "string" || !Array.isArray(roles)) {
        return null;
      }

      return {
        subject: payload.sub,
        organizationId,
        roles: roles.filter((role): role is string => typeof role === "string"),
      };
    } catch {
      return null;
    }
  };
}
