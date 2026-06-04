import { z } from "zod";
import { ContextMetricsSchema, MeasurementResultSchema, SelectionMetadataSchema } from "./core.js";
import {
  CaliperAuditContextSchema,
  CaliperBreakpointAuditMatrixSchema,
  CaliperRuntimeConnectionSchema,
  CaliperVisibilitySchema,
} from "./visibility.js";
import {
  CaliperComputedStylesSchema,
  CaliperNodeSchema,
  CaliperSelectorInputSchema,
  WalkOptionsSchema,
} from "./audit.js";
import {
  CALIPER_ENGINE_METHODS,
  CaliperEngineMethodSchema,
  isCaliperEngineMethod,
  type CaliperEngineMethod,
  type CaliperEngineParamsByMethod,
  CaliperRuntimeFingerprintSchema,
  CaliperScreenshotRefSchema,
} from "./engine-control.js";
import {
  JSONRPCRequestSchema as _JSONRPCRequestSchema,
  JSONRPCNotificationSchema as _JSONRPCNotificationSchema,
  JSONRPCResultResponseSchema as _JSONRPCResultResponseSchema,
  JSONRPCErrorResponseSchema as _JSONRPCErrorResponseSchema,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCNotification,
  type JSONRPCErrorResponse,
  isJSONRPCRequest as _isJSONRPCRequest,
  isJSONRPCNotification as _isJSONRPCNotification,
  isJSONRPCResultResponse as _isJSONRPCResultResponse,
  isJSONRPCErrorResponse as _isJSONRPCErrorResponse,
} from "@modelcontextprotocol/sdk/types.js";

export const JSONRPCRequestSchema = _JSONRPCRequestSchema;
export const JSONRPCNotificationSchema = _JSONRPCNotificationSchema;
export const JSONRPCResultResponseSchema = _JSONRPCResultResponseSchema;
export const JSONRPCErrorResponseSchema = _JSONRPCErrorResponseSchema;
export const isJSONRPCRequest = _isJSONRPCRequest;
export const isJSONRPCNotification = _isJSONRPCNotification;
export const isJSONRPCResultResponse = _isJSONRPCResultResponse;
export const isJSONRPCErrorResponse = _isJSONRPCErrorResponse;

export type { JSONRPCRequest, JSONRPCResponse, JSONRPCNotification, JSONRPCErrorResponse };

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
  STATE_UPDATE: "caliper/stateUpdate",
} as const;

export const CaliperBaseMethodSchema = z.enum([
  CALIPER_METHODS.SELECT,
  CALIPER_METHODS.MEASURE,
  CALIPER_METHODS.INSPECT,
  CALIPER_METHODS.FREEZE,
  CALIPER_METHODS.CLEAR,
  CALIPER_METHODS.WALK_DOM,
  CALIPER_METHODS.WALK_AND_MEASURE,
  CALIPER_METHODS.GET_CONTEXT,
]);

export const CaliperBridgeNotificationMethodSchema = z.enum([
  CALIPER_METHODS.REGISTER_TAB,
  CALIPER_METHODS.TAB_UPDATE,
  CALIPER_METHODS.STATE_UPDATE,
]);

export const CaliperMethodSchema = z.union([
  CaliperBaseMethodSchema,
  CaliperBridgeNotificationMethodSchema,
]);

export type CaliperBaseMethod = z.infer<typeof CaliperBaseMethodSchema>;
export type CaliperBridgeNotificationMethod = z.infer<typeof CaliperBridgeNotificationMethodSchema>;
export type CaliperMethod = z.infer<typeof CaliperMethodSchema>;

export const CaliperRpcMethodSchema = z.union([CaliperBaseMethodSchema, CaliperEngineMethodSchema]);

export type CaliperRpcMethod = z.infer<typeof CaliperRpcMethodSchema>;

export const SourceHintsSchema = z.object({
  stableAnchors: z.array(z.string()),
  suggestedGrep: z.string().optional(),
  textContent: z.string().optional(),
  accessibleName: z.string().optional(),
  unstableClasses: z.array(z.string()),
  tagName: z.string(),
});

