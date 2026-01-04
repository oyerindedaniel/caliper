

import type {
  MeasurementResult,
  CalculatorState,
  MeasurementLine,
  AnimationConfig,
  SelectionMetadata,
} from "@caliper/core";
import type { Accessor } from "solid-js";

export interface OverlayProps {
  result: Accessor<MeasurementResult | null>;
  cursor: Accessor<{ x: number; y: number }>;
  selectionMetadata: Accessor<SelectionMetadata>;
  isAltPressed: Accessor<boolean>;
  isFrozen: Accessor<boolean>;
  animation: Required<AnimationConfig>;
  viewport: Accessor<{
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  }>;
  calculatorState?: Accessor<CalculatorState | null>;
  onLineClick?: (line: MeasurementLine, liveValue: number) => void;
  onCalculatorInput?: (key: string) => void;
  onCalculatorBackspace?: () => void;
  onCalculatorDelete?: () => void;
  onCalculatorEnter?: () => void;
  onCalculatorClose?: () => void;
}

export interface OverlayOptions {
  // Future options can be added here
}
