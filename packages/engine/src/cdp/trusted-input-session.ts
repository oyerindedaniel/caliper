import {
  CALIPER_ENGINE_METHODS,
  type CaliperActionResult,
  type CaliperEngineClickAtPayload,
  type CaliperEnginePressKeyPayload,
} from "@oyerinde/caliper-schema";
import type { CdpSendClient } from "./cdp-page-session.js";
import { buildKeyEventSequence } from "./engine-key-events.js";
import { resolveSelectorClickPoint } from "./dom-resolver.js";
import { PAGE_AUTOMATION_DISABLED_MESSAGE } from "./page-automation.js";
import type { NavigationSession } from "./navigation-session.js";

export type TrustedInputSessionOptions = {
  allowPageAutomation: boolean;
};

type MouseButton = "left" | "right" | "middle";

function mouseButtonsForPress(button: MouseButton): number {
  switch (button) {
    case "left":
      return 1;
    case "right":
      return 2;
    case "middle":
      return 4;
  }
}

export class TrustedInputSession {
  constructor(
    private readonly client: CdpSendClient,
    private readonly navigation: NavigationSession,
    private readonly options: TrustedInputSessionOptions
  ) {}

  async clickAt(payload: CaliperEngineClickAtPayload): Promise<CaliperActionResult> {
    const timestamp = Date.now();

    if (!this.options.allowPageAutomation) {
      return this.automationDisabled(CALIPER_ENGINE_METHODS.CLICK_AT, timestamp);
    }

    const button = payload.button ?? "left";
    const clickCount = payload.clickCount ?? 1;

    let x: number;
    let y: number;
    let selector: string | undefined;

    if (payload.selector !== undefined) {
      selector = payload.selector;
      if (payload.scrollIntoView ?? true) {
        await this.navigation.scrollIntoView(selector);
      }

      const point = await resolveSelectorClickPoint(this.client, selector);
      if (!point) {
        const error = selector.trim().startsWith("{")
          ? "JSON fingerprint targets are not supported for engine CLICK_AT; use a CSS selector or caliper-* agent id"
          : `Element not found for click: ${selector}`;
        return {
          success: false,
          method: CALIPER_ENGINE_METHODS.CLICK_AT,
          error,
          timestamp,
        };
      }

      x = point.x;
      y = point.y;
    } else {
      if (payload.x === undefined || payload.y === undefined) {
        return {
          success: false,
          method: CALIPER_ENGINE_METHODS.CLICK_AT,
          error: "Click coordinates require both x and y",
          timestamp,
        };
      }

      x = payload.x;
      y = payload.y;
    }

    await this.dispatchClick(x, y, button, clickCount);

    return {
      success: true,
      method: CALIPER_ENGINE_METHODS.CLICK_AT,
      x,
      y,
      selector,
      timestamp,
    };
  }

  async pressKey(payload: CaliperEnginePressKeyPayload): Promise<CaliperActionResult> {
    const timestamp = Date.now();

    if (!this.options.allowPageAutomation) {
      return this.automationDisabled(CALIPER_ENGINE_METHODS.PRESS_KEY, timestamp);
    }

    const modifiers = payload.modifiers ?? 0;
    const events = buildKeyEventSequence(payload.key, modifiers);

    for (const event of events) {
      await this.client.send("Input.dispatchKeyEvent", event);
    }

    return {
      success: true,
      method: CALIPER_ENGINE_METHODS.PRESS_KEY,
      key: payload.key,
      timestamp,
    };
  }

  private async dispatchClick(
    x: number,
    y: number,
    button: MouseButton,
    clickCount: number
  ): Promise<void> {
    const buttons = mouseButtonsForPress(button);

    await this.client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      buttons,
      clickCount,
    });

    await this.client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      buttons: 0,
      clickCount,
    });
  }

  private automationDisabled(
    method: typeof CALIPER_ENGINE_METHODS.CLICK_AT | typeof CALIPER_ENGINE_METHODS.PRESS_KEY,
    timestamp: number
  ): CaliperActionResult {
    return {
      success: false,
      method,
      error: PAGE_AUTOMATION_DISABLED_MESSAGE,
      timestamp,
    };
  }
}
