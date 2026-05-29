import { describe, it, expect } from "vitest";
import { isSameMeasurementContext } from "./measurement-context.js";
import type { ScrollState } from "@/shared/types/index.js";

function scrollState(element: HTMLElement): ScrollState {
  return {
    element,
    initialScrollTop: 0,
    initialScrollLeft: 0,
    containerRect: null,
    absoluteDepth: 0,
  };
}

describe("isSameMeasurementContext", () => {
  it("returns true when hierarchies share the same scroll elements", () => {
    const a = document.createElement("div");
    const b = document.createElement("section");
    const primary = [scrollState(a), scrollState(b)];
    const secondary = [scrollState(a), scrollState(b)];

    expect(
      isSameMeasurementContext({
        primaryPosition: "static",
        secondaryPosition: "static",
        primaryHierarchy: primary,
        secondaryHierarchy: secondary,
        selectedElement: null,
        secondaryElement: null,
      })
    ).toBe(true);
  });

  it("returns true for direct parent/child scroll relationship", () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.appendChild(child);

    expect(
      isSameMeasurementContext({
        primaryPosition: "static",
        secondaryPosition: "static",
        primaryHierarchy: [scrollState(parent)],
        secondaryHierarchy: [],
        selectedElement: child,
        secondaryElement: parent,
      })
    ).toBe(true);

    expect(
      isSameMeasurementContext({
        primaryPosition: "static",
        secondaryPosition: "static",
        primaryHierarchy: [],
        secondaryHierarchy: [scrollState(parent)],
        selectedElement: parent,
        secondaryElement: child,
      })
    ).toBe(true);
  });

  it("returns false when stacks differ", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const c = document.createElement("div");

    expect(
      isSameMeasurementContext({
        primaryPosition: "static",
        secondaryPosition: "absolute",
        primaryHierarchy: [scrollState(a)],
        secondaryHierarchy: [scrollState(b)],
        selectedElement: null,
        secondaryElement: c,
      })
    ).toBe(false);
  });
});
