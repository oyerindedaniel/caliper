import { createMeasurementBetween, deduceGeometry } from "@oyerinde/caliper/core";
import type {
  CaliperIntent,
  CaliperActionResult,
  CaliperSelectPayload,
  CaliperMeasurePayload,
  CaliperInspectPayload,
  CaliperWalkDomPayload,
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
          error: `Elements not found: ${!primaryElement ? primarySelector : ""} ${!secondaryElement ? secondarySelector : ""}`.trim(),
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
    const computedStyle = window.getComputedStyle(element);

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
      computedStyles: {
        paddingLeft: parseFloat(computedStyle.paddingLeft) || 0,
        paddingRight: parseFloat(computedStyle.paddingRight) || 0,
        paddingTop: parseFloat(computedStyle.paddingTop) || 0,
        paddingBottom: parseFloat(computedStyle.paddingBottom) || 0,
        marginLeft: parseFloat(computedStyle.marginLeft) || 0,
        marginRight: parseFloat(computedStyle.marginRight) || 0,
        marginTop: parseFloat(computedStyle.marginTop) || 0,
        marginBottom: parseFloat(computedStyle.marginBottom) || 0,
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

  function handleWalkDom(payload: CaliperWalkDomPayload): CaliperActionResult {
    const { selector } = payload;
    const element = resolveElement(selector);

    if (!element) {
      return {
        success: false,
        intent: "CALIPER_WALK_DOM",
        selector,
        error: `Element not found: ${selector}`,
        timestamp: Date.now(),
      };
    }

    const getElSummary = (el: Element) => ({
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classList: Array.from(el.classList),
      agentId: el.getAttribute("data-caliper-agent-id") || undefined,
      text: el.textContent?.trim().slice(0, 50) || undefined,
    });

    const parent = element.parentElement ? getElSummary(element.parentElement) : null;
    const children = Array.from(element.children).map(getElSummary);

    return {
      success: true,
      intent: "CALIPER_WALK_DOM",
      selector,
      domContext: {
        element: getElSummary(element),
        parent,
        children,
      },
      timestamp: Date.now(),
    };
  }

  async function dispatch(intent: CaliperIntent): Promise<CaliperActionResult> {
    let result: CaliperActionResult;

    switch (intent.type) {
      case "CALIPER_SELECT":
        result = await handleSelect(intent.payload);
        break;
      case "CALIPER_MEASURE":
        result = await handleMeasure(intent.payload);
        break;
      case "CALIPER_INSPECT":
        result = handleInspect(intent.payload);
        break;
      case "CALIPER_WALK_DOM":
        result = handleWalkDom(intent.payload);
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
    }

    if (window.__CALIPER_STATE__) {
      window.__CALIPER_STATE__.lastActionResult = result;
      window.__CALIPER_STATE__.lastUpdated = Date.now();
    }

    return result;
  }

  return { dispatch };
}
