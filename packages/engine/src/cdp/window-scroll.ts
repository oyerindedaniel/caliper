import type { CdpClient } from "./cdp-client.js";
import type { RuntimeEvaluateResponse } from "./cdp-protocol.js";

export type WindowScrollPosition = {
  scrollX: number;
  scrollY: number;
};

export async function readWindowScrollPosition(
  client: CdpClient,
  options: { onMissing?: "zero" | "throw" } = {}
): Promise<WindowScrollPosition> {
  const onMissing = options.onMissing ?? "throw";
  const evaluation = await client.send<RuntimeEvaluateResponse>("Runtime.evaluate", {
    expression: `({ scrollX: window.scrollX, scrollY: window.scrollY })`,
    returnByValue: true,
  });

  const position = evaluation.result?.value;
  if (!position || typeof position !== "object") {
    if (onMissing === "zero") {
      return { scrollX: 0, scrollY: 0 };
    }
    throw new Error("Failed to read scroll position");
  }

  const value = position as Record<string, unknown>;
  return {
    scrollX: typeof value.scrollX === "number" ? value.scrollX : 0,
    scrollY: typeof value.scrollY === "number" ? value.scrollY : 0,
  };
}
