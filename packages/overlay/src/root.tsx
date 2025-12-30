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
  type AnimationConfig,
} from "@caliper/core";
import { Overlay } from "./ui/utils/render-overlay.jsx";

interface RootConfig {
  commands: Required<CommandsConfig>;
  animation: Required<AnimationConfig>;
}

export function Root(config: RootConfig) {
  const { commands, animation } = config;
  const [result, setResult] = createSignal<MeasurementResult | null>(null);
  const [cursor, setCursor] = createSignal({ x: 0, y: 0 });
  const [initialSelectedRect, setInitialSelectedRect] =
    createSignal<DOMRect | null>(null);
  const [selectedRect, setSelectedRect] = createSignal<DOMRect | null>(null);
  const [calculatorState, setCalculatorState] =
    createSignal<CalculatorState | null>(null);

  let system: MeasurementSystem | null = null;
  let selectionSystem: SelectionSystem | null = null;
  const [isAltPressed, setIsAltPressed] = createSignal(false);
  let isFirstRectAfterSelection = false;


  onMount(() => {
    selectionSystem = createSelectionSystem();
    system = createMeasurementSystem(selectionSystem);

    const unsubscribe = system.onStateChange(() => {
      if (!system) return;
      const currentResult = system.getCurrentResult();
      console.log("Root: Measurement update received", {
        linesCount: currentResult?.lines.length ?? 0,
        hasSecondary: !!currentResult?.secondary
      });
      setResult(currentResult);
    });

    // Initial sync
    const currentResult = system.getCurrentResult();
    setResult(currentResult);

    const unsubscribeRect = selectionSystem.onRectUpdate((rect) => {
      if (isFirstRectAfterSelection && rect) {
        setInitialSelectedRect(rect);
        isFirstRectAfterSelection = false;
      }
    });

    const unsubscribeHoverRect = selectionSystem.onHoverRectUpdate((rect) => {
      if (initialSelectedRect()) {
        setSelectedRect(rect);
      }
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

          isFirstRectAfterSelection = true;
          lastHoveredElement = null;
          suppressionFrames = 0;
          selectionSystem.select(element);
        }
      }
    };

    let lastMouseEvent: MouseEvent | null = null;
    let mouseMoveRafId: number | null = null;
    let lastHoveredElement: Element | null = null;
    let suppressionFrames = 0;

    const processMouseMove = () => {
      if (!lastMouseEvent || !selectionSystem) {
        mouseMoveRafId = null;
        return;
      }

      const e = lastMouseEvent;
      setCursor({ x: e.clientX, y: e.clientY });

      if (initialSelectedRect()) {
        if (isAltPressed()) {
          console.log("Root: Measuring mode");
          // MEASURING MODE
          if (system && selectionSystem.getSelected()) {
            system.measure(selectionSystem.getSelected()!, {
              x: e.clientX,
              y: e.clientY,
            });
          }
        } else {
          console.log("Root: Selection mode");
          // SELECTION MODE
          const hoveredElement = document.elementFromPoint(e.clientX, e.clientY);
          if (hoveredElement) {
            // GLITCH SUPPRESSION: Ignore transient parent hits between siblings for 1 frame
            const isAncestor =
              lastHoveredElement &&
              hoveredElement.contains(lastHoveredElement) &&
              hoveredElement !== lastHoveredElement;

            if (isAncestor && suppressionFrames < 1) {
              suppressionFrames++;
            } else {
              suppressionFrames = 0;
              lastHoveredElement = hoveredElement;
              selectionSystem.hover(hoveredElement);
            }
          }
        }
      }

      mouseMoveRafId = null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      lastMouseEvent = e;
      if (!mouseMoveRafId) {
        mouseMoveRafId = requestAnimationFrame(processMouseMove);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt key activates measuring mode - only if we have a selection
      if (e.key === commands.activate && !e.repeat && initialSelectedRect()) {
        console.log("Root: activate measuring mode");
        setIsAltPressed(true);
      }
      // Space key freezes current measurement
      else if (
        e.key === commands.freeze &&
        e.target === document.body &&
        system &&
        system.getState() === "MEASURING"
      ) {
        console.log("Root: freezing measurement");
        e.preventDefault();
        system.freeze();
      }
      // Escape key clears selection
      else if (e.key === commands.clear) {
        console.log("Root: clearing selection and measurements");
        if (selectionSystem) {
          setInitialSelectedRect(null);
          setSelectedRect(null);
          lastHoveredElement = null;
          suppressionFrames = 0;
          selectionSystem.clear();
        }
        if (system) {
          system.abort();
          setResult(null);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      console.log("Root: handleKeyUp", e.key);
      // Alt release only stops measuring, does NOT clear selection
      if (e.key === commands.activate) {
        if (isAltPressed()) {
          console.log("Root: Stop measuring");
          setIsAltPressed(false);
          if (system) {
            const state = system.getState();
            // Stop measuring but keep selection intact
            if (state !== "FROZEN") {
              system.stop();
              // Clear measurement result but keep selection
              setResult(null);
            }
          }
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

      if (mouseMoveRafId) {
        cancelAnimationFrame(mouseMoveRafId);
      }

      unsubscribe();
      unsubscribeRect();
      unsubscribeHoverRect();

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
      initialSelectedRect={initialSelectedRect}
      selectedRect={selectedRect}
      isAltPressed={isAltPressed}
      animation={animation}
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
