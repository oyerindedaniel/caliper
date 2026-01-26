import type { CaliperNode } from "@oyerinde/caliper-schema";
import { isVisible, filterRuntimeClasses, getElementDirectText } from "@oyerinde/caliper/core";
import { DEFAULT_WALK_DEPTH } from "../constants.js";
import { parseComputedStyles } from "../utils.js";
import {
    initWalkVisualizer,
    showWalkBoundary,
    showChildBoundary,
    cleanupWalkVisualizer,
} from "./walk-visualizer.js";

function generateStableSelector(element: Element, domIndex?: number): string {
    if (element.id) return `#${element.id}`;

    const testId = element.getAttribute("data-testid");
    if (testId) return `[data-testid="${testId}"]`;

    const tag = element.tagName.toLowerCase();
    const cssClasses = filterRuntimeClasses(element.classList).slice(0, 2).join(".");

    if (domIndex !== undefined) {
        const selector = cssClasses ? `${tag}.${cssClasses}` : tag;
        return `${selector}:nth-child(${domIndex + 1})`;
    }

    const agentId = element.getAttribute("data-caliper-agent-id");
    if (agentId) return `[data-caliper-agent-id="${agentId}"]`;

    return cssClasses ? `${tag}.${cssClasses}` : tag;
}

function createNodeSnapshot(element: Element, depth: number, domIndex?: number, visibleIndex?: number): CaliperNode {
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
        textContent: getElementDirectText(htmlElement, 100),

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
    };
}

export interface WalkResult {
    root: CaliperNode;
    nodeCount: number;
    maxDepthReached: number;
    walkDurationMs: number;
}

export interface WalkOptions {
    maxDepth?: number;
    visualize?: boolean;
}

export function walkAndMeasure(
    rootSelector: string,
    maxDepthOrOptions: number | WalkOptions = DEFAULT_WALK_DEPTH
): WalkResult {
    const options: WalkOptions = typeof maxDepthOrOptions === "number"
        ? { maxDepth: maxDepthOrOptions, visualize: false }
        : maxDepthOrOptions;

    const maxDepth = options.maxDepth ?? DEFAULT_WALK_DEPTH;
    const visualize = options.visualize ?? false;

    const startTime = performance.now();

    const rootElement = rootSelector.startsWith("caliper-")
        ? document.querySelector(`[data-caliper-agent-id="${rootSelector}"]`)
        : document.querySelector(rootSelector);

    if (!rootElement) throw new Error(`Root element not found: ${rootSelector}`);

    if (visualize) {
        initWalkVisualizer();
    }

    const rootNode = createNodeSnapshot(rootElement, 0);
    const queue: Array<{ el: Element; node: CaliperNode }> = [{ el: rootElement, node: rootNode }];

    if (visualize) {
        showWalkBoundary(rootElement, rootNode.agentId, true);
    }

    let nodeCount = 0;
    let maxDepthReached = 0;

    while (queue.length > 0) {
        const { el, node } = queue.shift()!;
        nodeCount++;
        maxDepthReached = Math.max(maxDepthReached, node.depth);

        if (visualize) {
            showWalkBoundary(el, node.agentId, true);
        }

        if (node.depth >= maxDepth) continue;

        const allChildren = Array.from(el.children);
        const visibleChildren = allChildren.filter(isVisible);
        node.measurements.siblingCount = visibleChildren.length;

        let visibleIdx = 0;
        for (let domIdx = 0; domIdx < allChildren.length; domIdx++) {
            const childEl = allChildren[domIdx]!;
            if (!isVisible(childEl)) continue;

            const childNode = createNodeSnapshot(childEl, node.depth + 1, domIdx, visibleIdx);
            childNode.parentAgentId = node.agentId;

            if (visualize) {
                showChildBoundary(childEl, childNode.agentId);
            }

            const pPadding = node.styles.padding;
            const pRect = node.rect;
            childNode.measurements.toParent = {
                top: childNode.rect.top - (pRect.top + pPadding.top),
                left: childNode.rect.left - (pRect.left + pPadding.left),
                bottom: (pRect.bottom - pPadding.bottom) - childNode.rect.bottom,
                right: (pRect.right - pPadding.right) - childNode.rect.right,
            };

            if (visibleIdx > 0) {
                const prevNode = node.children[visibleIdx - 1]!;
                const isVertical = childNode.rect.top >= prevNode.rect.bottom;

                const distance = isVertical
                    ? childNode.rect.top - prevNode.rect.bottom
                    : childNode.rect.left - prevNode.rect.right;

                const direction = isVertical ? "above" as const : "left" as const;

                childNode.measurements.toPreviousSibling = { distance, direction };
                prevNode.measurements.toNextSibling = {
                    distance,
                    direction: isVertical ? "below" as const : "right" as const
                };
            }

            node.children.push(childNode);
            queue.push({ el: childEl, node: childNode });
            visibleIdx++;
        }
    }

    if (visualize) {
        setTimeout(() => {
            cleanupWalkVisualizer();
        }, 2000);
    }

    return {
        root: rootNode,
        nodeCount,
        maxDepthReached,
        walkDurationMs: performance.now() - startTime,
    };
}

export interface ParsedSelection {
    selector: string;
    tag: string;
    id?: string;
    text?: string;
    classes: string[];
    timestamp: number;
    isValid: boolean;
    errorMessage?: string;
}

export function parseSelection(jsonString: string): ParsedSelection {
    try {
        const parsedData = JSON.parse(jsonString);
        if (!parsedData.selector || typeof parsedData.selector !== "string") {
            return { selector: "", tag: "", classes: [], timestamp: 0, isValid: false, errorMessage: "Missing 'selector'" };
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
        return { selector: "", tag: "", classes: [], timestamp: 0, isValid: false, errorMessage: "Invalid JSON" };
    }
}
