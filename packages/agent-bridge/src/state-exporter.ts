import type {
    CaliperAgentState,
    ElementGeometry,
    AgentBridgeConfig,
    CaliperCoreSystems,
} from "./types.js";
import { generateId, isVisible } from "@oyerinde/caliper/core";
import { DEFAULT_MIN_ELEMENT_SIZE, DEFAULT_DEBOUNCE_MS } from "./constants.js";

const SEMANTIC_TAGS = ["main", "section", "article", "nav", "header", "footer", "aside"];

function isSignificantElement(element: Element, minSize: number): boolean {
    if (!isVisible(element)) {
        return false;
    }

    const hasId = !!element.id;
    const hasClass = element.classList.length > 0;
    const isSemantic = SEMANTIC_TAGS.includes(element.tagName.toLowerCase());

    if (!hasId && !hasClass && !isSemantic) {
        return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < minSize || rect.height < minSize) {
        return false;
    }

    return true;
}

function isInViewport(rect: DOMRect, viewport: { width: number; height: number }): boolean {
    return (
        rect.bottom > 0 && rect.right > 0 && rect.top < viewport.height && rect.left < viewport.width
    );
}

function getTextContent(element: Element): string | undefined {
    const text = element.textContent?.trim();
    if (!text || text.length > 100) return undefined;
    return text;
}

function computeElementGeometry(element: Element): Omit<ElementGeometry, "agentId" | "selector"> {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const zIndex = parseInt(style.zIndex, 10) || 0;

    return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        absoluteX: rect.left + window.scrollX,
        absoluteY: rect.top + window.scrollY,
        zIndex,
        tagName: element.tagName.toLowerCase(),
        textContent: getTextContent(element),
        id: element.id || undefined,
        classList: element.classList.length > 0 ? Array.from(element.classList) : undefined,
    };
}

export function createStateExporter(config: AgentBridgeConfig, systems: CaliperCoreSystems) {
    const { measurementSystem, selectionSystem, onViewportChange } = systems;
    const minSize = config.minElementSize ?? DEFAULT_MIN_ELEMENT_SIZE;
    const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let isRunning = false;
    let unsubscribeMeasurement: (() => void) | null = null;
    let unsubscribeSelection: (() => void) | null = null;
    let unsubscribeViewport: (() => void) | null = null;

    function updatePassiveState(): void {
        const viewport = {
            width: document.documentElement.clientWidth,
            height: document.documentElement.clientHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
        };

        const pageGeometry: Record<string, ElementGeometry> = {};

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
                const el = node as Element;

                if (!isVisible(el)) {
                    return NodeFilter.FILTER_REJECT;
                }

                if (!isSignificantElement(el, minSize)) {
                    return NodeFilter.FILTER_SKIP;
                }

                const rect = el.getBoundingClientRect();
                if (!isInViewport(rect, viewport)) {
                    return NodeFilter.FILTER_REJECT;
                }

                return NodeFilter.FILTER_ACCEPT;
            },
        });

        let currentNode = walker.nextNode();
        while (currentNode) {
            const element = currentNode as HTMLElement;

            let agentId = element.getAttribute("data-caliper-agent-id");
            if (!agentId) {
                agentId = generateId("caliper");
                element.setAttribute("data-caliper-agent-id", agentId);
            }

            pageGeometry[agentId] = {
                ...computeElementGeometry(element),
                agentId,
                selector: agentId
            };
            currentNode = walker.nextNode();
        }

        const state: CaliperAgentState = {
            viewport,
            pageGeometry,
            activeSelection: selectionSystem.getMetadata(),
            lastMeasurement: measurementSystem.getCurrentResult(),
            lastActionResult: window.__CALIPER_STATE__?.lastActionResult ?? null,
            lastUpdated: Date.now(),
        };

        window.__CALIPER_STATE__ = state;

        if (config.onStateChange) {
            config.onStateChange(state);
        }
    }

    function updateMetadataOnly(): void {
        if (!window.__CALIPER_STATE__) return;

        window.__CALIPER_STATE__ = {
            ...window.__CALIPER_STATE__,
            activeSelection: selectionSystem.getMetadata(),
            lastMeasurement: measurementSystem.getCurrentResult(),
            lastUpdated: Date.now(),
        };

        if (config.onStateChange) {
            config.onStateChange(window.__CALIPER_STATE__);
        }
    }

    function scheduleUpdate(): void {
        if (!isRunning) return;

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(updatePassiveState, debounceMs);
    }

    function start(): void {
        isRunning = true;

        updatePassiveState();

        unsubscribeViewport = onViewportChange(() => {
            if (isRunning) {
                scheduleUpdate();
            }
        });

        unsubscribeMeasurement = measurementSystem.onStateChange(() => {
            if (isRunning) {
                updateMetadataOnly();
            }
        });

        unsubscribeSelection = selectionSystem.onUpdate(() => {
            if (isRunning) {
                updateMetadataOnly();
            }
        });
    }

    function stop(): void {
        isRunning = false;

        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        if (unsubscribeViewport) {
            unsubscribeViewport();
            unsubscribeViewport = null;
        }

        if (unsubscribeMeasurement) {
            unsubscribeMeasurement();
            unsubscribeMeasurement = null;
        }

        if (unsubscribeSelection) {
            unsubscribeSelection();
            unsubscribeSelection = null;
        }

        delete window.__CALIPER_STATE__;
    }

    function forceUpdate(): void {
        updatePassiveState();
    }

    return {
        start,
        stop,
        forceUpdate,
    };
}
