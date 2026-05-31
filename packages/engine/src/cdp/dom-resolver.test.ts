import { describe, expect, it } from "vitest";
import { normalizeSelectorForDom } from "./dom-resolver.js";

describe("normalizeSelectorForDom", () => {
  it("maps caliper agent ids to data attribute selectors", () => {
    expect(normalizeSelectorForDom("caliper-abc123")).toBe(
      '[data-caliper-agent-id="caliper-abc123"]'
    );
  });

  it("passes through css selectors unchanged", () => {
    expect(normalizeSelectorForDom('[role="tablist"]')).toBe('[role="tablist"]');
  });
});
