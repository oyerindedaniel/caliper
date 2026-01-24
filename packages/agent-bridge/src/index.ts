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
 * import { initAgentBridge } from "@oyerinde/caliper-bridge";
 *
 * const measurementSystem = createMeasurementSystem();
 * const selectionSystem = createSelectionSystem();
 *
 * const cleanup = initAgentBridge({
 *   enabled: true,
 *   systems: { measurementSystem, selectionSystem }
 * });
 * ```
 */

import type {
    CaliperIntent,
    CaliperActionResult,
    CaliperAgentState,
} from "@oyerinde/caliper-schema";
import type {
    AgentBridgeConfig,
    CaliperCoreSystems,
} from "./types.js";
import { createStateExporter } from "./state-exporter.js";
import { createIntentHandler } from "./intent-handler.js";
import { createWSBridge } from "./ws-bridge.js";
import { createLogger } from "@oyerinde/caliper/core";
import { DEFAULT_WS_URL } from "./constants.js";
import { createStateStore } from "./state-store.js";

const logger = createLogger("agent-bridge");

export * from "./types.js";

let stateExporter: ReturnType<typeof createStateExporter> | null = null;
let intentHandler: ReturnType<typeof createIntentHandler> | null = null;
let stateStore: ReturnType<typeof createStateStore> | null = null;
let isInitialized = false;

export interface InitAgentBridgeOptions extends AgentBridgeConfig {
    systems: CaliperCoreSystems;
}

/**
 * Initialize the Agent Bridge with Caliper Core systems
 *
 * @param options - Configuration including the core systems
 * @returns Cleanup function to destroy the bridge
 */
export function initAgentBridge(options: InitAgentBridgeOptions): () => void {
    const clearGlobals = () => {
        delete window.dispatchCaliperIntent;
    };

    if (isInitialized) {
        logger.warn("Already initialized. Call cleanup first.");
        return () => { };
    }

    const { enabled = false } = options;

    if (!enabled) {
        logger.info("Bridge is disabled via config.");
        clearGlobals();
        return () => { };
    }

    if (!options.systems?.measurementSystem || !options.systems?.selectionSystem) {
        logger.error(
            "Missing required systems. Provide measurementSystem and selectionSystem from @caliper/core."
        );
        clearGlobals();
        return () => { };
    }

    stateStore = createStateStore();

    stateExporter = createStateExporter(options, options.systems, stateStore);
    stateExporter.start();

    intentHandler = createIntentHandler(options.systems, stateStore);

    const wsUrl = options.wsUrl ?? DEFAULT_WS_URL;
    const wsBridge = createWSBridge({
        onIntent: (intent) => intentHandler!.dispatch(intent),
        onGetState: () => stateStore?.getState() ?? null,
        wsUrl,
    });

    window.dispatchCaliperIntent = async (intent: CaliperIntent): Promise<CaliperActionResult> => {
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
    logger.info(`Initialized. MCP Relay enabled on ${wsUrl}`);

    return () => {
        if (stateExporter) {
            stateExporter.stop();
            stateExporter = null;
        }

        wsBridge.destroy();
        clearGlobals();

        intentHandler = null;
        if (stateStore) {
            stateStore.clear();
            stateStore = null;
        }
        isInitialized = false;

        logger.info("Bridge stopped. State store cleared and connections closed.");
    };
}

export function getCaliperState(): CaliperAgentState | null {
    return stateStore?.getState() ?? null;
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

export function forceStateUpdate(): void {
    if (stateExporter) {
        stateExporter.forceUpdate();
    }
}
