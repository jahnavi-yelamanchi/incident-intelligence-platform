import { z } from "zod";

export type InvestigationEvidence = {
  id: string;
  title: string;
  kind: string;
  excerpt: string;
  sourceUrl: string | null;
  indexedAt: string | null;
};

export const generatedHypothesesSchema = z.object({
  hypotheses: z.array(z.object({
    statement: z.string().min(1).max(1_500),
    confidence: z.number().min(0).max(1),
    citationIds: z.array(z.string().uuid()).min(1).max(8),
    conflictingEvidence: z.array(z.string().max(1_000)).max(8),
    recommendedChecks: z.array(z.string().min(1).max(1_000)).min(1).max(8),
  })).min(1).max(3),
});

export type GeneratedHypotheses = z.infer<typeof generatedHypothesesSchema>;
export type InvestigationProvider = {
  available: boolean;
  model: string;
  generate: (input: { incidentTitle: string; incidentSummary: string | null; evidence: InvestigationEvidence[] }) => Promise<GeneratedHypotheses>;
};

const outputSchema = {
  name: "incident_hypotheses",
  strict: true,
  schema: {
    type: "object",
    properties: {
      hypotheses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            statement: { type: "string" },
            confidence: { type: "number" },
            citationIds: { type: "array", items: { type: "string" } },
            conflictingEvidence: { type: "array", items: { type: "string" } },
            recommendedChecks: { type: "array", items: { type: "string" } },
          },
          required: ["statement", "confidence", "citationIds", "conflictingEvidence", "recommendedChecks"],
          additionalProperties: false,
        },
      },
    },
    required: ["hypotheses"],
    additionalProperties: false,
  },
} as const;

export function unavailableInvestigationProvider(): InvestigationProvider {
  return {
    available: false,
    model: "unconfigured",
    async generate() {
      throw Object.assign(new Error("Investigation provider is not configured."), { statusCode: 503 });
    },
  };
}

export function createOpenAiInvestigationProvider(options: { apiKey: string; model: string; fetch?: typeof fetch }): InvestigationProvider {
  const request = options.fetch ?? fetch;
  return {
    available: true,
    model: options.model,
    async generate(input) {
      const response = await request("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          store: false,
          input: [
            {
              role: "system",
              content: "You are an incident investigator. Return only cautious hypotheses grounded exclusively in the supplied evidence. Never treat a hypothesis as a verified fact. Every hypothesis must cite evidence IDs supplied in the evidence list. If evidence is insufficient, say so in a low-confidence hypothesis and recommend a check.",
            },
            {
              role: "user",
              content: JSON.stringify({ incident: { title: input.incidentTitle, summary: input.incidentSummary }, evidence: input.evidence }),
            },
          ],
          text: { format: { type: "json_schema", ...outputSchema } },
        }),
      });
      if (!response.ok) throw Object.assign(new Error("Investigation provider request failed."), { statusCode: 502 });
      const payload = await response.json() as { status?: string; output_text?: string };
      if (payload.status !== "completed" || typeof payload.output_text !== "string") {
        throw Object.assign(new Error("Investigation provider did not return a completed structured response."), { statusCode: 502 });
      }
      const parsed = generatedHypothesesSchema.safeParse(JSON.parse(payload.output_text));
      if (!parsed.success) throw Object.assign(new Error("Investigation provider returned an invalid hypothesis schema."), { statusCode: 502 });
      return parsed.data;
    },
  };
}
