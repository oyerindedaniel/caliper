/**
 * Selection system for tracking selected elements
 */

export interface SelectionSystem {
  select: (element: Element | null) => void;
  getSelected: () => Element | null;
  getSelectedRect: () => DOMRect | null;
  clear: () => void;
  onRectUpdate: (callback: (rect: DOMRect | null) => void) => () => void;
}

export function createSelectionSystem(): SelectionSystem {
  let selectedElement: Element | null = null;
  let selectedRect: DOMRect | null = null;

  const rectUpdateListeners = new Set<(rect: DOMRect | null) => void>();

  function notifyRectListeners() {
    rectUpdateListeners.forEach((listener) => listener(selectedRect));
  }

  function select(element: Element | null) {
    if (selectedElement === element && (element !== null || selectedRect === null)) return;

    selectedElement = element;

    if (element) {
      requestAnimationFrame(() => {
        Promise.resolve().then(() => {
          if (selectedElement === element) {
            const rect = element.getBoundingClientRect();
            selectedRect = new DOMRect(
              rect.left + window.scrollX,
              rect.top + window.scrollY,
              rect.width,
              rect.height
            );
            notifyRectListeners();
          }
        });
      });
    } else {
      selectedRect = null;
      notifyRectListeners();
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

  function onRectUpdate(callback: (rect: DOMRect | null) => void) {
    rectUpdateListeners.add(callback);
    return () => {
      rectUpdateListeners.delete(callback);
    };
  }

  return {
    select,
    getSelected,
    getSelectedRect,
    clear,
    onRectUpdate,
  };
}
