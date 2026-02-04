/**
 * @caliper/agent-bridge
 * Enables AI agents to use Caliper's high-precision measurement engine
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
import { createStateStore, initStateSync } from "./state-store.js";
import "./types.js";

const logger = createLogger("agent-bridge");

/**
 * CaliperBridge Plugin Factory
 * Enables AI agents to use Caliper's high-precision measurement engine.
 *
 * @param config - Bridge configuration
 */
export function CaliperBridge(config: AgentBridgeConfig): CaliperPlugin {
  let bridgeDispose: (() => void) | null = null;
  let isDisposed = false;
  let isInitialized = false;
  let intentHandler: ReturnType<typeof createIntentHandler> | null = null;
  let stateStore: ReturnType<typeof createStateStore> | null = null;

  return {
    name: "agent-bridge",
    install: (instance: OverlayInstance) => {
      const cleanup = () => {
        delete window.dispatchCaliperIntent;
        isInitialized = false;
        intentHandler = null;
        if (stateStore) {
          stateStore.clear();
          stateStore = null;
        }
      };

      if (isInitialized) {
        logger.warn("Already initialized. Call bridgeDispose first.");
        return;
      }

      const { enabled = false } = config;

      if (!enabled) {
        logger.info("Bridge is disabled via config.");
        cleanup();
        return;
      }

      instance
        .waitForSystems()
        .then((systems: CaliperCoreSystems) => {
          if (isDisposed) {
            logger.info("Bridge disposed before initialization completed. Aborting.");
            return;
          }

          if (!systems.measurementSystem || !systems.selectionSystem) {
            logger.error(
              "Missing required systems. Provide measurementSystem and selectionSystem from @caliper/core."
            );
            cleanup();
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

          const disposeSync = initStateSync(stateStore, systems, (state) => {
            wsBridge.sendStateUpdate(state);
            config.onStateChange?.(state);
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
            disposeSync();
            wsBridge.destroy();
            cleanup();
            logger.info("Bridge stopped. Connections closed.");
          };
        })
        .catch((error) => {
          if (isDisposed) return;
          logger.error("Failed to initialize agent bridge:", error);
          cleanup();
        });
    },
    dispose: () => {
      isDisposed = true;
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
