import type { PositionMode, ScrollState } from "@/shared/types/index.js";

export interface SameMeasurementContextInput {
  primaryPosition: PositionMode;
  secondaryPosition: PositionMode;
  primaryHierarchy: ScrollState[];
  secondaryHierarchy: ScrollState[];
  selectedElement: Element | null;
  secondaryElement: Element | null;
}

/**
 * True when primary and secondary elements share the same scroll stacking context,
 * or are direct parent/child in the scroll hierarchy (measurement lines need no cross-context clamping).
 */
export function isSameMeasurementContext(input: SameMeasurementContextInput): boolean {
  const hasSameStack =
    input.primaryPosition === input.secondaryPosition &&
    input.primaryHierarchy.length === input.secondaryHierarchy.length &&
    input.primaryHierarchy.every(
      (scrollState, index) => scrollState.element === input.secondaryHierarchy[index]?.element
    );

  const isDirectParentChild =
    (input.primaryHierarchy.length > 0 &&
      input.primaryHierarchy[0]?.element === input.secondaryElement) ||
    (input.secondaryHierarchy.length > 0 &&
      input.secondaryHierarchy[0]?.element === input.selectedElement);

  return hasSameStack || isDirectParentChild;
}
