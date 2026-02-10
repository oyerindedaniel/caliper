import type {
  OverlayConfig,
  ThemeConfig,
  AnimationConfig,
  CommandsConfig,
  DeepRequired,
} from "./overlay-config.js";
import { DEFAULT_COMMANDS, DEFAULT_ANIMATION, DEFAULT_THEME } from "./overlay-config.js";

function parseNumber(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null || value === "") return defaultValue;
  const num = Number(value);
  return isFinite(num) && !isNaN(num) ? num : defaultValue;
}

/**
 * Helper to inject opacity into both Hex and RGBA colors
 */
function withOpacity(color: string, opacity: number): string {
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3)
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  if (color.startsWith("rgba")) {
    return color.replace(/[\d.]+\)$/g, `${opacity})`);
  }
  if (color.startsWith("rgb")) {
    return color.replace(")", `, ${opacity})`).replace("rgb", "rgba");
  }
  return color;
}

/**
 * Applies a Caliper theme to an HTML element by setting CSS variables.
 * 
 * This is used internally to inject the custom theme into the Shadow DOM root 
 * or can be used manually to sync theme variables with a host application.
 *
 * @param theme - The theme configuration object.
 * @param target - The element to apply styles to. Defaults to documentElement.
 */
export function applyTheme(theme?: ThemeConfig, target: HTMLElement = document.documentElement) {
  if (!theme || !target) return;

  const root = target;

  if (theme.primary) {
    root.style.setProperty("--caliper-primary", theme.primary);
    root.style.setProperty("--caliper-primary-90", withOpacity(theme.primary, 0.9));
    root.style.setProperty("--caliper-primary-95", withOpacity(theme.primary, 0.95));
    root.style.setProperty("--caliper-primary-50", withOpacity(theme.primary, 0.5));
    root.style.setProperty("--caliper-primary-05", withOpacity(theme.primary, 0.05));
  }
  if (theme.secondary) {
    root.style.setProperty("--caliper-secondary", theme.secondary);
    root.style.setProperty("--caliper-secondary-50", withOpacity(theme.secondary, 0.5));
    root.style.setProperty("--caliper-secondary-05", withOpacity(theme.secondary, 0.05));
  }
  if (theme.calcBg) root.style.setProperty("--caliper-calc-bg", theme.calcBg);
  if (theme.calcShadow) root.style.setProperty("--caliper-calc-shadow", theme.calcShadow);
  if (theme.calcOpHighlight)
    root.style.setProperty("--caliper-calc-op-highlight", theme.calcOpHighlight);
  if (theme.calcText) root.style.setProperty("--caliper-calc-text", theme.calcText);
  if (theme.text) root.style.setProperty("--caliper-text", theme.text);
  if (theme.projection) {
    root.style.setProperty("--caliper-projection", theme.projection);
    root.style.setProperty("--caliper-projection-90", withOpacity(theme.projection, 0.9));
    root.style.setProperty("--caliper-projection-light", withOpacity(theme.projection, 0.2));
  }
  if (theme.ruler) root.style.setProperty("--caliper-ruler", theme.ruler);
}

export function mergeCommands(userCommands?: CommandsConfig): DeepRequired<CommandsConfig> {
  return {
    activate: userCommands?.activate ?? DEFAULT_COMMANDS.activate,
    freeze: userCommands?.freeze ?? DEFAULT_COMMANDS.freeze,
    select: userCommands?.select ?? DEFAULT_COMMANDS.select,
    clear: userCommands?.clear ?? DEFAULT_COMMANDS.clear,
    calculator: {
      top: userCommands?.calculator?.top ?? DEFAULT_COMMANDS.calculator.top,
      right: userCommands?.calculator?.right ?? DEFAULT_COMMANDS.calculator.right,
      bottom: userCommands?.calculator?.bottom ?? DEFAULT_COMMANDS.calculator.bottom,
      left: userCommands?.calculator?.left ?? DEFAULT_COMMANDS.calculator.left,
      distance: userCommands?.calculator?.distance ?? DEFAULT_COMMANDS.calculator.distance,
    },
    projection: {
      top: userCommands?.projection?.top ?? DEFAULT_COMMANDS.projection.top,
      left: userCommands?.projection?.left ?? DEFAULT_COMMANDS.projection.left,
      bottom: userCommands?.projection?.bottom ?? DEFAULT_COMMANDS.projection.bottom,
      right: userCommands?.projection?.right ?? DEFAULT_COMMANDS.projection.right,
    },
    ruler: userCommands?.ruler ?? DEFAULT_COMMANDS.ruler,
    selectionHoldDuration: parseNumber(
      userCommands?.selectionHoldDuration,
      DEFAULT_COMMANDS.selectionHoldDuration
    ),
  };
}

export function mergeAnimation(userAnimation?: AnimationConfig): DeepRequired<AnimationConfig> {
  return {
    enabled: userAnimation?.enabled ?? DEFAULT_ANIMATION.enabled,
    lerpFactor: parseNumber(userAnimation?.lerpFactor, DEFAULT_ANIMATION.lerpFactor),
  };
}

export function mergeTheme(userTheme?: ThemeConfig): DeepRequired<ThemeConfig> {
  return {
    primary: userTheme?.primary ?? DEFAULT_THEME.primary,
    secondary: userTheme?.secondary ?? DEFAULT_THEME.secondary,
    calcBg: userTheme?.calcBg ?? DEFAULT_THEME.calcBg,
    calcShadow: userTheme?.calcShadow ?? DEFAULT_THEME.calcShadow,
    calcOpHighlight: userTheme?.calcOpHighlight ?? DEFAULT_THEME.calcOpHighlight,
    calcText: userTheme?.calcText ?? DEFAULT_THEME.calcText,
    text: userTheme?.text ?? DEFAULT_THEME.text,
    projection: userTheme?.projection ?? DEFAULT_THEME.projection,
    ruler: userTheme?.ruler ?? DEFAULT_THEME.ruler,
  };
}

declare global {
  interface Window {
    __CALIPER_CONFIG__?: OverlayConfig;
  }
}

/**
 * Retrieves the current Caliper configuration from the environment.
 * 
 * It resolves configuration in the following priority:
 * 1. Global window object (`window.__CALIPER_CONFIG__`)
 * 2. `data-config` attribute on the script tag (useful for UMD/CDN usage)
 *
 * @returns The resolved OverlayConfig object.
 */
export function getConfig(): OverlayConfig {
  if (typeof window !== "undefined") {
    const windowConfig = window.__CALIPER_CONFIG__ ?? {};

    const currentScript =
      typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement) : null;
    const dataConfig =
      currentScript?.getAttribute("data-config") ||
      (typeof document !== "undefined"
        ? document.querySelector("script[data-config]")?.getAttribute("data-config")
        : null);

    if (dataConfig) {
      try {
        const parsed = JSON.parse(dataConfig) as OverlayConfig;
        return {
          ...windowConfig,
          ...parsed,
          theme: { ...windowConfig.theme, ...parsed.theme },
          commands: { ...windowConfig.commands, ...parsed.commands },
          animation: { ...windowConfig.animation, ...parsed.animation },
          bridge: { ...windowConfig.bridge, ...parsed.bridge },
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
