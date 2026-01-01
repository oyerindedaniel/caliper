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
  getElementAtPoint,
  getTopElementAtPoint,
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
  const [selectionRect, setSelectionRect] = createSignal<DOMRect | null>(null);
  const [calculatorState, setCalculatorState] =
    createSignal<CalculatorState | null>(null);

  let system: MeasurementSystem | null = null;
  let selectionSystem: SelectionSystem | null = null;
  const [isAltPressed, setIsAltPressed] = createSignal(false);
  const [isFrozen, setIsFrozen] = createSignal(false);
  let isFirstRectAfterSelection = false;

  onMount(() => {
    selectionSystem = createSelectionSystem();
    system = createMeasurementSystem();

    const unsubscribe = system.onStateChange(() => {
      if (!system) return;
      const currentResult = system.getCurrentResult();
      setResult(currentResult);
      setIsFrozen(system.getState() === "FROZEN");
    });

    // Initial sync
    const currentResult = system.getCurrentResult();
    setResult(currentResult);

    const unsubscribeRect = selectionSystem.onRectUpdate((rect) => {
      if (isFirstRectAfterSelection && rect) {
        setSelectionRect(rect);
        isFirstRectAfterSelection = false;
      }
    });

    const unsubscribeHoverRect = selectionSystem.onHoverRectUpdate((rect) => {
      if (selectionSystem?.getSelected()) {
        setSelectionRect(rect);
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

        const element = getTopElementAtPoint(e.clientX, e.clientY);

        if (element && selectionSystem) {
          setSelectionRect(null);
          setResult(null);

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

      const selectedElement = selectionSystem.getSelected();
      const isAlt = isAltPressed();
      const state = system?.getState();

      if (selectedElement) {
        if (isAlt) {
          if (system) {
            system.measure(selectedElement, { x: e.clientX, y: e.clientY });
          }
        } else if (state !== "FROZEN") {
          const hoveredElement = getTopElementAtPoint(e.clientX, e.clientY);

          if (hoveredElement) {
            const isAncestor = lastHoveredElement && hoveredElement.contains(lastHoveredElement) && hoveredElement !== lastHoveredElement;
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
      if (e.key === commands.clear) {
        setIsAltPressed(false);
        setIsFrozen(false);
        setCalculatorState(null);

        if (selectionSystem) {
          setSelectionRect(null);
          lastHoveredElement = null;
          suppressionFrames = 0;
          selectionSystem.clear();
        }
        if (system) {
          system.abort();
          const calc = system.getCalculator();
          calc.close();
          setResult(null);
        }
        return;
      }

      if (calculatorState()) return;

      const isSelectKey =
        (commands.select === "Control" && e.ctrlKey) ||
        (commands.select === "Meta" && e.metaKey);

      if (isSelectKey && !isFrozen()) {
        const x = lastMouseEvent?.clientX || 0;
        const y = lastMouseEvent?.clientY || 0;
        const element = getElementAtPoint(x, y);

        if (element && selectionSystem) {
          selectionSystem.hover(element);
        }
      }

      const isAltKey = e.key === "Alt" || e.key === "AltGraph" || e.key === commands.activate;

      if (isAltKey) {
        e.preventDefault();
        if (!isAltPressed() && system) {
          system.abort();
          setResult(null);
        }
        setIsAltPressed(true);
      }
      else if (
        e.key === commands.freeze &&
        e.target === document.body &&
        system
      ) {
        const state = system.getState();
        if (state === "FROZEN") {
          e.preventDefault();
          system.unfreeze(isAltPressed());
        } else if (state === "MEASURING" || system.getCurrentResult()) {
          e.preventDefault();
          system.freeze();
        }
      }
      else if (isFrozen() && result()) {
        const key = e.key.toLowerCase();
        const typeMap: Record<string, string> = {
          t: "top",
          r: "right",
          b: "bottom",
          l: "left",
        };
        const targetType = typeMap[key];
        if (targetType || key === "d") {
          const currentLines = result()?.lines || [];
          const targetLine =
            currentLines.find((l) => l.type === targetType) ||
            (currentLines.length === 1 && (currentLines[0]?.type === "distance" || targetType)
              ? currentLines[0]
              : null);

          if (targetLine) {
            e.preventDefault();
            handleLineClick(targetLine, null as any);
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (calculatorState()) return;

      const isAltKey = e.key === "Alt" || e.key === "AltGraph" || e.key === commands.activate;

      if (isAltKey) {
        e.preventDefault();
        if (isAltPressed()) {
          setIsAltPressed(false);
          if (system) {
            system.stop();
          }
        }
      }
    };

    const handleBlur = () => {
      if (isAltPressed()) {
        setIsAltPressed(false);
        if (system) {
          system.stop();
          setResult(null);
        }
      }
    };

    window.addEventListener("click", handleClick, true);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    onCleanup(() => {
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);

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
      selectionRect={selectionRect}
      isAltPressed={isAltPressed}
      isFrozen={isFrozen}
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
