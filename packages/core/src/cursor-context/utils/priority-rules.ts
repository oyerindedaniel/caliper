import type { CursorContext } from "../../shared/types/index.js";
import { isEligible } from "../../element-picking/utils/filter-visible.js";

/**
 * ============================================================================
 * HIT-TESTING CONTRACT
 * ============================================================================
 * Hit testing is paint-order based (via document.elementFromPoint).
 *
 * To ensure correct behavior:
 * - Overlay and editor UI layers MUST be non-interactive
 *   (pointer-events: none) OR filtered via isEligible
 * - Use data-caliper-ignore attribute to exclude elements
 * ============================================================================
 */

/**
 * Hysteresis configuration
 */
const HYSTERESIS_THRESHOLD = 2; // pixels

/**
 * Check if an element belongs to Caliper's portaled UI
 */
function isCaliperNode(node: Node | null): boolean {
  if (!node || !(node instanceof Element)) return false;
  return !!(node.closest("#caliper-overlay-root") || node.closest("[class*='caliper-']"));
}

/**
 * Find the first eligible element at a point, skipping Caliper's own UI
 */
export function getElementAtPoint(x: number, y: number): Element | null {
  const nodes = document.elementsFromPoint(x, y);

  return (
    nodes.find((node) => {
      if (isCaliperNode(node)) return false;
      return isEligible(node);
    }) || null
  );
}

/**
 * Find the topmost eligible element at a point (standard selection)
 */
export function getTopElementAtPoint(x: number, y: number): Element | null {
  const node = document.elementFromPoint(x, y);
  if (!node) return null;

  if (isCaliperNode(node) || !isEligible(node)) return null;

  return node;
}

/**
 * Detect the best matching context and element using priority rules
 */
function detectBestContext(
  selectedElement: Element,
  cursorX: number,
  cursorY: number
): { context: CursorContext; element: Element } | null {
  let node = getElementAtPoint(cursorX, cursorY);
  if (!node) return null;

  while (node) {
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
 * Calculate distance from point to nearest edge of rectangle
 */
function getDistanceToEdge(x: number, y: number, rect: DOMRect): number {
  const dx = Math.min(Math.abs(x - rect.left), Math.abs(x - rect.right));
  const dy = Math.min(Math.abs(y - rect.top), Math.abs(y - rect.bottom));
  return Math.min(dx, dy);
}

/**
 * Apply priority rules when cursor position is ambiguous
 */
export function resolveAmbiguousContext(
  selectedElement: Element,
  cursorX: number,
  cursorY: number,
  previousContext: CursorContext | null,
  previousElement: Element | null = null
): { context: CursorContext; element: Element } | null {
  const result = detectBestContext(selectedElement, cursorX, cursorY);
  if (!result) return null;

  const { context: winnerContext, element: winnerElement } = result;

  if (
    previousContext &&
    previousElement &&
    (winnerContext !== previousContext || winnerElement !== previousElement)
  ) {
    const rect = previousElement.getBoundingClientRect();
    const distance = getDistanceToEdge(cursorX, cursorY, rect);

    if (distance <= HYSTERESIS_THRESHOLD) {
      // Sibling/Child context is more specific than Parent.
      // If we are moving FROM a parent TO a sibling/child, we should switch
      // immediately regardless of hysteresis to feel responsive and avoid "sticky" parents.
      const isSwitchingToSpecific =
        (winnerContext === "sibling" || winnerContext === "child") && previousContext === "parent";

      if (!isSwitchingToSpecific) {
        return { context: previousContext, element: previousElement };
      }
    }
  }

  return result;
}

/**
 * Detect the cursor context relative to the selected element
 */
export function detectContext(
  selectedElement: Element,
  cursorX: number,
  cursorY: number
): CursorContext {
  const result = resolveAmbiguousContext(selectedElement, cursorX, cursorY, null, null);
  return result?.context ?? null;
}
