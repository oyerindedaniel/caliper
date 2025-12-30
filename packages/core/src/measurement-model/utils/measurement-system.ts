import { createReader } from "../../scheduling/reader.js";
import { createFrequencyControlledReader } from "../../scheduling/frequency-control.js";
import type { CursorContext } from "../../shared/types/index.js";
import type { MeasurementResult } from "./measurement-result.js";
import { createMeasurement } from "./create-measurement.js";
import { createStateMachine, type MeasurementState } from "./state-machine.js";
import {
  createCalculatorIntegration,
  type CalculatorIntegration,
} from "./calculator-integration.js";
import type { SelectionSystem } from "./selection-system.js";

export type { MeasurementState };

type MeasurementSystemListener = () => void;

export interface MeasurementSystem {
  measure: (
    selectedElement: Element,
    cursor: { x: number; y: number }
  ) => Promise<void>;
  abort: () => void;
  stop: () => void;
  freeze: () => void;
  unfreeze: (isAltDown: boolean) => void;
  cleanup: () => void;
  getState: () => MeasurementState;
  getCurrentResult: () => MeasurementResult | null;
  getCalculator: () => CalculatorIntegration;
  onStateChange: (listener: MeasurementSystemListener) => () => void;
}

export function createMeasurementSystem(
  selectionSystem: SelectionSystem
): MeasurementSystem {
  const baseReader = createReader();
  const reader = createFrequencyControlledReader(baseReader);
  const stateMachine = createStateMachine();
  const calculator = createCalculatorIntegration();
  const listeners = new Set<MeasurementSystemListener>();
  let abortController: AbortController | null = null;
  let currentResult: MeasurementResult | null = null;
  let previousContext: CursorContext | null = null;

  function notifyListeners() {
    listeners.forEach((listener) => listener());
  }

  async function measure(
    selectedElement: Element,
    cursor: { x: number; y: number }
  ): Promise<void> {
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    stateMachine.transitionTo("ARMED");

    try {
      await new Promise<void>((resolve) => {
        const scheduled = reader.scheduleRead(() => {
          if (signal.aborted) {
            resolve();
            return;
          }

          // reader.recordFrameTime(performance.now());

          const start = performance.now();
          const result = createMeasurement(
            selectedElement,
            cursor.x,
            cursor.y,
            previousContext || undefined
          );
          const duration = performance.now() - start;

          if (result) {
            if (signal.aborted) {
              resolve();
              return;
            }

            console.log(`[Caliper] Measure: ${duration.toFixed(2)}ms`);
            currentResult = result;
            previousContext = result.context;
            stateMachine.transitionTo("MEASURING");
            notifyListeners();
          }

          resolve();
        });

        // If the read was queued or throttled, resolve the promise immediately.
        // We don't want to block the caller since a newer request will supersede this one.
        if (!scheduled) {
          resolve();
        }
      });
    } catch (error) {
      if (!signal.aborted) {
        console.error("MeasurementSystem: Error during measurement", error);
        stateMachine.transitionTo("IDLE");
      }
    }
  }

  function freeze() {
    const state = stateMachine.getState();
    if ((state === "MEASURING" || state === "IDLE") && currentResult) {
      stateMachine.transitionTo("FROZEN");
      notifyListeners();
    }
  }

  function unfreeze(isAltDown: boolean) {
    if (stateMachine.isFrozen()) {
      stateMachine.transitionTo(isAltDown ? "MEASURING" : "IDLE");
      notifyListeners();
    }
  }

  function abort() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    reader.cancel();
    stateMachine.transitionTo("IDLE");
    currentResult = null;
    notifyListeners();
  }

  function stop() {
    // Stop the active reader/computation, but DO NOT clear the result.
    // This allows the last measurement to stay on screen until aborted.
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    reader.cancel();
    if (stateMachine.getState() === "MEASURING") {
      stateMachine.transitionTo("IDLE");
    }
    notifyListeners();
  }

  function cleanup() {
    abort();

    abortController = null;
    currentResult = null;
    previousContext = null;

    reader.cancel();
  }

  function getState(): MeasurementState {
    return stateMachine.getState();
  }

  function getCurrentResult(): MeasurementResult | null {
    return currentResult;
  }

  function getCalculator(): CalculatorIntegration {
    return calculator;
  }

  function onStateChange(listener: MeasurementSystemListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    measure,
    abort,
    stop,
    freeze,
    unfreeze,
    cleanup,
    getState,
    getCurrentResult,
    getCalculator,
    onStateChange,
  };
}
