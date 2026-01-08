import { RulerLine, RulerState } from "../../shared/types/index.js";
import { MAX_RULER_LINES } from "../../shared/constants/index.js";

type RulerListener = (state: RulerState) => void;

export interface RulerSystem {
    getState: () => RulerState;
    addPair: (x: number, y: number) => void;
    updateLine: (id: string, position: number) => void;
    removeLine: (id: string) => void;
    clear: () => void;
    onUpdate: (listener: RulerListener) => () => void;
}

/**
 * Manages the "Ruler" system - fixed viewport guidelines.
 */
export function createRulerSystem(): RulerSystem {
    let state: RulerState = {
        lines: [],
    };

    const listeners = new Set<RulerListener>();

    const notify = () => {
        // Return a fresh copy of lines to ensure reactivity observes the array change
        listeners.forEach((l) => l({ lines: [...state.lines] }));
    };

    return {
        getState: () => ({ lines: [...state.lines] }),
        addPair: (x, y) => {
            if (state.lines.length >= MAX_RULER_LINES) return;

            const hLine: RulerLine = {
                id: `ruler-h-${Math.random().toString(36).slice(2, 9)}`,
                type: "horizontal",
                position: y,
            };
            const vLine: RulerLine = {
                id: `ruler-v-${Math.random().toString(36).slice(2, 9)}`,
                type: "vertical",
                position: x,
            };

            state.lines.push(hLine, vLine);
            notify();
        },
        updateLine: (id, position) => {
            const index = state.lines.findIndex((l) => l.id === id);
            if (index !== -1 && state.lines[index]) {
                state.lines[index] = { ...state.lines[index]!, position };
                notify();
            }
        },
        removeLine: (id) => {
            state.lines = state.lines.filter((l) => l.id !== id);
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
