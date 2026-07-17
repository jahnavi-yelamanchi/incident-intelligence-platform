import { describe, expect, it } from "vitest";
import { createOAuthState, verifyOAuthState } from "./oauth-state.js";

describe("OAuth state", () => {
  it("binds provider, tenant, user, and expiry into an authenticated state", () => {
    const state = createOAuthState({ provider: "slack", organizationId: "org", subject: "auth0|user" }, "state-secret", 1_000);
    expect(verifyOAuthState(state, "state-secret", 1_001)).toMatchObject({ organizationId: "org", subject: "auth0|user" });
    expect(verifyOAuthState(state, "other", 1_001)).toBeNull();
    expect(verifyOAuthState(state, "state-secret", 601_001)).toBeNull();
  });
});
