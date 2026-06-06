import { z } from "zod";
import {
  CaliperEngineActivatePagePayloadSchema,
  CaliperEngineClosePagePayloadSchema,
  CaliperEngineListPagesPayloadSchema,
  CaliperEngineOpenPagePayloadSchema,
  CaliperEnginePageScopeSchema,
  withEnginePageScope,
} from "./engine-pages.js";

export const CALIPER_ENGINE_METHODS = {
  SET_VIEWPORT: "CALIPER_SET_VIEWPORT",
  AUDIT_BREAKPOINTS: "CALIPER_AUDIT_BREAKPOINTS",
  GET_RUNTIME: "CALIPER_ENGINE_GET_RUNTIME",
  CLEAR_RUNTIME: "CALIPER_ENGINE_CLEAR_RUNTIME",
  SCROLL: "CALIPER_ENGINE_SCROLL",
  SCROLL_INTO_VIEW: "CALIPER_ENGINE_SCROLL_INTO_VIEW",
  PAUSE_ANIMATIONS: "CALIPER_ENGINE_PAUSE_ANIMATIONS",
  RESUME_ANIMATIONS: "CALIPER_ENGINE_RESUME_ANIMATIONS",
  SCREENSHOT: "CALIPER_ENGINE_SCREENSHOT",
  EVAL_SCRIPT: "CALIPER_ENGINE_EVAL_SCRIPT",
  CLICK_AT: "CALIPER_ENGINE_CLICK_AT",
  PRESS_KEY: "CALIPER_ENGINE_PRESS_KEY",
  LIST_PAGES: "CALIPER_ENGINE_LIST_PAGES",
  OPEN_PAGE: "CALIPER_ENGINE_OPEN_PAGE",
  ACTIVATE_PAGE: "CALIPER_ENGINE_ACTIVATE_PAGE",
  CLOSE_PAGE: "CALIPER_ENGINE_CLOSE_PAGE",
} as const;

export const CALIPER_ENGINE_CLICK_AT_MAX_COORD = 32_000;

export const CALIPER_ENGINE_CLICK_AT_MAX_CLICK_COUNT = 3;

export const CALIPER_ENGINE_PRESS_KEY_MAX_MODIFIERS = 15;

export const CALIPER_ENGINE_EVAL_SCRIPT_MAX_SOURCE_LENGTH = 262_144;

export const CALIPER_ENGINE_EVAL_SCRIPT_DEFAULT_TIMEOUT_MS = 30_000;

export const CALIPER_ENGINE_EVAL_SCRIPT_MAX_TIMEOUT_MS = 120_000;

export const CaliperEngineMethodSchema = z.enum([
  CALIPER_ENGINE_METHODS.SET_VIEWPORT,
  CALIPER_ENGINE_METHODS.AUDIT_BREAKPOINTS,
  CALIPER_ENGINE_METHODS.GET_RUNTIME,
  CALIPER_ENGINE_METHODS.CLEAR_RUNTIME,
  CALIPER_ENGINE_METHODS.SCROLL,
  CALIPER_ENGINE_METHODS.SCROLL_INTO_VIEW,
  CALIPER_ENGINE_METHODS.PAUSE_ANIMATIONS,
  CALIPER_ENGINE_METHODS.RESUME_ANIMATIONS,
  CALIPER_ENGINE_METHODS.SCREENSHOT,
  CALIPER_ENGINE_METHODS.EVAL_SCRIPT,
  CALIPER_ENGINE_METHODS.CLICK_AT,
  CALIPER_ENGINE_METHODS.PRESS_KEY,
  CALIPER_ENGINE_METHODS.LIST_PAGES,
  CALIPER_ENGINE_METHODS.OPEN_PAGE,
  CALIPER_ENGINE_METHODS.ACTIVATE_PAGE,
  CALIPER_ENGINE_METHODS.CLOSE_PAGE,
]);

export type CaliperEngineMethod = z.infer<typeof CaliperEngineMethodSchema>;

/** Handled by PageRegistry before per-page EngineMeasurementSession dispatch. */
export const CALIPER_ENGINE_REGISTRY_METHODS = [
  CALIPER_ENGINE_METHODS.LIST_PAGES,
  CALIPER_ENGINE_METHODS.OPEN_PAGE,
  CALIPER_ENGINE_METHODS.ACTIVATE_PAGE,
  CALIPER_ENGINE_METHODS.CLOSE_PAGE,
  CALIPER_ENGINE_METHODS.GET_RUNTIME,
  CALIPER_ENGINE_METHODS.CLEAR_RUNTIME,
] as const;

