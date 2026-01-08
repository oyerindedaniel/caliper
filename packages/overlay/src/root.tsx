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
} from "@caliper/core";
import { Overlay } from "./ui/utils/render-overlay.jsx";

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

    const isCommandActive = (e: MouseEvent): boolean => {
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

    const handleClick = (e: MouseEvent) => {
      if (isCommandActive(e)) {
        e.preventDefault();
        e.stopPropagation();

        const element = getTopElementAtPoint(e.clientX, e.clientY);
        if (element && selectionSystem) {
          setResult(null);
          setCalculatorState(null);

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
      }
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
      if (!mouseMoveRafId) {
        mouseMoveRafId = requestAnimationFrame(processMouseMove);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === commands.clear) {
        setIsAltPressed(false);
        setIsFrozen(false);
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
        } else if (state === "MEASURING" || system.getCurrentResult()) {
          e.preventDefault();
          system.freeze();
        }
      } else if (isFrozen() && result()) {
        const key = e.key.toLowerCase();
        const { calculator } = commands;

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
      } else if (selectionMetadata().element) {
        const key = e.key.toLowerCase();
        const { projection } = commands;
        const isNumeric = /^\d$/.test(key);
        const isBackspace = e.key === "Backspace";
        const isEnter = e.key === "Enter";

        const dirMap: Record<string, ProjectionDirection> = {
          [projection.top]: "top",
          [projection.left]: "left",
          [projection.bottom]: "bottom",
          [projection.right]: "right",
        };

        const dir = dirMap[key];
        const isDirection = !!dir;
        const isProjectionActive = projectionState().direction !== null;

        if (isDirection || isNumeric || isBackspace || (isEnter && isProjectionActive)) {
          e.preventDefault();

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
            let runway: number;
            switch (dir) {
              case "top": runway = live.top - window.scrollY; break;
              case "bottom": runway = vp.height - (live.top - window.scrollY + live.height); break;
              case "left": runway = live.left - window.scrollX; break;
              case "right": runway = vp.width - (live.left - window.scrollX + live.width); break;
            }
            return runway;
          };

          if (isDirection && projectionSystem) {
            const currentElement = selectionMetadata().element;
            if (currentElement) {
              projectionSystem.setElement(currentElement as HTMLElement);
            }
            projectionSystem.setDirection(dir);
            const maxRunway = getRunway(dir);
            if (maxRunway !== undefined) projectionSystem.capValue(maxRunway);
          } else if (isNumeric && projectionSystem) {
            const currentDir = projectionState().direction;
            const max = currentDir ? getRunway(currentDir) : undefined;
            projectionSystem.appendValue(key, max);
          } else if (isBackspace && projectionSystem) {
            projectionSystem.backspace();
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
      const calcState = calc.getState();
      setCalculatorState(calcState.isActive ? calcState : null);
      setActiveCalculatorLine(line);
    }
  };

  const handleCalculatorInput = (key: string) => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleInput(key);
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
      onLineClick={handleLineClick}
      onRulerUpdate={handleRulerUpdate}
      onRulerRemove={handleRulerRemove}
      onCalculatorInput={handleCalculatorInput}
      onCalculatorBackspace={handleCalculatorBackspace}
      onCalculatorDelete={handleCalculatorDelete}
      onCalculatorEnter={handleCalculatorEnter}
      onCalculatorClose={handleCalculatorClose}
    />
  );
}
