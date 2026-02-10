import {
  createCalculatorState,
  type CalculatorState,
  type CalculatorOperation,
} from "../../calculator-model/utils/calculator-state.js";
import type { MeasurementLine } from "./measurement-result.js";

export interface CalculatorIntegration {
  getState: () => CalculatorState;
  open: (baseValue: number) => void;
  handleInput: (key: string) => void;
  handleBackspace: () => void;
  handleDelete: () => void;
  handleEnter: () => void;
  close: () => void;
  syncValue: (value: number) => void;
  getResult: () => number | null;
}

/**
 * Calculator Integration Factory
 *
 * Creates an integration bridge between the raw calculator state machine and
 * the measurement system. It handles mapping user inputs (keys, actions)
 * to calculator state transitions.
 *
 * @returns A CalculatorIntegration instance.
 */
export function createCalculatorIntegration(): CalculatorIntegration {
  const calculator = createCalculatorState();

  function open(baseValue: number) {
    calculator.dispatch({ type: "OPEN", baseValue });
  }

  function handleInput(key: string) {
    if (/^[0-9.]$/.test(key)) {
      calculator.dispatch({ type: "INPUT_DIGIT", digit: key });
    } else if (/^[+\-*/]$/.test(key)) {
      calculator.dispatch({
        type: "INPUT_OPERATION",
        operation: key as CalculatorOperation,
      });
    }
  }

  function handleBackspace() {
    calculator.dispatch({ type: "BACKSPACE" });
  }

  function handleDelete() {
    calculator.dispatch({ type: "DELETE" });
  }

  function handleEnter() {
    calculator.dispatch({ type: "ENTER" });
  }

  function close() {
    calculator.dispatch({ type: "CLOSE" });
  }

  function syncValue(value: number) {
    calculator.dispatch({ type: "SYNC_VALUE", value });
  }

  function getResult(): number | null {
    const state = calculator.getState();
    return state.result;
  }

  return {
    getState: calculator.getState,
    open,
    handleInput,
    handleBackspace,
    handleDelete,
    handleEnter,
    close,
    syncValue,
    getResult,
  };
}

/**
 * Opens and initializes the calculator using the value from a specific measurement line.
 *
 * @param calculator - The calculator integration instance to open.
 * @param line - The measurement line providing the base numeric value.
 */
export function openCalculatorFromLine(calculator: CalculatorIntegration, line: MeasurementLine) {
  calculator.open(line.value);
}