export type CaliperEngineRegistryMethod = (typeof CALIPER_ENGINE_REGISTRY_METHODS)[number];

export type CaliperPageScopedEngineMethod = Exclude<
  CaliperEngineMethod,
  CaliperEngineRegistryMethod
>;

export const CaliperRuntimeConsoleLevelSchema = z.enum([
  "log",
  "warn",
  "error",
  "info",
  "debug",
]);

export const CaliperRuntimeConsoleEntrySchema = z.object({
  level: CaliperRuntimeConsoleLevelSchema,
  text: z.string(),
  url: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
  timestamp: z.number().optional(),
});

export const CaliperRuntimeExceptionEntrySchema = z.object({
  text: z.string(),
  url: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
  stack: z.string().optional(),
  timestamp: z.number().optional(),
});

export const CaliperRuntimeLogEntrySchema = z.object({
  source: z.string(),
  level: z.string(),
  text: z.string(),
  timestamp: z.number().optional(),
});

export const CaliperRuntimeNetworkFailureSchema = z.object({
  url: z.string(),
  error: z.string(),
  resourceType: z.string().optional(),
  timestamp: z.number().optional(),
});

export const CaliperRuntimeChannelCountsSchema = z.object({
  console: z.number().int().nonnegative(),
  exceptions: z.number().int().nonnegative(),
  logs: z.number().int().nonnegative(),
  networkFailures: z.number().int().nonnegative(),
});

export const CaliperRuntimeChannelTimestampsSchema = z.object({
  console: z.number().optional(),
  exceptions: z.number().optional(),
  logs: z.number().optional(),
  networkFailures: z.number().optional(),
});

export const CaliperRuntimeChannelRotationSchema = z.object({
  console: z.boolean().optional(),
  exceptions: z.boolean().optional(),
  logs: z.boolean().optional(),
  networkFailures: z.boolean().optional(),
});

export const CaliperRuntimeTripCodeSchema = z.enum([
  "rate_exceeded",
  "session_lines_exceeded",
  "session_bytes_exceeded",
  "duplicate_streak",
]);

export const CaliperRuntimeTripSchema = z.object({
  code: CaliperRuntimeTripCodeSchema,
  at: z.number(),
  message: z.string(),
});

export const CaliperRuntimeFingerprintSchema = z.object({
  seq: z.number().int().nonnegative(),
  counts: CaliperRuntimeChannelCountsSchema,
  lastTimestamps: CaliperRuntimeChannelTimestampsSchema.optional(),
  capturedAt: z.number(),
  redactionApplied: z.boolean().optional(),
  rotated: CaliperRuntimeChannelRotationSchema.optional(),
  tripped: CaliperRuntimeTripSchema.optional(),
});

export const CaliperRuntimeChannelNameSchema = z.enum([
  "console",
  "exceptions",
  "logs",
  "networkFailures",
]);

export const CaliperRuntimeCaptureEnabledSchema = z
  .object({
    enabled: z.boolean(),
    channels: z.array(CaliperRuntimeChannelNameSchema).optional(),
    subscribedAt: z.number().optional(),
    projectRoot: z.string().optional(),
    trippedAt: z.number().optional(),
    tripCode: CaliperRuntimeTripCodeSchema.optional(),
    tripMessage: z.string().optional(),
    trippedBy: z.literal("engine").optional(),
  })
  .superRefine((payload, context) => {
    if (payload.enabled && (payload.channels?.length ?? 0) === 0) {
      context.addIssue({
        code: "custom",
        message: "channels is required when capture is enabled",
      });
    }
  });

export const CaliperEngineRuntimePathsSchema = z.object({
  runtimeDir: z.string(),
  console: z.string(),
  exceptions: z.string(),
  logs: z.string(),
  networkFailures: z.string(),
  fingerprint: z.string(),
  captureEnabledFlag: z.string(),
});

export const CaliperEngineRuntimeAgentDiscoverySchema = z.object({
  whyGitignored: z.string(),
  howToRead: z.array(z.string()),
  format: z.string(),
  workflow: z.array(z.string()),
  redactionNote: z.string(),
});

export const CaliperEngineRuntimeResourceSchema = z.object({
  available: z.literal(false),
});

