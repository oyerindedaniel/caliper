import { z } from "zod";

export const CaliperAuditViewportSchema = z.object({
  width: z.number(),
  height: z.number(),
  scrollX: z.number(),
  scrollY: z.number(),
});

export const CALIPER_VISIBILITY_STATUS = {
  VISIBLE: "visible",
  HIDDEN: "hidden",
} as const;

export const CALIPER_VISIBILITY_REASON = {
  DISPLAY_NONE: "display_none",
  NOT_VISIBLE: "not_visible",
  PARENT_HIDDEN: "parent_hidden",
} as const;

export const CaliperVisibilityStatusSchema = z.enum([
  CALIPER_VISIBILITY_STATUS.VISIBLE,
  CALIPER_VISIBILITY_STATUS.HIDDEN,
]);

export const CaliperVisibilityReasonSchema = z.enum([
  CALIPER_VISIBILITY_REASON.DISPLAY_NONE,
  CALIPER_VISIBILITY_REASON.NOT_VISIBLE,
  CALIPER_VISIBILITY_REASON.PARENT_HIDDEN,
]);

export const CaliperVisibilityHiddenBySchema = z.object({
  type: z.enum(["css_rule", "css_media_query", "ancestor"]),
  rule: z.string().optional(),
  mediaQuery: z.string().optional(),
  stylesheetUrl: z.string().optional(),
  detail: z.string().optional(),
  ancestorSelector: z.string().optional(),
});

export const CaliperVisibilitySchema = z.object({
  status: CaliperVisibilityStatusSchema,
  reason: CaliperVisibilityReasonSchema.optional(),
  computedDisplay: z.string().optional(),
  computedVisibility: z.string().optional(),
  opacity: z.number().optional(),
  intersectingViewport: z.boolean(),
  hiddenBy: CaliperVisibilityHiddenBySchema.nullable().optional(),
});

export const CaliperAuditContextSchema = z.object({
  viewport: CaliperAuditViewportSchema,
  deviceScaleFactor: z.number(),
  emulated: z.boolean().optional(),
  viewportMismatch: z.boolean().optional(),
});

export const CaliperRuntimeConnectionSchema = z.object({
  runtime: z.enum(["attached", "engine"]),
  measurementRouting: z.enum(["auto", "attached", "engine"]),
  engineHealthUrl: z.string().nullable().optional(),
  activeTabId: z.string().nullable().optional(),
  activeTabUrl: z.string().nullable().optional(),
});

export const CaliperMediaQueryDescriptorSchema = z.object({
  text: z.string(),
  source: z.string().optional(),
});

export const CaliperBreakpointAuditEntrySchema = z.object({
  selector: z.string(),
  viewport: CaliperAuditViewportSchema,
  visibility: CaliperVisibilitySchema,
  geometry: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

export const CaliperBreakpointAuditMatrixSchema = z.object({
  selector: z.string(),
  mediaQueries: z.array(CaliperMediaQueryDescriptorSchema),
  breakpoints: z.array(
    z.object({
      width: z.number(),
      height: z.number(),
      label: z.string().optional(),
    })
  ),
  entries: z.array(CaliperBreakpointAuditEntrySchema),
});

export type CaliperVisibilityStatus = z.infer<typeof CaliperVisibilityStatusSchema>;
export type CaliperVisibilityReason = z.infer<typeof CaliperVisibilityReasonSchema>;
export type CaliperVisibilityHiddenBy = z.infer<typeof CaliperVisibilityHiddenBySchema>;
export type CaliperVisibility = z.infer<typeof CaliperVisibilitySchema>;
export type CaliperAuditContext = z.infer<typeof CaliperAuditContextSchema>;
export type CaliperRuntimeConnection = z.infer<typeof CaliperRuntimeConnectionSchema>;
export type CaliperBreakpointAuditMatrix = z.infer<typeof CaliperBreakpointAuditMatrixSchema>;

export const DEFAULT_AUDIT_VIEWPORT_HEIGHT = 812;

export function createDefaultRuntimeConnection(
  overrides: Partial<CaliperRuntimeConnection> = {}
): CaliperRuntimeConnection {
  return {
    runtime: "attached",
    measurementRouting: "auto",
    engineHealthUrl: null,
    activeTabId: null,
    activeTabUrl: null,
    ...overrides,
  };
}
