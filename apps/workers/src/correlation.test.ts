import { describe, expect, it } from "vitest";
import { highestSeverity, serviceSlug } from "./correlation";

describe("incident correlation helpers", () => {
  it("never lowers an incident severity", () => {
    expect(highestSeverity("critical", "medium")).toBe("critical");
    expect(highestSeverity("medium", "high")).toBe("high");
  });

  it("creates stable catalog slugs for alert-discovered services", () => {
    expect(serviceSlug("Checkout API / Blue")).toBe("checkout-api-blue");
    expect(serviceSlug("   ")).toBe("unknown-service");
  });
});
