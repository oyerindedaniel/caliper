/**
 * @oyerinde/caliper/bridge - Server Stub
 *
 * This file is loaded when the package is imported in a Node.js/SSR environment.
 * It exports no-op stubs to prevent "window is not defined" errors.
 */

export interface CaliperPlugin {
  name: string;
  install: (instance: unknown) => void;
  dispose?: () => void;
}

export interface AgentBridgeConfig {
  enabled?: boolean;
  wsPort?: number;
  onStateChange?: (state: unknown) => void;
}

export interface CaliperIntent {
  method: string;
  params?: Record<string, unknown>;
}

export interface CaliperActionResult {
  success: boolean;
  method: string;
  error?: string;
  timestamp: number;
  data?: unknown;
}

export function CaliperBridge(_config?: AgentBridgeConfig): CaliperPlugin {
  return {
    name: "agent-bridge-stub",
    install: () => {},
    dispose: () => {},
  };
}

export async function dispatchCaliperIntent(_intent?: CaliperIntent): Promise<CaliperActionResult> {
  return {
    success: false,
    method: "UNKNOWN",
    error: "Agent bridge is not available in SSR environment",
    timestamp: Date.now(),
  };
}
