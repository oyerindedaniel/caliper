import type { CursorContext } from "../../shared/types/index.js";
import { resolveAmbiguousContext } from "../../cursor-context/utils/priority-rules.js";
import {
  createMeasurementLines,
  type MeasurementResult,
} from "./measurement-result.js";
import {
  findCommonPortalHost,
  findBestPortalHost,
} from "../../geometry/utils/scroll-aware.js";
import { diagnosticLogger, formatElement, formatRect } from "../../shared/utils/logger.js";


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

  if (secondaryElement === selectedElement) return null;

  const primaryRect = selectedElement.getBoundingClientRect();
  const secondaryRect = secondaryElement.getBoundingClientRect();

  const primary = new DOMRect(
    primaryRect.left + window.scrollX,
    primaryRect.top + window.scrollY,
    primaryRect.width,
    primaryRect.height
  );
  const secondary = new DOMRect(
    secondaryRect.left + window.scrollX,
    secondaryRect.top + window.scrollY,
    secondaryRect.width,
    secondaryRect.height
  );

  const lines = createMeasurementLines(
    context,
    primary,
    secondary
  );

  const container = findCommonPortalHost(selectedElement, secondaryElement);
  const containerRect = container.getBoundingClientRect();

  const primaryRelative = new DOMRect(
    primaryRect.left - containerRect.left + container.scrollLeft,
    primaryRect.top - containerRect.top + container.scrollTop,
    primaryRect.width,
    primaryRect.height
  );

  const secondaryRelative = new DOMRect(
    secondaryRect.left - containerRect.left + container.scrollLeft,
    secondaryRect.top - containerRect.top + container.scrollTop,
    secondaryRect.width,
    secondaryRect.height
  );

  const secondaryContainer = findBestPortalHost(secondaryElement);
  const secondaryContainerRect = secondaryContainer.getBoundingClientRect();
  const secondaryLocalRelative = new DOMRect(
    secondaryRect.left - secondaryContainerRect.left + secondaryContainer.scrollLeft,
    secondaryRect.top - secondaryContainerRect.top + secondaryContainer.scrollTop,
    secondaryRect.width,
    secondaryRect.height
  );

  diagnosticLogger.log(`[Measurement] Primary: ${formatElement(selectedElement)}, Secondary: ${formatElement(secondaryElement)}`);
  diagnosticLogger.log(`[Measurement] Container: ${formatElement(container)}`);

  return {
    element: secondaryElement,
    result: {
      context,
      lines,
      primary,
      secondary,
      timestamp: performance.now(),
      primaryRelative,
      secondaryRelative,
      secondaryElement,
      container,
      secondaryContainer,
      secondaryLocalRelative,
    },
  };
}
