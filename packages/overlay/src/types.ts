/**
 * Type definitions for overlay components
 * Exported separately to avoid JSX type conflicts in React
 */

import type {
  MeasurementResult,
  CalculatorState,
  MeasurementLine,
} from "@caliper/core";
import type { Accessor } from "solid-js";

export interface OverlayProps {
  result: Accessor<MeasurementResult | null>;
  cursor: Accessor<{ x: number; y: number }>;
  selectedRect: Accessor<DOMRect | null>;
  calculatorState?: Accessor<CalculatorState | null>;
  onLineClick?: (line: MeasurementLine, event: MouseEvent) => void;
  onCalculatorInput?: (key: string) => void;
  onCalculatorBackspace?: () => void;
  onCalculatorDelete?: () => void;
  onCalculatorEnter?: () => void;
  onCalculatorClose?: () => void;
}

export interface OverlayOptions {
  // Future options can be added here
}
