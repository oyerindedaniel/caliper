import { onMount, onCleanup, createSignal, createEffect } from "solid-js";
import {
  createMeasurementSystem,
  createSelectionSystem,
  type MeasurementSystem,
  type SelectionSystem,
  type MeasurementResult,
  type CalculatorState,
  type SelectionMetadata,
  type MeasurementLine,
  type CommandsConfig,
  type AnimationConfig,
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
  const [viewport, setViewport] = createSignal({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const [selectionMetadata, setSelectionMetadata] = createSignal<SelectionMetadata>({
    element: null,
    rect: null,
    relativeRect: null,
    container: null,
  });
  const [calculatorState, setCalculatorState] =
    createSignal<CalculatorState | null>(null);

  let system: MeasurementSystem | null = null;
  let selectionSystem: SelectionSystem | null = null;
  const [isAltPressed, setIsAltPressed] = createSignal(false);
  const [isFrozen, setIsFrozen] = createSignal(false);

  let viewportRafId: number | null = null;
  let pendingScroll = false;
  let pendingResize = false;

  const syncViewport = () => {
    setViewport((prev) => {
      const patch: Partial<typeof prev> = {};
      if (pendingScroll || pendingResize) {
        patch.scrollX = window.scrollX;
        patch.scrollY = window.scrollY;
      }
      if (pendingResize) {
        patch.width = window.innerWidth;
        patch.height = window.innerHeight;
      }
      return { ...prev, ...patch };
    });
    pendingScroll = false;
    pendingResize = false;
    viewportRafId = null;
  };

  const scheduleScrollUpdate = () => {
    pendingScroll = true;
    if (!viewportRafId) viewportRafId = requestAnimationFrame(syncViewport);
  };

  const scheduleResizeUpdate = () => {
    pendingResize = true;
    if (!viewportRafId) viewportRafId = requestAnimationFrame(syncViewport);
  };

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

    const [isSelectKeyDown, setIsSelectKeyDown] = createSignal(false);

    const unsubscribeUpdate = selectionSystem.onUpdate((metadata) => {
      setSelectionMetadata(metadata);
    });

    const isCommandActive = (e: MouseEvent): boolean => {
      const { ctrlKey, metaKey, altKey, shiftKey } = e;
      const key = commands.select;

      const modifiers: Record<string, boolean> = {
        Control: ctrlKey,
        Meta: metaKey,
        Alt: altKey,
        Shift: shiftKey
      };

      if (key in modifiers) {
        return Object.entries(modifiers).every(([name, value]) =>
          name === key ? value === true : value === false
        );
      }

      return isSelectKeyDown() && !ctrlKey && !metaKey && !altKey && !shiftKey;
    };

    const handleClick = (e: MouseEvent) => {
      if (isCommandActive(e)) {
        e.preventDefault();
        e.stopPropagation();

        const element = getTopElementAtPoint(e.clientX, e.clientY);

        if (element && selectionSystem) {
          setResult(null);
          setCalculatorState(null);

          if (system) {
            system.abort();
            system.getCalculator().close();
          }

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
    let trailingTimer: ReturnType<typeof setTimeout> | null = null;

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

            if (trailingTimer) {
              clearTimeout(trailingTimer);
              trailingTimer = null;
            }

            if (isAncestor && suppressionFrames < 8) {
              suppressionFrames++;

              trailingTimer = setTimeout(() => {
                suppressionFrames = 0;
                lastHoveredElement = hoveredElement;
                selectionSystem?.select(hoveredElement);
                trailingTimer = null;
              }, 30);
            } else {
              suppressionFrames = 0;
              lastHoveredElement = hoveredElement;
              selectionSystem.select(hoveredElement);
            }
          } else if (trailingTimer) {
            clearTimeout(trailingTimer);
            trailingTimer = null;
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

      if (e.key === commands.select) {
        setIsSelectKeyDown(true);
      }

      if (calculatorState()) return;

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
        const typeMap: Record<string, MeasurementLine["type"]> = {
          t: "top",
          r: "right",
          b: "bottom",
          l: "left",
          d: "distance"
        };
        const targetType = typeMap[key];
        if (targetType) {
          const currentLines = result()?.lines || [];
          const targetLine = currentLines.find((l) => l.type === targetType)
          if (targetLine) {
            e.preventDefault();
            handleLineClick(targetLine);
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === commands.select) {
        setIsSelectKeyDown(false);
      }

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
      if (trailingTimer) {
        clearTimeout(trailingTimer);
      }

      unsubscribe();
      unsubscribeUpdate();

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

  createEffect(() => {
    const active = !!selectionMetadata().element || !!result();

    if (active) {
      window.addEventListener("scroll", scheduleScrollUpdate, { passive: true });
      window.addEventListener("resize", scheduleResizeUpdate, { passive: true });
      // Initial sync
      pendingScroll = true;
      pendingResize = true;
      syncViewport();
    }

    onCleanup(() => {
      window.removeEventListener("scroll", scheduleScrollUpdate);
      window.removeEventListener("resize", scheduleResizeUpdate);
      if (viewportRafId) {
        cancelAnimationFrame(viewportRafId);
        viewportRafId = null;
      }
      pendingScroll = false;
      pendingResize = false;
    });
  });

  const handleLineClick = (line: MeasurementLine) => {
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
      selectionMetadata={selectionMetadata}
      isAltPressed={isAltPressed}
      isFrozen={isFrozen}
      animation={animation}
      viewport={viewport}
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
