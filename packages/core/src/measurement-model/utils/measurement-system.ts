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

export type { MeasurementState };

type MeasurementSystemListener = () => void;

export interface MeasurementSystem {
  measure: (
    selectedElement: Element,
    cursor: { x: number; y: number }
  ) => void;
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

export function createMeasurementSystem(): MeasurementSystem {
  const baseReader = createReader();
  const reader = createFrequencyControlledReader(baseReader);
  const stateMachine = createStateMachine();
  const calculator = createCalculatorIntegration();
  const listeners = new Set<MeasurementSystemListener>();

  let currentResult: MeasurementResult | null = null;
  let previousContext: CursorContext | null = null;
  let previousElement: Element | null = null;

  function notifyListeners() {
    listeners.forEach((listener) => listener());
  }

  function measure(
    selectedElement: Element,
    cursor: { x: number; y: number }
  ): void {
    stateMachine.transitionTo("ARMED");

    reader.scheduleRead(() => {
      const start = performance.now();

      const measurement = createMeasurement(
        selectedElement,
        cursor.x,
        cursor.y,
        previousContext,
        previousElement
      );

      // reader.recordFrameTime(performance.now());

      if (measurement) {
        const { result, element } = measurement;
        currentResult = result;
        previousContext = result.context;
        previousElement = element;
        stateMachine.transitionTo("MEASURING");
        notifyListeners();
      }
    });
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
    reader.cancel();
    stateMachine.transitionTo("IDLE");
    calculator.close();
    currentResult = null;
    previousContext = null;
    previousElement = null;
    notifyListeners();
  }

  function stop() {
    reader.cancel();
    if (stateMachine.getState() === "MEASURING") {
      stateMachine.transitionTo("IDLE");
    }
    notifyListeners();
  }

  function cleanup() {
    abort();
    listeners.clear();
    currentResult = null;
    previousContext = null;
    previousElement = null;
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
