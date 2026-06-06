import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENGINE_NAVIGATION_TIMEOUT_DOM_MS,
  DEFAULT_ENGINE_NAVIGATION_TIMEOUT_LOAD_MS,
} from "@oyerinde/caliper-schema";
import {
  cdpEventForWaitUntil,
  EngineNavigationTimeoutError,
  isEngineNavigationTimeoutError,
  resolveNavigationTimeoutMs,
} from "./navigation-timeout.js";

describe("navigation-timeout", () => {
  it("maps waitUntil to CDP events", () => {
    expect(cdpEventForWaitUntil("domcontentloaded")).toBe("Page.domContentEventFired");
    expect(cdpEventForWaitUntil("load")).toBe("Page.loadEventFired");
  });

  it("uses schema defaults when no override is provided", () => {
    expect(resolveNavigationTimeoutMs("domcontentloaded")).toBe(
      DEFAULT_ENGINE_NAVIGATION_TIMEOUT_DOM_MS
    );
    expect(resolveNavigationTimeoutMs("load")).toBe(DEFAULT_ENGINE_NAVIGATION_TIMEOUT_LOAD_MS);
  });

  it("extends Error with structured navigation timeout fields", () => {
    const error = new EngineNavigationTimeoutError({
      url: "https://example.com",
      waitUntil: "load",
      timeoutMs: 90_000,
      elapsedMs: 90_123,
      cdpEvent: "Page.loadEventFired",
      pageId: "page-1",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EngineNavigationTimeoutError);
    expect(error.code).toBe("navigation_timeout");
    expect(error.details).toEqual({
      url: "https://example.com",
      waitUntil: "load",
      timeoutMs: 90_000,
      elapsedMs: 90_123,
      cdpEvent: "Page.loadEventFired",
      pageId: "page-1",
    });
    expect(isEngineNavigationTimeoutError(error)).toBe(true);
    expect(isEngineNavigationTimeoutError(new Error("nope"))).toBe(false);
  });
});
