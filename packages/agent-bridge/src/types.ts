import type {
  CaliperIntent,
  CaliperActionResult,
  CaliperNode,
  WalkOptionsBase,
} from "@oyerinde/caliper-schema";

declare global {
  interface Window {
    dispatchCaliperIntent?: (intent: CaliperIntent) => Promise<CaliperActionResult>;
    /** Set by engine CDP inject bootstrap before the Caliper bundle runs. */
    __CALIPER_ENGINE_INJECTED__?: boolean;
    /** Set while CaliperBridge is installing; cleared when dispatch is ready. */
    __CALIPER_BRIDGE_BOOTING__?: boolean;
  }
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
