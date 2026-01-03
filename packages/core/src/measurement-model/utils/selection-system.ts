import { deduceGeometry } from "../../geometry/utils/scroll-aware.js";
import { diagnosticLogger, formatElement, formatRect } from "../../shared/utils/logger.js";

/**
 * Selection system for tracking selected elements
 */

export interface SelectionMetadata {
  element: Element | null;
  rect: DOMRect | null;
  relativeRect: DOMRect | null;
  container: Element | null;
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
  let relativeRect: DOMRect | null = null;
  let container: Element | null = null;

  const updateListeners = new Set<(metadata: SelectionMetadata) => void>();

  function getMetadata(): SelectionMetadata {
    return {
      element: selectedElement,
      rect: selectedRect,
      relativeRect,
      container,
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
            relativeRect = geometry.relativeRect;
            container = geometry.container;

            diagnosticLogger.log(`[SelectionSystem] Select: ${formatElement(element)}`);
            diagnosticLogger.log(`[SelectionSystem] Rect: ${formatRect(selectedRect)}`);
            diagnosticLogger.log(`[SelectionSystem] RelRect: ${formatRect(relativeRect)}`);
            diagnosticLogger.log(`[SelectionSystem] Container: ${formatElement(container)}`);

            notifyListeners();
          }
        });
      });
    } else {
      selectedRect = null;
      relativeRect = null;
      container = null;
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
