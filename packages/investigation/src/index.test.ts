import { describe, expect, it } from "vitest";
import { chunkDocument, documentChecksum, lexicalScore } from "./index.js";

describe("investigation evidence utilities", () => {
  it("preserves paragraph context while producing bounded citations", () => {
    const chunks = chunkDocument("First safe step.\n\nSecond safe step.", 30);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toBe("First safe step.");
    expect(chunks[1]?.content).toBe("Second safe step.");
  });

  it("ranks evidence by whole query terms without altering source content", () => {
    expect(lexicalScore("checkout latency", "Checkout latency is rising.")).toBeGreaterThan(0);
    expect(lexicalScore("checkout latency", "Unrelated cache event.")).toBe(0);
    expect(documentChecksum("source evidence")).toHaveLength(64);
  });
});
