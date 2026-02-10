import type { CursorContext } from "../../shared/types/index.js";
import { resolveAmbiguousContext } from "../../cursor-context/utils/priority-rules.js";
import { createMeasurementLines, type MeasurementResult } from "./measurement-result.js";
import { deduceGeometry } from "../../geometry/utils/scroll-aware.js";

/**
 * Computes a measurement result for a selected element relative to another 
 * element at specific cursor coordinates. It automatically resolves the 
 * context (sibling, parent, etc.).
 * 
 * @param selectedElement - The primary element being measured from.
 * @param cursorX - Current X coordinate.
 * @param cursorY - Current Y coordinate.
 * @param previousContext - Optional context from previous frame to stabilize results.
 * @param previousElement - Optional element from previous frame to stabilize results.
 * @returns An object containing the secondary element and the measurement result, or null if invalid.
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
 * Creates a measurement result between two specific elements with a defined context.
 * 
 * If no context is provided, it will be automatically detected based on the 
 * containment relationship (parent/child/sibling).
 * 
 * @param primaryElement - The primary element.
 * @param secondaryElement - The target element.
 * @param context - Optional explicit context override.
 * @returns The measurement result object.
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
      timestamp: Date.now(),
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
