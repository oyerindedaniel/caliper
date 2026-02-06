import {
  createMeasurementBetween,
  deduceGeometry,
  filterRuntimeClasses,
  getElementDirectText,
  waitPostRaf,
  type CaliperCoreSystems,
} from "@caliper/core";
import {
  sanitizeSelection,
  sanitizeMeasurement,
  parseComputedStyles,
  getContextMetrics,
  countDescendants,
  generateSourceHints,
  resolveElement,
} from "./utils.js";
import { walkAndMeasure } from "./harness/walk-engine.js";
import type {
  CaliperIntent,
  CaliperActionResult,
  CaliperSelectPayload,
  CaliperMeasurePayload,
  CaliperInspectPayload,
  CaliperWalkDomPayload,
  CaliperSelectorInput,
} from "@oyerinde/caliper-schema";
import { BitBridge, CALIPER_METHODS } from "@oyerinde/caliper-schema";
import { DEFAULT_WALK_DEPTH } from "./constants.js";
import type { CaliperStateStore } from "./state-store.js";

export function createIntentHandler(systems: CaliperCoreSystems, stateStore: CaliperStateStore) {
  const { measurementSystem, selectionSystem } = systems;

  function handleSelect(selectParams: CaliperSelectPayload): Promise<CaliperActionResult> {
    return new Promise((resolve) => {
      const { selector: targetSelector } = selectParams;
      const targetElement = resolveElement(targetSelector);

      if (!targetElement) {
        resolve({
          success: false,
          method: CALIPER_METHODS.SELECT,
          selector: targetSelector,
          error: `Element not found: ${targetSelector}`,
          timestamp: Date.now(),
        });
        return;
      }

      const currentSelectedElement = selectionSystem.getSelected();
      if (currentSelectedElement === targetElement) {
        const selectionMetadataValue = selectionSystem.getMetadata();
        resolve({
          success: true,
          method: CALIPER_METHODS.SELECT,
          selector: targetSelector,
          selection: sanitizeSelection(selectionMetadataValue)!,
          timestamp: Date.now(),
        });
        return;
      }

      const unsubscribeFromUpdates = selectionSystem.onUpdate((selectionMetadataValue) => {
        unsubscribeFromUpdates();
        resolve({
          success: true,
          method: CALIPER_METHODS.SELECT,
          selector: targetSelector,
          selection: sanitizeSelection(selectionMetadataValue)!,
          timestamp: Date.now(),
        });
      });

      selectionSystem.select(targetElement);
    });
  }

  function handleMeasure(measureParams: CaliperMeasurePayload): Promise<CaliperActionResult> {
    return new Promise((resolve) => {
      const { primarySelector, secondarySelector } = measureParams;
      const primaryElement = resolveElement(primarySelector);
      const secondaryElement = resolveElement(secondarySelector);

      if (!primaryElement || !secondaryElement) {
        resolve({
          success: false,
          method: CALIPER_METHODS.MEASURE,
          error:
            `Elements not found: ${!primaryElement ? primarySelector : ""} ${!secondaryElement ? secondarySelector : ""}`.trim(),
          timestamp: Date.now(),
        });
        return;
      }

      const measurementResult = createMeasurementBetween(primaryElement, secondaryElement);

      if (!measurementResult) {
        resolve({
          success: false,
          method: CALIPER_METHODS.MEASURE,
          error: "Failed to create measurement",
          timestamp: Date.now(),
        });
        return;
      }

      selectionSystem.select(primaryElement);

      measurementSystem.applyResult(measurementResult.result);
      measurementSystem.freeze();

      const sanitizedMeasurementResult = sanitizeMeasurement(measurementResult.result);
      if (!sanitizedMeasurementResult) {
        resolve({
          success: false,
          method: CALIPER_METHODS.MEASURE,
          error: "Failed to sanitize measurement result",
          timestamp: Date.now(),
        });
        return;
      }

      resolve({
        success: true,
        method: CALIPER_METHODS.MEASURE,
        selector: primarySelector,
        measurement: sanitizedMeasurementResult,
        timestamp: Date.now(),
      });
    });
  }

  async function handleInspect(inspectParams: CaliperInspectPayload): Promise<CaliperActionResult> {
    const { selector: targetSelector } = inspectParams;
    const targetElement = resolveElement(targetSelector);

    if (!targetElement) {
      return {
        success: false,
        method: CALIPER_METHODS.INSPECT,
        selector: targetSelector,
        error: `Element not found: ${targetSelector}`,
        timestamp: Date.now(),
      };
    }

    return waitPostRaf(() => {
      const elementGeometry = deduceGeometry(targetElement);
      const boundingClientRect = targetElement.getBoundingClientRect();
      const computedStyleDeclaration = window.getComputedStyle(targetElement);
      const descendantStats = countDescendants(targetElement);

      return {
        success: true,
        method: CALIPER_METHODS.INSPECT,
        selector: targetSelector,
        distances: {
          top: boundingClientRect.top,
          left: boundingClientRect.left,
          bottom: document.documentElement.clientHeight - boundingClientRect.bottom,
          right: document.documentElement.clientWidth - boundingClientRect.right,
          horizontal: boundingClientRect.width,
          vertical: boundingClientRect.height,
        },
        computedStyles: parseComputedStyles(computedStyleDeclaration),
        selection: sanitizeSelection({
          element: targetElement,
          rect: elementGeometry.rect,
          scrollHierarchy: elementGeometry.scrollHierarchy,
          position: elementGeometry.position,
          stickyConfig: elementGeometry.stickyConfig,
          initialWindowX: elementGeometry.initialWindowX,
          initialWindowY: elementGeometry.initialWindowY,
          depth: elementGeometry.depth,
        })!,
        immediateChildCount: targetElement.children.length,
        descendantCount: descendantStats.count,
        descendantsTruncated: descendantStats.isTruncated,
        sourceHints: generateSourceHints(targetElement),
        timestamp: Date.now(),
      };
    });
  }

  async function handleWalkDom(walkDomParams: CaliperWalkDomPayload): Promise<CaliperActionResult> {
    const { selector: targetSelector } = walkDomParams;
    const targetElement = resolveElement(targetSelector);

    if (!targetElement) {
      return {
        success: false,
        method: CALIPER_METHODS.WALK_DOM,
        selector: targetSelector,
        error: `Element not found: ${targetSelector}`,
        timestamp: Date.now(),
      };
    }

    return waitPostRaf(() => {
      const getElementSummary = (summaryElement: Element) => ({
        tagName: summaryElement.tagName.toLowerCase(),
        id: summaryElement.id || undefined,
        classList: filterRuntimeClasses(summaryElement.classList),
        agentId: summaryElement.getAttribute("data-caliper-agent-id") || undefined,
        text: getElementDirectText(summaryElement, 100),
      });

      return {
        success: true,
        method: CALIPER_METHODS.WALK_DOM,
        selector: targetSelector,
        domContext: {
          element: getElementSummary(targetElement),
          parent: targetElement.parentElement
            ? getElementSummary(targetElement.parentElement)
            : null,
          children: Array.from(targetElement.children).map((childElement) =>
            getElementSummary(childElement)
          ),
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
        case CALIPER_METHODS.SELECT:
          result = await handleSelect(intent.params);
          break;
        case CALIPER_METHODS.MEASURE:
          result = await handleMeasure(intent.params);
          break;
        case CALIPER_METHODS.INSPECT:
          result = await handleInspect(intent.params);
          break;
        case CALIPER_METHODS.WALK_DOM:
          result = await handleWalkDom(intent.params);
          break;

        case CALIPER_METHODS.FREEZE:
          measurementSystem.freeze();
          result = {
            success: true,
            method: CALIPER_METHODS.FREEZE,
            timestamp: Date.now(),
          };
          break;
        case CALIPER_METHODS.CLEAR:
          measurementSystem.abort();
          selectionSystem.clear();
          result = {
            success: true,
            method: CALIPER_METHODS.CLEAR,
            timestamp: Date.now(),
          };
          break;
        case CALIPER_METHODS.WALK_AND_MEASURE:
          try {
            const walkResult = await waitPostRaf(() =>
              walkAndMeasure(intent.params.selector, {
                maxDepth: intent.params.maxDepth ?? DEFAULT_WALK_DEPTH,
                maxNodes: intent.params.maxNodes,
                continueFrom: intent.params.continueFrom,
                minElementSize: intent.params.minElementSize,
                visualize: true,
              })
            );

            const { root, ...stats } = walkResult;
            const binaryPayload = BitBridge.serialize(root) as Uint8Array;

            result = {
              success: true,
              method: CALIPER_METHODS.WALK_AND_MEASURE,
              selector: intent.params.selector,
              walkResult: stats,
              binaryPayload,
              timestamp: Date.now(),
            };
          } catch (walkError) {
            result = {
              success: false,
              method: CALIPER_METHODS.WALK_AND_MEASURE,
              selector: intent.params.selector,
              error: walkError instanceof Error ? walkError.message : String(walkError),
              timestamp: Date.now(),
            };
          }
          break;
        case CALIPER_METHODS.GET_CONTEXT:
          result = {
            success: true,
            method: CALIPER_METHODS.GET_CONTEXT,
            context: getContextMetrics(),
            timestamp: Date.now(),
          };
          break;
        default:
          const _exhaustive: never = intent;
          throw new Error(`Unknown intent method: ${(_exhaustive as CaliperIntent).method}`);
      }

      stateStore.updateState({
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
