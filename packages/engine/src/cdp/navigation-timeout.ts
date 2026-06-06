import {
  CALIPER_ENGINE_NAVIGATION_TIMEOUT_CODE,
  type CaliperEnginePageWaitUntil,
} from "@oyerinde/caliper-schema";
import { readEngineNavigationTimeoutMs } from "./engine-viewport-config.js";

export type EngineNavigationTimeoutDetails = {
  url: string;
  waitUntil: CaliperEnginePageWaitUntil;
  timeoutMs: number;
  elapsedMs: number;
  cdpEvent: string;
  pageId?: string;
};

export class EngineNavigationTimeoutError extends Error {
  readonly code = CALIPER_ENGINE_NAVIGATION_TIMEOUT_CODE;
  readonly details: EngineNavigationTimeoutDetails;

  constructor(details: EngineNavigationTimeoutDetails) {
    super(
      `Navigation timed out after ${details.elapsedMs}ms waiting for ${details.cdpEvent} (${details.waitUntil}) at ${details.url}`
    );
    this.name = "EngineNavigationTimeoutError";
    this.details = details;
  }
}

export function isEngineNavigationTimeoutError(
  error: unknown
): error is EngineNavigationTimeoutError {
  return error instanceof EngineNavigationTimeoutError;
}

export function resolveNavigationTimeoutMs(
  waitUntil: CaliperEnginePageWaitUntil,
  overrideMs?: number
): number {
  if (overrideMs !== undefined) {
    return overrideMs;
  }
  return readEngineNavigationTimeoutMs(waitUntil);
}

export function cdpEventForWaitUntil(waitUntil: CaliperEnginePageWaitUntil): string {
  return waitUntil === "load" ? "Page.loadEventFired" : "Page.domContentEventFired";
}
