/**
 * @oyerinde/caliper - Server Stub
 *
 * This file is loaded when the package is imported in a Node.js/SSR environment.
 * It exports no-op stubs to prevent "window is not defined" errors.
 */

export interface OverlayInstance {
    mount: () => void;
    dispose: () => void;
    mounted: boolean;
}

export interface OverlayConfig {
    theme?: Record<string, string>;
    commands?: Record<string, unknown>;
    animation?: Record<string, unknown>;
}

const noopInstance: OverlayInstance = {
    mount: () => { },
    dispose: () => { },
    mounted: false,
};

export const init = (): OverlayInstance => noopInstance;
export const setConfig = (_config: OverlayConfig): void => { };
export const getConfig = (): OverlayConfig => ({});
export const VERSION = "[SSR]";
