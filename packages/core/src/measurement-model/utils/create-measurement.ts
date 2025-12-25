import type { CursorContext } from "../../shared/types/index.js";
import { resolveAmbiguousContext } from "../../cursor-context/utils/priority-rules.js";
import {
  createMeasurementLines,
  type MeasurementResult,
} from "./measurement-result.js";
import {
  getScrollAwareRect,
  clipToViewport,
} from "../../geometry/utils/scroll-aware.js";

/**
 * Find scroll container for an element
 */
function findScrollContainer(element: Element): Element | null {
  let parent = element.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (
      style.overflow === "auto" ||
      style.overflow === "scroll" ||
      style.overflowX === "auto" ||
      style.overflowX === "scroll" ||
      style.overflowY === "auto" ||
      style.overflowY === "scroll"
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

/**
 * Create a measurement result from element and cursor position
 */
export function createMeasurement(
  selectedElement: Element,
  cursorX: number,
  cursorY: number,
  previousContext: CursorContext | null = null
): MeasurementResult | null {
  const result = resolveAmbiguousContext(
    selectedElement,
    cursorX,
    cursorY,
    previousContext
  );

  if (!result) {
    return null;
  }

  const { context, element: secondaryElement } = result;

  const primaryScrollContainer = findScrollContainer(selectedElement);
  const secondaryScrollContainer = findScrollContainer(secondaryElement);

  const primary = getScrollAwareRect(
    selectedElement,
    primaryScrollContainer || undefined
  );
  const secondary = getScrollAwareRect(
    secondaryElement,
    secondaryScrollContainer || undefined
  );

  const primaryClipped = clipToViewport(primary);
  const secondaryClipped = clipToViewport(secondary);

  const lines = createMeasurementLines(
    context,
    primaryClipped,
    secondaryClipped
  );

  return {
    context,
    lines,
    primary: primaryClipped,
    secondary: secondaryClipped,
    timestamp: performance.now(),
  };
}
