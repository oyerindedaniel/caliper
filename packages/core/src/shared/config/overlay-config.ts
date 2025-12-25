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
  activate?: string;
  freeze?: string;
  select?: string;
}

export interface OverlayConfig {
  theme?: ThemeConfig;
  commands?: CommandsConfig;
}

export const DEFAULT_COMMANDS: Required<CommandsConfig> = {
  activate: "Alt",
  freeze: " ",
  select: "Control",
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

