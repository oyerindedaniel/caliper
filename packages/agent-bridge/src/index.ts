/**
 * @caliper/agent-bridge
 * Enables AI agents to use Caliper's high-precision measurement engine
 *
 * This bridge integrates with @caliper/core systems to provide:
 * - Passive state observation via window.__CALIPER_STATE__
 * - Active intent dispatching via window.dispatchCaliperIntent()
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
    AgentBridgeConfig,
    CaliperIntent,
    CaliperActionResult,
    CaliperAgentState,
    CaliperCoreSystems,
} from "./types.js";
import { createStateExporter } from "./state-exporter.js";
import { createIntentHandler } from "./intent-handler.js";
import { createWSBridge } from "./ws-bridge.js";
import { createLogger } from "@oyerinde/caliper/core";
import { DEFAULT_WS_URL, DEFAULT_SECURITY_ATTRIBUTE } from "./constants.js";

const logger = createLogger("agent-bridge");

export * from "./types.js";

let stateExporter: ReturnType<typeof createStateExporter> | null = null;
let intentHandler: ReturnType<typeof createIntentHandler> | null = null;
let isInitialized = false;

function checkSecurityGate(attribute: string): boolean {
    const htmlAttr = document.documentElement.getAttribute(attribute);
    if (htmlAttr === "true" || htmlAttr === "") {
        return true;
    }

    const bodyAttr = document.body?.getAttribute(attribute);
    if (bodyAttr === "true" || bodyAttr === "") {
        return true;
    }

    return false;
}

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
        delete window.__CALIPER_STATE__;
    };

    if (isInitialized) {
        logger.warn("Already initialized. Call cleanup first.");
        return () => { };
    }

    if (!options.enabled) {
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

    const securityAttribute = options.securityAttribute ?? DEFAULT_SECURITY_ATTRIBUTE;
    if (!checkSecurityGate(securityAttribute)) {
        logger.warn(
            `Security gate failed. Add '${securityAttribute}="true"' to <html> or <body> to enable the agent bridge.`
        );
        clearGlobals();
        return () => { };
    }

    stateExporter = createStateExporter(options, options.systems);
    stateExporter.start();

    intentHandler = createIntentHandler(options.systems);

    const wsUrl = options.wsUrl ?? DEFAULT_WS_URL;
    const wsBridge = createWSBridge({
        onIntent: (intent) => intentHandler!.dispatch(intent),
        onGetState: () => window.__CALIPER_STATE__ ?? null,
        wsUrl,
    });

    window.dispatchCaliperIntent = async (intent: CaliperIntent): Promise<CaliperActionResult> => {
        if (!intentHandler) {
            return {
                success: false,
                intent: intent.type,
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
        isInitialized = false;

        logger.info("Destroyed.");
    };
}

export function getCaliperState(): CaliperAgentState | null {
    return window.__CALIPER_STATE__ ?? null;
}

export async function dispatchCaliperIntent(intent: CaliperIntent): Promise<CaliperActionResult> {
    if (!window.dispatchCaliperIntent) {
        return {
            success: false,
            intent: intent.type,
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
