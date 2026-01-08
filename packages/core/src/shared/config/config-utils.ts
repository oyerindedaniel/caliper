import type {
  OverlayConfig,
  ThemeConfig,
  AnimationConfig,
  CommandsConfig,
  DeepRequired
} from "./overlay-config.js";
import { DEFAULT_COMMANDS, DEFAULT_ANIMATION } from "./overlay-config.js";

export function applyTheme(theme?: ThemeConfig) {
  if (!theme) return;

  const root = document.documentElement;

  if (theme.primary) root.style.setProperty("--caliper-primary", theme.primary);
  if (theme.secondary)
    root.style.setProperty("--caliper-secondary", theme.secondary);
  if (theme.calcBg) root.style.setProperty("--caliper-calc-bg", theme.calcBg);
  if (theme.calcShadow)
    root.style.setProperty("--caliper-calc-shadow", theme.calcShadow);
  if (theme.calcOpHighlight)
    root.style.setProperty(
      "--caliper-calc-op-highlight",
      theme.calcOpHighlight
    );
  if (theme.calcText)
    root.style.setProperty("--caliper-calc-text", theme.calcText);
  if (theme.text) root.style.setProperty("--caliper-text", theme.text);
  if (theme.projection)
    root.style.setProperty("--caliper-projection", theme.projection);
  if (theme.ruler)
    root.style.setProperty("--caliper-ruler", theme.ruler);
}

export function mergeCommands(
  userCommands?: CommandsConfig
): DeepRequired<CommandsConfig> {
  return {
    activate: userCommands?.activate ?? DEFAULT_COMMANDS.activate,
    freeze: userCommands?.freeze ?? DEFAULT_COMMANDS.freeze,
    select: userCommands?.select ?? DEFAULT_COMMANDS.select,
    clear: userCommands?.clear ?? DEFAULT_COMMANDS.clear,
    calculator: {
      top: userCommands?.calculator?.top ?? DEFAULT_COMMANDS.calculator.top,
      right: userCommands?.calculator?.right ?? DEFAULT_COMMANDS.calculator.right,
      bottom:
        userCommands?.calculator?.bottom ?? DEFAULT_COMMANDS.calculator.bottom,
      left: userCommands?.calculator?.left ?? DEFAULT_COMMANDS.calculator.left,
      distance: userCommands?.calculator?.distance ?? DEFAULT_COMMANDS.calculator.distance,
    },
    projection: {
      top: userCommands?.projection?.top ?? DEFAULT_COMMANDS.projection.top,
      left: userCommands?.projection?.left ?? DEFAULT_COMMANDS.projection.left,
      bottom:
        userCommands?.projection?.bottom ?? DEFAULT_COMMANDS.projection.bottom,
      right: userCommands?.projection?.right ?? DEFAULT_COMMANDS.projection.right,
    },
    ruler: userCommands?.ruler ?? DEFAULT_COMMANDS.ruler,
  };
}

export function mergeAnimation(
  userAnimation?: AnimationConfig
): DeepRequired<AnimationConfig> {
  return {
    enabled: userAnimation?.enabled ?? DEFAULT_ANIMATION.enabled,
    lerpFactor: userAnimation?.lerpFactor ?? DEFAULT_ANIMATION.lerpFactor,
  };
}

declare global {
  interface Window {
    __CALIPER_CONFIG__?: OverlayConfig;
  }
}

export function getConfig(): OverlayConfig {
  if (typeof window !== "undefined") {
    const windowConfig = window.__CALIPER_CONFIG__ ?? {};

    const currentScript = document.currentScript as HTMLScriptElement;
    const dataConfig = currentScript?.getAttribute("data-config") ||
      document.querySelector("script[data-config]")?.getAttribute("data-config");

    if (dataConfig) {
      try {
        const parsed = JSON.parse(dataConfig);
        return {
          ...windowConfig,
          ...parsed,
          theme: { ...windowConfig.theme, ...parsed.theme },
          commands: { ...windowConfig.commands, ...parsed.commands },
          animation: { ...windowConfig.animation, ...parsed.animation },
        };
      } catch (e) {
        console.warn("[CALIPER] Failed to parse data-config attribute", e);
      }
    }

    return windowConfig;
  }
  return {};
}

/**
 * Sets the global Caliper configuration.
 * This is a typed wrapper around window.__CALIPER_CONFIG__.
 *
 * @param config - The configuration object to set
 *
 * @example
 * ```ts
 * import { setConfig } from "@caliper/core";
 *
 * setConfig({
 *   theme: { primary: "#ff0000" },
 *   commands: { activate: "Alt" }
 * });
 * ```
 */
export function setConfig(config: OverlayConfig): void {
  if (typeof window !== "undefined") {
    window.__CALIPER_CONFIG__ = config;
  }
}
