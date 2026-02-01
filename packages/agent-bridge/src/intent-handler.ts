import { createMeasurementBetween, deduceGeometry, filterRuntimeClasses, getElementDirectText, type CaliperCoreSystems } from "@caliper/core";
import { sanitizeSelection, sanitizeMeasurement, parseComputedStyles, waitPostRaf, getContextMetrics } from "./utils.js";
import { walkAndMeasure, parseSelection } from "./harness/walk-engine.js";
import type {
  CaliperIntent,
  CaliperActionResult,
  CaliperSelectPayload,
  CaliperMeasurePayload,
  CaliperInspectPayload,
  CaliperWalkDomPayload,
} from "@oyerinde/caliper-schema";
import { BitBridge } from "@oyerinde/caliper-schema";
import { DEFAULT_WALK_DEPTH } from "./constants.js";
import type { CaliperStateStore } from "./state-store.js";

export function createIntentHandler(systems: CaliperCoreSystems, stateStore: CaliperStateStore) {
  const { measurementSystem, selectionSystem } = systems;

  function resolveElement(selector: string): HTMLElement | null {
    if (selector.startsWith("caliper-")) {
      return document.querySelector(`[data-caliper-agent-id="${selector}"]`) as HTMLElement;
    }
    return document.querySelector(selector) as HTMLElement;
  }

  function handleSelect(params: CaliperSelectPayload): Promise<CaliperActionResult> {
    return new Promise((resolve) => {
      const { selector } = params;
      const element = resolveElement(selector);

      if (!element) {
        resolve({
          success: false,
          method: "CALIPER_SELECT",
          selector,
          error: `Element not found: ${selector}`,
          timestamp: Date.now(),
        });
        return;
      }

      const currentSelected = selectionSystem.getSelected();
      if (currentSelected === element) {
        const metadata = selectionSystem.getMetadata();
        resolve({
          success: true,
          method: "CALIPER_SELECT",
          selector,
          selection: sanitizeSelection(metadata)!,
          timestamp: Date.now(),
        });
        return;
      }

      const unsubscribe = selectionSystem.onUpdate((metadata) => {
        unsubscribe();
        resolve({
          success: true,
          method: "CALIPER_SELECT",
          selector,
          selection: sanitizeSelection(metadata)!,
          timestamp: Date.now(),
        });
      });

      selectionSystem.select(element);
    });
  }

  function handleMeasure(params: CaliperMeasurePayload): Promise<CaliperActionResult> {
    return new Promise((resolve) => {
      const { primarySelector, secondarySelector } = params;
      const primaryElement = resolveElement(primarySelector);
      const secondaryElement = resolveElement(secondarySelector);

      if (!primaryElement || !secondaryElement) {
        resolve({
          success: false,
          method: "CALIPER_MEASURE",
          error: `Elements not found: ${!primaryElement ? primarySelector : ""} ${!secondaryElement ? secondarySelector : ""}`.trim(),
          timestamp: Date.now(),
        });
        return;
      }

      const measurement = createMeasurementBetween(primaryElement, secondaryElement);

      if (!measurement) {
        resolve({
          success: false,
          method: "CALIPER_MEASURE",
          error: "Failed to create measurement",
          timestamp: Date.now(),
        });
        return;
      }

      selectionSystem.select(primaryElement);

      measurementSystem.applyResult(measurement.result);
      measurementSystem.freeze();

      const sanitized = sanitizeMeasurement(measurement.result);
      if (!sanitized) {
        resolve({
          success: false,
          method: "CALIPER_MEASURE",
          error: "Failed to sanitize measurement result",
          timestamp: Date.now(),
        });
        return;
      }

      resolve({
        success: true,
        method: "CALIPER_MEASURE",
        selector: primarySelector,
        measurement: sanitized,
        timestamp: Date.now(),
      });
    });
  }

  async function handleInspect(params: CaliperInspectPayload): Promise<CaliperActionResult> {
    const { selector } = params;
    const element = resolveElement(selector);

    if (!element) {
      return {
        success: false,
        method: "CALIPER_INSPECT",
        selector,
        error: `Element not found: ${selector}`,
        timestamp: Date.now(),
      };
    }

    return waitPostRaf(() => {
      const geometry = deduceGeometry(element);
      const rect = element.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(element);

      return {
        success: true,
        method: "CALIPER_INSPECT",
        selector,
        distances: {
          top: rect.top,
          left: rect.left,
          bottom: document.documentElement.clientHeight - rect.bottom,
          right: document.documentElement.clientWidth - rect.right,
          horizontal: rect.width,
          vertical: rect.height,
        },
        computedStyles: parseComputedStyles(computedStyle),
        selection: sanitizeSelection({
          element,
          rect: geometry.rect,
          scrollHierarchy: geometry.scrollHierarchy,
          position: geometry.position,
          stickyConfig: geometry.stickyConfig,
          initialWindowX: geometry.initialWindowX,
          initialWindowY: geometry.initialWindowY,
        })!,
        timestamp: Date.now(),
      };
    });
  }


  async function handleWalkDom(params: CaliperWalkDomPayload): Promise<CaliperActionResult> {
    const { selector } = params;
    const element = resolveElement(selector);

    if (!element) {
      return {
        success: false,
        method: "CALIPER_WALK_DOM",
        selector,
        error: `Element not found: ${selector}`,
        timestamp: Date.now(),
      };
    }

    return waitPostRaf(() => {
      const getElSummary = (element: Element) => ({
        tagName: element.tagName.toLowerCase(),
        id: element.id || undefined,
        classList: filterRuntimeClasses(element.classList),
        agentId: element.getAttribute("data-caliper-agent-id") || undefined,
        text: getElementDirectText(element, 100),
      });

      return {
        success: true,
        method: "CALIPER_WALK_DOM",
        selector,
        domContext: {
          element: getElSummary(element),
          parent: element.parentElement ? getElSummary(element.parentElement) : null,
          children: Array.from(element.children).map((child) => getElSummary(child)),
        },
        timestamp: Date.now(),
      };
    });
  }


  async function dispatch(intent: CaliperIntent): Promise<CaliperActionResult> {
    stateStore.setAgentLock(true);

    let result: CaliperActionResult;

    try {
      switch (intent.method) {
        case "CALIPER_SELECT":
          result = await handleSelect(intent.params);
          break;
        case "CALIPER_MEASURE":
          result = await handleMeasure(intent.params);
          break;
        case "CALIPER_INSPECT":
          result = await handleInspect(intent.params);
          break;
        case "CALIPER_WALK_DOM":
          result = await handleWalkDom(intent.params);
          break;

        case "CALIPER_FREEZE":
          measurementSystem.freeze();
          result = {
            success: true,
            method: "CALIPER_FREEZE",
            timestamp: Date.now(),
          };
          break;
        case "CALIPER_CLEAR":
          measurementSystem.abort();
          selectionSystem.clear();
          result = {
            success: true,
            method: "CALIPER_CLEAR",
            timestamp: Date.now(),
          };
          break;
        case "CALIPER_PARSE_SELECTION":
          const parsed = parseSelection(intent.params.selectionJson);
          result = {
            success: parsed.isValid,
            method: "CALIPER_PARSE_SELECTION",
            selector: parsed.selector,
            parsed,
            error: parsed.errorMessage,
            timestamp: Date.now(),
          } as CaliperActionResult;
          break;
        case "CALIPER_WALK_AND_MEASURE":
          try {
            const walkResult = await waitPostRaf(() =>
              walkAndMeasure(
                intent.params.selector,
                {
                  maxDepth: intent.params.maxDepth ?? DEFAULT_WALK_DEPTH,
                  visualize: true
                }
              )
            );

            const { root, ...stats } = walkResult;
            const binaryPayload = BitBridge.serialize(root) as Uint8Array;

            result = {
              success: true,
              method: "CALIPER_WALK_AND_MEASURE",
              selector: intent.params.selector,
              walkResult: stats,
              binaryPayload,
              timestamp: Date.now(),
            };
          } catch (walkError) {
            result = {
              success: false,
              method: "CALIPER_WALK_AND_MEASURE",
              selector: intent.params.selector,
              error: walkError instanceof Error ? walkError.message : String(walkError),
              timestamp: Date.now(),
            };
          }
          break;
        case "CALIPER_GET_CONTEXT":
          result = {
            success: true,
            method: "CALIPER_GET_CONTEXT",
            context: getContextMetrics(),
            timestamp: Date.now(),
          };
          break;
        default:
          const _exhaustive: never = intent;
          throw new Error(`Unknown intent method: ${(_exhaustive as CaliperIntent).method}`);
      }

      stateStore.updateState({
        lastActionResult: result,
        lastUpdated: Date.now(),
      });
    } catch (error) {
      result = {
        success: false,
        method: intent.method,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
    } finally {
      stateStore.setAgentLock(false);
    }

    return result;
  }

  return { dispatch };
}
