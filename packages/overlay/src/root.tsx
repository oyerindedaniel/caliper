import { onMount, onCleanup, createSignal } from "solid-js";
import {
  createMeasurementSystem,
  createSelectionSystem,
  type MeasurementSystem,
  type SelectionSystem,
  type MeasurementResult,
  type CalculatorState,
  type MeasurementLine,
  type CommandsConfig,
} from "@caliper/core";
import { Overlay } from "./ui/utils/render-overlay.jsx";

export function Root(commands: Required<CommandsConfig>) {
  const [result, setResult] = createSignal<MeasurementResult | null>(null);
  const [cursor, setCursor] = createSignal({ x: 0, y: 0 });
  const [selectedRect, setSelectedRect] = createSignal<DOMRect | null>(null);
  const [calculatorState, setCalculatorState] =
    createSignal<CalculatorState | null>(null);

  let system: MeasurementSystem | null = null;
  let selectionSystem: SelectionSystem | null = null;
  let isAltPressed = false;

  console.log("Overlay mounted---");

  onMount(() => {
    selectionSystem = createSelectionSystem();
    system = createMeasurementSystem(selectionSystem);

    const unsubscribe = system.onStateChange(() => {
      if (!system) return;
      const currentResult = system.getCurrentResult();
      setResult(currentResult);
    });

    // Initial sync
    const currentResult = system.getCurrentResult();
    setResult(currentResult);

    const unsubscribeRect = selectionSystem.onRectUpdate((rect) => {
      setSelectedRect(rect);
    });

    const handleClick = (e: MouseEvent) => {
      const isSelectKey =
        (commands.select === "Control" && e.ctrlKey) ||
        (commands.select === "Meta" && e.metaKey) ||
        e.ctrlKey ||
        e.metaKey;

      if (isSelectKey) {
        e.preventDefault();
        e.stopPropagation();

        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (element && selectionSystem) {
          if (system) {
            system.abort();
          }

          selectionSystem.select(element);
          // Rect will be updated via onRectUpdate callback when ready
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      setCursor({ x: e.clientX, y: e.clientY });

      // Only measure if ALT is held AND element is selected
      if (isAltPressed && selectionSystem?.getSelected() && system) {
        system.measure(selectionSystem.getSelected()!, {
          x: e.clientX,
          y: e.clientY,
        });
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === commands.activate && !e.repeat) {
        isAltPressed = true;
      } else if (
        e.key === commands.freeze &&
        e.target === document.body &&
        system &&
        system.getState() === "MEASURING"
      ) {
        e.preventDefault();
        system.freeze();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === commands.activate) {
        isAltPressed = false;
        if (system) {
          const state = system.getState();
          // Only clear selection if not frozen
          if (state !== "FROZEN" && selectionSystem) {
            selectionSystem.clear();
            setSelectedRect(null);
          }
          system.stop();
        }
      }
    };

    window.addEventListener("click", handleClick, true);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    onCleanup(() => {
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);

      unsubscribe();
      unsubscribeRect();

      if (system) {
        system.cleanup();
        system = null;
      }

      if (selectionSystem) {
        selectionSystem.clear();
        selectionSystem = null;
      }
    });
  });

  const handleLineClick = (line: MeasurementLine, event: MouseEvent) => {
    if (system) {
      const calc = system.getCalculator();
      calc.open(line.value);
      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
    }
  };

  const handleCalculatorInput = (key: string) => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleInput(key);
      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
    }
  };

  const handleCalculatorBackspace = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleBackspace();
      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
    }
  };

  const handleCalculatorDelete = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleDelete();
      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
    }
  };

  const handleCalculatorEnter = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleEnter();
      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
    }
  };

  const handleCalculatorClose = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.close();
      setCalculatorState(null);
    }
  };

  return (
    <Overlay
      result={result}
      cursor={cursor}
      selectedRect={selectedRect}
      calculatorState={calculatorState}
      onLineClick={handleLineClick}
      onCalculatorInput={handleCalculatorInput}
      onCalculatorBackspace={handleCalculatorBackspace}
      onCalculatorDelete={handleCalculatorDelete}
      onCalculatorEnter={handleCalculatorEnter}
      onCalculatorClose={handleCalculatorClose}
    />
  );
}
