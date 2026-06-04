import type { CaliperEngineAllowlistedKey } from "@oyerinde/caliper-schema";

/**
 * CDP Input.dispatchKeyEvent sequences aligned with chromedp/kb (keyDown → optional char → keyUp).
 * @see https://github.com/chromedp/chromedp/blob/master/kb/kb.go
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent
 */
export type CdpKeyEventParams = {
  type: "keyDown" | "keyUp" | "char";
  key: string;
  code: string;
  text?: string;
  unmodifiedText?: string;
  windowsVirtualKeyCode?: number;
  nativeVirtualKeyCode?: number;
  modifiers?: number;
};

type KeyDefinition = {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  text?: string;
  unmodifiedText?: string;
};

const ALLOWLISTED_KEY_DEFINITIONS: Record<CaliperEngineAllowlistedKey, KeyDefinition> = {
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Enter: {
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    text: "\r",
    unmodifiedText: "\r",
  },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Space: {
    key: " ",
    code: " ",
    windowsVirtualKeyCode: 32,
    text: " ",
    unmodifiedText: " ",
  },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
};

export function buildKeyEventSequence(
  allowlistedKey: CaliperEngineAllowlistedKey,
  modifiers = 0
): CdpKeyEventParams[] {
  const definition = ALLOWLISTED_KEY_DEFINITIONS[allowlistedKey];
  const base = {
    key: definition.key,
    code: definition.code,
    windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
    nativeVirtualKeyCode: definition.windowsVirtualKeyCode,
    modifiers,
  };

  const keyDown: CdpKeyEventParams = { type: "keyDown", ...base };
  const keyUp: CdpKeyEventParams = { type: "keyUp", ...base };

  if (definition.text !== undefined) {
    const keyChar: CdpKeyEventParams = {
      type: "char",
      ...base,
      text: definition.text,
      unmodifiedText: definition.unmodifiedText ?? definition.text,
      windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
      nativeVirtualKeyCode: definition.windowsVirtualKeyCode,
    };
    return [keyDown, keyChar, keyUp];
  }

  return [keyDown, keyUp];
}
