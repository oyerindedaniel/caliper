import type { CdpClient } from "./cdp-client.js";
import type { RuntimeEvaluateResponse } from "./cdp-protocol.js";
import { resolveSelectorToNodeId } from "./dom-resolver.js";
import { readWindowScrollPosition } from "./window-scroll.js";

export class NavigationSession {
  constructor(private readonly client: CdpClient) {}

  async scrollTo(
    scrollX?: number,
    scrollY?: number
  ): Promise<{ scrollX: number; scrollY: number }> {
    const targetScrollX =
      scrollX === undefined
        ? "window.scrollX"
        : Number.isFinite(scrollX)
          ? String(scrollX)
          : "window.scrollX";
    const targetScrollY =
      scrollY === undefined
        ? "window.scrollY"
        : Number.isFinite(scrollY)
          ? String(scrollY)
          : "window.scrollY";

    const evaluation = await this.client.send<RuntimeEvaluateResponse>("Runtime.evaluate", {
      expression: `(window.scrollTo(${targetScrollX}, ${targetScrollY}), { scrollX: window.scrollX, scrollY: window.scrollY })`,
      returnByValue: true,
    });

    const position = evaluation.result?.value;
    if (!position || typeof position !== "object") {
      throw new Error("Failed to read scroll position after scroll");
    }

    const value = position as Record<string, unknown>;
    return {
      scrollX: typeof value.scrollX === "number" ? value.scrollX : 0,
      scrollY: typeof value.scrollY === "number" ? value.scrollY : 0,
    };
  }

  async scrollIntoView(selector: string): Promise<{ scrollX: number; scrollY: number }> {
    const nodeId = await resolveSelectorToNodeId(this.client, selector);
    if (!nodeId) {
      throw new Error(`Element not found for scroll into view: ${selector}`);
    }

    await this.client.send("DOM.scrollIntoViewIfNeeded", { nodeId });
    return readWindowScrollPosition(this.client);
  }
}
