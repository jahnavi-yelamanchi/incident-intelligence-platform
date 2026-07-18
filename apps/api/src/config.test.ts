import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("API configuration", () => {
  it("treats blank optional provider configuration as absent", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://incident_app:incident_app@localhost:5432/incident",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "test-key",
      SLACK_CLIENT_ID: "",
      SLACK_CLIENT_SECRET: "",
      SLACK_SIGNING_SECRET: "",
      GITHUB_APP_ID: "",
      GITHUB_APP_PRIVATE_KEY: "",
      INTEGRATION_OAUTH_STATE_SECRET: "",
    });
    expect(config.OPENAI_API_KEY).toBe("test-key");
    expect(config.SLACK_CLIENT_ID).toBeUndefined();
    expect(config.GITHUB_APP_ID).toBeUndefined();
    expect(config.INTEGRATION_OAUTH_STATE_SECRET).toBeUndefined();
  });
});
