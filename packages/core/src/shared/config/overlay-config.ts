export interface ThemeConfig {
  primary?: string;
  secondary?: string;
  calcBg?: string;
  calcShadow?: string;
  calcOpHighlight?: string;
  calcText?: string;
  text?: string;
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
}

export interface AnimationConfig {
  /** Enable smooth lerp animation for boundary box hover (default: true) */
  enabled?: boolean;
  /** Lerp factor for animation smoothness (0-1, lower = smoother, default: 0.25) */
  lerpFactor?: number;
}

export interface OverlayConfig {
  theme?: ThemeConfig;
  commands?: CommandsConfig;
  animation?: AnimationConfig;
}

export const DEFAULT_COMMANDS: Required<CommandsConfig> = {
  activate: "Alt",
  freeze: " ",
  select: "Control",
  clear: "Escape",
};

export const DEFAULT_THEME: Required<ThemeConfig> = {
  primary: "#3b82f6",
  secondary: "#10b981",
  calcBg: "rgba(59, 130, 246, 0.95)",
  calcShadow: "rgba(0, 0, 0, 0.2)",
  calcOpHighlight: "rgba(255, 255, 255, 0.3)",
  calcText: "white",
  text: "white",
};

export const DEFAULT_ANIMATION: Required<AnimationConfig> = {
  enabled: true,
  lerpFactor: 0.25,
};
