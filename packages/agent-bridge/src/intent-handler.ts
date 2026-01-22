import { createMeasurementBetween, deduceGeometry } from "@oyerinde/caliper/core";
import type {
  CaliperIntent,
  CaliperActionResult,
  CaliperSelectPayload,
  CaliperMeasurePayload,
  CaliperInspectPayload,
  CaliperCoreSystems,
} from "./types.js";

export function createIntentHandler(systems: CaliperCoreSystems) {
  const { measurementSystem, selectionSystem } = systems;

  function resolveElement(selector: string): HTMLElement | null {
    if (selector.startsWith("caliper-")) {
      return document.querySelector(`[data-caliper-agent-id="${selector}"]`) as HTMLElement;
    }
    return document.querySelector(selector) as HTMLElement;
  }

  function handleSelect(payload: CaliperSelectPayload): Promise<CaliperActionResult> {
    return new Promise((resolve) => {
      const { selector } = payload;
      const element = resolveElement(selector);

      if (!element) {
        resolve({
          success: false,
          intent: "CALIPER_SELECT",
          selector,
          error: `Element not found: ${selector}`,
          timestamp: Date.now(),
        });
        return;
      }

      const unsubscribe = selectionSystem.onUpdate((metadata) => {
        unsubscribe();
        resolve({
          success: true,
          intent: "CALIPER_SELECT",
          selector,
          selection: metadata,
          timestamp: Date.now(),
        });
      });

      selectionSystem.select(element);
    });
  }

  function handleMeasure(payload: CaliperMeasurePayload): Promise<CaliperActionResult> {
    return new Promise((resolve) => {
      const { primarySelector, secondarySelector } = payload;
      const primaryElement = resolveElement(primarySelector);
      const secondaryElement = resolveElement(secondarySelector);

      if (!primaryElement || !secondaryElement) {
        resolve({
          success: false,
          intent: "CALIPER_MEASURE",
          error:
            `Elements not found: ${!primaryElement ? primarySelector : ""} ${!secondaryElement ? secondarySelector : ""}`.trim(),
          timestamp: Date.now(),
        });
        return;
      }

      const unsubSelect = selectionSystem.onUpdate(() => {
        unsubSelect();
        const measurement = createMeasurementBetween(primaryElement, secondaryElement);

        if (!measurement) {
          resolve({
            success: false,
            intent: "CALIPER_MEASURE",
            error: "Failed to create measurement",
            timestamp: Date.now(),
          });
          return;
        }

        measurementSystem.applyResult(measurement.result);

        resolve({
          success: true,
          intent: "CALIPER_MEASURE",
          selector: primarySelector,
          measurement: measurement.result,
          timestamp: Date.now(),
        });
      });

      selectionSystem.select(primaryElement);
    });
  }

  function handleInspect(payload: CaliperInspectPayload): CaliperActionResult {
    const { selector } = payload;
    const element = resolveElement(selector);

    if (!element) {
      return {
        success: false,
        intent: "CALIPER_INSPECT",
        selector,
        error: `Element not found: ${selector}`,
        timestamp: Date.now(),
      };
    }

    const geometry = deduceGeometry(element);
    const rect = element.getBoundingClientRect();

    return {
      success: true,
      intent: "CALIPER_INSPECT",
      selector,
      distances: {
        top: rect.top,
        left: rect.left,
        bottom: window.innerHeight - rect.bottom,
        right: window.innerWidth - rect.right,
        horizontal: rect.width,
        vertical: rect.height,
      },
      selection: {
        element,
        rect: geometry.rect,
        scrollHierarchy: geometry.scrollHierarchy,
        position: geometry.position,
        stickyConfig: geometry.stickyConfig,
        initialWindowX: geometry.initialWindowX,
        initialWindowY: geometry.initialWindowY,
      },
      timestamp: Date.now(),
    };
  }

  async function dispatch(intent: CaliperIntent): Promise<CaliperActionResult> {
    let result: CaliperActionResult;

    switch (intent.type) {
      case "CALIPER_SELECT":
        result = await handleSelect(intent.payload as CaliperSelectPayload);
        break;
      case "CALIPER_MEASURE":
        result = await handleMeasure(intent.payload as CaliperMeasurePayload);
        break;
      case "CALIPER_INSPECT":
        result = handleInspect(intent.payload as CaliperInspectPayload);
        break;
      case "CALIPER_FREEZE":
        measurementSystem.freeze();
        result = {
          success: true,
          intent: "CALIPER_FREEZE",
          timestamp: Date.now(),
        };
        break;
      case "CALIPER_CLEAR":
        measurementSystem.abort();
        selectionSystem.clear();
        result = {
          success: true,
          intent: "CALIPER_CLEAR",
          timestamp: Date.now(),
        };
        break;
      default:
        result = {
          success: false,
          intent: intent.type,
          error: `Unknown intent type: ${intent.type}`,
          timestamp: Date.now(),
        };
    }

    if (window.__CALIPER_STATE__) {
      window.__CALIPER_STATE__.lastActionResult = result;
      window.__CALIPER_STATE__.lastUpdated = Date.now();
    }

    return result;
  }

  return { dispatch };
}
