import type { CaliperAgentState } from "@oyerinde/caliper-schema";
import type { HandoffRegistry } from "@caliper/core";
import { getContextMetrics } from "./utils.js";
import { persistHandoff, readPersistedHandoff } from "./handoff-session.js";

const AGENT_LOCK_EVENT = "caliper:agent-lock-change";

export function createStateStore() {
  let activeState: CaliperAgentState | null = null;
  let isAgentActiveFlag = false;

  return {
    getState: (): CaliperAgentState | null => activeState,
    setState: (newFullState: CaliperAgentState) => {
      activeState = newFullState;
    },
    updateState: (statePatch: Partial<CaliperAgentState>) => {
      if (activeState) {
        activeState = { ...activeState, ...statePatch };
      }
    },
    clearHandoff: () => {
      persistHandoff(null);
      if (activeState) {
        activeState = { ...activeState, handoff: null, lastUpdated: Date.now() };
      }
    },
    clear: () => {
      activeState = null;
    },
    setAgentLock: (isLocked: boolean) => {
      if (isAgentActiveFlag !== isLocked) {
        isAgentActiveFlag = isLocked;
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(AGENT_LOCK_EVENT, {
              detail: { locked: isLocked },
            })
          );
        }
      }
    },
    isAgentActive: () => isAgentActiveFlag,
  };
}

export function initStateSync(
  stateStore: CaliperStateStore,
  handoffRegistry: HandoffRegistry,
  updateCallback: (state: CaliperAgentState) => void
) {
  const initialContext = getContextMetrics();
  stateStore.setState({
    viewport: {
      width: initialContext.viewportWidth,
      height: initialContext.viewportHeight,
      scrollX: initialContext.scrollX,
      scrollY: initialContext.scrollY,
    },
    handoff: readPersistedHandoff(),
    lastUpdated: Date.now(),
  });

  const persistedHandoff = stateStore.getState()?.handoff;
  if (persistedHandoff) {
    updateCallback(stateStore.getState()!);
  }

  const unsubCommit = handoffRegistry.onCommit((handoff) => {
    persistHandoff(handoff);
    stateStore.updateState({
      handoff,
      lastUpdated: Date.now(),
    });

    const currentState = stateStore.getState();
    if (currentState) {
      updateCallback(currentState);
    }
  });

  return () => {
    unsubCommit();
  };
}

export { AGENT_LOCK_EVENT };

export type CaliperStateStore = ReturnType<typeof createStateStore>;
