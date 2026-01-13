import { onMount, onCleanup, createSignal, createEffect, untrack, createMemo } from "solid-js";
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
  isEditable,
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
  RESIZE_THROTTLE_MS,
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
  const [projectionState, setProjectionState] = createSignal<ProjectionState>({
    direction: null,
    value: "",
    element: null,
  });
  const [activeCalculatorLine, setActiveCalculatorLine] = createSignal<MeasurementLine | null>(
    null
  );
  const [isSelectKeyDown, setIsSelectKeyDown] = createSignal(false);
  const [activeInputFocus, setActiveInputFocus] = createSignal<"calculator" | "projection">(
    "calculator"
  );

  let system: MeasurementSystem | null = null;
  let selectionSystem: SelectionSystem | null = null;
  let projectionSystem: ProjectionSystem | null = null;
  let rulerSystem: RulerSystem | null = null;

  const [rulerState, setRulerState] = createSignal<RulerState>({ lines: [] });

  const [isActivatePressed, setIsActivatePressed] = createSignal(false);
  const [isFrozen, setIsFrozen] = createSignal(false);

  const ignoredElements = new WeakSet<Element>();

  let viewportRafId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let observedRoot = false;
  let observedPrimary: Element | null = null;
  let observedSecondary: Element | null = null;

  const resetCalculatorUI = () => {
    setCalculatorState(null);
    setActiveCalculatorLine(null);
    if (projectionState().direction !== null) {
      setActiveInputFocus("projection");
    }
  };

  const syncCalculatorUI = (state: CalculatorState) => {
    if (!state.isActive) {
      resetCalculatorUI();
      return;
    }

    setCalculatorState(state);

    // If an operation is in progress (e.g. user typed +),
    // we stop highlighting the specific measurement line the calculator was opened from
    if (state.operation) {
      setActiveCalculatorLine(null);
    }

  };

  const isActive = createMemo(() => {
    return (
      !!selectionMetadata().element ||
      !!result() ||
      rulerState().lines.length > 0 ||
      projectionState().direction !== null
    );
  });

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
    if (!isActive()) return;

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
      if (state.direction === null) {
        if (calculatorState()?.isActive) {
          setActiveInputFocus("calculator");
        }
        if (system?.getState() === "FROZEN") {
          system?.unfreeze(false);
        }
      } else {
        setActiveInputFocus("projection");
      }
    });

    rulerSystem = createRulerSystem();
    const unsubscribeRuler = rulerSystem.onUpdate((state) => {
      setRulerState(state);
    });

    const unsubscribe = system.onStateChange(() => {
      if (!system) return;
      setResult(system.getCurrentResult());
      setIsFrozen(system.getState() === "FROZEN");
    });

    const unsubscribeUpdate = selectionSystem.onUpdate((metadata) => {
      setSelectionMetadata(metadata);
    });

    let selectionTimeoutId: number | null = null;
    let lastPointerPos = { x: 0, y: 0 };

    const performSelection = (x: number, y: number) => {
      const element = getTopElementAtPoint(x, y);
      if (element && selectionSystem) {
        if (system) {
          system.abort();
        }

        if (projectionSystem) {
          projectionSystem.clear();
        }

        resetCalculatorUI();
        setActiveInputFocus("calculator");

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

    const isActivateActive = (e: KeyboardEvent): boolean => {
      return e.key === commands.activate || (commands.activate === "Alt" && (e.key === "Alt" || e.key === "AltGraph"));
    };

    const handlePointerDown = (e: PointerEvent) => {
      lastPointerPos = { x: e.clientX, y: e.clientY };

      if (isCommandActive(e)) {
        e.preventDefault();
        if (selectionTimeoutId) window.clearTimeout(selectionTimeoutId);
        selectionTimeoutId = window.setTimeout(() => {
          performSelection(lastPointerPos.x, lastPointerPos.y);
          selectionTimeoutId = null;
        }, commands.selectionHoldDuration);
      } else {
        if (selectionTimeoutId) window.clearTimeout(selectionTimeoutId);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (selectionTimeoutId) {
        window.clearTimeout(selectionTimeoutId);
        selectionTimeoutId = null;
      }

      const target = e.target as HTMLElement;

      if (target.closest(`[data-caliper-ignore]`) || target.closest(`.${PREFIX}projection-input`)) {
        if (target.closest(`.${PREFIX}projection-input`)) {
          setActiveInputFocus("projection");
        } else if (target.closest(`.${PREFIX}calculator`)) {
          setActiveInputFocus("calculator");
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (isCommandActive(e)) {
        e.preventDefault();
      }
    };

    let lastMouseEvent: MouseEvent | null = null;
    let mouseMoveRafId: number | null = null;
    let lastHoveredElement: Element | null = null;

    const selectionDelegate = createSuppressionDelegate((el: Element) => {
      if (selectionSystem?.getSelected() !== el) {
        system?.abort();
      }
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
      const isAlt = isActivatePressed();
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
      if (e.key === commands.clear && !isEditable(e.target as Element)) {
        if (!isActive()) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        setIsActivatePressed(false);
        resetCalculatorUI();

        if (system) {
          system.abort();
        }

        if (projectionSystem) {
          projectionSystem.clear();
        }

        if (rulerSystem) {
          rulerSystem.clear();
        }

        if (selectionSystem) {
          lastHoveredElement = null;
          selectionDelegate.cancel();
          measureDelegate.cancel();
          selectionSystem.clear();
        }

        return;
      }

      if (e.key === commands.select && !isEditable(e.target as Element)) {
        setIsSelectKeyDown(true);
      }

      if (e.key.toLowerCase() === commands.ruler.toLowerCase() && e.shiftKey && rulerSystem && !isEditable(e.target as Element)) {
        e.preventDefault();
        const vp = viewport();
        const x = Math.max(0, Math.min(cursor().x, vp.width));
        const y = Math.max(0, Math.min(cursor().y, vp.height));
        rulerSystem.addPair(x, y);
        return;
      }

      if (isActivateActive(e)) {
        if (selectionMetadata().element) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }

        if (!isActivatePressed() && isActive()) {
          if (system) {
            system.abort();
          }
          if (projectionSystem) {
            projectionSystem.clear();
          }
          resetCalculatorUI();
        }

        setIsActivatePressed(true);
      } else if (e.key === commands.freeze && !isEditable(e.target as Element) && system) {
        const state = system.getState();

        if (state === "FROZEN") {
          e.preventDefault();
          e.stopImmediatePropagation();
          system.unfreeze(isActivatePressed());
        } else if (selectionMetadata().element) {
          e.preventDefault();
          e.stopImmediatePropagation();
          system.freeze();
        }
      } else {
        const key = e.key;
        const { calculator, projection } = commands;
        const isCalcActive = !!calculatorState();
        const isProjActive = projectionState().direction !== null;

        // 1. Handle Active Calculator Inputs (Numbers, Operators, etc)
        // High priority if focused OR if projection is not even active
        const shouldCalcGetNumbers =
          isCalcActive && (activeInputFocus() === "calculator" || !isProjActive);

        if (isCalcActive && (shouldCalcGetNumbers || !/^\d$/.test(e.key))) {
          const isNumeric = /^[0-9]$/.test(e.key);
          const isOperator = /^[+\-*/]$/.test(e.key);
          const isDecimal = e.key === ".";
          const isBackspace = e.key === "Backspace";
          const isDelete = e.key === "Delete";
          const isEnter = e.key === "Enter";
          const isEscape = e.key === "Escape";

          if (
            isNumeric ||
            isOperator ||
            isDecimal ||
            isBackspace ||
            isDelete ||
            isEnter ||
            isEscape
          ) {
            // Only eat numbers if we have priority
            if ((isNumeric || isBackspace || isDecimal) && !shouldCalcGetNumbers) {
              // fall through to projection
            } else {
              e.preventDefault();
              e.stopImmediatePropagation();

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
        const dirMap: Record<string, ProjectionDirection> = {
          [projection.top]: "top",
          [projection.left]: "left",
          [projection.bottom]: "bottom",
          [projection.right]: "right",
        };
        const dir = dirMap[key];

        if (dir && selectionMetadata().element && !isEditable(e.target as Element)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setActiveInputFocus("projection");

          const currentElement = selectionMetadata().element;
          if (currentElement) {
            projectionSystem?.setElement(currentElement as HTMLElement);
          }
          projectionSystem?.setDirection(dir);

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
            return getMaxProjectionDistance(dir, live);
          };

          const maxRunway = getRunway(dir);
          if (maxRunway !== undefined) projectionSystem?.capValue(maxRunway);
          return;
        }

        // 3. Handle Projection Value Inputs (Numeric/Backspace)
        // Only if Projection is active and has focus priority (or calculator is closed).
        if (isProjActive) {
          const isNumeric = /^[0-9.]$/.test(key);
          const isBackspace = e.key === "Backspace";
          const hasPriority = activeInputFocus() === "projection" || !isCalcActive;

          if ((isNumeric || isBackspace) && hasPriority) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const currentDir = projectionState().direction;
            if (isNumeric && currentDir) {
              const metadata = selectionMetadata();
              const live = getLiveGeometry(
                metadata.rect,
                metadata.scrollHierarchy,
                metadata.position,
                metadata.stickyConfig,
                metadata.initialWindowX,
                metadata.initialWindowY
              );

              let max: number | undefined;
              if (live) {
                max = getMaxProjectionDistance(currentDir, live);
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
            const currentLines = result()?.lines || [];
            const targetLine = currentLines.find((l) => l.type === targetType);

            if (targetLine) {
              e.preventDefault();
              e.stopImmediatePropagation();
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

      if (isActivateActive(e)) {
        e.preventDefault();

        if (isActivatePressed()) {
          setIsActivatePressed(false);

          if (system && isActive()) {
            system.stop();
          }
        }
      }
    };

    const handleBlur = () => {
      if (isActivatePressed()) {
        setIsActivatePressed(false);

        if (system && isActive()) {
          system.stop();
        }
      }
    };

    const handleFocus = () => {
      if (!isActive()) return;
      scheduleUpdate();

      window.focus();
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("pointerup", handlePointerUp, { capture: true });
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("contextmenu", handleContextMenu, { capture: true });
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    onCleanup(() => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("pointerup", handlePointerUp, { capture: true });
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("contextmenu", handleContextMenu, { capture: true });
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);

      if (mouseMoveRafId) {
        cancelAnimationFrame(mouseMoveRafId);
      }

      selectionDelegate.cancel();
      measureDelegate.cancel();

      unsubscribe();
      unsubscribeUpdate();
      unsubscribeProjection();
      unsubscribeRuler();

      if (system) {
        system.cleanup();
      }

      if (projectionSystem) {
        projectionSystem = null;
      }

      if (rulerSystem) {
        rulerSystem = null;
      }
    });
  });

  createEffect(() => {
    if (isActive()) {
      window.addEventListener("scroll", scheduleUpdate, { passive: true, capture: true });
      syncViewport();

      onCleanup(() => {
        window.removeEventListener("scroll", scheduleUpdate, { capture: true });

        if (viewportRafId) {
          cancelAnimationFrame(viewportRafId);
          viewportRafId = null;
        }
      });
    }
  });

  const updateResizeObservations = (active: boolean, primaryEl: Element | null, secondaryEl: Element | null) => {
    if (!resizeObserver) return;

    if (active && !observedRoot) {
      resizeObserver.observe(document.documentElement);
      observedRoot = true;
    } else if (!active && observedRoot) {
      resizeObserver.unobserve(document.documentElement);
      observedRoot = false;
    }

    if (primaryEl === observedPrimary && secondaryEl === observedSecondary) {
      return;
    }

    if (observedPrimary && observedPrimary !== primaryEl) {
      resizeObserver.unobserve(observedPrimary);
      observedPrimary = null;
    }
    if (observedSecondary && observedSecondary !== secondaryEl && observedSecondary !== primaryEl) {
      resizeObserver.unobserve(observedSecondary);
      observedSecondary = null;
    }

    if (primaryEl && primaryEl !== observedPrimary) {
      ignoredElements.add(primaryEl);
      resizeObserver.observe(primaryEl);
      observedPrimary = primaryEl;
    }
    if (secondaryEl && secondaryEl !== primaryEl && secondaryEl !== observedSecondary) {
      ignoredElements.add(secondaryEl);
      resizeObserver.observe(secondaryEl);
      observedSecondary = secondaryEl;
    }
  };

  createEffect(() => {
    let resizeTimer: number | null = null;
    let lastRun = 0;
    let sentinelResized = false;
    let primaryChanged = false;
    let secondaryChanged = false;

    const runUpdates = () => {
      if (sentinelResized || primaryChanged) {
        if (observedPrimary) {
          const rect = observedPrimary.getBoundingClientRect();
          selectionSystem?.updateRect(rect);
          if (system) system.updatePrimaryRect(rect);
        }
      }
      if (sentinelResized || secondaryChanged) {
        if (observedSecondary) {
          const rect = observedSecondary.getBoundingClientRect();
          system?.updateSecondaryRect(rect);
        }
      }

      sentinelResized = false;
      primaryChanged = false;
      secondaryChanged = false;
    };

    resizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      if (!isActive()) return;

      let hasActualResize = false;
      for (const entry of entries) {
        if (ignoredElements.has(entry.target)) {
          ignoredElements.delete(entry.target);
          continue;
        }
        hasActualResize = true;
      }

      if (!hasActualResize) return;

      for (const entry of entries) {
        if (entry.target === document.documentElement) {
          sentinelResized = true;
        } else if (entry.target === observedPrimary) {
          primaryChanged = true;
        } else if (entry.target === observedSecondary) {
          secondaryChanged = true;
        }
      }

      if (sentinelResized) {
        scheduleUpdate();
      }

      const now = Date.now();
      const remaining = RESIZE_THROTTLE_MS - (now - lastRun);

      if (remaining <= 0) {
        if (resizeTimer) clearTimeout(resizeTimer);
        lastRun = now;
        runUpdates();
      } else if (!resizeTimer) {
        resizeTimer = window.setTimeout(() => {
          lastRun = Date.now();
          resizeTimer = null;
          runUpdates();
        }, remaining);
      }
    });

    onCleanup(() => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      observedPrimary = null;
      observedSecondary = null;
      if (resizeTimer) clearTimeout(resizeTimer);
    });
  });

  createEffect(() => {
    const active = isActive();
    const primaryEl = selectionMetadata().element;
    const currentResult = result();
    const secondaryEl = isFrozen() ? (currentResult?.secondaryElement ?? null) : null;

    if (!active) {
      updateResizeObservations(false, null, null);
      return;
    }

    updateResizeObservations(true, primaryEl, secondaryEl);
  });

  createEffect(() => {
    const calcLine = activeCalculatorLine();
    const currentResult = result();

    if (calcLine && currentResult && system) {
      const state = untrack(() => calculatorState());

      if (state?.isActive) {
        viewport().version;

        const matchingLine = currentResult.lines.find((l) => l.type === calcLine.type);
        if (matchingLine) {
          const liveValue = getLiveLineValue(matchingLine, currentResult);
          const calc = system.getCalculator();
          calc.syncValue(liveValue);
          setCalculatorState(calc.getState());
        }
      }
    }
  });


  const handleLineClick = (line: MeasurementLine, liveValue: number) => {
    if (system) {
      const calc = system.getCalculator();
      calc.open(liveValue);
      setActiveInputFocus("calculator");
      syncCalculatorUI(calc.getState());

      // Only track the line if it's a measurement line (has startSync property)
      // Projection/ruler lines are synthetic and shouldn't be tracked for live sync
      if ("startSync" in line) {
        setActiveCalculatorLine(line);
      }
    }
  };

  const handleCalculatorInput = (key: string) => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleInput(key);

      if (/^[+\-*/.]$/.test(key)) {
        setActiveInputFocus("calculator");
      }

      syncCalculatorUI(calc.getState());
    }
  };

  const handleCalculatorBackspace = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleBackspace();
      syncCalculatorUI(calc.getState());
    }
  };

  const handleCalculatorDelete = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleDelete();
      syncCalculatorUI(calc.getState());
    }
  };

  const handleCalculatorEnter = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.handleEnter();
      syncCalculatorUI(calc.getState());
    }
  };

  const handleCalculatorClose = () => {
    if (system) {
      const calc = system.getCalculator();
      calc.close();
      resetCalculatorUI();
    }
  };

  const handleRulerUpdate = (id: string, position: number) => {
    rulerSystem?.updateLine(id, position);
  };

  const handleRulerRemove = (id: string) => {
    rulerSystem?.removeLine(id);
  };


  return (
    <Overlay
      result={result}
      cursor={cursor}
      selectionMetadata={selectionMetadata}
      isActivatePressed={isActivatePressed}
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

function getMaxProjectionDistance(
  dir: ProjectionDirection,
  live: { top: number; left: number; width: number; height: number }
): number {
  const docWidth = document.documentElement.scrollWidth;
  const docHeight = document.documentElement.scrollHeight;

  switch (dir) {
    case "top":
      return live.top;
    case "bottom":
      return docHeight - (live.top + live.height);
    case "left":
      return live.left;
    case "right":
      return docWidth - (live.left + live.width);
  }
}
