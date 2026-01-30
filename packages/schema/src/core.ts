import { z } from "zod";

export const PositionModeSchema = z.enum(["static", "relative", "absolute", "fixed", "sticky"]);

export const CursorContextSchema = z.enum(["parent", "child", "sibling"]);

export const RectSchema = z.object({
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
    width: z.number(),
    height: z.number(),
    x: z.number(),
    y: z.number(),
});

export const ScrollStateSchema = z.object({
    initialScrollTop: z.number(),
    initialScrollLeft: z.number(),
    containerRect: RectSchema.nullable(),
});

export const MeasurementLineSchema = z.object({
    type: z.enum(["left", "top", "right", "bottom", "distance"]),
    value: z.number(),
    start: z.object({ x: z.number(), y: z.number() }),
    end: z.object({ x: z.number(), y: z.number() }),
    startSync: z.enum(["primary", "secondary"]).optional(),
    endSync: z.enum(["primary", "secondary"]).optional(),
});

export const StickyConfigSchema = z.object({
    top: z.number().nullable(),
    bottom: z.number().nullable(),
    left: z.number().nullable(),
    right: z.number().nullable(),
    naturalTop: z.number(),
    naturalLeft: z.number(),
    containerWidth: z.number(),
    containerHeight: z.number(),
    elementWidth: z.number(),
    elementHeight: z.number(),
});

export const MeasurementResultSchema = z.object({
    context: CursorContextSchema.nullable(),
    lines: z.array(MeasurementLineSchema),
    primary: RectSchema,
    secondary: RectSchema.nullable(),
    timestamp: z.number(),
    primaryHierarchy: z.array(ScrollStateSchema),
    secondaryHierarchy: z.array(ScrollStateSchema),
    primaryPosition: PositionModeSchema,
    secondaryPosition: PositionModeSchema,
    primaryWinX: z.number(),
    primaryWinY: z.number(),
    secondaryWinX: z.number(),
    secondaryWinY: z.number(),
    primarySticky: StickyConfigSchema.optional(),
    secondarySticky: StickyConfigSchema.optional(),
    primaryHasContainingBlock: z.boolean().optional(),
    secondaryHasContainingBlock: z.boolean().optional(),
});

export const SelectionMetadataSchema = z.object({
    rect: RectSchema.nullable(),
    scrollHierarchy: z.array(ScrollStateSchema),
    position: PositionModeSchema,
    stickyConfig: StickyConfigSchema.optional(),
    initialWindowX: z.number(),
    initialWindowY: z.number(),
    hasContainingBlock: z.boolean().optional(),
});

// ============================================================================
// CONTEXT METRICS (Browser environment details for relative unit resolution)
// ============================================================================

export const ContextMetricsSchema = z.object({
    rootFontSize: z.number(),
    devicePixelRatio: z.number(),
    viewportWidth: z.number(),
    viewportHeight: z.number(),
    visualViewportWidth: z.number().optional(),
    visualViewportHeight: z.number().optional(),
});

export type ContextMetrics = z.infer<typeof ContextMetricsSchema>;

export const DEFAULT_CONTEXT_METRICS: ContextMetrics = {
    rootFontSize: 16,
    devicePixelRatio: 1,
    viewportWidth: 1920,
    viewportHeight: 1080,
    visualViewportWidth: 1920,
    visualViewportHeight: 1080,
};

export type Rect = z.infer<typeof RectSchema>;
export type PositionMode = z.infer<typeof PositionModeSchema>;
export type CursorContext = z.infer<typeof CursorContextSchema>;
export type ScrollState = z.infer<typeof ScrollStateSchema>;
export type StickyConfig = z.infer<typeof StickyConfigSchema>;
export type MeasurementLine = z.infer<typeof MeasurementLineSchema>;
export type MeasurementResult = z.infer<typeof MeasurementResultSchema>;
export type SelectionMetadata = z.infer<typeof SelectionMetadataSchema>;

