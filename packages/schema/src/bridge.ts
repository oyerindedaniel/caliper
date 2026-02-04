import { z } from "zod";
import { ContextMetricsSchema, MeasurementResultSchema, SelectionMetadataSchema } from "./core.js";
import { CaliperComputedStylesSchema, CaliperNodeSchema } from "./audit.js";
import {
    JSONRPCRequestSchema,
    JSONRPCNotificationSchema,
    JSONRPCResultResponseSchema,
    JSONRPCErrorResponseSchema,
    type JSONRPCRequest,
    type JSONRPCResponse,
    type JSONRPCNotification,
    isJSONRPCRequest,
    isJSONRPCNotification,
    isJSONRPCResultResponse,
    isJSONRPCErrorResponse,
} from "@modelcontextprotocol/sdk/types.js";

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

export const CALIPER_METHODS = {
    SELECT: "CALIPER_SELECT",
    MEASURE: "CALIPER_MEASURE",
    INSPECT: "CALIPER_INSPECT",
    FREEZE: "CALIPER_FREEZE",
    CLEAR: "CALIPER_CLEAR",
    WALK_DOM: "CALIPER_WALK_DOM",
    WALK_AND_MEASURE: "CALIPER_WALK_AND_MEASURE",
    GET_CONTEXT: "CALIPER_GET_CONTEXT",
    REGISTER_TAB: "caliper/registerTab",
    TAB_UPDATE: "caliper/tabUpdate",
} as const;

export const CaliperMethodSchema = z.enum([
    CALIPER_METHODS.SELECT,
    CALIPER_METHODS.MEASURE,
    CALIPER_METHODS.INSPECT,
    CALIPER_METHODS.FREEZE,
    CALIPER_METHODS.CLEAR,
    CALIPER_METHODS.WALK_DOM,
    CALIPER_METHODS.WALK_AND_MEASURE,
    CALIPER_METHODS.GET_CONTEXT,
]);


export const SourceHintsSchema = z.object({
    stableAnchors: z.array(z.string()),
    suggestedGrep: z.string().optional(),
    textContent: z.string().optional(),
    accessibleName: z.string().optional(),
    unstableClasses: z.array(z.string()),
    tagName: z.string(),
});

export type CaliperMethod = z.infer<typeof CaliperMethodSchema>;

export const CaliperActionResultSchema = z.union([
    z.object({ success: z.literal(true), method: z.literal(CALIPER_METHODS.SELECT), selector: z.string(), selection: SelectionMetadataSchema, timestamp: z.number() }),
    z.object({ success: z.literal(true), method: z.literal(CALIPER_METHODS.MEASURE), selector: z.string(), measurement: MeasurementResultSchema, timestamp: z.number() }),
    z.object({
        success: z.literal(true),
        method: z.literal(CALIPER_METHODS.INSPECT),
        selector: z.string(),
        distances: z.object({
            top: z.number(),
            right: z.number(),
            bottom: z.number(),
            left: z.number(),
            horizontal: z.number(),
            vertical: z.number(),
        }),
        computedStyles: CaliperComputedStylesSchema,
        selection: SelectionMetadataSchema,
        immediateChildCount: z.number().optional(),
        descendantCount: z.number().optional(),
        descendantsTruncated: z.boolean().optional(),
        sourceHints: SourceHintsSchema.optional(),
        timestamp: z.number()
    }),
    z.object({ success: z.literal(true), method: z.literal(CALIPER_METHODS.FREEZE), timestamp: z.number() }),
    z.object({ success: z.literal(true), method: z.literal(CALIPER_METHODS.CLEAR), timestamp: z.number() }),
    z.object({
        success: z.literal(true),
        method: z.literal(CALIPER_METHODS.WALK_DOM),
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
        method: z.literal(CALIPER_METHODS.WALK_AND_MEASURE),
        selector: z.string(),
        walkResult: z.object({
            root: CaliperNodeSchema.optional(),
            nodeCount: z.number(),
            maxDepthReached: z.number(),
            walkDurationMs: z.number(),
            hasMore: z.boolean().optional(),
            batchInstructions: z.string().optional(),
            continuationToken: z.string().optional(),
        }),
        timestamp: z.number(),
        binaryPayload: z.custom<Uint8Array>().optional(),
    }),
    z.object({
        success: z.literal(true),
        method: z.literal(CALIPER_METHODS.GET_CONTEXT),
        context: ContextMetricsSchema,
        timestamp: z.number(),
    }),
    z.object({
        success: z.literal(false),
        method: CaliperMethodSchema,
        selector: z.string().optional(),
        error: z.string(),
        timestamp: z.number(),
        binaryPayload: z.custom<Uint8Array>().optional(),
    }),
]);

export type SourceHints = z.infer<typeof SourceHintsSchema>;

