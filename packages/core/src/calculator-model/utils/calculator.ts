/**
 * Parse and evaluate a simple math expression
 * Supports: +, -, *, /, parentheses
 * Example: "24px + 8px" -> 32
 */
export function calculate(expression: string, baseValue: number): number | null {
  try {
    // Remove "px" units and whitespace
    const cleaned = expression.replace(/px/gi, "").replace(/\s/g, "");

    // Replace base value placeholder if present
    const withBase = cleaned.replace(/\bvalue\b/gi, baseValue.toString());

    // Evaluate the expression
    // Using Function constructor for safe evaluation
    // Only allow numbers, operators, and parentheses
    if (!/^[0-9+\-*/().\s]+$/.test(withBase)) {
      return null;
    }

    const result = Function(`"use strict"; return (${withBase})`)();
    return typeof result === "number" ? result : null;
  } catch {
    return null;
  }
}

/**
 * Parse a measurement expression
 * Supports formats like:
 * - "24px + 8px"
 * - "value * 2"
 * - "(24 + 8)px"
 */
export function parseMeasurement(
  expression: string,
  baseValue: number
): { value: number; unit: string } | null {
  const result = calculate(expression, baseValue);
  if (result === null) {
    return null;
  }

  // Extract unit from original expression
  const unitMatch = expression.match(/(px|em|rem|%)/i);
  const unit = unitMatch?.[1] ?? "px";

  return {
    value: result,
    unit,
  };
}

/**
 * Format a calculated result
 */
export function formatResult(value: number, unit: string): string {
  // Round to 2 decimal places
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${unit}`;
}
