/**
 * @caliper/agent-bridge
 * Enables AI agents to use Caliper's high-precision measurement engine
 *
 * This bridge integrates with @caliper/core systems to provide:
 * - Passive state observation
 * - Active intent dispatching
 *
 * @example
 * ```typescript
 * import { createMeasurementSystem, createSelectionSystem } from "@oyerinde/caliper/core";
 * import { bridge } from "@oyerinde/caliper-bridge";
 *
 * const measurementSystem = createMeasurementSystem();
 * const selectionSystem = createSelectionSystem();
 *
 * const cleanup = bridge({
 *   enabled: true,
 *   systems: { measurementSystem, selectionSystem }
 * });
 * ```
 */

import type { CaliperIntent, CaliperActionResult } from "@oyerinde/caliper-schema";
import { createIntentHandler } from "./intent-handler.js";
import { createWSBridge } from "./ws-bridge.js";
import type {
  OverlayInstance,
  CaliperPlugin,
  CaliperCoreSystems,
  AgentBridgeConfig,
} from "@caliper/core";
import { createLogger } from "@caliper/core";
import { DEFAULT_WS_PORT } from "./constants.js";
import { createStateStore } from "./state-store.js";
import "./types.js";

const logger = createLogger("agent-bridge");

let intentHandler: ReturnType<typeof createIntentHandler> | null = null;
let stateStore: ReturnType<typeof createStateStore> | null = null;
let isInitialized = false;

/**
 * CaliperBridge Plugin Factory
 * Enables AI agents to use Caliper's high-precision measurement engine.
 *
 * @param config - Bridge configuration
 */
export function CaliperBridge(config: AgentBridgeConfig): CaliperPlugin {
  let bridgeDispose: (() => void) | null = null;

  return {
    name: "agent-bridge",
    install: (instance: OverlayInstance) => {
      const clearGlobals = () => {
        delete window.dispatchCaliperIntent;
      };

      if (isInitialized) {
        logger.warn("Already initialized. Call bridgeDispose first.");
        return;
      }

      const { enabled = false } = config;

      if (!enabled) {
        logger.info("Bridge is disabled via config.");
        clearGlobals();
        return;
      }

      instance.waitForSystems().then((systems: CaliperCoreSystems) => {
        if (!systems.measurementSystem || !systems.selectionSystem) {
          logger.error(
            "Missing required systems. Provide measurementSystem and selectionSystem from @caliper/core."
          );
          clearGlobals();
          return;
        }

        stateStore = createStateStore();
        intentHandler = createIntentHandler(systems, stateStore);

        const wsPort = config.wsPort ?? DEFAULT_WS_PORT;
        const wsUrl = `ws://localhost:${wsPort}`;
        const wsBridge = createWSBridge({
          onIntent: (intent) => intentHandler!.dispatch(intent),
          wsUrl,
        });

        window.dispatchCaliperIntent = async (
          intent: CaliperIntent
        ): Promise<CaliperActionResult> => {
          if (!intentHandler) {
            return {
              success: false,
              method: intent.method,
              error: "Agent bridge not initialized",
              timestamp: Date.now(),
            };
          }
          return intentHandler.dispatch(intent);
        };

        isInitialized = true;
        logger.info(`Initialized. MCP Relay enabled on port ${wsPort} (${wsUrl})`);

        bridgeDispose = () => {
          wsBridge.destroy();
          clearGlobals();
          intentHandler = null;
          if (stateStore) {
            stateStore.clear();
            stateStore = null;
          }
          isInitialized = false;
          logger.info("Bridge stopped. Connections closed.");
        };
      });
    },
    dispose: () => {
      bridgeDispose?.();
    },
  };
}

export async function dispatchCaliperIntent(intent: CaliperIntent): Promise<CaliperActionResult> {
  if (!window.dispatchCaliperIntent) {
    return {
      success: false,
      method: intent.method,
      error: "Agent bridge not initialized",
      timestamp: Date.now(),
    };
  }
  return window.dispatchCaliperIntent(intent);
}
