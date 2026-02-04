import type { CaliperAgentState } from "@oyerinde/caliper-schema";
import { type CaliperCoreSystems, buildSelectorInfo } from "@caliper/core";
import { getContextMetrics, sanitizeSelection, sanitizeMeasurement } from "./utils.js";

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

export function initStateSync(
  stateStore: CaliperStateStore,
  systems: CaliperCoreSystems,
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
    activeSelection: null,
    selectionFingerprint: null,
    lastMeasurement: null,
    measurementFingerprint: null,
    lastUpdated: Date.now(),
  });

  const unsubSelection = systems.selectionSystem.onUpdate((metadata) => {
    stateStore.updateState({
      activeSelection: sanitizeSelection(metadata),
      selectionFingerprint: metadata.element ? buildSelectorInfo(metadata.element, metadata) : null,
      lastUpdated: Date.now(),
    });

    const currentState = stateStore.getState();
    if (currentState) {
      updateCallback(currentState);
    }
  });

  const unsubMeasurement = systems.measurementSystem.onStateChange(() => {
    const result = systems.measurementSystem.getCurrentResult();
    const secondaryElement = systems.measurementSystem.getSecondaryElement();

    stateStore.updateState({
      lastMeasurement: sanitizeMeasurement(result),
      measurementFingerprint: secondaryElement ? buildSelectorInfo(secondaryElement) : null,
      lastUpdated: Date.now(),
    });

    const currentState = stateStore.getState();
    if (currentState) {
      updateCallback(currentState);
    }
  });

  return () => {
    unsubSelection();
    unsubMeasurement();
  };
}

export { AGENT_LOCK_EVENT };

export type CaliperStateStore = ReturnType<typeof createStateStore>;
