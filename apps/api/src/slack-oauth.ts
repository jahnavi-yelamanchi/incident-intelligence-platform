import { z } from "zod";
import type { DatabaseClient } from "@incident/database";
import type { ApiAuthContext } from "./security/auth0-access-token.js";
import { createOAuthState, verifyOAuthState } from "./security/oauth-state.js";
import { upsertSlackOAuthConnection } from "./integrations.js";

const slackOAuthResponseSchema = z.object({
  ok: z.literal(true), access_token: z.string().min(1), scope: z.string().default(""), bot_user_id: z.string().min(1).optional(),
  team: z.object({ id: z.string().min(1), name: z.string().min(1) }),
});

export type SlackOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string; stateSecret: string; signingSecret: string; encryptionKey: string };

function canInstallSlack(context: ApiAuthContext) { return context.roles.includes("administrator") || context.roles.includes("incident-commander"); }

export function slackAuthorizeUrl(context: ApiAuthContext, config: SlackOAuthConfig) {
  if (!canInstallSlack(context)) throw Object.assign(new Error("Administrator role required."), { statusCode: 403 });
  const state = createOAuthState({ provider: "slack", organizationId: context.organizationId, subject: context.subject }, config.stateSecret);
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "chat:write,channels:read,commands");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeSlackOAuth(database: DatabaseClient, input: { code: string; state: string }, config: SlackOAuthConfig, correlationId: string, request: typeof fetch = fetch) {
  const state = verifyOAuthState(input.state, config.stateSecret);
  if (!state) throw Object.assign(new Error("Invalid or expired OAuth state."), { statusCode: 400 });
  const form = new URLSearchParams({ code: input.code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri });
  const response = await request("https://slack.com/api/oauth.v2.access", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  if (!response.ok) throw Object.assign(new Error("Slack OAuth token exchange failed."), { statusCode: 502 });
  const payload = slackOAuthResponseSchema.safeParse(await response.json());
  if (!payload.success) throw Object.assign(new Error("Slack OAuth returned an invalid token response."), { statusCode: 502 });
  return upsertSlackOAuthConnection(database, state, payload.data, config.encryptionKey, config.signingSecret, correlationId);
}
