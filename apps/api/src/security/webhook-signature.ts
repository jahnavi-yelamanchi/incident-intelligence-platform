import { createHmac, timingSafeEqual } from "node:crypto";

export type SignatureResult =
  | { valid: true }
  | { valid: false; reason: "missing" | "expired" | "malformed" | "mismatch" };

export function verifyWebhookSignature(input: {
  body: string;
  secret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  now?: Date;
  toleranceSeconds?: number;
}): SignatureResult {
  const { body, secret, signature, timestamp, now = new Date(), toleranceSeconds = 300 } = input;
  if (!signature || !timestamp) return { valid: false, reason: "missing" };

  const epoch = Number(timestamp);
  if (!Number.isInteger(epoch)) return { valid: false, reason: "malformed" };
  if (Math.abs(now.getTime() / 1000 - epoch) > toleranceSeconds) {
    return { valid: false, reason: "expired" };
  }

  const providedHex = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (!/^[0-9a-f]{64}$/i.test(providedHex)) return { valid: false, reason: "malformed" };

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  const provided = Buffer.from(providedHex, "hex");
  return timingSafeEqual(expected, provided)
    ? { valid: true }
    : { valid: false, reason: "mismatch" };
}

