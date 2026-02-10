import { RulerLine, RulerState } from "../../shared/types/index.js";
import { MAX_RULER_LINES } from "../../shared/constants/index.js";
import { generateId } from "../../shared/utils/id.js";

type RulerListener = (state: RulerState) => void;

export interface RulerSystem {
  getState: () => RulerState;
  addPair: (x: number, y: number) => string | null;
  updateLine: (id: string, position: number) => void;
  removeLine: (id: string) => void;
  clear: () => void;
  onUpdate: (listener: RulerListener) => () => void;
}

/**
 * Ruler System Factory
 * 
 * Creates a system that manages customized ruler lines on the viewport. 
 * Allows users to drop horizontal and vertical guides and track their positions.
 *
 * @returns A RulerSystem instance.
 */
export function createRulerSystem(): RulerSystem {
  let state: RulerState = {
    lines: [],
  };

  const listeners = new Set<RulerListener>();

  const notify = () => {
    listeners.forEach((listener) => listener({ lines: [...state.lines] }));
  };

  return {
    getState: () => ({ lines: [...state.lines] }),
    addPair: (x, y) => {
      if (state.lines.length >= MAX_RULER_LINES) return null;

      const hLine: RulerLine = {
        id: generateId("ruler-h"),
        type: "horizontal",
        position: y,
      };
      const vLine: RulerLine = {
        id: generateId("ruler-v"),
        type: "vertical",
        position: x,
      };

      state.lines.push(hLine, vLine);
      notify();
      return vLine.id;
    },
    updateLine: (id, position) => {
      const index = state.lines.findIndex((line) => line.id === id);
      if (index !== -1 && state.lines[index]) {
        state.lines[index] = { ...state.lines[index]!, position };
        notify();
      }
    },
    removeLine: (id) => {
      state.lines = state.lines.filter((line) => line.id !== id);
      notify();
    },
    clear: () => {
      state.lines = [];
      notify();
    },
    onUpdate: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