export const CaliperEngineRuntimeChannelSubscribeUrisSchema = z.object({
  console: z.string(),
  exceptions: z.string(),
  logs: z.string(),
  networkFailures: z.string(),
});

export const CaliperEngineRuntimeResourceReadySchema = z.object({
  seq: z.number().int().nonnegative(),
  captureEnabled: z.boolean(),
  activeChannels: z.array(CaliperRuntimeChannelNameSchema),
  channelSubscribeUris: CaliperEngineRuntimeChannelSubscribeUrisSchema,
  projectRoot: z.string(),
  paths: CaliperEngineRuntimePathsSchema,
  counts: CaliperRuntimeChannelCountsSchema,
  capturedAt: z.number(),
  redactionApplied: z.boolean().optional(),
  rotated: CaliperRuntimeChannelRotationSchema.optional(),
  tripped: CaliperRuntimeTripSchema.optional(),
  agentDiscovery: CaliperEngineRuntimeAgentDiscoverySchema,
});

export const CaliperEngineRuntimeChannelResourceReadySchema = z.object({
  channel: CaliperRuntimeChannelNameSchema,
  subscribeUri: z.string(),
  captureEnabled: z.boolean(),
  seq: z.number().int().nonnegative(),
  path: z.string(),
  count: z.number().int().nonnegative(),
  tripped: CaliperRuntimeTripSchema.optional(),
});

export const CaliperEngineRuntimeChannelResourcePayloadSchema = z.union([
  CaliperEngineRuntimeResourceSchema,
  CaliperEngineRuntimeChannelResourceReadySchema,
]);

export const CaliperEngineRuntimeResourcePayloadSchema = z.union([
  CaliperEngineRuntimeResourceSchema,
  CaliperEngineRuntimeResourceReadySchema,
]);

export const CaliperEngineGetRuntimePayloadSchema = withEnginePageScope({
  fingerprintOnly: z.boolean().optional(),
});

export const CaliperScreenshotRefSchema = z.object({
  captureId: z.string(),
  url: z.string(),
  width: z.number(),
  height: z.number(),
  scrollX: z.number(),
  scrollY: z.number(),
  fullPage: z.boolean(),
  capturedAt: z.number(),
});

export const CaliperEngineScrollPayloadSchema = withEnginePageScope({
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
});

export const CaliperEngineScrollIntoViewPayloadSchema = withEnginePageScope({
  selector: z.string(),
});

export const CaliperEngineScreenshotPayloadSchema = withEnginePageScope({
  fullPage: z.boolean().optional(),
  selector: z.string().optional(),
  format: z.enum(["png", "jpeg"]).optional(),
}).refine((payload) => !(payload.fullPage && payload.selector), {
  message: "fullPage and selector are mutually exclusive",
});

export const CaliperEngineEvalScriptPayloadSchema = withEnginePageScope({
  source: z
    .string()
    .min(1)
    .max(CALIPER_ENGINE_EVAL_SCRIPT_MAX_SOURCE_LENGTH),
  awaitPromise: z.boolean().optional(),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(CALIPER_ENGINE_EVAL_SCRIPT_MAX_TIMEOUT_MS)
    .optional(),
});

export const CaliperEngineMouseButtonSchema = z.enum(["left", "right", "middle"]);

export const CaliperEngineClickAtSharedPayloadSchema = z.object({
  button: CaliperEngineMouseButtonSchema.optional(),
  clickCount: z
    .number()
    .int()
    .min(1)
    .max(CALIPER_ENGINE_CLICK_AT_MAX_CLICK_COUNT)
    .optional(),
});

export const CaliperEngineClickAtBySelectorPayloadSchema =
  CaliperEngineClickAtSharedPayloadSchema.extend({
    selector: z.string().min(1),
    scrollIntoView: z.boolean().optional(),
  });

export const CaliperEngineClickAtByCoordsPayloadSchema =
  CaliperEngineClickAtSharedPayloadSchema.extend({
    x: z.number().min(0).max(CALIPER_ENGINE_CLICK_AT_MAX_COORD),
    y: z.number().min(0).max(CALIPER_ENGINE_CLICK_AT_MAX_COORD),
  });