export const CaliperAgentStateSchema = z.object({
    viewport: ViewportSchema,
    pageGeometry: z.record(z.string(), ElementGeometrySchema),
    activeSelection: SelectionMetadataSchema.nullable(),
    lastMeasurement: MeasurementResultSchema.nullable(),
    lastActionResult: CaliperActionResultSchema.nullable(),
    lastUpdated: z.number(),
});

export type JsonRpcRequest = JSONRPCRequest;
export type JsonRpcResponse = JSONRPCResponse;
export type JsonRpcNotification = JSONRPCNotification;

export {
    isJSONRPCRequest,
    isJSONRPCNotification,
    isJSONRPCResultResponse,
    isJSONRPCErrorResponse,
};

export class RpcFactory {
    static request<T extends Record<string, unknown>>(
        method: string,
        params: T,
        id: string | number
    ): JsonRpcRequest {
        return JSONRPCRequestSchema.parse({ jsonrpc: "2.0", method, params, id }) as JsonRpcRequest;
    }

    static response<T extends Record<string, unknown>>(id: string | number | null, result: T): JsonRpcResponse {
        return JSONRPCResultResponseSchema.parse({ jsonrpc: "2.0", id, result }) as JsonRpcResponse;
    }

    static error(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
        return JSONRPCErrorResponseSchema.parse({ jsonrpc: "2.0", id, error: { code, message, data } }) as JsonRpcResponse;
    }

    static notification<T extends Record<string, unknown>>(
        method: string,
        params: T
    ): JsonRpcNotification {
        return JSONRPCNotificationSchema.parse({ jsonrpc: "2.0", method, params }) as JsonRpcNotification;
    }
}

export const CaliperResponseSchema = z.union([
    z.object({
        jsonrpc: z.literal("2.0"),
        id: z.union([z.string(), z.number()]),
        result: z.union([CaliperActionResultSchema, CaliperAgentStateSchema]),
    }),
    JSONRPCErrorResponseSchema,
]);

export const CaliperNotificationSchema = z.union([
    z.object({
        jsonrpc: z.literal("2.0"),
        method: z.literal(CALIPER_METHODS.REGISTER_TAB),
        params: z.object({
            tabId: z.string(),
            url: z.string(),
            title: z.string(),
            isFocused: z.boolean(),
        }),
    }),
    z.object({
        jsonrpc: z.literal("2.0"),
        method: z.literal(CALIPER_METHODS.TAB_UPDATE),
        params: z.object({
            isFocused: z.boolean(),
        }),
    }),
]);

export const BridgeMessageSchema = z.union([
    JSONRPCRequestSchema,
    CaliperResponseSchema,
    CaliperNotificationSchema,
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

export const CaliperWalkAndMeasurePayloadSchema = z.object({
    selector: z.string(),
    maxDepth: z.number().optional(),
    maxNodes: z.number().optional(),
    continueFrom: z.string().optional(),
    minElementSize: z.number().optional(),
});

export const CaliperGetContextPayloadSchema = z.object({});
export type ViewportState = z.infer<typeof ViewportSchema>;
export type ElementGeometry = z.infer<typeof ElementGeometrySchema>;
export type CaliperActionResult = z.infer<typeof CaliperActionResultSchema>;
export type CaliperAgentState = z.infer<typeof CaliperAgentStateSchema>;
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;
export type CaliperSelectPayload = z.infer<typeof CaliperSelectPayloadSchema>;
export type CaliperMeasurePayload = z.infer<typeof CaliperMeasurePayloadSchema>;
export type CaliperInspectPayload = z.infer<typeof CaliperInspectPayloadSchema>;
export type CaliperWalkDomPayload = z.infer<typeof CaliperWalkDomPayloadSchema>;
export type CaliperWalkAndMeasurePayload = z.infer<typeof CaliperWalkAndMeasurePayloadSchema>;
export type CaliperGetContextPayload = z.infer<typeof CaliperGetContextPayloadSchema>;

export type CaliperIntent = JsonRpcRequest & (
    | { method: typeof CALIPER_METHODS.SELECT; params: CaliperSelectPayload }
    | { method: typeof CALIPER_METHODS.MEASURE; params: CaliperMeasurePayload }
    | { method: typeof CALIPER_METHODS.INSPECT; params: CaliperInspectPayload }
    | { method: typeof CALIPER_METHODS.FREEZE; params: {} }
    | { method: typeof CALIPER_METHODS.CLEAR; params: {} }
    | { method: typeof CALIPER_METHODS.WALK_DOM; params: CaliperWalkDomPayload }
    | { method: typeof CALIPER_METHODS.WALK_AND_MEASURE; params: CaliperWalkAndMeasurePayload }
    | { method: typeof CALIPER_METHODS.GET_CONTEXT; params: CaliperGetContextPayload }
);

export type BridgeMessageUnion =
    | JsonRpcRequest
    | JsonRpcResponse
    | JsonRpcNotification;
