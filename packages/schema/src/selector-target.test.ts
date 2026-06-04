import { describe, expect, it } from "vitest";
import {
  caliperTargetToDomQuerySelector,
  normalizeCaliperTargetSelector,
  CALIPER_TARGET_RESOLUTION_MODES,
} from "./selector-target.js";

describe("normalizeCaliperTargetSelector", () => {
  it("maps caliper agent ids to data attribute selectors", () => {
    expect(normalizeCaliperTargetSelector("caliper-abc123")).toEqual({
      mode: CALIPER_TARGET_RESOLUTION_MODES.DOM_QUERY,
      cssSelector: '[data-caliper-agent-id="caliper-abc123"]',
    });
  });

  it("escapes quotes in agent ids", () => {
    expect(normalizeCaliperTargetSelector('caliper-bad"id')).toEqual({
      mode: CALIPER_TARGET_RESOLUTION_MODES.DOM_QUERY,
      cssSelector: '[data-caliper-agent-id="caliper-bad\\"id"]',
    });
  });

  it("passes through css selectors unchanged", () => {
    expect(normalizeCaliperTargetSelector('[role="tablist"]')).toEqual({
      mode: CALIPER_TARGET_RESOLUTION_MODES.DOM_QUERY,
      cssSelector: '[role="tablist"]',
    });
  });

  it("trims whitespace before classification", () => {
    expect(normalizeCaliperTargetSelector("  #hero  ")).toEqual({
      mode: CALIPER_TARGET_RESOLUTION_MODES.DOM_QUERY,
      cssSelector: "#hero",
    });
  });

  it("detects json fingerprint targets", () => {
    expect(normalizeCaliperTargetSelector('{"selector":"caliper-x","tag":"div"}')).toEqual({
      mode: CALIPER_TARGET_RESOLUTION_MODES.FINGERPRINT_JSON,
    });
    expect(caliperTargetToDomQuerySelector('{"selector":"caliper-x"}')).toBeNull();
  });
});
