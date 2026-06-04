import { describe, expect, it, vi } from "vitest";
import {
  CALIPER_ENGINE_METHODS,
  CaliperEngineAllowlistedKeySchema,
  CaliperEngineClickAtPayloadSchema,
  CaliperEnginePressKeyPayloadSchema,
  isCaliperActionResultMethod,
} from "@oyerinde/caliper-schema";
import type { CdpClient } from "./cdp-client.js";
import type { DomGetBoxModelResponse } from "./cdp-protocol.js";
import { PAGE_AUTOMATION_DISABLED_MESSAGE } from "./page-automation.js";
import type { NavigationSession } from "./navigation-session.js";
import { TrustedInputSession } from "./trusted-input-session.js";
import { boxContentQuadCenter } from "./dom-resolver.js";

function createInputMock() {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });

    if (method === "DOM.enable" || method === "DOM.getDocument") {
      return method === "DOM.getDocument" ? { root: { nodeId: 1, nodeName: "HTML" } } : {};
    }

    if (method === "DOM.querySelector") {
      return { nodeId: 42 };
    }

    if (method === "DOM.getBoxModel") {
      return {
        model: {
          content: [100, 200, 120, 200, 120, 240, 100, 240],
          padding: [],
          border: [],
          margin: [],
          width: 20,
          height: 40,
        },
      } satisfies DomGetBoxModelResponse;
    }

    return {};
  });

  const client = { send } as unknown as CdpClient;
  const navigation = {
    scrollIntoView: vi.fn(async () => ({ scrollX: 0, scrollY: 100 })),
  } as unknown as NavigationSession;

  return { client, navigation, send, calls };
}

function createSession(
  client: CdpClient,
  navigation: NavigationSession,
  allowPageAutomation: boolean
) {
  return new TrustedInputSession(client, navigation, { allowPageAutomation });
}

function assertClickSuccess(
  result: Awaited<ReturnType<TrustedInputSession["clickAt"]>>
): asserts result is Extract<
  Awaited<ReturnType<TrustedInputSession["clickAt"]>>,
  { success: true; method: typeof CALIPER_ENGINE_METHODS.CLICK_AT }
> {
  if (!isCaliperActionResultMethod(result, CALIPER_ENGINE_METHODS.CLICK_AT) || !result.success) {
    throw new Error("expected CLICK_AT success");
  }
}

function assertPressKeySuccess(
  result: Awaited<ReturnType<TrustedInputSession["pressKey"]>>
): asserts result is Extract<
  Awaited<ReturnType<TrustedInputSession["pressKey"]>>,
  { success: true; method: typeof CALIPER_ENGINE_METHODS.PRESS_KEY }
> {
  if (!isCaliperActionResultMethod(result, CALIPER_ENGINE_METHODS.PRESS_KEY) || !result.success) {
    throw new Error("expected PRESS_KEY success");
  }
}

describe("boxContentQuadCenter", () => {
  it("returns center of a content quad", () => {
    expect(boxContentQuadCenter([100, 200, 120, 200, 120, 240, 100, 240])).toEqual({
      x: 110,
      y: 220,
    });
  });
});

describe("TrustedInputSession.clickAt", () => {
  it("rejects when page automation is disabled", async () => {
    const { client, navigation, send } = createInputMock();
    const session = createSession(client, navigation, false);

    const result = await session.clickAt({ x: 10, y: 20 });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error).toBe(PAGE_AUTOMATION_DISABLED_MESSAGE);
    expect(send).not.toHaveBeenCalled();
  });

  it("dispatches mouse press and release at coordinates", async () => {
    const { client, navigation, calls } = createInputMock();
    const session = createSession(client, navigation, true);

    const result = await session.clickAt({ x: 50, y: 60, clickCount: 2 });

    assertClickSuccess(result);
    expect(result.x).toBe(50);
    expect(result.y).toBe(60);

    const mouseEvents = calls.filter((call) => call.method === "Input.dispatchMouseEvent");
    expect(mouseEvents).toHaveLength(2);
    expect(mouseEvents[0]?.params).toMatchObject({
      type: "mousePressed",
      x: 50,
      y: 60,
      button: "left",
      buttons: 1,
      clickCount: 2,
    });
    expect(mouseEvents[1]?.params).toMatchObject({
      type: "mouseReleased",
      x: 50,
      y: 60,
      buttons: 0,
      clickCount: 2,
    });
  });

  it("scrolls into view and clicks selector center from box model", async () => {
    const { client, navigation, calls } = createInputMock();
    const session = createSession(client, navigation, true);

    const result = await session.clickAt({ selector: "#submit" });

    assertClickSuccess(result);
    expect(result.selector).toBe("#submit");
    expect(result.x).toBe(110);
    expect(result.y).toBe(220);
    expect(navigation.scrollIntoView).toHaveBeenCalledWith("#submit");

    const mouseEvents = calls.filter((call) => call.method === "Input.dispatchMouseEvent");
    expect(mouseEvents[0]?.params).toMatchObject({ x: 110, y: 220 });
  });

  it("fails when selector is not found", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "DOM.enable" || method === "DOM.getDocument") {
        return method === "DOM.getDocument" ? { root: { nodeId: 1, nodeName: "HTML" } } : {};
      }
      if (method === "DOM.querySelector") {
        return { nodeId: 0 };
      }
      return {};
    });
    const client = { send } as unknown as CdpClient;
    const navigation = { scrollIntoView: vi.fn() } as unknown as NavigationSession;
    const session = createSession(client, navigation, true);

    const result = await session.clickAt({ selector: "#missing" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("#missing");
    }
  });
});

describe("TrustedInputSession.pressKey", () => {
  it("rejects when page automation is disabled", async () => {
    const { client, navigation, send } = createInputMock();
    const session = createSession(client, navigation, false);

    const result = await session.pressKey({ key: "Escape" });

    expect(result.success).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("dispatches keyDown char keyUp for Enter", async () => {
    const { client, navigation, calls } = createInputMock();
    const session = createSession(client, navigation, true);

    const result = await session.pressKey({ key: "Enter" });

    assertPressKeySuccess(result);
    expect(result.key).toBe("Enter");

    const keyEvents = calls.filter((call) => call.method === "Input.dispatchKeyEvent");
    expect(keyEvents.map((call) => call.params?.type)).toEqual(["keyDown", "char", "keyUp"]);
  });

  it("dispatches keyDown keyUp for Escape", async () => {
    const { client, navigation, calls } = createInputMock();
    const session = createSession(client, navigation, true);

    await session.pressKey({ key: "Escape" });

    const keyEvents = calls.filter((call) => call.method === "Input.dispatchKeyEvent");
    expect(keyEvents.map((call) => call.params?.type)).toEqual(["keyDown", "keyUp"]);
  });
});

describe("engine input payload schemas", () => {
  it("accepts selector or coordinate click payloads", () => {
    expect(CaliperEngineClickAtPayloadSchema.safeParse({ selector: "#a" }).success).toBe(true);
    expect(CaliperEngineClickAtPayloadSchema.safeParse({ x: 1, y: 2 }).success).toBe(true);
    expect(
      CaliperEngineClickAtPayloadSchema.safeParse({ selector: "#a", x: 1, y: 2 }).success
    ).toBe(false);
  });

  it("rejects unknown keys at schema boundary", () => {
    expect(CaliperEnginePressKeyPayloadSchema.safeParse({ key: "KeyA" }).success).toBe(false);
    expect(CaliperEngineAllowlistedKeySchema.safeParse("Escape").success).toBe(true);
  });
});
