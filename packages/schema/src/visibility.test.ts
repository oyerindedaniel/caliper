import { describe, expect, it } from "vitest";
import {
  CALIPER_VISIBILITY_REASON,
  CALIPER_VISIBILITY_STATUS,
  CaliperVisibilitySchema,
} from "./visibility.js";

describe("visibility schema", () => {
  it("parses hidden visibility with css media-query detail in hiddenBy", () => {
    const visibility = CaliperVisibilitySchema.parse({
      status: CALIPER_VISIBILITY_STATUS.HIDDEN,
      reason: CALIPER_VISIBILITY_REASON.DISPLAY_NONE,
      computedDisplay: "none",
      computedVisibility: "visible",
      opacity: 1,
      intersectingViewport: false,
      hiddenBy: {
        type: "css_media_query",
        mediaQuery: "(min-width: 640px)",
        detail: "Element matches (min-width: 640px) { display: none }",
      },
    });

    expect(visibility.reason).toBe("display_none");
    expect(visibility.hiddenBy?.type).toBe("css_media_query");
  });
});
