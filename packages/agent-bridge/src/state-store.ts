import type { CaliperAgentState } from "@oyerinde/caliper-schema";

const AGENT_LOCK_EVENT = "caliper:agent-lock-change";

export function createStateStore() {
    let state: CaliperAgentState | null = null;
    let isAgentActive = false;

    return {
        getState: (): CaliperAgentState | null => state,
        setState: (newState: CaliperAgentState) => {
            state = newState;
        },
        updateState: (patch: Partial<CaliperAgentState>) => {
            if (state) {
                state = { ...state, ...patch };
            }
        },
        clear: () => {
            state = null;
        },
        setAgentLock: (locked: boolean) => {
            if (isAgentActive !== locked) {
                isAgentActive = locked;
                if (typeof window !== "undefined") {
                    window.dispatchEvent(
                        new CustomEvent(AGENT_LOCK_EVENT, {
                            detail: { locked },
                        })
                    );
                }
            }
        },
        isAgentActive: () => isAgentActive,
    };
}

export { AGENT_LOCK_EVENT };

export type CaliperStateStore = ReturnType<typeof createStateStore>;
