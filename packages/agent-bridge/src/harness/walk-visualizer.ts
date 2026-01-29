import { DEFAULT_THEME, CALIPER_PREFIX } from "@caliper/core";

const WALK_VIS_PREFIX = `${CALIPER_PREFIX}walk-vis`;
const WALK_VIS_CONTAINER_ID = `${WALK_VIS_PREFIX}-container`;

const WALK_VIS_STYLES = `
.${WALK_VIS_PREFIX}-box {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
  border: 2px solid ${DEFAULT_THEME.primary};
  background: rgba(24, 160, 251, 0.05);
  z-index: 999990;
  transition: opacity 0.15s ease-out, border-color 0.15s ease-out;
}

.${WALK_VIS_PREFIX}-box-active {
  border-color: ${DEFAULT_THEME.primary};
  background: rgba(24, 160, 251, 0.1);
  box-shadow: 0 0 8px rgba(24, 160, 251, 0.4);
}

.${WALK_VIS_PREFIX}-box-child {
  border: 1px dashed ${DEFAULT_THEME.secondary};
  background: rgba(242, 78, 30, 0.03);
  z-index: 999989;
}

.${WALK_VIS_PREFIX}-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 999988;
  overflow: visible;
}
`;

let styleElement: HTMLStyleElement | null = null;
let containerElement: HTMLDivElement | null = null;
let activeBoxes: Map<string, HTMLDivElement> = new Map();
let isVisualizerActive = false;

function injectStyles(): void {
    if (styleElement) return;

    styleElement = document.createElement("style");
    styleElement.id = `${WALK_VIS_PREFIX}-styles`;
    styleElement.textContent = WALK_VIS_STYLES;
    document.head.appendChild(styleElement);
}

function createContainer(): HTMLDivElement {
    if (containerElement) return containerElement;

    containerElement = document.createElement("div");
    containerElement.id = WALK_VIS_CONTAINER_ID;
    containerElement.className = `${WALK_VIS_PREFIX}-container`;
    document.body.appendChild(containerElement);

    return containerElement;
}

function createBox(id: string, rect: DOMRect, isActive: boolean, isChild: boolean): HTMLDivElement {
    const box = document.createElement("div");
    box.id = `${WALK_VIS_PREFIX}-box-${id}`;
    box.className = `${WALK_VIS_PREFIX}-box`;

    if (isActive) {
        box.classList.add(`${WALK_VIS_PREFIX}-box-active`);
    }
    if (isChild) {
        box.classList.add(`${WALK_VIS_PREFIX}-box-child`);
    }

    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    return box;
}

export function initWalkVisualizer(): void {
    if (isVisualizerActive) return;

    injectStyles();
    createContainer();
    isVisualizerActive = true;
}

export function showWalkBoundary(element: Element, id: string, isActive: boolean = false): void {
    if (!isVisualizerActive || !containerElement) {
        initWalkVisualizer();
    }

    const rect = element.getBoundingClientRect();

    const existingBox = activeBoxes.get(id);
    if (existingBox) {
        existingBox.style.left = `${rect.left}px`;
        existingBox.style.top = `${rect.top}px`;
        existingBox.style.width = `${rect.width}px`;
        existingBox.style.height = `${rect.height}px`;

        if (isActive) {
            existingBox.classList.add(`${WALK_VIS_PREFIX}-box-active`);
        } else {
            existingBox.classList.remove(`${WALK_VIS_PREFIX}-box-active`);
        }
        return;
    }

    const box = createBox(id, rect, isActive, false);
    containerElement!.appendChild(box);
    activeBoxes.set(id, box);
}

export function showChildBoundary(element: Element, id: string): void {
    if (!isVisualizerActive || !containerElement) {
        initWalkVisualizer();
    }

    const rect = element.getBoundingClientRect();

    if (activeBoxes.has(id)) return;

    const box = createBox(id, rect, false, true);
    containerElement!.appendChild(box);
    activeBoxes.set(id, box);
}

export function setActiveNode(id: string): void {
    for (const [boxId, box] of activeBoxes) {
        if (boxId === id) {
            box.classList.add(`${WALK_VIS_PREFIX}-box-active`);
        } else {
            box.classList.remove(`${WALK_VIS_PREFIX}-box-active`);
        }
    }
}

export function removeWalkBoundary(id: string): void {
    const box = activeBoxes.get(id);
    if (box) {
        box.remove();
        activeBoxes.delete(id);
    }
}

export function clearAllWalkBoundaries(): void {
    for (const box of activeBoxes.values()) {
        box.remove();
    }
    activeBoxes.clear();
}

export function cleanupWalkVisualizer(): void {
    clearAllWalkBoundaries();

    if (containerElement) {
        containerElement.remove();
        containerElement = null;
    }

    if (styleElement) {
        styleElement.remove();
        styleElement = null;
    }

    isVisualizerActive = false;
}
