import { describe, expect, it } from "vitest";
import { githubDeploymentStatusSchema, normalizeGitHubDeploymentStatus } from "./normalize-github.js";

describe("GitHub deployment status normalization", () => {
  it("turns a failed deployment into an actionable normalized event", () => {
    const payload = githubDeploymentStatusSchema.parse({ deployment_status: { id: 10, state: "failure", environment: "production", created_at: "2026-07-17T12:00:00.000Z", description: "Health check failed" }, deployment: { id: 4, ref: "main" }, repository: { full_name: "acme/checkout" } });
    const event = normalizeGitHubDeploymentStatus(payload, "75c56ad8-d17d-4d28-a4e3-66be34d4f18a");
    expect(event).toMatchObject({ source: "github", severity: "high", status: "firing", service: "acme/checkout" });
  });
});
