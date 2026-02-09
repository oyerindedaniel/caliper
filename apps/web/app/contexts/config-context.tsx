"use client";

import { createContext, useContext, useState, ReactNode, useLayoutEffect } from "react";
import { type OverlayConfig, type OverlayInstance } from "@oyerinde/caliper";
import { DEFAULT_COMMANDS, DEFAULT_THEME as CORE_THEME } from "@caliper/core";
import { STORAGE_KEY } from "@/app/constants";

declare global {
  interface Window {
    __CALIPER__?: OverlayInstance;
  }
}

export interface CommandConfig {
  activate: string;
  freeze: string;
  select: string;
  clear: string;
  ruler: string;
  calcTop: string;
  calcRight: string;
  calcBottom: string;
  calcLeft: string;
  calcDist: string;
  projTop: string;
  projRight: string;
  projBottom: string;
  projLeft: string;
}

const INITIAL_COMMANDS: CommandConfig = {
  activate: DEFAULT_COMMANDS.activate,
  freeze: DEFAULT_COMMANDS.freeze,
  select: DEFAULT_COMMANDS.select,
  clear: DEFAULT_COMMANDS.clear,
  ruler: DEFAULT_COMMANDS.ruler,
  calcTop: DEFAULT_COMMANDS.calculator.top,
  calcRight: DEFAULT_COMMANDS.calculator.right,
  calcBottom: DEFAULT_COMMANDS.calculator.bottom,
  calcLeft: DEFAULT_COMMANDS.calculator.left,
  calcDist: DEFAULT_COMMANDS.calculator.distance,
  projTop: DEFAULT_COMMANDS.projection.top,
  projRight: DEFAULT_COMMANDS.projection.right,
  projBottom: DEFAULT_COMMANDS.projection.bottom,
  projLeft: DEFAULT_COMMANDS.projection.left,
};

export interface ThemeConfig {
  primary: string;
  secondary: string;
  calcBg: string;
  calcShadow: string;
  calcOpHighlight: string;
  calcText: string;
  text: string;
  projection: string;
  ruler: string;
}

const INITIAL_THEME: ThemeConfig = {
  primary: CORE_THEME.primary,
  secondary: CORE_THEME.secondary,
  calcBg: CORE_THEME.calcBg,
  calcShadow: CORE_THEME.calcShadow,
  calcOpHighlight: CORE_THEME.calcOpHighlight,
  calcText: CORE_THEME.calcText,
  text: CORE_THEME.text,
  projection: CORE_THEME.projection,
  ruler: CORE_THEME.ruler,
};

interface AppConfig {
  commands: CommandConfig;
  theme: ThemeConfig;
}

const INITIAL_CONFIG: AppConfig = {
  commands: INITIAL_COMMANDS,
  theme: INITIAL_THEME,
};

interface ConfigContextType {
  commands: CommandConfig;
  theme: ThemeConfig;
  updateCommand: (key: keyof CommandConfig, value: string) => void;
  updateTheme: (key: keyof ThemeConfig, value: string) => void;
  applyConfig: () => void;
  resetConfig: () => void;
  getCaliperConfig: () => OverlayConfig;
}

const ConfigContext = createContext<ConfigContextType | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<AppConfig>(INITIAL_CONFIG);
  const [appliedConfig, setAppliedConfig] = useState<AppConfig>(INITIAL_CONFIG);

  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const hydrated = {
          commands: { ...INITIAL_COMMANDS, ...(parsed.commands || {}) },
          theme: { ...INITIAL_THEME, ...(parsed.theme || {}) },
        };
        setConfigState(hydrated);
        setAppliedConfig(hydrated);
      }
    } catch (e) {
      console.error("Failed to load config", e);
    }
  }, []);

  const updateCommand = (key: keyof CommandConfig, value: string) => {
    setConfigState((prev) => ({
      ...prev,
      commands: { ...prev.commands, [key]: value },
    }));
  };

  const updateTheme = (key: keyof ThemeConfig, value: string) => {
    setConfigState((prev) => ({
      ...prev,
      theme: { ...prev.theme, [key]: value },
    }));
  };

  const syncCaliper = (theme: ThemeConfig) => {
    const caliper = window.__CALIPER__;
    if (caliper) {
      caliper.dispose();
      caliper.mount();

      if (theme.primary && theme.secondary) {
        document.documentElement.style.setProperty("--caliper-primary", theme.primary);
        document.documentElement.style.setProperty("--caliper-secondary", theme.secondary);
        document.documentElement.style.setProperty("--caliper-projection", theme.projection);
      }
    }
  };

  const applyConfig = () => {
    setAppliedConfig(config);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      syncCaliper(config.theme);
    }
  };

  const resetConfig = () => {
    const reset = INITIAL_CONFIG;
    setConfigState(reset);
    setAppliedConfig(reset);
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
      syncCaliper(reset.theme);
    }
  };

  const getCaliperConfig = (): OverlayConfig => ({
    theme: appliedConfig.theme,
    commands: {
      activate: appliedConfig.commands.activate,
      freeze: appliedConfig.commands.freeze,
      select: appliedConfig.commands.select,
      clear: appliedConfig.commands.clear,
      ruler: appliedConfig.commands.ruler,
      calculator: {
        top: appliedConfig.commands.calcTop,
        right: appliedConfig.commands.calcRight,
        bottom: appliedConfig.commands.calcBottom,
        left: appliedConfig.commands.calcLeft,
        distance: appliedConfig.commands.calcDist,
      },
      projection: {
        top: appliedConfig.commands.projTop,
        right: appliedConfig.commands.projRight,
        bottom: appliedConfig.commands.projBottom,
        left: appliedConfig.commands.projLeft,
      },
    },
  });

  return (
    <ConfigContext.Provider
      value={{
        commands: config.commands,
        theme: config.theme,
        updateCommand,
        updateTheme,
        applyConfig,
        resetConfig,
        getCaliperConfig,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) throw new Error("useConfig must be used within ConfigProvider");
  return context;
};
