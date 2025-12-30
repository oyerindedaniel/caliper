import type { CursorContext } from "../../shared/types/index.js";
import { isEligible } from "../../element-picking/utils/filter-visible.js";

/**
 * Hysteresis threshold for context switching
 * Prevents jitter when cursor is near boundaries
 */
const HYSTERESIS_THRESHOLD = 2; // pixels

/**
 * Find the element matching a specific context type
 * Returns element reference - caller must extract primitive data immediately
 */
function findElementByContext(
  selectedElement: Element,
  context: CursorContext,
  cursorX: number,
  cursorY: number
): Element | null {
  let node = document.elementFromPoint(cursorX, cursorY);
  if (!node) return null;

  while (node) {
    if (!isEligible(node)) {
      node = node.parentElement;
      continue;
    }

    if (context === "child") {
      if (node !== selectedElement && selectedElement.contains(node)) {
        return node;
      }
    } else if (context === "sibling") {
      if (
        node !== selectedElement &&
        !node.contains(selectedElement) &&
        !selectedElement.contains(node)
      ) {
        return node;
      }
    } else if (context === "parent") {
      if (node !== selectedElement && node.contains(selectedElement)) {
        return node;
      }
    }

    node = node.parentElement;
  }

  return null;
}

/**
 * Detect the best matching context and element using priority rules
 * Priority: child > sibling > parent
 * Returns element reference - caller must extract primitive data immediately
 */
function detectBestContext(
  selectedElement: Element,
  cursorX: number,
  cursorY: number
): { context: CursorContext; element: Element } | null {
  let node = document.elementFromPoint(cursorX, cursorY);
  if (!node) return null;

  const parent = selectedElement.parentElement;

  while (node) {
    if (!isEligible(node)) {
      node = node.parentElement;
      continue;
    }

    if (node !== selectedElement) {
      // 1. Child context: Target is inside selection
      if (selectedElement.contains(node)) {
        return { context: "child", element: node };
      }

      // 2. Parent context: Selection is inside target (ancestor)
      if (node.contains(selectedElement)) {
        return { context: "parent", element: node };
      }

      // 3. Sibling context: Target is an external element
      return { context: "sibling", element: node };
    }

    node = node.parentElement;
  }

  return null;
}

/**
 * Apply priority rules when cursor position is ambiguous
 * "Closest enclosing meaningful box wins"
 * Returns both context and the secondary element
 *
 * NOTE: Element reference is ephemeral - caller must extract primitive data
 * (DOMRect) immediately and not store the element reference
 */
export function resolveAmbiguousContext(
  selectedElement: Element,
  cursorX: number,
  cursorY: number,
  previousContext: CursorContext | null
): { context: CursorContext; element: Element } | null {
  const result = detectBestContext(selectedElement, cursorX, cursorY);
  if (!result) return null;

  const { context: winnerContext, element: winnerElement } = result;

  // Apply hysteresis if context changed
  if (previousContext && previousContext !== winnerContext) {
    const rect = winnerElement.getBoundingClientRect();
    const distance = getDistanceToEdge(cursorX, cursorY, rect);

    if (distance <= HYSTERESIS_THRESHOLD) {
      const previousElement = findElementByContext(
        selectedElement,
        previousContext,
        cursorX,
        cursorY
      );
      if (previousElement) {
        return { context: previousContext, element: previousElement };
      }
    }
  }

  return result;
}

/**
 * Detect the cursor context relative to the selected element
 * Returns: "parent" | "sibling" | "child" | null
 */
export function detectContext(
  selectedElement: Element,
  cursorX: number,
  cursorY: number
): CursorContext {
  const result = resolveAmbiguousContext(
    selectedElement,
    cursorX,
    cursorY,
    null
  );
  return result?.context ?? null;
}

/**
 * Calculate distance from point to nearest edge of rectangle
 */
function getDistanceToEdge(x: number, y: number, rect: DOMRect): number {
  const dx = Math.min(Math.abs(x - rect.left), Math.abs(x - rect.right));
  const dy = Math.min(Math.abs(y - rect.top), Math.abs(y - rect.bottom));
  return Math.min(dx, dy);
}
