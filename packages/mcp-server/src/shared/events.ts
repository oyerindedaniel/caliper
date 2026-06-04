import type { CaliperAgentState } from "@oyerinde/caliper-schema";

export interface BridgeEvents {
  state: (state: CaliperAgentState) => void;
  connection: () => void;
}

export const BRIDGE_EVENTS = {
  STATE: "state",
  CONNECTION: "connection",
} as const;
