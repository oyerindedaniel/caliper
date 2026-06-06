import { z } from "zod";
import {
  CaliperEngineDefaultViewportSchema,
  CaliperEnginePageSummarySchema,
} from "./engine-pages.js";

export const CALIPER_RUNTIME_MODES = {
  ATTACHED: "attached",
  ENGINE: "engine",
} as const;

export const CALIPER_MEASUREMENT_ROUTING = {
  AUTO: "auto",
  ATTACHED: "attached",
  ENGINE: "engine",
} as const;

export const CaliperMeasurementRoutingSchema = z.enum([
  CALIPER_MEASUREMENT_ROUTING.AUTO,
  CALIPER_MEASUREMENT_ROUTING.ATTACHED,
  CALIPER_MEASUREMENT_ROUTING.ENGINE,
]);

export type CaliperMeasurementRouting = z.infer<typeof CaliperMeasurementRoutingSchema>;

export const CaliperRuntimeModeSchema = z.enum([
  CALIPER_RUNTIME_MODES.ATTACHED,
  CALIPER_RUNTIME_MODES.ENGINE,
]);

export type CaliperRuntimeMode = z.infer<typeof CaliperRuntimeModeSchema>;

export const DEFAULT_ENGINE_HOST = "127.0.0.1";
export const DEFAULT_ENGINE_PORT = 9877;
export const DEFAULT_ENGINE_URL = `http://${DEFAULT_ENGINE_HOST}:${DEFAULT_ENGINE_PORT}`;

export function isLoopbackHost(hostname: string): boolean {
  return hostname === DEFAULT_ENGINE_HOST || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

export function buildEngineHttpUrl(
  host: string,
  port: number,
  path: string = ""
): string {
  const normalizedPath = path.startsWith("/") ? path : path ? `/${path}` : "";
  return `http://${host}:${port}${normalizedPath}`;
}

export { buildEngineStateSseUrl, CALIPER_ENGINE_STATE_SSE_PATH } from "./engine-sse.js";

export const EngineHealthSchema = z.object({
  ok: z.literal(true),
  runtime: z.literal(CALIPER_RUNTIME_MODES.ENGINE),
  version: z.string(),
  sessionId: z.string(),
  activeUrl: z.string().nullable(),
  activePageId: z.string().nullable(),
  pages: z.array(CaliperEnginePageSummarySchema),
  defaultViewport: CaliperEngineDefaultViewportSchema,
  chromeConnected: z.boolean(),
  allowScriptEval: z.boolean(),
  startedAt: z.number(),
});

export type EngineHealth = z.infer<typeof EngineHealthSchema>;

export type EngineSessionState = Pick<
  EngineHealth,
  "sessionId" | "activeUrl" | "activePageId" | "pages" | "chromeConnected" | "startedAt"
>;

export const CaliperConnectionTargetSchema = z.discriminatedUnion("runtime", [
  z.object({
    runtime: z.literal(CALIPER_RUNTIME_MODES.ATTACHED),
    tabId: z.string(),
  }),
  z.object({
    runtime: z.literal(CALIPER_RUNTIME_MODES.ENGINE),
    sessionId: z.string(),
    activeUrl: z.string().nullable(),
    activePageId: z.string().nullable(),
  }),
]);

export type CaliperConnectionTarget = z.infer<typeof CaliperConnectionTargetSchema>;
