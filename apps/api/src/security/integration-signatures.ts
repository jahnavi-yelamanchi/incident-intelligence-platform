import { createHmac, timingSafeEqual } from "node:crypto";

function equal(expected: Buffer, supplied: string) {
  const received = Buffer.from(supplied, "hex");
  return received.length === expected.length && timingSafeEqual(expected, received);
}

export function verifyGitHubSignature(body: string, secret: string, signature: string | undefined) {
  if (!signature?.startsWith("sha256=")) return false;
  const hex = signature.slice("sha256=".length);
  return /^[0-9a-f]{64}$/i.test(hex) && equal(createHmac("sha256", secret).update(body).digest(), hex);
}

export function verifySlackSignature(body: string, secret: string, signature: string | undefined, timestamp: string | undefined, now = Date.now()) {
  if (!signature?.startsWith("v0=") || !timestamp || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const hex = signature.slice(3);
  return /^[0-9a-f]{64}$/i.test(hex) && equal(createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest(), hex);
}