export const CaliperEngineClickAtPayloadSchema = withEnginePageScope({
  selector: z.string().min(1).optional(),
  scrollIntoView: z.boolean().optional(),
  x: z.number().min(0).max(CALIPER_ENGINE_CLICK_AT_MAX_COORD).optional(),
  y: z.number().min(0).max(CALIPER_ENGINE_CLICK_AT_MAX_COORD).optional(),
  button: CaliperEngineMouseButtonSchema.optional(),
  clickCount: z
    .number()
    .int()
    .min(1)
    .max(CALIPER_ENGINE_CLICK_AT_MAX_CLICK_COUNT)
    .optional(),
}).superRefine((payload, context) => {
    const hasSelector = payload.selector !== undefined;
    const hasX = payload.x !== undefined;
    const hasY = payload.y !== undefined;

    if (hasSelector && (hasX || hasY)) {
      context.addIssue({
        code: "custom",
        message: "selector and x/y are mutually exclusive",
      });
    }

    if (!hasSelector && (!hasX || !hasY)) {
      context.addIssue({
        code: "custom",
        message: "provide selector or both x and y",
      });
    }
  });

export const CaliperEngineAllowlistedKeySchema = z.enum([
  "Escape",
  "Enter",
  "Tab",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

export const CaliperEnginePressKeyPayloadSchema = withEnginePageScope({
  key: CaliperEngineAllowlistedKeySchema,
  modifiers: z
    .number()
    .int()
    .min(0)
    .max(CALIPER_ENGINE_PRESS_KEY_MAX_MODIFIERS)
    .optional(),
});

export const CaliperEngineEmptyPayloadSchema = z.object({});

export const CaliperEngineScopedEmptyPayloadSchema = CaliperEnginePageScopeSchema;

export const CaliperSetViewportPayloadSchema = withEnginePageScope({
  width: z.number().int().positive(),
  height: z.number().int().positive().optional(),
  deviceScaleFactor: z.number().positive().optional(),
});

export const CaliperAuditBreakpointsPayloadSchema = withEnginePageScope({
  selector: z.string(),
  widths: z.array(z.number().int().positive()).optional(),
  height: z.number().int().positive().optional(),
});

export type CaliperRuntimeConsoleEntry = z.infer<typeof CaliperRuntimeConsoleEntrySchema>;
export type CaliperRuntimeExceptionEntry = z.infer<typeof CaliperRuntimeExceptionEntrySchema>;
export type CaliperRuntimeLogEntry = z.infer<typeof CaliperRuntimeLogEntrySchema>;
export type CaliperRuntimeNetworkFailure = z.infer<typeof CaliperRuntimeNetworkFailureSchema>;

/** NDJSON line shape per runtime channel (see {@link CaliperRuntimeChannel}). */
export type CaliperRuntimeChannelEntry = {
  console: CaliperRuntimeConsoleEntry;
  exceptions: CaliperRuntimeExceptionEntry;
  logs: CaliperRuntimeLogEntry;
  networkFailures: CaliperRuntimeNetworkFailure;
};
export type CaliperRuntimeChannelCounts = z.infer<typeof CaliperRuntimeChannelCountsSchema>;
export type CaliperRuntimeChannelRotation = z.infer<typeof CaliperRuntimeChannelRotationSchema>;
export type CaliperRuntimeCaptureEnabled = z.infer<typeof CaliperRuntimeCaptureEnabledSchema>;
export type CaliperEngineRuntimePaths = z.infer<typeof CaliperEngineRuntimePathsSchema>;
export type CaliperEngineRuntimeAgentDiscovery = z.infer<
  typeof CaliperEngineRuntimeAgentDiscoverySchema
>;
export type CaliperEngineRuntimeResource = z.infer<typeof CaliperEngineRuntimeResourcePayloadSchema>;
export type CaliperEngineRuntimeChannelResource = z.infer<
  typeof CaliperEngineRuntimeChannelResourcePayloadSchema
>;
export type CaliperRuntimeChannelTimestamps = z.infer<
  typeof CaliperRuntimeChannelTimestampsSchema
>;
export type CaliperRuntimeFingerprint = z.infer<typeof CaliperRuntimeFingerprintSchema>;
export type CaliperRuntimeTripCode = z.infer<typeof CaliperRuntimeTripCodeSchema>;
export type CaliperRuntimeTrip = z.infer<typeof CaliperRuntimeTripSchema>;
export type CaliperEngineGetRuntimePayload = z.infer<typeof CaliperEngineGetRuntimePayloadSchema>;
export type CaliperScreenshotRef = z.infer<typeof CaliperScreenshotRefSchema>;
export type CaliperEngineScrollPayload = z.infer<typeof CaliperEngineScrollPayloadSchema>;
export type CaliperEngineScrollIntoViewPayload = z.infer<
  typeof CaliperEngineScrollIntoViewPayloadSchema
>;
export type CaliperEngineScreenshotPayload = z.infer<typeof CaliperEngineScreenshotPayloadSchema>;
export type CaliperEngineEvalScriptPayload = z.infer<typeof CaliperEngineEvalScriptPayloadSchema>;
export type CaliperEngineClickAtPayload = z.infer<typeof CaliperEngineClickAtPayloadSchema>;
export type CaliperEnginePressKeyPayload = z.infer<typeof CaliperEnginePressKeyPayloadSchema>;
export type CaliperEngineAllowlistedKey = z.infer<typeof CaliperEngineAllowlistedKeySchema>;
export type CaliperSetViewportPayload = z.infer<typeof CaliperSetViewportPayloadSchema>;
export type CaliperAuditBreakpointsPayload = z.infer<typeof CaliperAuditBreakpointsPayloadSchema>;

export type CaliperEngineListPagesPayload = z.infer<typeof CaliperEngineListPagesPayloadSchema>;
export type CaliperEngineOpenPagePayload = z.infer<typeof CaliperEngineOpenPagePayloadSchema>;
export type CaliperEngineActivatePagePayload = z.infer<
  typeof CaliperEngineActivatePagePayloadSchema
>;
export type CaliperEngineClosePagePayload = z.infer<typeof CaliperEngineClosePagePayloadSchema>;

export type CaliperEngineParamsByMethod = {
  [CALIPER_ENGINE_METHODS.SET_VIEWPORT]: CaliperSetViewportPayload;
  [CALIPER_ENGINE_METHODS.AUDIT_BREAKPOINTS]: CaliperAuditBreakpointsPayload;
  [CALIPER_ENGINE_METHODS.GET_RUNTIME]: CaliperEngineGetRuntimePayload;
  [CALIPER_ENGINE_METHODS.CLEAR_RUNTIME]: CaliperEngineScopedEmptyPayload;
  [CALIPER_ENGINE_METHODS.SCROLL]: CaliperEngineScrollPayload;
  [CALIPER_ENGINE_METHODS.SCROLL_INTO_VIEW]: CaliperEngineScrollIntoViewPayload;
  [CALIPER_ENGINE_METHODS.PAUSE_ANIMATIONS]: CaliperEngineScopedEmptyPayload;
  [CALIPER_ENGINE_METHODS.RESUME_ANIMATIONS]: CaliperEngineScopedEmptyPayload;
  [CALIPER_ENGINE_METHODS.SCREENSHOT]: CaliperEngineScreenshotPayload;
  [CALIPER_ENGINE_METHODS.EVAL_SCRIPT]: CaliperEngineEvalScriptPayload;
  [CALIPER_ENGINE_METHODS.CLICK_AT]: CaliperEngineClickAtPayload;
  [CALIPER_ENGINE_METHODS.PRESS_KEY]: CaliperEnginePressKeyPayload;
  [CALIPER_ENGINE_METHODS.LIST_PAGES]: CaliperEngineListPagesPayload;
  [CALIPER_ENGINE_METHODS.OPEN_PAGE]: CaliperEngineOpenPagePayload;
  [CALIPER_ENGINE_METHODS.ACTIVATE_PAGE]: CaliperEngineActivatePagePayload;
  [CALIPER_ENGINE_METHODS.CLOSE_PAGE]: CaliperEngineClosePagePayload;
};

export type CaliperEngineEmptyPayload = z.infer<typeof CaliperEngineEmptyPayloadSchema>;
export type CaliperEngineScopedEmptyPayload = z.infer<
  typeof CaliperEngineScopedEmptyPayloadSchema
>;
export type CaliperEngineParams<M extends CaliperEngineMethod> = CaliperEngineParamsByMethod[M];

export type CaliperEngineRequest = {
  [M in CaliperEngineMethod]: {
    method: M;
    params: CaliperEngineParams<M>;
  };
}[CaliperEngineMethod];

export function isCaliperEngineMethod(method: string): method is CaliperEngineMethod {
  return (CaliperEngineMethodSchema.options as readonly string[]).includes(method);
}

