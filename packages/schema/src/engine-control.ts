import { z } from "zod";

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
} as const;

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
]);

export type CaliperEngineMethod = z.infer<typeof CaliperEngineMethodSchema>;

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

export const CaliperRuntimeBlockSchema = z.object({
  console: z.array(CaliperRuntimeConsoleEntrySchema),
  exceptions: z.array(CaliperRuntimeExceptionEntrySchema),
  logs: z.array(CaliperRuntimeLogEntrySchema),
  networkFailures: z.array(CaliperRuntimeNetworkFailureSchema),
  capturedAt: z.number(),
  truncated: z.boolean().optional(),
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

export const CaliperEngineScrollPayloadSchema = z.object({
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
});

export const CaliperEngineScrollIntoViewPayloadSchema = z.object({
  selector: z.string(),
});

export const CaliperEngineScreenshotPayloadSchema = z.object({
  fullPage: z.boolean().optional(),
  format: z.enum(["png", "jpeg"]).optional(),
});

export const CaliperEngineEmptyPayloadSchema = z.object({});

export const CaliperSetViewportPayloadSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive().optional(),
  deviceScaleFactor: z.number().positive().optional(),
});

export const CaliperAuditBreakpointsPayloadSchema = z.object({
  selector: z.string(),
  widths: z.array(z.number().int().positive()).optional(),
  height: z.number().int().positive().optional(),
});

export type CaliperRuntimeConsoleEntry = z.infer<typeof CaliperRuntimeConsoleEntrySchema>;
export type CaliperRuntimeExceptionEntry = z.infer<typeof CaliperRuntimeExceptionEntrySchema>;
export type CaliperRuntimeLogEntry = z.infer<typeof CaliperRuntimeLogEntrySchema>;
export type CaliperRuntimeNetworkFailure = z.infer<typeof CaliperRuntimeNetworkFailureSchema>;
export type CaliperRuntimeBlock = z.infer<typeof CaliperRuntimeBlockSchema>;
export type CaliperScreenshotRef = z.infer<typeof CaliperScreenshotRefSchema>;
export type CaliperEngineScrollPayload = z.infer<typeof CaliperEngineScrollPayloadSchema>;
export type CaliperEngineScrollIntoViewPayload = z.infer<
  typeof CaliperEngineScrollIntoViewPayloadSchema
>;
export type CaliperEngineScreenshotPayload = z.infer<typeof CaliperEngineScreenshotPayloadSchema>;
export type CaliperSetViewportPayload = z.infer<typeof CaliperSetViewportPayloadSchema>;
export type CaliperAuditBreakpointsPayload = z.infer<typeof CaliperAuditBreakpointsPayloadSchema>;

export type CaliperEngineParamsByMethod = {
  [CALIPER_ENGINE_METHODS.SET_VIEWPORT]: CaliperSetViewportPayload;
  [CALIPER_ENGINE_METHODS.AUDIT_BREAKPOINTS]: CaliperAuditBreakpointsPayload;
  [CALIPER_ENGINE_METHODS.GET_RUNTIME]: Record<string, never>;
  [CALIPER_ENGINE_METHODS.CLEAR_RUNTIME]: Record<string, never>;
  [CALIPER_ENGINE_METHODS.SCROLL]: CaliperEngineScrollPayload;
  [CALIPER_ENGINE_METHODS.SCROLL_INTO_VIEW]: CaliperEngineScrollIntoViewPayload;
  [CALIPER_ENGINE_METHODS.PAUSE_ANIMATIONS]: Record<string, never>;
  [CALIPER_ENGINE_METHODS.RESUME_ANIMATIONS]: Record<string, never>;
  [CALIPER_ENGINE_METHODS.SCREENSHOT]: CaliperEngineScreenshotPayload;
};

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
