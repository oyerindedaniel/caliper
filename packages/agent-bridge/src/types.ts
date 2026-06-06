import type {
  CaliperAgentState,
  CaliperIntent,
  CaliperActionResult,
  CaliperNode,
  WalkOptionsBase,
} from "@oyerinde/caliper-schema";

export type CaliperGlobalStateHandler = (state: CaliperAgentState) => void;

declare global {
  interface Window {
    dispatchCaliperIntent?: (intent: CaliperIntent) => Promise<CaliperActionResult>;
    /** Set by engine CDP inject bootstrap before the Caliper bundle runs. */
    __CALIPER_ENGINE_INJECTED__?: boolean;
    /**
     * Forwards overlay state into the CDP Runtime binding installed by the engine.
     * Set by engine inject bootstrap; invoked by CaliperBridge when engineStateBinding is true.
     */
    __CALIPER_ENGINE_REPORT_STATE__?: CaliperGlobalStateHandler;
    /** CDP Runtime binding callback (engine installs via Runtime.addBinding). */
    caliperEngineState?: (payload: string) => void;
    /** Set while CaliperBridge is installing; cleared when dispatch is ready. */
    __CALIPER_BRIDGE_BOOTING__?: boolean;
  }
}

export function resolveCaliperGlobalStateHandler(
  name: string
): CaliperGlobalStateHandler | undefined {
  const handler = Reflect.get(window, name);
  return typeof handler === "function" ? (handler as CaliperGlobalStateHandler) : undefined;
}

export interface WalkResult {
  root: CaliperNode;
  nodeCount: number;
  maxDepthReached: number;
  walkDurationMs: number;
  hasMore: boolean;
  continuationToken?: string;
  batchInstructions?: string;
}

export interface WalkOptions extends WalkOptionsBase {
  visualize?: boolean;
}

export interface ParsedSelection {
  selector: string;
  tag: string;
  id?: string;
  text?: string;
  classes: string[];
  timestamp: number;
  isValid: boolean;
  errorMessage?: string;
}
