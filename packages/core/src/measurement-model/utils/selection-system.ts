import { deduceGeometry, type ScrollState, type PositionMode, type StickyConfig } from "../../geometry/utils/scroll-aware.js";

/**
 * Selection system for tracking selected elements
 */

export interface SelectionMetadata {
  element: Element | null;
  rect: DOMRect | null;
  scrollHierarchy: ScrollState[];
  position: PositionMode;
  stickyConfig?: StickyConfig;
  initialWindowX: number;
  initialWindowY: number;
}

export interface SelectionSystem {
  select: (element: Element | null) => void;
  getSelected: () => Element | null;
  getSelectedRect: () => DOMRect | null;
  getMetadata: () => SelectionMetadata;
  clear: () => void;
  onUpdate: (callback: (metadata: SelectionMetadata) => void) => () => void;
}

export function createSelectionSystem(): SelectionSystem {
  let selectedElement: Element | null = null;
  let selectedRect: DOMRect | null = null;
  let scrollHierarchy: ScrollState[] = [];
  let position: PositionMode = "static";
  let stickyConfig: StickyConfig | undefined;
  let initialWindowX = 0;
  let initialWindowY = 0;

  const updateListeners = new Set<(metadata: SelectionMetadata) => void>();

  function getMetadata(): SelectionMetadata {
    return {
      element: selectedElement,
      rect: selectedRect,
      scrollHierarchy,
      position,
      stickyConfig,
      initialWindowX,
      initialWindowY,
    };
  }

  function notifyListeners() {
    const metadata = getMetadata();
    updateListeners.forEach((listener) => listener(metadata));
  }

  function select(element: Element | null) {
    if (selectedElement === element && (element !== null || selectedRect === null)) return;

    selectedElement = element;

    if (element) {
      requestAnimationFrame(() => {
        Promise.resolve().then(() => {
          if (selectedElement === element) {
            const geometry = deduceGeometry(element);
            selectedRect = geometry.rect;
            scrollHierarchy = geometry.scrollHierarchy;
            position = geometry.position;
            stickyConfig = geometry.stickyConfig;
            initialWindowX = geometry.initialWindowX;
            initialWindowY = geometry.initialWindowY;

            notifyListeners();
          }
        });
      });
    } else {
      selectedRect = null;
      scrollHierarchy = [];
      position = "static";
      stickyConfig = undefined;
      initialWindowX = 0;
      initialWindowY = 0;
      notifyListeners();
    }
  }

  function getSelected(): Element | null {
    return selectedElement;
  }

  function getSelectedRect(): DOMRect | null {
    return selectedRect;
  }

  function clear() {
    select(null);
  }

  function onUpdate(callback: (metadata: SelectionMetadata) => void) {
    updateListeners.add(callback);
    return () => {
      updateListeners.delete(callback);
    };
  }

  return {
    select,
    getSelected,
    getSelectedRect,
    getMetadata,
    clear,
    onUpdate,
  };
}
