/**
 * Calculator configuration and shortcuts.
 * This file defines how users can customize the calculator triggers and appearance.
 */
import { OS } from "../utils/os.js";
import type { CaliperAgentState } from "@oyerinde/caliper-schema";
export type { CaliperAgentState };

export type DeepRequired<T> = {
  [K in keyof T]-?: DeepRequired<T[K]>;
};

export interface ThemeConfig {
  primary?: string;
  secondary?: string;
  calcBg?: string;
  calcShadow?: string;
  calcOpHighlight?: string;
  calcText?: string;
  text?: string;
  projection?: string;
  ruler?: string;
}

/**
 * Keyboard shortcuts for measurement sides.
 */
export interface CalculatorShortcuts {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  distance?: string;
}

/**
 * Keyboard shortcuts for projection directions.
 */
export interface ProjectionShortcuts {
  top?: string;
  left?: string;
  bottom?: string;
  right?: string;
}

export interface CommandsConfig {
  /** Key to activate measuring mode (default: Alt) */
  activate?: string;
  /** Key to freeze current measurement (default: Space) */
  freeze?: string;
  /** Key to select an element - must be held + click (default: Control) */
  select?: string;
  /** Key to clear current selection (default: Escape) */
  clear?: string;
  /** Custom keys to trigger calculator for specific sides (default: t, r, b, l) */
  calculator?: CalculatorShortcuts;
  /** Custom keys to trigger projection for specific directions (default: w, a, s, d) */
  projection?: ProjectionShortcuts;
  /** Key to trigger ruler lines - must be Shift + this key (default: r) */
  ruler?: string;
  /** Duration in ms to hold the select key to trigger selection (default: 250) */
  selectionHoldDuration?: number;
}

export interface AnimationConfig {
  /** Enable smooth lerp animation for boundary box hover (default: true) */
  enabled?: boolean;
  /** Lerp factor for animation smoothness (0-1, lower = smoother, default: 0.25) */
  lerpFactor?: number;
}

export interface AgentBridgeConfig {
  /** Enable the agentic bridge for AI integration (default: false) */
  enabled?: boolean;
  /** WebSocket port for the MCP relay (default: 9876) */
  wsPort?: number;
  /** Callback for agent state changes */
  onStateChange?: (state: CaliperAgentState) => void;
}

export interface OverlayConfig {
  /** Customize the visual appearance of the overlay (colors, shadows). */
  theme?: ThemeConfig;
  /** Customize keyboard shortcuts for all interactions. */
  commands?: CommandsConfig;
  /** Control the boundary box lerp animation behavior. */
  animation?: AnimationConfig;
  /** Configure the Agent Bridge for AI/MCP integration. */
  bridge?: AgentBridgeConfig;
  /** Enable debug logging (default: true). All logs are stripped from production builds. */
  debug?: boolean;
}

export const DEFAULT_COMMANDS: DeepRequired<CommandsConfig> = {
  activate: "Alt",
  freeze: " ",
  select: OS.getControlKey(),
  clear: "Escape",
  calculator: {
    top: "t",
    right: "r",
    bottom: "b",
    left: "l",
    distance: "g",
  },
  projection: {
    top: "w",
    left: "a",
    bottom: "s",
    right: "d",
  },
  ruler: "r",
  selectionHoldDuration: 250,
};

export const DEFAULT_THEME: DeepRequired<ThemeConfig> = {
  primary: "rgba(24, 160, 251, 1)",
  secondary: "rgba(242, 78, 30, 1)",
  calcBg: "rgba(30, 30, 30, 0.95)",
  calcShadow: "rgba(0, 0, 0, 0.25)",
  calcOpHighlight: "rgba(24, 160, 251, 0.3)",
  calcText: "rgba(255, 255, 255, 1)",
  text: "rgba(255, 255, 255, 1)",
  projection: "rgba(155, 81, 224, 1)",
  ruler: "rgba(24, 160, 251, 1)",
};

export const DEFAULT_ANIMATION: DeepRequired<AnimationConfig> = {
  enabled: true,
  lerpFactor: 0.25,
};
