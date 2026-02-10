/**
 * @oyerinde/caliper/preset - Server Stub
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

export interface AgentBridgeConfig {
  enabled?: boolean;
  wsPort?: number;
  onStateChange?: (state: unknown) => void;
}

export interface OverlayConfig {
  theme?: Record<string, string>;
  commands?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  bridge?: AgentBridgeConfig;
}

export type Extension = ((instance: OverlayInstance) => void) | CaliperPlugin;

/**
 * CaliperBridge stub for server-side execution.
 */
export function CaliperBridge(_configuration?: AgentBridgeConfig): CaliperPlugin {
  return {
    name: "agent-bridge-stub",
    install: () => {},
    dispose: () => {},
  };
}

/**
 * server-side stub for the preset initialization.
 */
export async function init(
  _configuration?: OverlayConfig,
  _extensions: Array<Extension> = []
): Promise<OverlayInstance> {
  return {
    mount: () => {},
    dispose: () => {},
    getSystems: () => null,
    waitForSystems: () => new Promise(() => {}),
    use: () => ({}) as OverlayInstance,
    mounted: false,
  };
}

export const caliperProps = (marker: string) => ({
  "data-caliper-marker": marker,
});
