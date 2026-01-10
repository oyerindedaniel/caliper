/**
 * Measurement state machine
 * IDLE → ARMED → MEASURING → FROZEN → IDLE
 */
export type MeasurementState = "IDLE" | "ARMED" | "MEASURING" | "FROZEN";

export interface StateMachine {
  getState: () => MeasurementState;
  transitionTo: (newState: MeasurementState) => boolean;
  isIdle: () => boolean;
  isArmed: () => boolean;
  isMeasuring: () => boolean;
  isFrozen: () => boolean;
}

export function createStateMachine(): StateMachine {
  let state: MeasurementState = "IDLE";

  function getState(): MeasurementState {
    return state;
  }

  function transitionTo(newState: MeasurementState): boolean {
    const validTransitions: Record<MeasurementState, MeasurementState[]> = {
      IDLE: ["ARMED", "FROZEN"],
      ARMED: ["MEASURING", "FROZEN", "IDLE"],
      MEASURING: ["FROZEN", "IDLE"],
      FROZEN: ["MEASURING", "IDLE"],
    };

    const allowed = validTransitions[state];
    if (allowed && allowed.includes(newState)) {
      state = newState;
      return true;
    }

    return false;
  }

  function isIdle(): boolean {
    return state === "IDLE";
  }

  function isArmed(): boolean {
    return state === "ARMED";
  }

  function isMeasuring(): boolean {
    return state === "MEASURING";
  }

  function isFrozen(): boolean {
    return state === "FROZEN";
  }

  return {
    getState,
    transitionTo,
    isIdle,
    isArmed,
    isMeasuring,
    isFrozen,
  };
}
