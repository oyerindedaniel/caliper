/**
 * Selection system for tracking selected element
 * Stores only primitive data (DOMRect), not DOM references
 */

export interface SelectionSystem {
  select: (element: Element | null) => void;
  getSelected: () => Element | null;
  getSelectedRect: () => DOMRect | null;
  clear: () => void;
  onRectUpdate: (callback: (rect: DOMRect | null) => void) => () => void;
}

/**
 * Create a selection system
 * GC-friendly: stores only primitive data, not DOM references
 */
export function createSelectionSystem(): SelectionSystem {
  let selectedElement: Element | null = null;
  let selectedRect: DOMRect | null = null;
  const rectUpdateListeners = new Set<(rect: DOMRect | null) => void>();

  function notifyListeners() {
    rectUpdateListeners.forEach((listener) => listener(selectedRect));
  }

  function select(element: Element | null) {
    selectedElement = element;

    if (element) {
      // Initially set to null, will be updated in next frame
      selectedRect = null;
      notifyListeners();

      // Schedule read using post-RAF pattern (before layout, after write RAF)
      requestAnimationFrame(() => {
        Promise.resolve().then(() => {
          selectedRect = element.getBoundingClientRect();
          notifyListeners();
        });
      });
    } else {
      selectedRect = null;
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
    selectedElement = null;
    selectedRect = null;
    notifyListeners();
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
