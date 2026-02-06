import type { CaliperNode, CaliperComputedStyles, BoxEdges } from "@oyerinde/caliper-schema";
import { isVisible, filterRuntimeClasses, getElementDirectText, generateId } from "@caliper/core";
import { DEFAULT_WALK_DEPTH } from "../constants.js";
import { parseComputedStyles, resolveElements, resolveElement } from "../utils.js";
import {
  initWalkVisualizer,
  showWalkBoundary,
  showChildBoundary,
  cleanupWalkVisualizer,
} from "./walk-visualizer.js";
import type { WalkResult, WalkOptions, ParsedSelection } from "../types.js";

function pruneBoxEdges(edges: BoxEdges): BoxEdges | undefined {
  if (edges.top === 0 && edges.right === 0 && edges.bottom === 0 && edges.left === 0) {
    return undefined;
  }
  return edges;
}

function pruneStyles(styles: CaliperComputedStyles): CaliperComputedStyles {
  const pruned: CaliperComputedStyles = {};

  // Box model - only include if non-default
  if (styles.display && styles.display !== "block") pruned.display = styles.display;
  if (styles.visibility && styles.visibility !== "visible") pruned.visibility = styles.visibility;
  if (styles.position && styles.position !== "static") pruned.position = styles.position;
  if (styles.boxSizing && styles.boxSizing !== "border-box") pruned.boxSizing = styles.boxSizing;

  // Spacing - only include if non-zero
  if (styles.padding) {
    const prunedPadding = pruneBoxEdges(styles.padding);
    if (prunedPadding) pruned.padding = prunedPadding;
  }
  if (styles.margin) {
    const prunedMargin = pruneBoxEdges(styles.margin);
    if (prunedMargin) pruned.margin = prunedMargin;
  }
  if (styles.border) {
    const prunedBorder = pruneBoxEdges(styles.border);
    if (prunedBorder) pruned.border = prunedBorder;
  }

  // Flexbox/Grid - only include if relevant
  if (styles.gap !== null && styles.gap !== undefined && styles.gap !== 0) pruned.gap = styles.gap;
  if (styles.display === "flex" || styles.display === "inline-flex") {
    if (styles.flexDirection && styles.flexDirection !== "row")
      pruned.flexDirection = styles.flexDirection;
    if (styles.justifyContent && styles.justifyContent !== "normal")
      pruned.justifyContent = styles.justifyContent;
    if (styles.alignItems && styles.alignItems !== "normal") pruned.alignItems = styles.alignItems;
  }

  // Typography - always include these as they're critical for audits
  if (styles.fontSize !== undefined) pruned.fontSize = styles.fontSize;
  if (styles.fontWeight) pruned.fontWeight = styles.fontWeight;
  if (styles.fontFamily) pruned.fontFamily = styles.fontFamily;
  if (styles.lineHeight !== undefined && styles.lineHeight !== "normal")
    pruned.lineHeight = styles.lineHeight;
  if (styles.letterSpacing !== undefined && styles.letterSpacing !== "normal")
    pruned.letterSpacing = styles.letterSpacing;
  if (styles.color) pruned.color = styles.color;

  // Visual - only include if non-default
  if (styles.backgroundColor && styles.backgroundColor !== "rgba(0, 0, 0, 0)")
    pruned.backgroundColor = styles.backgroundColor;
  if (styles.borderColor) pruned.borderColor = styles.borderColor;
  if (styles.borderRadius && styles.borderRadius !== "0px")
    pruned.borderRadius = styles.borderRadius;
  if (styles.boxShadow && styles.boxShadow !== "none") pruned.boxShadow = styles.boxShadow;
  if (styles.opacity !== undefined && styles.opacity !== 1 && styles.opacity !== "1")
    pruned.opacity = styles.opacity;
  if (styles.zIndex !== null && styles.zIndex !== undefined) pruned.zIndex = styles.zIndex;

  // Overflow - only include if non-default
  if (styles.overflow && styles.overflow !== "visible") pruned.overflow = styles.overflow;
  if (styles.overflowX && styles.overflowX !== "visible") pruned.overflowX = styles.overflowX;
  if (styles.overflowY && styles.overflowY !== "visible") pruned.overflowY = styles.overflowY;

  return pruned;
}

function generateStableSelector(element: Element, domIndex?: number): string {
  const marker = element.getAttribute("data-caliper-marker");
  if (marker) return `[data-caliper-marker="${marker}"]`;

  let agentId = element.getAttribute("data-caliper-agent-id");
  const alreadyHadId = !!agentId;

  if (!alreadyHadId) {
    agentId = generateId("caliper");
    element.setAttribute("data-caliper-agent-id", agentId);
  } else {
    return `[data-caliper-agent-id="${agentId}"]`;
  }

  if (element.id) return `#${element.id}`;

  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;

  const tag = element.tagName.toLowerCase();
  const cssClasses = filterRuntimeClasses(element.classList).slice(0, 2).join(".");
  const base = cssClasses ? `${tag}.${cssClasses}` : tag;

  if (domIndex !== undefined) {
    return `${base}:nth-child(${domIndex + 1})`;
  }

  return base;
}

