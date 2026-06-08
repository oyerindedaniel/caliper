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
import { prepareWalkResultForJsonWire } from "@oyerinde/caliper-schema";
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
import { resolveCaliperGlobalStateHandler } from "./types.js";
import "./types.js";

const logger = createLogger("agent-bridge");

function resolveEffectiveBridgeConfig(config: AgentBridgeConfig): AgentBridgeConfig {
  const isEngineManaged =
    typeof window !== "undefined" && window.__CALIPER_ENGINE_MANAGED__ === true;
  if (!isEngineManaged) {
    return config;
  }

  return {
    ...config,
    relay: false,
    engineStateBinding: true,
  };
}

/**
 * CaliperBridge Plugin Factory
 *
 * Creates a Caliper plugin that enables AI agents to interact with the overlay via
 * a WebSocket bridge (local MCP relay) or direct global intent dispatching.
 *
 * When installed, this plugin:
 * 1. Starts a local WebSocket server (or connects to one) to receive agent commands.
 * 2. Exposes `window.dispatchCaliperIntent` for manual/in-page agentic calls.
 * 3. Syncs the overlay state (selection, measurements) back to the agent.
 *
 * @example
 * ```ts
 * import { init } from "@oyerinde/caliper/preset";
 * import { CaliperBridge } from "@oyerinde/caliper/bridge";
 *
 * init({ ... }, [
 *   new CaliperBridge({
 *     enabled: true,
 *     wsPort: 3010,
 *     onStateChange: (state) => console.log("New Agent State:", state)
 *   })
 * ]);
 * ```
 *
 * @param config - The bridge configuration settings.
 * @returns A CaliperPlugin that can be used with `caliper.use()` or in `init()`.
 */
export function CaliperBridge(config: AgentBridgeConfig): CaliperPlugin {
  let bridgeDispose: (() => void) | null = null;
  let isDisposed = false;
  let isInitialized = false;
  let intentHandler: ReturnType<typeof createIntentHandler> | null = null;
  let stateStore: ReturnType<typeof createStateStore> | null = null;
  let wsBridge: ReturnType<typeof createWSBridge> | null = null;
  let reportEngineState = false;

  return {
    name: "agent-bridge",
    install: (instance: OverlayInstance) => {
      const cleanup = () => {
        delete window.dispatchCaliperIntent;
        delete window.__CALIPER_BRIDGE_BOOTING__;
        delete window.__CALIPER_ENGINE_APPLY_MANAGED_TRANSPORT__;
        wsBridge = null;
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

      window.__CALIPER_BRIDGE_BOOTING__ = true;

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

          const effectiveConfig = resolveEffectiveBridgeConfig(config);
          const relayEnabled = effectiveConfig.relay !== false;
          reportEngineState = effectiveConfig.engineStateBinding === true;
          const wsPort = effectiveConfig.wsPort ?? DEFAULT_WS_PORT;
          const wsUrl = `ws://localhost:${wsPort}`;

          wsBridge = relayEnabled
            ? createWSBridge({
                onIntent: (intent) => intentHandler!.dispatch(intent),
                wsUrl,
              })
            : null;

          const disposeSync = initStateSync(stateStore, systems.handoffRegistry, (state) => {
            if (wsBridge) {
              wsBridge.sendStateUpdate(state);
            }
            if (reportEngineState) {
              window.__CALIPER_ENGINE_REPORT_STATE__?.(state);
            }
            effectiveConfig.onStateChange?.(state);
            if (effectiveConfig.onStateChangeGlobal) {
              resolveCaliperGlobalStateHandler(effectiveConfig.onStateChangeGlobal)?.(state);
            }
          });

          window.dispatchCaliperIntent = async (
            intent: CaliperIntent
          ): Promise<CaliperActionResult> => {
            if (!intentHandler) {
              return {
                success: false,
                method: intent.method,
                error: "Caliper agent bridge not initialized",
                timestamp: Date.now(),
              };
            }
            return prepareWalkResultForJsonWire(await intentHandler.dispatch(intent));
          };

          window.__CALIPER_ENGINE_APPLY_MANAGED_TRANSPORT__ = () => {
            if (wsBridge) {
              wsBridge.destroy();
              wsBridge = null;
            }
            reportEngineState = true;
          };

          delete window.__CALIPER_BRIDGE_BOOTING__;

          isInitialized = true;
          if (relayEnabled) {
            logger.info(`Initialized. MCP relay on port ${wsPort} (${wsUrl})`);
          } else {
            logger.info("Initialized. CDP dispatch only (MCP relay disabled).");
          }

          bridgeDispose = () => {
            disposeSync();
            wsBridge?.destroy();
            wsBridge = null;
            cleanup();
            logger.info("Bridge stopped. Connections closed.");
          };
        })
        .catch((error) => {
          if (isDisposed) return;
          delete window.__CALIPER_BRIDGE_BOOTING__;
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

/**
 * Dispatches a high-level intent to the Caliper engine.
 *
 * This function is used to programmatically trigger Caliper actions (like measuring between elements)
 * using the standardized intent format. Requires a `CaliperBridge` to be installed and active.
 *
 * @param intent - The action to perform (e.g., 'measure', 'select', 'inspect').
 * @returns A promise resolving to the result of the action, containing success status and metrics.
 */
export async function dispatchCaliperIntent(intent: CaliperIntent): Promise<CaliperActionResult> {
  if (!window.dispatchCaliperIntent) {
    return {
      success: false,
      method: intent.method,
      error: "Caliper agent bridge not initialized",
      timestamp: Date.now(),
    };
  }
  return window.dispatchCaliperIntent(intent);
}
