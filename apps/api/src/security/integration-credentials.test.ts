import { describe, expect, it } from "vitest";
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "./integration-credentials.js";

describe("integration credential encryption", () => {
  const key = "a".repeat(64);
  it("encrypts credentials with an authenticated randomized envelope", () => {
    const encrypted = encryptIntegrationCredentials({ accessToken: "secret", scope: "repo" }, key);
    expect(encrypted).not.toContain("secret");
    expect(decryptIntegrationCredentials(encrypted, key)).toEqual({ accessToken: "secret", scope: "repo" });
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptIntegrationCredentials({ secret: "value" }, key);
    const [prefix, nonce, tag, payload] = encrypted.split(".");
    const tampered = `${prefix}.${nonce}.${tag}.${payload!.slice(0, -1)}${payload!.endsWith("A") ? "B" : "A"}`;
    expect(() => decryptIntegrationCredentials(tampered, key)).toThrow();
  });
});
