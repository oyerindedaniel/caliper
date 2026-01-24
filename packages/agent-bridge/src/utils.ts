import { type SelectionMetadata, type MeasurementResult } from "@oyerinde/caliper/core";
import { type SelectionMetadata as BridgeSelectionMetadata, type MeasurementResult as BridgeMeasurementResult, type Rect, type ScrollState } from "@oyerinde/caliper-schema";

export function sanitizeSelection(
    metadata: SelectionMetadata | null | undefined
): BridgeSelectionMetadata | null {
    if (!metadata) return null;
    const { element, ...rest } = metadata;
    return rest;
}

function sanitizeDOMRect(rect: DOMRect | null): { left: number; top: number; right: number; bottom: number; width: number; height: number; x: number; y: number } | null {
    if (!rect) return null;
    return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        x: rect.x,
        y: rect.y,
    };
}

function sanitizeScrollState(state: { element: HTMLElement; initialScrollTop: number; initialScrollLeft: number; containerRect: DOMRect }): ScrollState {
    return {
        initialScrollTop: state.initialScrollTop,
        initialScrollLeft: state.initialScrollLeft,
        containerRect: sanitizeDOMRect(state.containerRect),
    };
}

export function sanitizeMeasurement(
    result: MeasurementResult | null | undefined
): BridgeMeasurementResult | null {
    if (!result) return null;
    const { secondaryElement, primary, secondary, primaryHierarchy, secondaryHierarchy, ...rest } = result;
    
    return {
        ...rest,
        primary: sanitizeDOMRect(primary)!,
        secondary: sanitizeDOMRect(secondary),
        primaryHierarchy: primaryHierarchy.map(sanitizeScrollState),
        secondaryHierarchy: secondaryHierarchy.map(sanitizeScrollState),
    };
}
