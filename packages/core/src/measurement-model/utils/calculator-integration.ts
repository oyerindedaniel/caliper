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
  getResult: () => number | null;
}

/**
 * Create calculator integration for measurement system
 */
export function createCalculatorIntegration(): CalculatorIntegration {
  const calculator = createCalculatorState();

  function open(baseValue: number) {
    calculator.dispatch({ type: "OPEN", baseValue });
  }

  function handleInput(key: string) {
    if (/^[0-9]$/.test(key)) {
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
    getResult,
  };
}

/**
 * Open calculator from measurement line
 */
export function openCalculatorFromLine(
  calculator: CalculatorIntegration,
  line: MeasurementLine
) {
  calculator.open(line.value);
}
