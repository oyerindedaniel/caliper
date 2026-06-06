import { z } from "zod";
import { DEFAULT_AUDIT_VIEWPORT_HEIGHT } from "./visibility.js";

export const DEFAULT_ENGINE_VIEWPORT_WIDTH = 1280;
export const DEFAULT_ENGINE_VIEWPORT_HEIGHT = DEFAULT_AUDIT_VIEWPORT_HEIGHT;
export const DEFAULT_ENGINE_VIEWPORT_DEVICE_SCALE_FACTOR = 1;
export const DEFAULT_ENGINE_MAX_PAGES = 8;

/** Default navigation wait for domcontentloaded (ms). Playwright default is 30s; engine uses 60s. */
export const DEFAULT_ENGINE_NAVIGATION_TIMEOUT_DOM_MS = 60_000;

/** Default navigation wait for load (ms). */
export const DEFAULT_ENGINE_NAVIGATION_TIMEOUT_LOAD_MS = 90_000;

export const CALIPER_ENGINE_NAVIGATION_TIMEOUT_CODE = "navigation_timeout";

export const CALIPER_ENGINE_STATE_BINDING = "caliperEngineState";

export const CaliperEnginePageSummarySchema = z.object({
  pageId: z.string(),
  url: z.string(),
  title: z.string(),
  isActive: z.boolean(),
});

export type CaliperEnginePageSummary = z.infer<typeof CaliperEnginePageSummarySchema>;

export const CaliperEngineDefaultViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive(),
});

export type CaliperEngineDefaultViewport = z.infer<typeof CaliperEngineDefaultViewportSchema>;

export const CaliperEnginePageWaitUntilSchema = z.enum(["domcontentloaded", "load"]);

export type CaliperEnginePageWaitUntil = z.infer<typeof CaliperEnginePageWaitUntilSchema>;

export const CaliperEnginePageScopeSchema = z.object({
  pageId: z.string().optional(),
});

export type CaliperEnginePageScopedParams = z.infer<typeof CaliperEnginePageScopeSchema>;

export function withEnginePageScope<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).extend(CaliperEnginePageScopeSchema.shape);
}

export const CaliperEngineListPagesPayloadSchema = CaliperEnginePageScopeSchema.pick({});

export const CaliperEngineOpenPagePayloadSchema = z.object({
  url: z.url(),
  waitUntil: CaliperEnginePageWaitUntilSchema.optional(),
  reuse: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const CaliperEngineActivatePagePayloadSchema = z.object({
  pageId: z.string(),
});

export const CaliperEngineClosePagePayloadSchema = z.object({
  pageId: z.string(),
});

export const CaliperEngineStateSnapshotSchema = z.object({
  stateSeq: z.number().int().nonnegative(),
  activePageId: z.string().nullable(),
  pages: z.record(z.string(), z.unknown()),
});

export type CaliperEngineStateSnapshot = z.infer<typeof CaliperEngineStateSnapshotSchema>;
