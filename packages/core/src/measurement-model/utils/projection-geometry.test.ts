import { describe, it, expect } from "vitest";
import { getMaxProjectionDistance, getProjectionLineGeometry } from "./projection-geometry.js";
import type { LiveGeometry } from "@/geometry/utils/scroll-aware.js";

const doc = { width: 1000, height: 800 };

describe("getMaxProjectionDistance", () => {
  const live = { top: 100, left: 50, width: 200, height: 80 };

  it("computes runway for each direction", () => {
    expect(getMaxProjectionDistance("top", live, doc)).toBe(100);
    expect(getMaxProjectionDistance("bottom", live, doc)).toBe(620);
    expect(getMaxProjectionDistance("left", live, doc)).toBe(50);
    expect(getMaxProjectionDistance("right", live, doc)).toBe(750);
  });
});

describe("getProjectionLineGeometry", () => {
  const live: LiveGeometry = {
    left: 50,
    top: 100,
    width: 200,
    height: 80,
    clipPath: "",
    isHidden: false,
    visibleMinX: 50,
    visibleMaxX: 250,
    visibleMinY: 100,
    visibleMaxY: 180,
  };

  const viewport = { scrollX: 0, scrollY: 0, width: 400, height: 300 };

  it("returns vertical top projection endpoints", () => {
    const geom = getProjectionLineGeometry({
      direction: "top",
      value: 40,
      live,
      viewport,
      docSize: doc,
    });

    expect(geom).not.toBeNull();
    expect(geom!.x1).toBe(geom!.x2);
    expect(geom!.y1).toBe(100);
    expect(geom!.y2).toBe(60);
    expect(geom!.actualValue).toBe(40);
  });
});