function createNodeSnapshot(
  element: Element,
  depth: number,
  domIndex?: number,
  visibleIndex?: number
): CaliperNode {
  const htmlElement = element as HTMLElement;
  const rect = htmlElement.getBoundingClientRect();
  const styles = window.getComputedStyle(htmlElement);
  const selector = generateStableSelector(htmlElement, domIndex);
  const agentId = htmlElement.getAttribute("data-caliper-agent-id") || selector;

  return {
    agentId,
    selector,
    tag: htmlElement.tagName.toLowerCase(),
    htmlId: htmlElement.id || undefined,
    classes: filterRuntimeClasses(htmlElement.classList),
    textContent: getElementDirectText(htmlElement, Infinity),

    rect: {
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      bottom: rect.bottom + window.scrollY,
      right: rect.right + window.scrollX,
      width: rect.width,
      height: rect.height,
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
    },

    viewportRect: {
      top: rect.top,
      left: rect.left,
    },

    styles: parseComputedStyles(styles),

    measurements: {
      toParent: { top: 0, left: 0, bottom: 0, right: 0 },
      toPreviousSibling: null,
      toNextSibling: null,
      indexInParent: visibleIndex ?? 0,
      siblingCount: 1,
    },

    depth,
    childCount: htmlElement.children.length,
    children: [],
    marker: htmlElement.getAttribute("data-caliper-marker") || undefined,
    ariaHidden: htmlElement.getAttribute("aria-hidden") === "true",
  };
}