export const CaliperActionResultSchema = z.union([
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_METHODS.SELECT),
    selector: z.string(),
    selection: SelectionMetadataSchema,
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_METHODS.MEASURE),
    selector: z.string(),
    measurement: MeasurementResultSchema,
    auditContext: CaliperAuditContextSchema.optional(),
    timestamp: z.number(),
  }),
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
    visibility: CaliperVisibilitySchema.optional(),
    auditContext: CaliperAuditContextSchema.optional(),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_METHODS.FREEZE),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_METHODS.CLEAR),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_METHODS.WALK_DOM),
    selector: z.string(),
    domContext: z.object({
      element: CaliperElementSummarySchema,
      parent: CaliperElementSummarySchema.nullable(),
      children: z.array(CaliperElementSummarySchema),
    }),
    auditContext: CaliperAuditContextSchema.optional(),
    timestamp: z.number(),
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
    auditContext: CaliperAuditContextSchema.optional(),
    timestamp: z.number(),
    binaryPayload: z.custom<Uint8Array>().optional(),
    /** JSON wire transport (engine HTTP/CDP); stripped after rehydrate */
    binaryPayloadBase64: z.string().optional(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_METHODS.GET_CONTEXT),
    context: ContextMetricsSchema,
    runtimeConnection: CaliperRuntimeConnectionSchema.optional(),
    auditContext: CaliperAuditContextSchema.optional(),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_ENGINE_METHODS.SET_VIEWPORT),
    viewport: ViewportSchema,
    deviceScaleFactor: z.number(),
    emulated: z.boolean(),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_ENGINE_METHODS.AUDIT_BREAKPOINTS),
    selector: z.string(),
    audit: CaliperBreakpointAuditMatrixSchema,
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_ENGINE_METHODS.GET_RUNTIME),
    fingerprint: CaliperRuntimeFingerprintSchema.optional(),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_ENGINE_METHODS.CLEAR_RUNTIME),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_ENGINE_METHODS.SCROLL),
    scrollX: z.number(),
    scrollY: z.number(),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_ENGINE_METHODS.SCROLL_INTO_VIEW),
    selector: z.string(),
    scrollX: z.number(),
    scrollY: z.number(),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_ENGINE_METHODS.PAUSE_ANIMATIONS),
    paused: z.literal(true),
    playbackRate: z.number(),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_ENGINE_METHODS.RESUME_ANIMATIONS),
    paused: z.literal(false),
    playbackRate: z.number(),
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(true),
    method: z.literal(CALIPER_ENGINE_METHODS.SCREENSHOT),
    capture: CaliperScreenshotRefSchema,
    timestamp: z.number(),
  }),
  z.object({
    success: z.literal(false),
    method: CaliperRpcMethodSchema,
    selector: z.string().optional(),
    error: z.string(),
    timestamp: z.number(),
    binaryPayload: z.custom<Uint8Array>().optional(),
  }),
]);

export type SourceHints = z.infer<typeof SourceHintsSchema>;

export const CaliperAgentStateSchema = z.object({
  viewport: ViewportSchema,
  activeSelection: SelectionMetadataSchema.nullable(),
  selectionFingerprint: CaliperSelectorInputSchema.nullable(),
  lastMeasurement: MeasurementResultSchema.nullable(),
  measurementFingerprint: z
    .object({
      primary: CaliperSelectorInputSchema,
      secondary: CaliperSelectorInputSchema,
    })
    .nullable(),
  lastUpdated: z.number(),
});

export const IdSchema = z.union([z.string(), z.number()]);

export type Id = z.infer<typeof IdSchema>;
export type NullableId<T extends Id = Id> = T | null;

export class RpcFactory {
  static request(
    method: CaliperRpcMethod,
    params: CaliperRpcParamsByMethod[CaliperRpcMethod],
    id: Id
  ): JSONRPCRequest {
    return JSONRPCRequestSchema.parse({ jsonrpc: "2.0", method, params, id });
  }

  static response(input: {
    id: NullableId;
    result: Record<string, unknown>;
  }): JSONRPCResponse {
    return JSONRPCResultResponseSchema.parse({
      jsonrpc: "2.0",
      id: input.id,
      result: input.result,
    });
  }

  static error(input: {
    id: NullableId;
    code: number;
    message: string;
    data?: unknown;
  }): JSONRPCErrorResponse {
    return JSONRPCErrorResponseSchema.parse({
      jsonrpc: "2.0",
      ...(input.id !== null ? { id: input.id } : {}),
      error: {
        code: input.code,
        message: input.message,
        ...(input.data !== undefined ? { data: input.data } : {}),
      },
    });
  }

  static notification(
    method: CaliperBridgeNotificationMethod,
    params: Record<string, unknown>
  ): JSONRPCNotification {
    return JSONRPCNotificationSchema.parse({
      jsonrpc: "2.0",
      method,
      params,
    });
  }
}

export type RpcErrorInput = Parameters<typeof RpcFactory.error>[0];
export type RpcResultInput = Parameters<typeof RpcFactory.response>[0];

export const isId = (value: unknown): value is Id => {
  return typeof value === "string" || typeof value === "number";
};

