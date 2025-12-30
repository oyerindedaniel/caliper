

import type {
  MeasurementResult,
  CalculatorState,
  MeasurementLine,
  AnimationConfig,
} from "@caliper/core";
import type { Accessor } from "solid-js";

export interface OverlayProps {
  result: Accessor<MeasurementResult | null>;
  cursor: Accessor<{ x: number; y: number }>;
  selectionRect: Accessor<DOMRect | null>;
  isAltPressed: Accessor<boolean>;
  isFrozen: Accessor<boolean>;
  animation: Required<AnimationConfig>;
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
