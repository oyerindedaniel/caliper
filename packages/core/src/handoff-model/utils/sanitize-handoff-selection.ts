import type { SelectionMetadata as WireSelectionMetadata } from "@oyerinde/caliper-schema";
import type { SelectionMetadata } from "@/measurement-model/utils/selection-system.js";

function sanitizeDOMRect(rect: DOMRect | null): WireSelectionMetadata["rect"] {
  if (!rect) return null;
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    x: rect.x,
    y: rect.y,
  };
}

export function sanitizeHandoffSelection(metadata: SelectionMetadata): WireSelectionMetadata {
  return {
    rect: sanitizeDOMRect(metadata.rect),
    scrollHierarchy: metadata.scrollHierarchy.map((scrollStateItem) => {
      const { element: _removedElement, ...serializableScrollState } =
        scrollStateItem as typeof scrollStateItem & { element?: unknown };
      return serializableScrollState;
    }),
    position: metadata.position,
    initialWindowX: metadata.initialWindowX,
    initialWindowY: metadata.initialWindowY,
    depth: metadata.depth,
    stickyConfig: metadata.stickyConfig,
    hasContainingBlock: metadata.hasContainingBlock,
  };
}
