import type { CaliperNode, CaliperComputedStyles } from "@oyerinde/caliper-schema";
import { isVisible, filterRuntimeClasses } from "@oyerinde/caliper/core";

function generateStableSelector(element: Element): string {
    if (element.id) {
        return `#${element.id}`;
    }

    const agentId = element.getAttribute("data-caliper-agent-id");
    if (agentId) {
        return `[data-caliper-agent-id="${agentId}"]`;
    }

    const testId = element.getAttribute("data-testid");
    if (testId) {
        return `[data-testid="${testId}"]`;
    }

    const tag = element.tagName.toLowerCase();
    const cssClasses = Array.from(element.classList).slice(0, 2).join(".");
    const parent = element.parentElement;

    if (parent) {
        const siblings = Array.from(parent.children).filter(
            (sibling) => sibling.tagName === element.tagName
        );
        const index = siblings.indexOf(element) + 1;

        if (cssClasses) {
            return `${tag}.${cssClasses}:nth-of-type(${index})`;
        }
        return `${tag}:nth-of-type(${index})`;
    }

    return cssClasses ? `${tag}.${cssClasses}` : tag;
}

function parseComputedStyles(styles: CSSStyleDeclaration): CaliperComputedStyles {
    const parseNumber = (value: string): number => parseFloat(value) || 0;

    return {
        display: styles.display,
        position: styles.position,
        boxSizing: styles.boxSizing,

        padding: {
            top: parseNumber(styles.paddingTop),
            right: parseNumber(styles.paddingRight),
            bottom: parseNumber(styles.paddingBottom),
            left: parseNumber(styles.paddingLeft),
        },
        margin: {
            top: parseNumber(styles.marginTop),
            right: parseNumber(styles.marginRight),
            bottom: parseNumber(styles.marginBottom),
            left: parseNumber(styles.marginLeft),
        },
        border: {
            top: parseNumber(styles.borderTopWidth),
            right: parseNumber(styles.borderRightWidth),
            bottom: parseNumber(styles.borderBottomWidth),
            left: parseNumber(styles.borderLeftWidth),
        },

        gap: styles.gap ? parseNumber(styles.gap) : null,
        flexDirection: styles.flexDirection || undefined,
        justifyContent: styles.justifyContent || undefined,
        alignItems: styles.alignItems || undefined,

        fontSize: parseNumber(styles.fontSize),
        fontWeight: styles.fontWeight,
        fontFamily: styles.fontFamily,
        lineHeight: styles.lineHeight === "normal" ? null : parseNumber(styles.lineHeight),
        letterSpacing: parseNumber(styles.letterSpacing),
        color: styles.color,

        backgroundColor: styles.backgroundColor,
        borderRadius: styles.borderRadius,
        opacity: parseNumber(styles.opacity),
        zIndex: styles.zIndex === "auto" ? null : parseInt(styles.zIndex, 10),

        overflow: styles.overflow,
        overflowX: styles.overflowX,
        overflowY: styles.overflowY,
    };
}

function buildStructure(element: Element, depth: number, maxDepth: number): CaliperNode {
    const htmlElement = element as HTMLElement;
    const boundingClientRect = htmlElement.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(htmlElement);
    const agentId = htmlElement.getAttribute("data-caliper-agent-id") || generateStableSelector(htmlElement);

    const node: CaliperNode = {
        agentId,
        selector: generateStableSelector(htmlElement),
        tag: htmlElement.tagName.toLowerCase(),
        htmlId: htmlElement.id || undefined,
        classes: filterRuntimeClasses(htmlElement.classList),
        textContent: (htmlElement.textContent || "").trim().slice(0, 100) || undefined,

        rect: {
            top: boundingClientRect.top + window.scrollY,
            left: boundingClientRect.left + window.scrollX,
            bottom: boundingClientRect.bottom + window.scrollY,
            right: boundingClientRect.right + window.scrollX,
            width: boundingClientRect.width,
            height: boundingClientRect.height,
            x: boundingClientRect.left + window.scrollX,
            y: boundingClientRect.top + window.scrollY,
        },

        viewportRect: {
            top: boundingClientRect.top,
            left: boundingClientRect.left,
        },

        styles: parseComputedStyles(computedStyle),

        measurements: {
            toParent: { top: 0, left: 0, bottom: 0, right: 0 },
            toPreviousSibling: null,
            toNextSibling: null,
            indexInParent: 0,
            siblingCount: 0,
        },

        depth,
        parentAgentId: undefined,
        childCount: htmlElement.children.length,
        children: [],
    };

    if (depth < maxDepth) {
        const visibleChildren = Array.from(htmlElement.children).filter(isVisible);
        node.children = visibleChildren.map((child) => {
            const childNode = buildStructure(child, depth + 1, maxDepth);
            childNode.parentAgentId = node.agentId;
            return childNode;
        });
    }

    return node;
}

