import { describe, expect, it } from "vitest";
import { extractBearerToken } from "./auth0-access-token.js";

describe("bearer access tokens", () => {
  it("accepts an explicit bearer token", () => {
    expect(extractBearerToken("Bearer signed.token.value")).toBe("signed.token.value");
  });

  it("rejects missing, malformed, and empty authorization headers", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken("Bearer   ")).toBeNull();
  });
});
