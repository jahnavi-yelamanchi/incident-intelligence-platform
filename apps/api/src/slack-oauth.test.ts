import { describe, expect, it } from "vitest";
import { slackAuthorizeUrl } from "./slack-oauth.js";
import { verifyOAuthState } from "./security/oauth-state.js";

describe("Slack OAuth", () => {
  const config = { clientId: "client", clientSecret: "secret", redirectUri: "https://console.example.com/v1/integrations/slack/callback", stateSecret: "s".repeat(32), signingSecret: "signing", encryptionKey: "a".repeat(64) };
  it("builds the v2 authorization URL with minimum bot scopes and tenant state", () => {
    const url = new URL(slackAuthorizeUrl({ subject: "auth0|admin", organizationId: "org", roles: ["administrator"] }, config));
    expect(url.origin).toBe("https://slack.com");
    expect(url.searchParams.get("scope")).toBe("chat:write,channels:read,commands");
    expect(verifyOAuthState(url.searchParams.get("state")!, config.stateSecret)).toMatchObject({ organizationId: "org", subject: "auth0|admin" });
  });
});
