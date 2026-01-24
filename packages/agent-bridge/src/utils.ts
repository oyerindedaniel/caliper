import { type SelectionMetadata, type MeasurementResult } from "@oyerinde/caliper/core";
import { type SelectionMetadata as BridgeSelectionMetadata, type MeasurementResult as BridgeMeasurementResult, type Rect, type ScrollState } from "@oyerinde/caliper-schema";

export function sanitizeSelection(
    metadata: SelectionMetadata | null | undefined
): BridgeSelectionMetadata | null {
    if (!metadata) return null;
    const { element, scrollHierarchy, rect, stickyConfig, ...rest } = metadata;
    return {
        ...rest,
        rect: sanitizeDOMRect(rect),
        scrollHierarchy: scrollHierarchy.map(sanitizeScrollState),
        stickyConfig: stickyConfig ? {
            top: stickyConfig.top,
            bottom: stickyConfig.bottom,
            left: stickyConfig.left,
            right: stickyConfig.right,
            naturalTop: stickyConfig.naturalTop,
            naturalLeft: stickyConfig.naturalLeft,
            containerWidth: stickyConfig.containerWidth,
            containerHeight: stickyConfig.containerHeight,
            elementWidth: stickyConfig.elementWidth,
            elementHeight: stickyConfig.elementHeight,
        } : undefined,
    };
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
    const { secondaryElement, primary, secondary, primaryHierarchy, secondaryHierarchy, primarySticky, secondarySticky, context, ...rest } = result;
    
    return {
        ...rest,
        context,
        primary: sanitizeDOMRect(primary)!,
        secondary: sanitizeDOMRect(secondary),
        primaryHierarchy: primaryHierarchy.map(sanitizeScrollState),
        secondaryHierarchy: secondaryHierarchy.map(sanitizeScrollState),
        primarySticky: primarySticky ? {
            top: primarySticky.top,
            bottom: primarySticky.bottom,
            left: primarySticky.left,
            right: primarySticky.right,
            naturalTop: primarySticky.naturalTop,
            naturalLeft: primarySticky.naturalLeft,
            containerWidth: primarySticky.containerWidth,
            containerHeight: primarySticky.containerHeight,
            elementWidth: primarySticky.elementWidth,
            elementHeight: primarySticky.elementHeight,
        } : undefined,
        secondarySticky: secondarySticky ? {
            top: secondarySticky.top,
            bottom: secondarySticky.bottom,
            left: secondarySticky.left,
            right: secondarySticky.right,
            naturalTop: secondarySticky.naturalTop,
            naturalLeft: secondarySticky.naturalLeft,
            containerWidth: secondarySticky.containerWidth,
            containerHeight: secondarySticky.containerHeight,
            elementWidth: secondarySticky.elementWidth,
            elementHeight: secondarySticky.elementHeight,
        } : undefined,
    };
}
