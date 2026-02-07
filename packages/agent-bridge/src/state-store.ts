import type { CaliperAgentState } from "@oyerinde/caliper-schema";
import { type CaliperCoreSystems, buildSelectorInfo } from "@caliper/core";
import { getContextMetrics, sanitizeSelection, sanitizeMeasurement } from "./utils.js";

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
    const measurementResult = systems.measurementSystem.getCurrentResult();
    const primaryElement = systems.selectionSystem.getSelected();
    const secondaryElement = systems.measurementSystem.getSecondaryElement();

    let measurementFingerprint = null;
    if (primaryElement && secondaryElement) {
      measurementFingerprint = {
        primary: buildSelectorInfo(primaryElement),
        secondary: buildSelectorInfo(secondaryElement),
      };
    }

    stateStore.updateState({
      lastMeasurement: sanitizeMeasurement(measurementResult),
      measurementFingerprint,
      lastUpdated: Date.now(),
    });

    const activeState = stateStore.getState();
    if (activeState) {
      updateCallback(activeState);
    }
  });

  return () => {
    unsubSelection();
    unsubMeasurement();
  };
}

export { AGENT_LOCK_EVENT };

export type CaliperStateStore = ReturnType<typeof createStateStore>;