export function parseCaliperActionResult(value: unknown): CaliperActionResult | null {
  const parsed = CaliperActionResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isCaliperActionResultMethod<M extends CaliperRpcMethod>(
  result: CaliperActionResult,
  method: M
): result is CaliperActionResultFor<M> {
  return result.method === method;
}

export const CaliperResponseSchema = z.union([
  z.object({
    jsonrpc: z.literal("2.0"),
    id: IdSchema,
    result: CaliperActionResultSchema,
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
  z.object({
    jsonrpc: z.literal("2.0"),
    method: z.literal(CALIPER_METHODS.STATE_UPDATE),
    params: CaliperAgentStateSchema,
  }),
]);

export const BridgeMessageSchema = z.union([CaliperResponseSchema, CaliperNotificationSchema]);

export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;
export type BridgeNotification = z.infer<typeof CaliperNotificationSchema>;
export type BridgeErrorResponse = Extract<BridgeMessage, { error: unknown }>;
export type BridgeResultResponse = Extract<BridgeMessage, { result: unknown }>;

export function isBridgeNotification(msg: BridgeMessage): msg is BridgeNotification {
  return "method" in msg;
}
export function isBridgeErrorResponse(msg: BridgeMessage): msg is BridgeErrorResponse {
  return "error" in msg;
}
export function isBridgeResultResponse(msg: BridgeMessage): msg is BridgeResultResponse {
  return "result" in msg;
}

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

export const CaliperWalkAndMeasurePayloadSchema = WalkOptionsSchema.extend({
  selector: z.string(),
});

export const CaliperGetContextPayloadSchema = z.object({});

export type ViewportState = z.infer<typeof ViewportSchema>;
export type ElementGeometry = z.infer<typeof ElementGeometrySchema>;
export type CaliperActionResult = z.infer<typeof CaliperActionResultSchema>;

export type CaliperActionResultFor<M extends CaliperRpcMethod> =
  | Extract<CaliperActionResult, { success: true; method: M }>
  | (Extract<CaliperActionResult, { success: false }> & { method: M });
  
export type CaliperAgentState = z.infer<typeof CaliperAgentStateSchema>;
export type CaliperSelectPayload = z.infer<typeof CaliperSelectPayloadSchema>;
export type CaliperMeasurePayload = z.infer<typeof CaliperMeasurePayloadSchema>;
export type CaliperInspectPayload = z.infer<typeof CaliperInspectPayloadSchema>;
export type CaliperWalkDomPayload = z.infer<typeof CaliperWalkDomPayloadSchema>;
export type CaliperWalkAndMeasurePayload = z.infer<typeof CaliperWalkAndMeasurePayloadSchema>;
export type CaliperGetContextPayload = z.infer<typeof CaliperGetContextPayloadSchema>;

export type CaliperBaseParamsByMethod = {
  [CALIPER_METHODS.SELECT]: CaliperSelectPayload;
  [CALIPER_METHODS.MEASURE]: CaliperMeasurePayload;
  [CALIPER_METHODS.INSPECT]: CaliperInspectPayload;
  [CALIPER_METHODS.FREEZE]: Record<string, never>;
  [CALIPER_METHODS.CLEAR]: Record<string, never>;
  [CALIPER_METHODS.WALK_DOM]: CaliperWalkDomPayload;
  [CALIPER_METHODS.WALK_AND_MEASURE]: CaliperWalkAndMeasurePayload;
  [CALIPER_METHODS.GET_CONTEXT]: CaliperGetContextPayload;
};

export type CaliperBaseRequest = {
  [M in CaliperBaseMethod]: {
    method: M;
    params: CaliperBaseParamsByMethod[M];
  };
}[CaliperBaseMethod];

export type CaliperParams<M extends CaliperBaseMethod> = CaliperBaseParamsByMethod[M];

export type CaliperRpcParamsByMethod = CaliperBaseParamsByMethod & CaliperEngineParamsByMethod;
export type CaliperRpcParams<M extends CaliperRpcMethod> = CaliperRpcParamsByMethod[M];

export type CaliperRpcRequest = {
  [M in CaliperRpcMethod]: JSONRPCRequest & {
    method: M;
    params: CaliperRpcParams<M>;
  };
}[CaliperRpcMethod];

export type CaliperIntent = Extract<CaliperRpcRequest, { method: CaliperBaseMethod }>;

export type CaliperEngineRpcRequest = Extract<CaliperRpcRequest, { method: CaliperEngineMethod }>;

const CALIPER_RPC_METHODS = new Set<string>([
  ...CaliperBaseMethodSchema.options,
  ...CaliperEngineMethodSchema.options,
]);

export const CaliperRpcRequestSchema = JSONRPCRequestSchema.refine(
  (request) => CALIPER_RPC_METHODS.has(request.method),
  { message: "Unsupported Caliper RPC method" }
);

export function parseCaliperRpcRequest(value: unknown): CaliperRpcRequest | null {
  const parsed = CaliperRpcRequestSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data as CaliperRpcRequest;
}

export function isCaliperEngineRpcRequest(
  request: CaliperRpcRequest
): request is CaliperEngineRpcRequest {
  return isCaliperEngineMethod(request.method);
}
