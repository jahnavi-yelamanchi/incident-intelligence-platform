import { createHmac, timingSafeEqual } from "node:crypto";

export type OAuthState = { provider: "slack"; organizationId: string; subject: string; expiresAt: number };

function encode(value: OAuthState) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }

export function createOAuthState(input: Omit<OAuthState, "expiresAt">, secret: string, now = Date.now()) {
  const payload = encode({ ...input, expiresAt: now + 10 * 60_000 });
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state: string, secret: string, now = Date.now()): OAuthState | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Partial<OAuthState>;
    if (value.provider !== "slack" || typeof value.organizationId !== "string" || typeof value.subject !== "string" || typeof value.expiresAt !== "number" || value.expiresAt < now) return null;
    return value as OAuthState;
  } catch { return null; }
}
