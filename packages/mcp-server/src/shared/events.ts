import type { CaliperAgentState } from "@oyerinde/caliper-schema";

export interface BridgeEvents {
    state: (state: CaliperAgentState) => void;
}

export const BRIDGE_EVENTS = {
    STATE: "state",
} as const;
