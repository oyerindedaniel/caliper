/**
 * @oyerinde/caliper - Server Stub
 *
 * This file is loaded when the package is imported in a Node.js/SSR environment.
 * It exports no-op stubs to prevent "window is not defined" errors.
 */

export interface OverlayInstance {
  mount: () => void;
  dispose: () => void;
  getSystems: () => unknown;
  waitForSystems: () => Promise<unknown>;
  use: (plugin: CaliperPlugin) => OverlayInstance;
  mounted: boolean;
}

export interface CaliperPlugin {
  name: string;
  install: (instance: OverlayInstance) => void;
  dispose?: () => void;
}

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

export interface CommandsConfig {
  activate?: string;
  freeze?: string;
  select?: string;
  clear?: string;
  calculator?: Record<string, string>;
  projection?: Record<string, string>;
  ruler?: string;
  selectionHoldDuration?: number;
}

export interface AnimationConfig {
  enabled?: boolean;
  lerpFactor?: number;
}

export interface AgentBridgeConfig {
  enabled?: boolean;
  wsPort?: number;
  onStateChange?: (state: unknown) => void;
}

export interface OverlayConfig {
  theme?: ThemeConfig;
  commands?: CommandsConfig;
  animation?: AnimationConfig;
  bridge?: AgentBridgeConfig;
}

export type MeasurementSystem = unknown;
export type SelectionSystem = unknown;

export type Systems = {
  measurementSystem: MeasurementSystem;
  selectionSystem: SelectionSystem;
};

export function init(_config?: OverlayConfig): OverlayInstance {
  return {
    mount: () => { },
    dispose: () => { },
    getSystems: () => null,
    waitForSystems: () => new Promise(() => { }),
    use: () => ({}) as OverlayInstance,
    mounted: false,
  };
}

export const setConfig = (_config: OverlayConfig): void => { };
export const getConfig = (): OverlayConfig => ({});
export const caliperProps = (marker: string) => ({
  "data-caliper-marker": marker,
});
export const VERSION = "[SSR]";
