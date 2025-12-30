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
        reader.scheduleRead(() => {
          if (signal.aborted) {
            resolve();
            return;
          }

          reader.recordFrameTime(performance.now());

          const result = createMeasurement(
            selectedElement,
            cursor.x,
            cursor.y,
            previousContext || undefined
          );

          if (result) {
            console.log("MeasurementSystem: Atomic Read/Write", result);
            currentResult = result;
            previousContext = result.context;
            stateMachine.transitionTo("MEASURING");
            notifyListeners();
          }

          resolve();
        });
      });
    } catch (error) {
      if (!signal.aborted) {
        console.error("MeasurementSystem: Error during measurement", error);
        stateMachine.transitionTo("IDLE");
      }
    }
  }

  function freeze() {
    if (stateMachine.isMeasuring()) {
      stateMachine.transitionTo("FROZEN");
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
    abort();
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
    cleanup,
    getState,
    getCurrentResult,
    getCalculator,
    onStateChange,
  };
}
