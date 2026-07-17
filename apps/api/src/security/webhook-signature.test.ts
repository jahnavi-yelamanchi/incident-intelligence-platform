import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./webhook-signature.js";

describe("verifyWebhookSignature", () => {
  const body = '{"status":"firing"}';
  const secret = "test-secret";
  const timestamp = "1784291400";
  const now = new Date(Number(timestamp) * 1000);

  it("accepts a correctly signed, current payload", () => {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(verifyWebhookSignature({ body, secret, signature, timestamp, now })).toEqual({ valid: true });
  });

  it("rejects replayed payloads outside the tolerance", () => {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(
      verifyWebhookSignature({ body, secret, signature, timestamp, now: new Date(now.getTime() + 301_000) }),
    ).toEqual({ valid: false, reason: "expired" });
  });
});
