import type {
  OverlayConfig,
  ThemeConfig,
  CommandsConfig,
} from "./overlay-config.js";
import { DEFAULT_COMMANDS } from "./overlay-config.js";

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
}

export function mergeCommands(
  userCommands?: CommandsConfig
): Required<CommandsConfig> {
  return {
    activate: userCommands?.activate ?? DEFAULT_COMMANDS.activate,
    freeze: userCommands?.freeze ?? DEFAULT_COMMANDS.freeze,
    select: userCommands?.select ?? DEFAULT_COMMANDS.select,
  };
}

declare global {
  interface Window {
    __CALIPER_CONFIG__?: OverlayConfig;
  }
}

export function getConfig(): OverlayConfig {
  if (typeof window !== "undefined") {
    return window.__CALIPER_CONFIG__ ?? {};
  }
  return {};
}
