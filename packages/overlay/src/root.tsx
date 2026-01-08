import { onMount, onCleanup, createSignal, createEffect } from "solid-js";
import {
  createMeasurementSystem,
  createSelectionSystem,
  createSuppressionDelegate,
  createProjectionSystem,
  type MeasurementSystem,
  type SelectionSystem,
  type MeasurementResult,
  type CalculatorState,
  type ProjectionState,
  type SelectionMetadata,
  type CommandsConfig,
  type AnimationConfig,
  getTopElementAtPoint,
  getLiveLineValue,
  getLiveGeometry,
  createRulerSystem,
  type MeasurementLine,
  type DeepRequired,
  type ProjectionSystem,
  type ProjectionDirection,
  type RulerSystem,
  type RulerState,
  SELECTION_HOLD_DURATION,
} from "@caliper/core";
import { Overlay } from "./ui/utils/render-overlay.jsx";
import { PREFIX } from "./css/styles.js";

interface RootConfig {
  commands: DeepRequired<CommandsConfig>;
  animation: DeepRequired<AnimationConfig>;
}

export function Root(config: RootConfig) {
  const { commands, animation } = config;

  const [result, setResult] = createSignal<MeasurementResult | null>(null);
  const [cursor, setCursor] = createSignal({ x: 0, y: 0 });
  const [viewport, setViewport] = createSignal({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    version: 0,
  });

  const [selectionMetadata, setSelectionMetadata] = createSignal<SelectionMetadata>({
    element: null,
    rect: null,
    scrollHierarchy: [],
    position: "static",
    initialWindowX: 0,
    initialWindowY: 0,
  });

  const [calculatorState, setCalculatorState] = createSignal<CalculatorState | null>(null);
  const [projectionState, setProjectionState] = createSignal<ProjectionState>({ direction: null, value: "", element: null });
  const [activeCalculatorLine, setActiveCalculatorLine] = createSignal<MeasurementLine | null>(null);
  const [isSelectKeyDown, setIsSelectKeyDown] = createSignal(false);
  const [activeInputFocus, setActiveInputFocus] = createSignal<"calculator" | "projection">("calculator");

  let system: MeasurementSystem | null = null;
  let selectionSystem: SelectionSystem | null = null;
  let projectionSystem: ProjectionSystem | null = null;
  let rulerSystem: RulerSystem | null = null;

  const [rulerState, setRulerState] = createSignal<RulerState>({ lines: [] });

  const [isAltPressed, setIsAltPressed] = createSignal(false);
  const [isFrozen, setIsFrozen] = createSignal(false);

  let viewportRafId: number | null = null;

  const syncViewport = () => {
    setViewport((prev) => ({
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      version: (prev.version || 0) + 1,
    }));
    viewportRafId = null;
  };

  const scheduleUpdate = () => {
    if (!viewportRafId) {
      viewportRafId = requestAnimationFrame(syncViewport);
    }
  };

  onMount(() => {
    selectionSystem = createSelectionSystem();
    system = createMeasurementSystem();
    projectionSystem = createProjectionSystem();

    const unsubscribeProjection = projectionSystem.onUpdate((state) => {
      setProjectionState(state);
    });

    rulerSystem = createRulerSystem();
    const unsubscribeRuler = rulerSystem.onUpdate((state) => {
      setRulerState(state);
    });

    const unsubscribe = system.onStateChange(() => {
      if (!system) {
        return;
      }

      const currentResult = system.getCurrentResult();
      setResult(currentResult);
      setIsFrozen(system.getState() === "FROZEN");
    });

    // Initial sync
    const currentResult = system.getCurrentResult();
    setResult(currentResult);

    const unsubscribeUpdate = selectionSystem.onUpdate((metadata) => {
      setSelectionMetadata(metadata);
    });

    let pointerDownTime = 0;
    let selectionTimeoutId: number | null = null;
    let lastPointerPos = { x: 0, y: 0 };

    const performSelection = (x: number, y: number) => {
      const element = getTopElementAtPoint(x, y);
      if (element && selectionSystem) {
        setResult(null);
        setCalculatorState(null);
        setActiveInputFocus("calculator");

        if (projectionSystem) {
          projectionSystem.clear();
        }

        if (system) {
          system.abort();
          system.getCalculator().close();
        }

        lastHoveredElement = null;
        selectionDelegate.cancel();
        measureDelegate.cancel();
        selectionSystem.select(element);
      }
    };

    const isCommandActive = (e: MouseEvent | PointerEvent | KeyboardEvent): boolean => {
      const { ctrlKey, metaKey, altKey, shiftKey } = e;
      const key = commands.select;
      const modifiers: Record<string, boolean> = {
        Control: ctrlKey,
        Meta: metaKey,
        Alt: altKey,
        Shift: shiftKey,
      };

      if (key in modifiers) {
        return Object.entries(modifiers).every(([name, value]) =>
          name === key ? value === true : value === false
        );
      }

      return isSelectKeyDown() && !ctrlKey && !metaKey && !altKey && !shiftKey;
    };

    const handlePointerDown = (e: PointerEvent) => {
      lastPointerPos = { x: e.clientX, y: e.clientY };

      if (isCommandActive(e)) {
        pointerDownTime = Date.now();
        if (selectionTimeoutId) window.clearTimeout(selectionTimeoutId);
        selectionTimeoutId = window.setTimeout(() => {
          performSelection(lastPointerPos.x, lastPointerPos.y);
          selectionTimeoutId = null;
        }, SELECTION_HOLD_DURATION);
      } else {
        pointerDownTime = 0;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (selectionTimeoutId) {
        window.clearTimeout(selectionTimeoutId);
        selectionTimeoutId = null;
      }

      const target = e.target as HTMLElement;

      // If clicking on our own interactive UI, don't do background logic
      if (target.closest(`[data-caliper-ignore]`) || target.closest(`.${PREFIX}projection-input`)) {
        if (target.closest(`.${PREFIX}projection-input`)) {
          setActiveInputFocus("projection");
        }
        pointerDownTime = 0;
        return;
      }

      pointerDownTime = 0;
    };

    let lastMouseEvent: MouseEvent | null = null;
    let mouseMoveRafId: number | null = null;
    let lastHoveredElement: Element | null = null;

    const selectionDelegate = createSuppressionDelegate((el: Element) => {
      lastHoveredElement = el;
      selectionSystem?.select(el);
    });

    const measureDelegate = createSuppressionDelegate(
      (el: Element, cursor: { x: number; y: number }, hover: Element | null) => {
        if (hover) {
          lastHoveredElement = hover;
        }
        system?.measure(el, cursor);
      }
    );

    const processMouseMove = () => {
      if (!lastMouseEvent || !selectionSystem) {
        mouseMoveRafId = null;
        return;
      }

      const e = lastMouseEvent;
      const cursorPoint = { x: e.clientX, y: e.clientY };
      setCursor(cursorPoint);

      const selectedElement = selectionSystem.getSelected();
      const isAlt = isAltPressed();
      const state = system?.getState();

      if (selectedElement) {
        const hoveredElement = getTopElementAtPoint(e.clientX, e.clientY);
        const isAncestor =
          hoveredElement &&
          lastHoveredElement &&
          hoveredElement.contains(lastHoveredElement) &&
          hoveredElement !== lastHoveredElement;

        if (isAlt) {
          if (system) {
            measureDelegate.execute(!!isAncestor, selectedElement, cursorPoint, hoveredElement);
          }
        } else if (state !== "FROZEN") {
          if (hoveredElement) {
            selectionDelegate.execute(!!isAncestor, hoveredElement);
          }
        }
      }

      mouseMoveRafId = null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      lastMouseEvent = e;
      lastPointerPos = { x: e.clientX, y: e.clientY };
      if (!mouseMoveRafId) {
        mouseMoveRafId = requestAnimationFrame(processMouseMove);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === commands.clear) {
        setIsAltPressed(false);
        setCalculatorState(null);
        setActiveCalculatorLine(null);

        if (selectionSystem) {
          lastHoveredElement = null;
          selectionDelegate.cancel();
          measureDelegate.cancel();
          selectionSystem.clear();
        }

        if (projectionSystem) {
          projectionSystem.clear();
        }

        if (rulerSystem) {
          rulerSystem.clear();
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

      if (e.key.toLowerCase() === commands.ruler && e.shiftKey && rulerSystem) {
        e.preventDefault();
        const vp = viewport();
        const x = Math.max(0, Math.min(cursor().x, vp.width));
        const y = Math.max(0, Math.min(cursor().y, vp.height));
        rulerSystem.addPair(x, y);
        return;
      }

      const isAltKey = e.key === "Alt" || e.key === "AltGraph" || e.key === commands.activate;

      if (isAltKey) {
        e.preventDefault();

        if (!isAltPressed()) {
          if (system) {
            system.abort();
            setResult(null);
            handleCalculatorClose();
          }
          if (projectionSystem) {
            projectionSystem.clear();
          }
        }

        setIsAltPressed(true);
      } else if (e.key === commands.freeze && e.target === document.body && system) {
        const state = system.getState();

        if (state === "FROZEN") {
          e.preventDefault();
          system.unfreeze(isAltPressed());
        } else if (selectionMetadata().element) {
          e.preventDefault();
          system.freeze();
        }
      } else {
        const key = e.key.toLowerCase();
        const { calculator, projection } = commands;
        const isCalcActive = !!calculatorState();
        const isProjActive = projectionState().direction !== null;

        // 1. Handle Active Calculator Inputs (Numbers, Operators, etc)
        // High priority if focused OR if projection is not even active
        const shouldCalcGetNumbers = isCalcActive && (activeInputFocus() === "calculator" || !isProjActive);

        if (isCalcActive && (shouldCalcGetNumbers || !/^\d$/.test(e.key))) {
          const isNumeric = /^[0-9]$/.test(e.key);
          const isOperator = /^[+\-*/]$/.test(e.key);
          const isDecimal = e.key === ".";
          const isBackspace = e.key === "Backspace";
          const isDelete = e.key === "Delete";
          const isEnter = e.key === "Enter";
          const isEscape = e.key === "Escape";

          if (isNumeric || isOperator || isDecimal || isBackspace || isDelete || isEnter || isEscape) {
            // Only eat numbers if we have priority
            if ((isNumeric || isBackspace || isDecimal) && !shouldCalcGetNumbers) {
              // fall through to projection
            } else {
              e.preventDefault();
              e.stopPropagation();

              if (isNumeric || isOperator || isDecimal) handleCalculatorInput(e.key);
              else if (isBackspace) handleCalculatorBackspace();
              else if (isDelete) handleCalculatorDelete();
              else if (isEnter) handleCalculatorEnter();
              else if (isEscape) handleCalculatorClose();
              return;
            }
          }
        }

        // 2. Handle Projection Directions (WASD)
        // These keys take precedence over Measurement line triggers (like 'd' for distance).
        const dirMap: Record<string, ProjectionDirection> = {
          [projection.top]: "top",
          [projection.left]: "left",
          [projection.bottom]: "bottom",
          [projection.right]: "right",
        };
        const dir = dirMap[key];

        if (dir && selectionMetadata().element) {
          e.preventDefault();
          const currentElement = selectionMetadata().element;
          if (currentElement) {
            projectionSystem?.setElement(currentElement as HTMLElement);
          }
          projectionSystem?.setDirection(dir);

          // Lock the measurement when we start projecting
          if (system) {
            system.freeze();
          }

          const getRunway = (dir: ProjectionDirection) => {
            const metadata = selectionMetadata();
            const live = getLiveGeometry(
              metadata.rect,
              metadata.scrollHierarchy,
              metadata.position,
              metadata.stickyConfig,
              metadata.initialWindowX,
              metadata.initialWindowY
            );
            if (!live) return undefined;
            const vp = viewport();
            switch (dir) {
              case "top": return live.top - window.scrollY;
              case "bottom": return vp.height - (live.top - window.scrollY + live.height);
              case "left": return live.left - window.scrollX;
              case "right": return vp.width - (live.left - window.scrollX + live.width);
            }
          };

          const maxRunway = getRunway(dir);
          if (maxRunway !== undefined) projectionSystem?.capValue(maxRunway);
          return;
        }

        // 3. Handle Projection Value Inputs (Numeric/Backspace)
        // Only if Projection is active and has focus priority (or calculator is closed).
        if (isProjActive) {
          const isNumeric = /^\d$/.test(key);
          const isBackspace = e.key === "Backspace";
          const hasPriority = activeInputFocus() === "projection" || !isCalcActive;

          if ((isNumeric || isBackspace) && hasPriority) {
            e.preventDefault();
            const currentDir = projectionState().direction;
            if (isNumeric && currentDir) {
              const metadata = selectionMetadata();
              const live = getLiveGeometry(metadata.rect, metadata.scrollHierarchy, metadata.position, metadata.stickyConfig, metadata.initialWindowX, metadata.initialWindowY);
              const vp = viewport();
              let max: number | undefined;
              if (live) {
                if (currentDir === "top") max = live.top - window.scrollY;
                else if (currentDir === "bottom") max = vp.height - (live.top - window.scrollY + live.height);
                else if (currentDir === "left") max = live.left - window.scrollX;
                else if (currentDir === "right") max = vp.width - (live.left - window.scrollX + live.width);
              }
              projectionSystem?.appendValue(key, max);
            } else if (isBackspace) {
              projectionSystem?.backspace();
            }
            return;
          }
        }

        // 4. Handle Measurement Line Triggers (to Open Calculator)
        // Only occurs if key wasn't swallowed by Projection/Calculator inputs above.
        if (isFrozen() && result()) {
          const typeMap: Record<string, MeasurementLine["type"]> = {
            [calculator.top]: "top",
            [calculator.right]: "right",
            [calculator.bottom]: "bottom",
            [calculator.left]: "left",
            [calculator.distance]: "distance",
          };

          const targetType = typeMap[key];
          if (targetType) {
            e.preventDefault();
            const currentLines = result()?.lines || [];
            const targetLine = currentLines.find((l) => l.type === targetType);

            if (targetLine) {
              const liveValue = getLiveLineValue(targetLine, result());
              handleLineClick(targetLine, liveValue);
            }
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === commands.select) {
        setIsSelectKeyDown(false);
      }

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

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    onCleanup(() => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);

      if (mouseMoveRafId) {
        cancelAnimationFrame(mouseMoveRafId);
      }

      selectionDelegate.cancel();
      measureDelegate.cancel();

      unsubscribe();
      unsubscribeUpdate();
      unsubscribeProjection();
      unsubscribeRuler();

      handleCleanup();

      if (projectionSystem) {
        projectionSystem = null;
      }

      if (rulerSystem) {
        rulerSystem = null;
      }
    });
  });

  createEffect(() => {
    const active = !!selectionMetadata().element || !!result();

    if (active) {
      window.addEventListener("scroll", scheduleUpdate, { passive: true, capture: true });
      window.addEventListener("resize", scheduleUpdate, { passive: true });
      syncViewport();
    }

    onCleanup(() => {
      window.removeEventListener("scroll", scheduleUpdate, { capture: true });
      window.removeEventListener("resize", scheduleUpdate);

      if (viewportRafId) {
        cancelAnimationFrame(viewportRafId);
        viewportRafId = null;
      }
    });
  });

  createEffect(() => {
    const calcLine = activeCalculatorLine();
    const currentResult = result();

    if (calcLine && currentResult && system) {
      viewport().version;

      const matchingLine = currentResult.lines.find((l) => l.type === calcLine.type);
      if (matchingLine) {
        const liveValue = getLiveLineValue(matchingLine, currentResult);
        const calc = system.getCalculator();
        calc.syncValue(liveValue);
        setCalculatorState(calc.getState());
      }
    }
  });

  const handleLineClick = (line: MeasurementLine, liveValue: number) => {
    if (system) {
      const calc = system.getCalculator();
      calc.open(liveValue);
      setActiveInputFocus("calculator");
      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
      setActiveCalculatorLine(line);
    }
  };

  const handleCalculatorInput = (key: string) => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleInput(key);

      if (/^[+\-*/.]$/.test(key)) {
        setActiveInputFocus("calculator");
      }

      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
      if (calcState.operation) {
        setActiveCalculatorLine(null);
      }
    }
  };

  const handleCalculatorBackspace = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleBackspace();
      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
      if (!calcState.isActive) {
        setActiveCalculatorLine(null);
      }
    }
  };

  const handleCalculatorDelete = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleDelete();
      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
      setActiveCalculatorLine(null);
    }
  };

  const handleCalculatorEnter = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleEnter();
      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
      setActiveCalculatorLine(null);
    }
  };

  const handleCalculatorClose = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.close();
      setCalculatorState(null);
      setActiveCalculatorLine(null);
    }
  };

  const handleRulerUpdate = (id: string, position: number) => {
    rulerSystem?.updateLine(id, position);
  };

  const handleRulerRemove = (id: string) => {
    rulerSystem?.removeLine(id);
  };

  const handleCleanup = () => {
    if (system) system.cleanup();
    if (selectionSystem) selectionSystem.clear();
    if (projectionSystem) projectionSystem.clear();
    if (rulerSystem) rulerSystem.clear();
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
      projectionState={projectionState}
      rulerState={rulerState}
      activeFocus={activeInputFocus}
      onLineClick={handleLineClick}
      onRulerUpdate={handleRulerUpdate}
      onRulerRemove={handleRulerRemove}
      onCalculatorClose={handleCalculatorClose}
    />
  );
}
