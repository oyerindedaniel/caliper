import { createReader } from "../../scheduling/reader.js";
import { createFrequencyControlledReader } from "../../scheduling/frequency-control.js";
import type { CursorContext } from "../../shared/types/index.js";
import type { MeasurementResult } from "./measurement-result.js";
import { createMeasurementLines } from "./measurement-result.js";
import { createMeasurement } from "./create-measurement.js";
import { createStateMachine, type MeasurementState } from "./state-machine.js";
import {
  createCalculatorIntegration,
  type CalculatorIntegration,
} from "./calculator-integration.js";
import { createProjectionSystem, type ProjectionSystem } from "./projection-system.js";
import { createRulerSystem, type RulerSystem } from "../../ruler-model/utils/ruler-system.js";

export type { MeasurementState };

type MeasurementSystemListener = () => void;

export interface MeasurementSystem {
  measure: (selectedElement: Element, cursor: { x: number; y: number }) => void;
  abort: () => void;
  stop: () => void;
  freeze: () => void;
  unfreeze: (isAltDown: boolean) => void;
  cleanup: () => void;
  getState: () => MeasurementState;
  getCurrentResult: () => MeasurementResult | null;
  getCalculator: () => CalculatorIntegration;
  getProjection: () => ProjectionSystem;
  getRuler: () => RulerSystem;
  onStateChange: (listener: MeasurementSystemListener) => () => void;
  updatePrimaryRect: (rect: DOMRect) => void;
  updateSecondaryRect: (rect: DOMRect) => void;
  applyResult: (result: MeasurementResult) => void;
}

export function createMeasurementSystem(): MeasurementSystem {
  const baseReader = createReader();
  const reader = createFrequencyControlledReader(baseReader);
  const stateMachine = createStateMachine();
  const calculator = createCalculatorIntegration();
  const projection = createProjectionSystem();
  const ruler = createRulerSystem();
  const listeners = new Set<MeasurementSystemListener>();

  let currentResult: MeasurementResult | null = null;
  let previousContext: CursorContext | null = null;
  let previousElement: Element | null = null;

  function notifyListeners() {
    listeners.forEach((listener) => listener());
  }

  function measure(selectedElement: Element, cursor: { x: number; y: number }): void {
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

        if (!stateMachine.isMeasuring() && !stateMachine.isArmed()) {
          return;
        }

        if (
          stateMachine.isMeasuring() &&
          element === previousElement &&
          result.context === previousContext
        ) {
          return;
        }

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
    if (state === "MEASURING" || state === "IDLE" || state === "ARMED") {
      reader.cancel();
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
    projection.clear();
    ruler.clear();
    currentResult = null;
    previousContext = null;
    previousElement = null;
    notifyListeners();
  }

  function stop() {
    reader.cancel();
    if (stateMachine.getState() === "MEASURING") {
      stateMachine.transitionTo("IDLE");
      notifyListeners();
    }
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

  function getProjection(): ProjectionSystem {
    return projection;
  }

  function getRuler(): RulerSystem {
    return ruler;
  }

  function onStateChange(listener: MeasurementSystemListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function updatePrimaryRect(rect: DOMRect) {
    if (!currentResult) return;
    const newPrimary = new DOMRect(
      rect.left + window.scrollX,
      rect.top + window.scrollY,
      rect.width,
      rect.height
    );
    currentResult = {
      ...currentResult,
      primary: newPrimary,
      primaryWinX: window.scrollX,
      primaryWinY: window.scrollY,
      lines: createMeasurementLines(currentResult.context, newPrimary, currentResult.secondary),
    };
    notifyListeners();
  }

  function updateSecondaryRect(rect: DOMRect) {
    if (!currentResult) return;
    const newSecondary = new DOMRect(
      rect.left + window.scrollX,
      rect.top + window.scrollY,
      rect.width,
      rect.height
    );
    currentResult = {
      ...currentResult,
      secondary: newSecondary,
      secondaryWinX: window.scrollX,
      secondaryWinY: window.scrollY,
      lines: createMeasurementLines(currentResult.context, currentResult.primary, newSecondary),
    };
    notifyListeners();
  }

  function applyResult(result: MeasurementResult) {
    currentResult = result;
    stateMachine.transitionTo("MEASURING");
    notifyListeners();
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
    getProjection,
    getRuler,
    onStateChange,
    updatePrimaryRect,
    updateSecondaryRect,
    applyResult,
  };
}
