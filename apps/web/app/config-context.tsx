"use client";

import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { type OverlayConfig } from "@oyerinde/caliper";
import { DEFAULT_COMMANDS, DEFAULT_THEME as CORE_THEME } from "@caliper/core";
import { STORAGE_KEY } from "./constants";

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
    theme: INITIAL_THEME
};

interface ConfigContextType {
    commands: CommandConfig;
    theme: ThemeConfig;
    updateCommand: (key: keyof CommandConfig, value: string) => void;
    updateTheme: (key: keyof ThemeConfig, value: string) => void;
    resetConfig: () => void;
    getCaliperConfig: () => OverlayConfig;
}

const ConfigContext = createContext<ConfigContextType | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
    const [config, setConfigState] = useState<AppConfig>(() => {
        if (typeof window !== "undefined") {
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return {
                        commands: { ...INITIAL_COMMANDS, ...(parsed.commands || {}) },
                        theme: { ...INITIAL_THEME, ...(parsed.theme || {}) }
                    };
                }
            } catch (e) {
                console.error("Failed to load config", e);
            }
        }
        return INITIAL_CONFIG;
    });

    const updateCommand = (key: keyof CommandConfig, value: string) => {
        setConfigState(prev => {
            const next = {
                ...prev,
                commands: { ...prev.commands, [key]: value }
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    };

    const updateTheme = (key: keyof ThemeConfig, value: string) => {
        setConfigState(prev => {
            const next = {
                ...prev,
                theme: { ...prev.theme, [key]: value }
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    };

    const resetConfig = () => {
        setConfigState(INITIAL_CONFIG);
        localStorage.removeItem(STORAGE_KEY);
    };

    const getCaliperConfig = (): OverlayConfig => ({
        theme: config.theme,
        commands: {
            activate: config.commands.activate,
            freeze: config.commands.freeze,
            select: config.commands.select,
            clear: config.commands.clear,
            ruler: config.commands.ruler,
            calculator: {
                top: config.commands.calcTop,
                right: config.commands.calcRight,
                bottom: config.commands.calcBottom,
                left: config.commands.calcLeft,
                distance: config.commands.calcDist,
            },
            projection: {
                top: config.commands.projTop,
                right: config.commands.projRight,
                bottom: config.commands.projBottom,
                left: config.commands.projLeft,
            }
        }
    });

    return (
        <ConfigContext.Provider value={{
            commands: config.commands,
            theme: config.theme,
            updateCommand,
            updateTheme,
            resetConfig,
            getCaliperConfig
        }}>
            {children}
        </ConfigContext.Provider>
    );
}

export const useConfig = () => {
    const context = useContext(ConfigContext);
    if (!context) throw new Error("useConfig must be used within ConfigProvider");
    return context;
};
