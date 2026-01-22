import { z } from "zod";
import { MeasurementResultSchema, SelectionMetadataSchema } from "./core.js";

export const ViewportSchema = z.object({
    width: z.number(),
    height: z.number(),
    scrollX: z.number(),
    scrollY: z.number(),
});

export const ElementGeometrySchema = z.object({
    top: z.number(),
    left: z.number(),
    width: z.number(),
    height: z.number(),
    absoluteX: z.number(),
    absoluteY: z.number(),
    zIndex: z.number().optional(),
    agentId: z.string().optional(),
});

export const CaliperMethodSchema = z.enum([
    "CALIPER_SELECT",
    "CALIPER_MEASURE",
    "CALIPER_INSPECT",
    "CALIPER_FREEZE",
    "CALIPER_CLEAR",
    "CALIPER_GET_STATE",
    "CALIPER_AUDIT_NODE",
]);

export type CaliperMethod = z.infer<typeof CaliperMethodSchema>;

export const CaliperActionResultSchema = z.object({
    success: z.boolean(),
    intent: CaliperMethodSchema,
    selector: z.string().optional(),
    measurement: MeasurementResultSchema.optional(),
    selection: SelectionMetadataSchema.optional(),
    distances: z
        .object({
            top: z.number(),
            right: z.number(),
            bottom: z.number(),
            left: z.number(),
            horizontal: z.number(),
            vertical: z.number(),
        })
        .optional(),
    error: z.string().optional(),
    timestamp: z.number(),
});

export const CaliperAgentStateSchema = z.object({
    viewport: ViewportSchema,
    pageGeometry: z.record(z.string(), ElementGeometrySchema),
    activeSelection: SelectionMetadataSchema.nullable(),
    lastMeasurement: MeasurementResultSchema.nullable(),
    lastActionResult: CaliperActionResultSchema.nullable(),
    lastUpdated: z.number(),
});

export type CaliperAgentState = z.infer<typeof CaliperAgentStateSchema>;

export const RegisterTabSchema = z.object({
    type: z.literal("REGISTER_TAB"),
    payload: z.object({
        tabId: z.string(),
        url: z.string(),
        title: z.string(),
        isFocused: z.boolean(),
    }),
});

export const TabUpdateSchema = z.object({
    type: z.literal("TAB_UPDATE"),
    payload: z.object({
        isFocused: z.boolean(),
    }),
});

export const ToolResponseSchema = z.object({
    type: z.literal("TOOL_RESPONSE"),
    id: z.string(),
    result: z.union([CaliperActionResultSchema, CaliperAgentStateSchema]).optional(),
    error: z.string().optional(),
});

export const BridgeMessageSchema = z.discriminatedUnion("type", [
    RegisterTabSchema,
    TabUpdateSchema,
    ToolResponseSchema,
]);

export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;
export type CaliperActionResult = z.infer<typeof CaliperActionResultSchema>;