export async function walkAndMeasure(
  rootSelector: string,
  maxDepthOrOptions: number | WalkOptions = DEFAULT_WALK_DEPTH
): Promise<WalkResult> {
  const options: WalkOptions =
    typeof maxDepthOrOptions === "number"
      ? { maxDepth: maxDepthOrOptions, visualize: false }
      : maxDepthOrOptions;

  const maxDepth = options.maxDepth ?? DEFAULT_WALK_DEPTH;
  const maxNodes = options.maxNodes ?? Infinity;
  const continueFrom = options.continueFrom;
  const visualize = options.visualize ?? false;
  const minElementSize = options.minElementSize ?? 0;
  const ignoreSelectors = options.ignoreSelectors ?? [];

  const startTime = performance.now();

  const rootElement = resolveElement(rootSelector);

  if (!rootElement) throw new Error(`Root element not found: ${rootSelector}`);

  try {
    if (visualize) {
      initWalkVisualizer();
    }

    const ignoredElements = new Set<Element>();
    for (const targetSelector of ignoreSelectors) {
      const resolvedElements = resolveElements(targetSelector);
      for (const targetElement of resolvedElements) {
        ignoredElements.add(targetElement);
      }
    }

    const checkIsIgnored = (targetElement: Element): boolean => {
      return ignoredElements.has(targetElement);
    };

    const rootNode = createNodeSnapshot(rootElement, 0);
    const queue: Array<{ element: Element; node: CaliperNode }> = [
      { element: rootElement, node: rootNode },
    ];

    if (visualize) {
      showWalkBoundary(rootElement, rootNode.agentId, true);
    }

    let nodeCount = 0;
    let maxDepthReached = 0;
    let hasMore = false;
    let continuationToken: string | undefined;
    let shouldStop = false;
    let finishingParent: CaliperNode | null = null;
    let skipUntilFound = !!continueFrom;

    const processedNodes = new Set<string>();

    while (queue.length > 0) {
      const { element: currentElement, node: currentNode } = queue.shift()!;

      if (checkIsIgnored(currentElement)) {
        continue;
      }

      if (skipUntilFound) {
        if (currentNode.agentId === continueFrom || currentNode.selector === continueFrom) {
          skipUntilFound = false;
        } else {
          continue;
        }
      }

      nodeCount++;
      maxDepthReached = Math.max(maxDepthReached, currentNode.depth);

      if (!shouldStop && nodeCount >= maxNodes) {
        shouldStop = true;
        finishingParent = currentNode;
      }

      if (
        shouldStop &&
        finishingParent &&
        currentNode.parentAgentId !== finishingParent.parentAgentId &&
        currentNode !== finishingParent
      ) {
        continuationToken = currentNode.agentId;
        hasMore = true;
        queue.unshift({ element: currentElement, node: currentNode });
        nodeCount--;
        break;
      }

      processedNodes.add(currentNode.agentId);

      if (visualize && !document.hidden) {
        showWalkBoundary(currentElement, currentNode.agentId, true);
        await new Promise((resolveAnimationFrame) => requestAnimationFrame(resolveAnimationFrame));
      }

      if (currentNode.depth >= maxDepth) continue;

      const allChildren = [...Array.from(currentElement.children)];
      if (currentElement.shadowRoot) {
        allChildren.push(...Array.from(currentElement.shadowRoot.children));
      }

      const visibleChildren = allChildren.filter(isVisible);
      currentNode.measurements.siblingCount = visibleChildren.length;

      let visibleIdx = 0;
      for (let domIdx = 0; domIdx < allChildren.length; domIdx++) {
        const childElement = allChildren[domIdx]!;
        if (!isVisible(childElement)) continue;

        if (minElementSize > 0) {
          const childRect = childElement.getBoundingClientRect();
          if (childRect.width < minElementSize || childRect.height < minElementSize) continue;
        }

        try {
          const childNode = createNodeSnapshot(
            childElement,
            currentNode.depth + 1,
            domIdx,
            visibleIdx
          );
          childNode.parentAgentId = currentNode.agentId;

          if (visualize) {
            showChildBoundary(childElement, childNode.agentId);
          }

          const parentPadding = currentNode.styles.padding || {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          };
          const parentRect = currentNode.rect;
          childNode.measurements.toParent = {
            top: childNode.rect.top - (parentRect.top + parentPadding.top),
            left: childNode.rect.left - (parentRect.left + parentPadding.left),
            bottom: parentRect.bottom - parentPadding.bottom - childNode.rect.bottom,
            right: parentRect.right - parentPadding.right - childNode.rect.right,
          };

          if (visibleIdx > 0) {
            const prevNode = currentNode.children[visibleIdx - 1]!;
            const isVerticalOrientation = childNode.rect.top >= prevNode.rect.bottom;

            const gapDistance = isVerticalOrientation
              ? childNode.rect.top - prevNode.rect.bottom
              : childNode.rect.left - prevNode.rect.right;

            const gapDirection = isVerticalOrientation ? ("above" as const) : ("left" as const);

            childNode.measurements.toPreviousSibling = {
              distance: gapDistance,
              direction: gapDirection,
            };
            prevNode.measurements.toNextSibling = {
              distance: gapDistance,
              direction: isVerticalOrientation ? ("below" as const) : ("right" as const),
            };
          }

          currentNode.children.push(childNode);
          queue.push({ element: childElement, node: childNode });
          visibleIdx++;
        } catch (nodeSnapshotError) {
          console.warn(
            `[Caliper] Failed to snapshot node at index ${domIdx}. Skipping.`,
            nodeSnapshotError
          );
          continue;
        }
      }
    }

    if (!hasMore && queue.length > 0) {
      hasMore = true;
      continuationToken = queue[0]!.node.agentId;
    }

    function pruneTreeStyles(node: CaliperNode): void {
      node.styles = pruneStyles(node.styles);

      const validChildren: CaliperNode[] = [];
      for (const child of node.children) {
        if (processedNodes.has(child.agentId)) {
          pruneTreeStyles(child);
          validChildren.push(child);
        }
      }
      node.children = validChildren;
    }
    pruneTreeStyles(rootNode);

    const batchInstructions = hasMore
      ? `Tree truncated at ${nodeCount} nodes. To continue, call caliper_walk_and_measure with continueFrom: "${continuationToken}"`
      : undefined;

    return {
      root: rootNode,
      nodeCount,
      maxDepthReached,
      walkDurationMs: performance.now() - startTime,
      hasMore,
      continuationToken,
      batchInstructions,
    };
  } finally {
    if (visualize) {
      setTimeout(() => {
        cleanupWalkVisualizer();
      }, 2000);
    }
  }
}

export function parseSelection(jsonString: string): ParsedSelection {
  try {
    const parsedData = JSON.parse(jsonString);
    if (!parsedData.selector || typeof parsedData.selector !== "string") {
      return {
        selector: "",
        tag: "",
        classes: [],
        timestamp: 0,
        isValid: false,
        errorMessage: "Missing 'selector'",
      };
    }
    return {
      selector: parsedData.selector,
      tag: parsedData.tag || "",
      id: parsedData.id || undefined,
      text: parsedData.text || undefined,
      classes: parsedData.classes || [],
      timestamp: parsedData.timestamp ? parseInt(parsedData.timestamp, 10) : Date.now(),
      isValid: true,
    };
  } catch (error) {
    return {
      selector: "",
      tag: "",
      classes: [],
      timestamp: 0,
      isValid: false,
      errorMessage: "Invalid JSON",
    };
  }
}