function calculateMeasurements(node: CaliperNode, parent: CaliperNode | null): void {
    if (parent) {
        const parentPadding = parent.styles.padding;
        const parentRect = parent.rect;

        node.measurements.toParent = {
            top: node.rect.top - (parentRect.top + parentPadding.top),
            left: node.rect.left - (parentRect.left + parentPadding.left),
            bottom: (parentRect.bottom - parentPadding.bottom) - node.rect.bottom,
            right: (parentRect.right - parentPadding.right) - node.rect.right,
        };
    }

    for (let i = 0; i < node.children.length; i++) {
        const childNode = node.children[i]!;
        childNode.measurements.indexInParent = i;
        childNode.measurements.siblingCount = node.children.length;

        if (i > 0) {
            const previousSibling = node.children[i - 1]!;
            const isVertical = childNode.rect.top >= previousSibling.rect.bottom;

            childNode.measurements.toPreviousSibling = {
                distance: isVertical
                    ? childNode.rect.top - previousSibling.rect.bottom
                    : childNode.rect.left - previousSibling.rect.right,
                direction: isVertical ? "above" : "left",
            };
        }

        if (i < node.children.length - 1) {
            const nextSibling = node.children[i + 1]!;
            const isVertical = nextSibling.rect.top >= childNode.rect.bottom;

            childNode.measurements.toNextSibling = {
                distance: isVertical
                    ? nextSibling.rect.top - childNode.rect.bottom
                    : nextSibling.rect.left - childNode.rect.right,
                direction: isVertical ? "below" : "right",
            };
        }

        calculateMeasurements(childNode, node);
    }
}

export interface WalkResult {
    root: CaliperNode;
    nodeCount: number;
    maxDepthReached: number;
    walkDurationMs: number;
}

function countNodes(node: CaliperNode): number {
    return 1 + node.children.reduce((total: number, childNode: CaliperNode) => total + countNodes(childNode), 0);
}

function findMaxDepth(node: CaliperNode): number {
    if (node.children.length === 0) return node.depth;
    return Math.max(...node.children.map(childNode => findMaxDepth(childNode)));
}

export function walkAndMeasure(rootSelector: string, maxDepth: number = 5): WalkResult {
    const startTimeInMilliseconds = performance.now();

    let rootElement: Element | null = null;

    if (rootSelector.startsWith("caliper-")) {
        rootElement = document.querySelector(`[data-caliper-agent-id="${rootSelector}"]`);
    } else {
        rootElement = document.querySelector(rootSelector);
    }

    if (!rootElement) {
        throw new Error(`Root element not found: ${rootSelector}`);
    }

    const tree = buildStructure(rootElement, 0, maxDepth);

    calculateMeasurements(tree, null);

    const endTimeInMilliseconds = performance.now();

    return {
        root: tree,
        nodeCount: countNodes(tree),
        maxDepthReached: findMaxDepth(tree),
        walkDurationMs: endTimeInMilliseconds - startTimeInMilliseconds,
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
            return {
                selector: "",
                tag: "",
                classes: [],
                timestamp: 0,
                isValid: false,
                errorMessage: "Missing or invalid 'selector' field",
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
            errorMessage: error instanceof Error ? error.message : "Invalid JSON",
        };
    }
}
