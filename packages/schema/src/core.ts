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
    type: z.string(),
    value: z.number(),
    label: z.string(),
    start: z.object({ x: z.number(), y: z.number() }),
    end: z.object({ x: z.number(), y: z.number() }),
});

export const MeasurementResultSchema = z
    .object({
        context: z.enum(["parent", "child", "sibling"]),
        lines: z.array(MeasurementLineSchema),
        primary: RectSchema,
        secondary: RectSchema.nullable(),
        timestamp: z.number(),
        primaryHierarchy: z.array(ScrollStateSchema),
        secondaryHierarchy: z.array(ScrollStateSchema),
    })
    .loose();

export const SelectionMetadataSchema = z
    .object({
        element: z.unknown().optional(),
        rect: RectSchema.nullable(),
        position: z.string(),
        initialWindowX: z.number(),
        initialWindowY: z.number(),
    })
    .loose();

export type Rect = z.infer<typeof RectSchema>;
export type ScrollState = z.infer<typeof ScrollStateSchema>;
export type MeasurementLine = z.infer<typeof MeasurementLineSchema>;
export type MeasurementResult = z.infer<typeof MeasurementResultSchema>;
export type SelectionMetadata = z.infer<typeof SelectionMetadataSchema>;
