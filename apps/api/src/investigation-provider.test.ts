import { describe, expect, it } from "vitest";
import { createOpenAiInvestigationProvider } from "./investigation-provider.js";

describe("OpenAI investigation provider", () => {
  it("uses strict structured output and validates the returned hypothesis", async () => {
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(body.text.format.type).toBe("json_schema");
      expect(body.text.format.strict).toBe(true);
      return new Response(JSON.stringify({
        status: "completed",
        output_text: JSON.stringify({
          hypotheses: [{
            statement: "The deployment may have increased checkout latency.",
            confidence: 0.62,
            citationIds: ["75c56ad8-d17d-4d28-a4e3-66be34d4f18a"],
            conflictingEvidence: [],
            recommendedChecks: ["Compare deployment timing with p95 latency."],
          }],
        }),
      }), { status: 200 });
    };
    const provider = createOpenAiInvestigationProvider({ apiKey: "test-key", model: "gpt-5.6", fetch });
    await expect(provider.generate({
      incidentTitle: "Checkout latency",
      incidentSummary: null,
      evidence: [{
        id: "75c56ad8-d17d-4d28-a4e3-66be34d4f18a",
        title: "Checkout runbook",
        kind: "runbook",
        excerpt: "Compare deployment timing.",
        sourceUrl: null,
        indexedAt: null,
      }],
    })).resolves.toMatchObject({ hypotheses: [{ confidence: 0.62 }] });
  });
});
