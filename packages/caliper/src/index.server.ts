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

export interface OverlayConfig {
  theme?: Record<string, string>;
  commands?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  bridge?: Record<string, unknown>;
}

export function init(_config?: OverlayConfig): OverlayInstance {
  return {
    mount: () => {},
    dispose: () => {},
    getSystems: () => null,
    waitForSystems: () => new Promise(() => {}),
    use: () => ({}) as OverlayInstance,
    mounted: false,
  };
}

export const setConfig = (_config: OverlayConfig): void => {};
export const getConfig = (): OverlayConfig => ({});
export type Systems = {
  measurementSystem: unknown;
  selectionSystem: unknown;
};
export const VERSION = "[SSR]";
