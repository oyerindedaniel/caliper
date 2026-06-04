import { describe, expect, it } from "vitest";
import { caliperTargetToDomQuerySelector } from "@oyerinde/caliper-schema";

describe("caliperTargetToDomQuerySelector", () => {
  it("maps caliper agent ids to data attribute selectors", () => {
    expect(caliperTargetToDomQuerySelector("caliper-abc123")).toBe(
      '[data-caliper-agent-id="caliper-abc123"]'
    );
  });

  it("passes through css selectors unchanged", () => {
    expect(caliperTargetToDomQuerySelector('[role="tablist"]')).toBe('[role="tablist"]');
  });
});
