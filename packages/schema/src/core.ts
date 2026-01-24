import { z } from "zod";

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

export const MeasurementResultSchema = z
    .object({
        context: z.enum(["parent", "child", "sibling"]).nullable(),
        lines: z.array(MeasurementLineSchema),
        primary: RectSchema,
        secondary: RectSchema.nullable(),
        timestamp: z.number(),
        primaryHierarchy: z.array(ScrollStateSchema),
        secondaryHierarchy: z.array(ScrollStateSchema),
        primaryPosition: z.enum(["static", "relative", "absolute", "fixed", "sticky"]),
        secondaryPosition: z.enum(["static", "relative", "absolute", "fixed", "sticky"]),
        primaryWinX: z.number(),
        primaryWinY: z.number(),
        secondaryWinX: z.number(),
        secondaryWinY: z.number(),
        primarySticky: StickyConfigSchema.optional(),
        secondarySticky: StickyConfigSchema.optional(),
    })
    .loose();

export const SelectionMetadataSchema = z
    .object({
        rect: RectSchema.nullable(),
        scrollHierarchy: z.array(ScrollStateSchema),
        position: z.enum(["static", "relative", "absolute", "fixed", "sticky"]),
        stickyConfig: StickyConfigSchema.optional(),
        initialWindowX: z.number(),
        initialWindowY: z.number(),
    })
    .loose();

export type Rect = z.infer<typeof RectSchema>;
export type ScrollState = z.infer<typeof ScrollStateSchema>;
export type MeasurementLine = z.infer<typeof MeasurementLineSchema>;
export type MeasurementResult = z.infer<typeof MeasurementResultSchema>;
export type SelectionMetadata = z.infer<typeof SelectionMetadataSchema>;
