import { ProjectionState, ProjectionDirection } from "../../shared/types/index.js";

type ProjectionListener = (state: ProjectionState) => void;

export interface ProjectionSystem {
  getState: () => ProjectionState;
  setDirection: (direction: ProjectionDirection | null) => void;
  setElement: (element: HTMLElement | null) => void;
  appendValue: (char: string, max?: number) => void;
  capValue: (max: number) => void;
  backspace: () => void;
  clear: () => void;
  onUpdate: (listener: ProjectionListener) => () => void;
}

export function createProjectionSystem(): ProjectionSystem {
  let state: ProjectionState = {
    direction: null,
    value: "",
    element: null,
  };

  const listeners = new Set<ProjectionListener>();

  const notify = () => {
    listeners.forEach((listener) => listener({ ...state }));
  };

  return {
    getState: () => ({ ...state }),
    setDirection: (direction) => {
      state.direction = direction;
      // When direction changes but no value exists, we keep value empty.
      // If user switches direction while typing, we keep the value.
      notify();
    },
    setElement: (element) => {
      state.element = element;
      notify();
    },
    appendValue: (char, max) => {
      if (/^[0-9.]$/.test(char)) {
        const isDot = char === ".";
        const alreadyHasDot = state.value.includes(".");

        if (isDot && alreadyHasDot) return;

        const newValueStr = state.value + char;
        const newValueNum = parseFloat(newValueStr) || 0;

        if (max !== undefined && newValueNum > max) {
          state.value = Math.floor(max).toString();
        } else {
          state.value = newValueStr;
        }
        notify();
      }
    },
    capValue: (max) => {
      const currentVal = parseFloat(state.value) || 0;
      if (currentVal > max) {
        state.value = Math.floor(max).toString();
        notify();
      }
    },
    backspace: () => {
      if (state.value.length > 0) {
        state.value = state.value.slice(0, -1);
        notify();
      } else if (state.direction) {
        // If value is empty, backspace clears the direction
        state.direction = null;
        notify();
      }
    },
    clear: () => {
      state = { direction: null, value: "", element: null };
      notify();
    },
    onUpdate: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
