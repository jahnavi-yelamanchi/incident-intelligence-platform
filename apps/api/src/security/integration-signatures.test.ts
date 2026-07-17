import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubSignature, verifySlackSignature } from "./integration-signatures.js";

describe("integration webhook signatures", () => {
  it("verifies GitHub HMAC SHA-256 payloads", () => {
    const body = '{"action":"published"}';
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyGitHubSignature(body, "secret", signature)).toBe(true);
    expect(verifyGitHubSignature(body, "other", signature)).toBe(false);
  });
  it("verifies Slack signed payloads within replay tolerance", () => {
    const body = "command=approve";
    const timestamp = "1784329000";
    const signature = `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
    expect(verifySlackSignature(body, "secret", signature, timestamp, 1_784_329_000_000)).toBe(true);
    expect(verifySlackSignature(body, "secret", signature, timestamp, 1_784_330_000_000)).toBe(false);
  });
});
