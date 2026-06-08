import type {
  MeasurementResult,
  CalculatorState,
  MeasurementLine,
  AnimationConfig,
  SelectionMetadata,
  DeepRequired,
  ProjectionState,
  RulerState,
  HandoffRegistry,
  HandoffUIState,
} from "@caliper/core";
import type { Accessor } from "solid-js";

export interface OverlayProps {
  result: Accessor<MeasurementResult | null>;
  cursor: Accessor<{ x: number; y: number }>;
  selectionMetadata: Accessor<SelectionMetadata>;
  isActivatePressed: Accessor<boolean>;
  isFrozen: Accessor<boolean>;
  animation: DeepRequired<AnimationConfig>;
  viewport: Accessor<{
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  }>;
  handoffRegistry?: HandoffRegistry;
  handoffState?: Accessor<HandoffUIState | null>;
  onMentionOpenChange?: (open: boolean) => void;
  calculatorState?: Accessor<CalculatorState | null>;
  projectionState?: Accessor<ProjectionState>;
  rulerState?: Accessor<RulerState>;
  activeFocus?: Accessor<"calculator" | "projection">;
  isCopied?: Accessor<boolean>;
  onLineClick?: (line: MeasurementLine, liveValue: number) => void;
  onRulerUpdate?: (id: string, position: number) => void;
  onRulerRemove?: (id: string) => void;
  onCalculatorClose?: () => void;
}
