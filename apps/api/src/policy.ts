import type { CreateActionRequest } from "./incidents.js";
import type { ApiAuthContext } from "./security/auth0-access-token.js";

export type RemediationPolicyDecision = { allow: boolean; requiredApprovals: number; dryRunRequired: boolean; reason: string; source: "opa" | "development" };
export type RemediationPolicyEvaluator = (context: ApiAuthContext, input: CreateActionRequest) => Promise<RemediationPolicyDecision>;

export function createOpaPolicyEvaluator(baseUrl: string): RemediationPolicyEvaluator {
  return async (context, input) => {
    const response = await fetch(new URL("/v1/data/aegis/remediation/decision", baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { roles: context.roles, actionType: input.actionType, target: input.target } }), signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw Object.assign(new Error("Policy service is unavailable."), { statusCode: 503 });
    const body = await response.json() as { result?: Omit<RemediationPolicyDecision, "source"> };
    if (!body.result || typeof body.result.allow !== "boolean" || !Number.isInteger(body.result.requiredApprovals) || typeof body.result.dryRunRequired !== "boolean" || typeof body.result.reason !== "string") throw Object.assign(new Error("Policy service returned an invalid decision."), { statusCode: 503 });
    return { ...body.result, source: "opa" };
  };
}

export const developmentPolicyEvaluator: RemediationPolicyEvaluator = async (context, input) => ({
  allow: context.roles.includes("responder") || context.roles.includes("incident-commander"),
  requiredApprovals: input.target.environment === "production" ? 1 : 1,
  dryRunRequired: true,
  reason: "Development policy mirrors the production approval floor.",
  source: "development",
});
