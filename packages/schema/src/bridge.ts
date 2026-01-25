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

export const CaliperElementSummarySchema = z.object({
    tagName: z.string(),
    id: z.string().optional(),
    classList: z.array(z.string()),
    agentId: z.string().optional(),
    text: z.string().optional(),
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
    "CALIPER_PARSE_SELECTION",
    "CALIPER_WALK_AND_MEASURE",
]);

export type CaliperMethod = z.infer<typeof CaliperMethodSchema>;

export const CaliperActionResultSchema = z.union([
    z.object({ success: z.literal(true), method: z.literal("CALIPER_SELECT"), selector: z.string(), selection: SelectionMetadataSchema, timestamp: z.number() }),
    z.object({ success: z.literal(true), method: z.literal("CALIPER_MEASURE"), selector: z.string(), measurement: MeasurementResultSchema, timestamp: z.number() }),
    z.object({
        success: z.literal(true),
        method: z.literal("CALIPER_INSPECT"),
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
    z.object({ success: z.literal(true), method: z.literal("CALIPER_FREEZE"), timestamp: z.number() }),
    z.object({ success: z.literal(true), method: z.literal("CALIPER_CLEAR"), timestamp: z.number() }),
    z.object({
        success: z.literal(true),
        method: z.literal("CALIPER_WALK_DOM"),
        selector: z.string(),
        domContext: z.object({
            element: CaliperElementSummarySchema,
            parent: CaliperElementSummarySchema.nullable(),
            children: z.array(CaliperElementSummarySchema)
        }),
        timestamp: z.number()
    }),
    z.object({
        success: z.literal(true),
        method: z.literal("CALIPER_PARSE_SELECTION"),
        selector: z.string(),
        parsed: z.object({
            selector: z.string(),
            tag: z.string(),
            id: z.string().optional(),
            text: z.string().optional(),
            classes: z.array(z.string()),
            timestamp: z.number(),
            isValid: z.literal(true),
        }),
        timestamp: z.number()
    }),
    z.object({
        success: z.literal(true),
        method: z.literal("CALIPER_WALK_AND_MEASURE"),
        selector: z.string(),
        walkResult: z.object({
            root: z.any(),
            nodeCount: z.number(),
            maxDepthReached: z.number(),
            walkDurationMs: z.number(),
        }),
        timestamp: z.number()
    }),
    z.object({ success: z.literal(false), method: CaliperMethodSchema, selector: z.string().optional(), error: z.string(), timestamp: z.number() }),
]);

export const CaliperAgentStateSchema = z.object({
    viewport: ViewportSchema,
    pageGeometry: z.record(z.string(), ElementGeometrySchema),
    activeSelection: SelectionMetadataSchema.nullable(),
    lastMeasurement: MeasurementResultSchema.nullable(),
    lastActionResult: CaliperActionResultSchema.nullable(),
    lastUpdated: z.number(),
});

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

export const CaliperSelectPayloadSchema = z.object({
    selector: z.string(),
});

export const CaliperMeasurePayloadSchema = z.object({
    primarySelector: z.string(),
    secondarySelector: z.string(),
});

export const CaliperInspectPayloadSchema = z.object({
    selector: z.string(),
});

export const CaliperWalkDomPayloadSchema = z.object({
    selector: z.string(),
    depth: z.number().optional(),
});

export const CaliperParseSelectionPayloadSchema = z.object({
    selectionJson: z.string(),
});

export const CaliperWalkAndMeasurePayloadSchema = z.object({
    selector: z.string(),
    maxDepth: z.number().optional(),
});


export type ViewportState = z.infer<typeof ViewportSchema>;
export type ElementGeometry = z.infer<typeof ElementGeometrySchema>;
export type CaliperActionResult = z.infer<typeof CaliperActionResultSchema>;
export type CaliperAgentState = z.infer<typeof CaliperAgentStateSchema>;
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;
export type CaliperSelectPayload = z.infer<typeof CaliperSelectPayloadSchema>;
export type CaliperMeasurePayload = z.infer<typeof CaliperMeasurePayloadSchema>;
export type CaliperInspectPayload = z.infer<typeof CaliperInspectPayloadSchema>;
export type CaliperWalkDomPayload = z.infer<typeof CaliperWalkDomPayloadSchema>;
export type CaliperParseSelectionPayload = z.infer<typeof CaliperParseSelectionPayloadSchema>;
export type CaliperWalkAndMeasurePayload = z.infer<typeof CaliperWalkAndMeasurePayloadSchema>;

export type CaliperIntentType = Exclude<CaliperMethod, "CALIPER_GET_STATE" | "CALIPER_AUDIT_NODE">;

export type CaliperIntent =
    | { method: "CALIPER_SELECT"; params: CaliperSelectPayload }
    | { method: "CALIPER_MEASURE"; params: CaliperMeasurePayload }
    | { method: "CALIPER_INSPECT"; params: CaliperInspectPayload }
    | { method: "CALIPER_FREEZE"; params: {} }
    | { method: "CALIPER_CLEAR"; params: {} }
    | { method: "CALIPER_WALK_DOM"; params: CaliperWalkDomPayload }
    | { method: "CALIPER_PARSE_SELECTION"; params: CaliperParseSelectionPayload }
    | { method: "CALIPER_WALK_AND_MEASURE"; params: CaliperWalkAndMeasurePayload };

export type ToolCallMessage =
    | { id: string; method: "CALIPER_GET_STATE"; params: {} }
    | { id: string; method: "CALIPER_SELECT"; params: CaliperSelectPayload }
    | { id: string; method: "CALIPER_MEASURE"; params: CaliperMeasurePayload }
    | { id: string; method: "CALIPER_INSPECT"; params: CaliperInspectPayload }
    | { id: string; method: "CALIPER_FREEZE"; params: {} }
    | { id: string; method: "CALIPER_CLEAR"; params: {} }
    | { id: string; method: "CALIPER_WALK_DOM"; params: CaliperWalkDomPayload }
    | { id: string; method: "CALIPER_PARSE_SELECTION"; params: CaliperParseSelectionPayload }
    | { id: string; method: "CALIPER_WALK_AND_MEASURE"; params: CaliperWalkAndMeasurePayload };

export type RegisterTabMessage = z.infer<typeof RegisterTabSchema>;
export type TabUpdateMessage = z.infer<typeof TabUpdateSchema>;
export type ToolResponseMessage = z.infer<typeof ToolResponseSchema>;

export type BridgeMessageUnion =
    | RegisterTabMessage
    | TabUpdateMessage
    | ToolResponseMessage
    | ToolCallMessage;
