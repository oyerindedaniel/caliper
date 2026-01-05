/**
 * Calculator state machine
 */

export type CalculatorOperation = "+" | "-" | "*" | "/";

export interface CalculatorState {
  baseValue: number;
  operation: CalculatorOperation | null;
  inputValue: string;
  result: number | null;
  isActive: boolean;
}

export type CalculatorAction =
  | { type: "OPEN"; baseValue: number }
  | { type: "INPUT_DIGIT"; digit: string }
  | { type: "INPUT_OPERATION"; operation: CalculatorOperation }
  | { type: "BACKSPACE" }
  | { type: "DELETE" }
  | { type: "ENTER" }
  | { type: "SYNC_VALUE"; value: number }
  | { type: "CLOSE" };

export function createCalculatorState(): {
  getState: () => CalculatorState;
  dispatch: (action: CalculatorAction) => CalculatorState;
  calculate: () => number | null;
} {
  let state: CalculatorState = {
    baseValue: 0,
    operation: null,
    inputValue: "",
    result: null,
    isActive: false,
  };

  function calculate(): number | null {
    if (!state.operation || state.inputValue === "") {
      return null;
    }

    const inputNum = parseFloat(state.inputValue);
    if (isNaN(inputNum)) {
      return null;
    }

    switch (state.operation) {
      case "+":
        return state.baseValue + inputNum;
      case "-":
        return state.baseValue - inputNum;
      case "*":
        return state.baseValue * inputNum;
      case "/":
        return inputNum !== 0 ? state.baseValue / inputNum : null;
      default:
        return null;
    }
  }

  function dispatch(action: CalculatorAction): CalculatorState {
    switch (action.type) {
      case "OPEN":
        state = {
          baseValue: action.baseValue,
          operation: null,
          inputValue: "",
          result: null,
          isActive: true,
        };
        break;

      case "SYNC_VALUE":
        // Only sync if the user hasn't started an operation yet
        if (state.isActive && state.operation === null) {
          state = {
            ...state,
            baseValue: action.value,
          };
        }
        break;

      case "INPUT_DIGIT":
        if (!state.isActive || !state.operation) return state;
        state = {
          ...state,
          inputValue: state.inputValue + action.digit,
        };
        break;

      case "INPUT_OPERATION":
        if (!state.isActive) return state;
        // If already has operation and input, calculate first
        if (state.operation && state.inputValue !== "") {
          const newBase = calculate() ?? state.baseValue;
          state = {
            baseValue: newBase,
            operation: action.operation,
            inputValue: "",
            result: null,
            isActive: true,
          };
        } else {
          state = {
            ...state,
            operation: action.operation,
            inputValue: "",
          };
        }
        break;

      case "BACKSPACE":
        if (!state.isActive) return state;

        if (state.result !== null) {
          // Remove result first, keeping operation and input
          state = {
            ...state,
            result: null,
          };
        } else if (state.inputValue.length > 0) {
          // Remove last digit
          state = {
            ...state,
            inputValue: state.inputValue.slice(0, -1),
          };
        } else if (state.operation) {
          // Remove operation
          state = {
            ...state,
            operation: null,
          };
        } else {
          // Close if nothing left
          state = {
            ...state,
            isActive: false,
          };
        }
        break;

      case "DELETE":
        if (!state.isActive) return state;
        state = {
          baseValue: state.baseValue,
          operation: null,
          inputValue: "",
          result: null,
          isActive: false,
        };
        break;

      case "ENTER":
        if (!state.isActive || !state.operation || state.inputValue === "") {
          return state;
        }
        const result = calculate();
        state = {
          ...state,
          result: result,
        };
        break;

      case "CLOSE":
        state = {
          baseValue: 0,
          operation: null,
          inputValue: "",
          result: null,
          isActive: false,
        };
        break;
    }

    return state;
  }

  function getState(): CalculatorState {
    return { ...state };
  }

  return { getState, dispatch, calculate };
}
