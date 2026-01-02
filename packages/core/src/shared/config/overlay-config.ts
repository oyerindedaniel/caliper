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
  primary: "rgba(24, 160, 251, 1)",
  secondary: "rgba(242, 78, 30, 1)",
  calcBg: "rgba(30, 30, 30, 0.95)",
  calcShadow: "rgba(0, 0, 0, 0.25)",
  calcOpHighlight: "rgba(24, 160, 251, 0.3)",
  calcText: "white",
  text: "white",
};

export const DEFAULT_ANIMATION: Required<AnimationConfig> = {
  enabled: true,
  lerpFactor: 0.25,
};
