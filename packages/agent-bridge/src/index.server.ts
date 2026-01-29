/**
 * @oyerinde/caliper/bridge - Server Stub
 *
 * This file is loaded when the package is imported in a Node.js/SSR environment.
 * It exports no-op stubs to prevent "window is not defined" errors.
 */

export function CaliperBridge(): unknown {
  return {
    name: "agent-bridge",
    install: () => { },
    dispose: () => { },
  };
}

export async function dispatchCaliperIntent(): Promise<unknown> {
  return {
    success: false,
    method: "UNKNOWN",
    error: "Agent bridge is not available in SSR environment",
    timestamp: Date.now(),
  };
}
