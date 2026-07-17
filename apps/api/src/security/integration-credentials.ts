import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const version = "v1";

function keyFromHex(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("INTEGRATION_ENCRYPTION_KEY must be exactly 32 bytes encoded as hex.");
  return Buffer.from(value, "hex");
}

export function encryptIntegrationCredentials(credentials: Record<string, unknown>, encryptionKey: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromHex(encryptionKey), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return [version, nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptIntegrationCredentials(ciphertext: string, encryptionKey: string): Record<string, unknown> {
  const [storedVersion, nonce, authTag, payload] = ciphertext.split(".");
  if (storedVersion !== version || !nonce || !authTag || !payload) throw new Error("Unsupported encrypted integration credential format.");
  const decipher = createDecipheriv("aes-256-gcm", keyFromHex(encryptionKey), Buffer.from(nonce, "base64url"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid decrypted integration credentials.");
  return parsed as Record<string, unknown>;
}
