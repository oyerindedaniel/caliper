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
    "CALIPER_WALK_DOM",
]);

export type CaliperMethod = z.infer<typeof CaliperMethodSchema>;

export const CaliperActionResultSchema = z.discriminatedUnion("intent", [
    z.object({ success: z.literal(true), intent: z.literal("CALIPER_SELECT"), selector: z.string(), selection: SelectionMetadataSchema, timestamp: z.number() }),
    z.object({ success: z.literal(true), intent: z.literal("CALIPER_MEASURE"), selector: z.string(), measurement: MeasurementResultSchema, timestamp: z.number() }),
    z.object({
        success: z.literal(true),
        intent: z.literal("CALIPER_INSPECT"),
        selector: z.string(),
        distances: z.object({
            top: z.number(),
            right: z.number(),
            bottom: z.number(),
            left: z.number(),
            horizontal: z.number(),
            vertical: z.number(),
        }),
        computedStyles: z.object({
            paddingLeft: z.number(),
            paddingRight: z.number(),
            paddingTop: z.number(),
            paddingBottom: z.number(),
            marginLeft: z.number(),
            marginRight: z.number(),
            marginTop: z.number(),
            marginBottom: z.number(),
        }),
        selection: SelectionMetadataSchema,
        timestamp: z.number()
    }),
    z.object({ success: z.literal(true), intent: z.literal("CALIPER_FREEZE"), timestamp: z.number() }),
    z.object({ success: z.literal(true), intent: z.literal("CALIPER_CLEAR"), timestamp: z.number() }),
    z.object({
        success: z.literal(true),
        intent: z.literal("CALIPER_WALK_DOM"),
        selector: z.string(),
        domContext: z.object({
            element: z.any(),
            parent: z.any().nullable(),
            children: z.array(z.any())
        }),
        timestamp: z.number()
    }),
    z.object({ success: z.literal(false), intent: CaliperMethodSchema, selector: z.string().optional(), error: z.string(), timestamp: z.number() }),
]);

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
