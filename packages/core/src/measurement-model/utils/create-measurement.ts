import type { CursorContext } from "../../shared/types/index.js";
import { resolveAmbiguousContext } from "../../cursor-context/utils/priority-rules.js";
import { createMeasurementLines, type MeasurementResult } from "./measurement-result.js";
import { deduceGeometry } from "../../geometry/utils/scroll-aware.js";

/**
 * Create a measurement result from element and cursor position
 */
export function createMeasurement(
  selectedElement: Element,
  cursorX: number,
  cursorY: number,
  previousContext: CursorContext | null = null,
  previousElement: Element | null = null
): { element: Element; result: MeasurementResult } | null {
  const result = resolveAmbiguousContext(
    selectedElement,
    cursorX,
    cursorY,
    previousContext,
    previousElement
  );

  if (!result) {
    return null;
  }

  const { context, element: secondaryElement } = result;
  return createMeasurementBetween(selectedElement, secondaryElement, context);
}

/**
 * Create a measurement result between two specific elements with a defined context.
 * If no context is provided, it will be automatically detected (parent/child/sibling).
 */
export function createMeasurementBetween(
  primaryElement: Element,
  secondaryElement: Element,
  context?: CursorContext
): { element: Element; result: MeasurementResult } | null {
  if (secondaryElement === primaryElement) return null;

  const resolvedContext =
    context ??
    (primaryElement.contains(secondaryElement)
      ? "child"
      : secondaryElement.contains(primaryElement)
        ? "parent"
        : "sibling");

  const primaryGeom = deduceGeometry(primaryElement);
  const secondaryGeom = deduceGeometry(secondaryElement);

  const primary = primaryGeom.rect;
  const secondary = secondaryGeom.rect;

  const lines = createMeasurementLines(resolvedContext, primary, secondary);

  return {
    element: secondaryElement,
    result: {
      context: resolvedContext,
      lines,
      primary,
      secondary,
      timestamp: performance.now(),
      primaryHierarchy: primaryGeom.scrollHierarchy,
      secondaryHierarchy: secondaryGeom.scrollHierarchy,
      secondaryElement,
      primaryPosition: primaryGeom.position,
      secondaryPosition: secondaryGeom.position,
      primarySticky: primaryGeom.stickyConfig,
      secondarySticky: secondaryGeom.stickyConfig,
      primaryWinX: primaryGeom.initialWindowX,
      primaryWinY: primaryGeom.initialWindowY,
      secondaryWinX: secondaryGeom.initialWindowX,
      secondaryWinY: secondaryGeom.initialWindowY,
    },
  };
}
