import type {
    SelectionMetadata,
    MeasurementResult,
    ScrollState as CoreScrollState,
    MeasurementLine as CoreMeasurementLine
} from "@oyerinde/caliper/core";
import type {
    SelectionMetadata as BridgeSelectionMetadata,
    MeasurementResult as BridgeMeasurementResult,
    ScrollState as BridgeScrollState,
    CaliperComputedStyles,
    Rect,
    MeasurementLine as BridgeMeasurementLine
} from "@oyerinde/caliper-schema";

export function sanitizeSelection(
    metadata: SelectionMetadata | null | undefined
): BridgeSelectionMetadata | null {
    if (!metadata) return null;

    return {
        rect: sanitizeDOMRect(metadata.rect),
        scrollHierarchy: metadata.scrollHierarchy.map(sanitizeScrollState),
        position: metadata.position,
        initialWindowX: metadata.initialWindowX,
        initialWindowY: metadata.initialWindowY,
        stickyConfig: metadata.stickyConfig ? {
            top: metadata.stickyConfig.top,
            bottom: metadata.stickyConfig.bottom,
            left: metadata.stickyConfig.left,
            right: metadata.stickyConfig.right,
            naturalTop: metadata.stickyConfig.naturalTop,
            naturalLeft: metadata.stickyConfig.naturalLeft,
            containerWidth: metadata.stickyConfig.containerWidth,
            containerHeight: metadata.stickyConfig.containerHeight,
            elementWidth: metadata.stickyConfig.elementWidth,
            elementHeight: metadata.stickyConfig.elementHeight,
        } : undefined,
    };
}

function sanitizeDOMRect(rect: { left: number; top: number; right: number; bottom: number; width: number; height: number; x: number; y: number } | null): Rect | null {
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

function sanitizeScrollState(state: CoreScrollState): BridgeScrollState {
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

    return {
        context: result.context,
        lines: result.lines.map(sanitizeLine),
        primary: sanitizeDOMRect(result.primary)!,
        secondary: sanitizeDOMRect(result.secondary),
        timestamp: result.timestamp,
        primaryHierarchy: result.primaryHierarchy.map(sanitizeScrollState),
        secondaryHierarchy: result.secondaryHierarchy.map(sanitizeScrollState),
        primaryPosition: result.primaryPosition,
        secondaryPosition: result.secondaryPosition,
        primaryWinX: result.primaryWinX,
        primaryWinY: result.primaryWinY,
        secondaryWinX: result.secondaryWinX,
        secondaryWinY: result.secondaryWinY,
        primarySticky: result.primarySticky ? {
            top: result.primarySticky.top,
            bottom: result.primarySticky.bottom,
            left: result.primarySticky.left,
            right: result.primarySticky.right,
            naturalTop: result.primarySticky.naturalTop,
            naturalLeft: result.primarySticky.naturalLeft,
            containerWidth: result.primarySticky.containerWidth,
            containerHeight: result.primarySticky.containerHeight,
            elementWidth: result.primarySticky.elementWidth,
            elementHeight: result.primarySticky.elementHeight,
        } : undefined,
        secondarySticky: result.secondarySticky ? {
            top: result.secondarySticky.top,
            bottom: result.secondarySticky.bottom,
            left: result.secondarySticky.left,
            right: result.secondarySticky.right,
            naturalTop: result.secondarySticky.naturalTop,
            naturalLeft: result.secondarySticky.naturalLeft,
            containerWidth: result.secondarySticky.containerWidth,
            containerHeight: result.secondarySticky.containerHeight,
            elementWidth: result.secondarySticky.elementWidth,
            elementHeight: result.secondarySticky.elementHeight,
        } : undefined,
    };
}

function sanitizeLine(line: CoreMeasurementLine): BridgeMeasurementLine {
    return {
        type: line.type,
        value: line.value,
        start: { x: line.start.x, y: line.start.y },
        end: { x: line.end.x, y: line.end.y },
        startSync: line.startSync,
        endSync: line.endSync
    };
}

export function parseComputedStyles(styles: CSSStyleDeclaration): CaliperComputedStyles {
    const parseNumber = (value: string): number => parseFloat(value) || 0;

    return {
        display: styles.display,
        position: styles.position,
        boxSizing: styles.boxSizing,

        padding: {
            top: parseNumber(styles.paddingTop),
            right: parseNumber(styles.paddingRight),
            bottom: parseNumber(styles.paddingBottom),
            left: parseNumber(styles.paddingLeft),
        },
        margin: {
            top: parseNumber(styles.marginTop),
            right: parseNumber(styles.marginRight),
            bottom: parseNumber(styles.marginBottom),
            left: parseNumber(styles.marginLeft),
        },
        border: {
            top: parseNumber(styles.borderTopWidth),
            right: parseNumber(styles.borderRightWidth),
            bottom: parseNumber(styles.borderBottomWidth),
            left: parseNumber(styles.borderLeftWidth),
        },

        gap: styles.gap ? parseNumber(styles.gap) : null,
        flexDirection: styles.flexDirection || undefined,
        justifyContent: styles.justifyContent || undefined,
        alignItems: styles.alignItems || undefined,

        fontSize: parseNumber(styles.fontSize),
        fontWeight: styles.fontWeight,
        fontFamily: styles.fontFamily,
        lineHeight: styles.lineHeight === "normal" ? "normal" : parseNumber(styles.lineHeight),
        letterSpacing: styles.letterSpacing === "normal" ? "normal" : parseNumber(styles.letterSpacing),
        color: styles.color,

        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
        borderRadius: styles.borderRadius,
        boxShadow: styles.boxShadow || undefined,
        opacity: parseNumber(styles.opacity),
        outline: styles.outline || undefined,
        outlineColor: styles.outlineColor,
        zIndex: styles.zIndex === "auto" ? null : parseInt(styles.zIndex, 10),

        overflow: styles.overflow,
        overflowX: styles.overflowX,
        overflowY: styles.overflowY,
    };
}

export function getContextMetrics() {
    return {
        rootFontSize: parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16,
        devicePixelRatio: window.devicePixelRatio || 1,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
    };
}