/**
 * Calculator command integration
 * Allows triggering calculator with keyboard shortcuts
 */

export type CalculatorCommand = "=" | "C" | "Escape";

/**
 * Handle calculator command keys
 * = : Open calculator with first measurement line value
 * C : Open calculator with current measurement
 * Escape : Close calculator
 */
export function handleCalculatorCommand(
  command: CalculatorCommand,
  measurementSystem: {
    getCurrentResult: () => { lines: Array<{ value: number }> } | null;
    getCalculator: () => { open: (value: number) => void; close: () => void };
  }
): boolean {
  const calculator = measurementSystem.getCalculator();
  const result = measurementSystem.getCurrentResult();

  switch (command) {
    case "=":
      // Open calculator with first measurement line value
      if (result && result.lines.length > 0 && result.lines[0]) {
        calculator.open(result.lines[0].value);
        return true;
      }
      break;

    case "C":
      // Open calculator with current measurement (average of all lines)
      if (result && result.lines.length > 0) {
        const avg =
          result.lines.reduce((sum, line) => sum + line.value, 0) /
          result.lines.length;
        calculator.open(avg);
        return true;
      }
      break;

    case "Escape":
      // Close calculator
      calculator.close();
      return true;
  }

  return false;
}

/**
 * Check if a key is a calculator command
 */
export function isCalculatorCommand(key: string): key is CalculatorCommand {
  return key === "=" || key === "c" || key === "C" || key === "Escape";
}

