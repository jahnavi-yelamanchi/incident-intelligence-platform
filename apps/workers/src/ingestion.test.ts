import { describe, expect, it } from "vitest";
import { isTerminalFailure } from "./ingestion";

describe("ingestion failure routing", () => {
  it("dead-letters only after the configured retry budget", () => {
    expect(isTerminalFailure(4, 5)).toBe(false);
    expect(isTerminalFailure(5, 5)).toBe(true);
  });

  it("defaults one-shot jobs to a single attempt", () => {
    expect(isTerminalFailure(1, undefined)).toBe(true);
  });
});
