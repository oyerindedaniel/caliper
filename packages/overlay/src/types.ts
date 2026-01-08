

import type {
  MeasurementResult,
  CalculatorState,
  MeasurementLine,
  AnimationConfig,
  SelectionMetadata,
  DeepRequired,
  ProjectionState,
  RulerState,
} from "@caliper/core";
import type { Accessor } from "solid-js";

export interface OverlayProps {
  result: Accessor<MeasurementResult | null>;
  cursor: Accessor<{ x: number; y: number }>;
  selectionMetadata: Accessor<SelectionMetadata>;
  isAltPressed: Accessor<boolean>;
  isFrozen: Accessor<boolean>;
  animation: DeepRequired<AnimationConfig>;
  viewport: Accessor<{
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  }>;
  calculatorState?: Accessor<CalculatorState | null>;
  projectionState?: Accessor<ProjectionState>;
  rulerState?: Accessor<RulerState>;
  onLineClick?: (line: MeasurementLine, liveValue: number) => void;
  onRulerUpdate?: (id: string, position: number) => void;
  onRulerRemove?: (id: string) => void;
  onCalculatorInput?: (key: string) => void;
  onCalculatorBackspace?: () => void;
  onCalculatorDelete?: () => void;
  onCalculatorEnter?: () => void;
  onCalculatorClose?: () => void;
}
