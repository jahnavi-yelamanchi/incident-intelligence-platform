import { describe, expect, it } from "vitest";
import { parseHiddenPanels, toggleHiddenPanel } from "./panel-preferences";

describe("dashboard panel preferences", () => {
  it("restores only known panel identifiers", () => {
    expect(parseHiddenPanels('["investigation","unknown","incidents"]')).toEqual([
      "incidents",
      "investigation",
    ]);
  });

  it("recovers from malformed browser storage", () => {
    expect(parseHiddenPanels("not-json")).toEqual([]);
    expect(parseHiddenPanels('{"incidents":true}')).toEqual([]);
  });

  it("toggles a panel without mutating the saved value", () => {
    const current = ["incidents"] as const;
    expect(toggleHiddenPanel(current, "investigation")).toEqual(["incidents", "investigation"]);
    expect(toggleHiddenPanel(current, "incidents")).toEqual([]);
    expect(current).toEqual(["incidents"]);
  });
});
