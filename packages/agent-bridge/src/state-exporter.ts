import type {
    CaliperAgentState,
    ElementGeometry,
    AgentBridgeConfig,
    CaliperCoreSystems,
} from "./types.js";
import { generateId, isVisible } from "@oyerinde/caliper/core";
import { DEFAULT_DEBOUNCE_MS } from "./constants.js";
import { sanitizeSelection, sanitizeMeasurement } from "./utils.js";
import { CaliperStateStore } from "./state-store.js";

const SEMANTIC_TAGS = ["main", "section", "article", "nav", "header", "footer", "aside"];

function isSemanticLandmark(element: Element): boolean {
    return SEMANTIC_TAGS.includes(element.tagName.toLowerCase());
}

function getTextContent(element: Element): string | undefined {
    let directText = "";
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            directText += child.textContent || "";
        }
    }
    const trimmed = directText.trim();
    if (!trimmed || trimmed.length > 50) return undefined;
    return trimmed;
}

function computeElementGeometry(element: Element): Omit<ElementGeometry, "agentId" | "selector"> {
    const rect = element.getBoundingClientRect();

    return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        absoluteX: rect.left + window.scrollX,
        absoluteY: rect.top + window.scrollY,
        tagName: element.tagName.toLowerCase(),
        textContent: getTextContent(element),
        id: element.id || undefined,
        classList: element.classList.length > 0 ? Array.from(element.classList) : undefined,
    };
}

export function createStateExporter(
    config: AgentBridgeConfig,
    systems: CaliperCoreSystems,
    stateStore: CaliperStateStore
) {
    const { measurementSystem, selectionSystem, onViewportChange } = systems;
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
                    return NodeFilter.FILTER_SKIP;
                }

                if (isSemanticLandmark(el)) {
                    return NodeFilter.FILTER_ACCEPT;
                }

                return NodeFilter.FILTER_SKIP;
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
            activeSelection: sanitizeSelection(selectionSystem.getMetadata()),
            lastMeasurement: sanitizeMeasurement(measurementSystem.getCurrentResult()),
            lastActionResult: stateStore.getState()?.lastActionResult ?? null,
            lastUpdated: Date.now(),
        };

        stateStore.setState(state);

        if (config.onStateChange) {
            config.onStateChange(state);
        }
    }

    function updateMetadataOnly(): void {
        stateStore.updateState({
            activeSelection: sanitizeSelection(selectionSystem.getMetadata()),
            lastMeasurement: sanitizeMeasurement(measurementSystem.getCurrentResult()),
            lastUpdated: Date.now(),
        });

        const currentState = stateStore.getState();
        if (currentState && config.onStateChange) {
            config.onStateChange(currentState);
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
