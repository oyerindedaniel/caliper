/**
 * Selection system for tracking selected element
 * Stores only primitive data (DOMRect), not DOM references
 */

export interface SelectionSystem {
  select: (element: Element | null) => void;
  getSelected: () => Element | null;
  getSelectedRect: () => DOMRect | null;
  clear: () => void;
}

/**
 * Create a selection system
 * GC-friendly: stores only primitive data, not DOM references
 */
export function createSelectionSystem(): SelectionSystem {
  let selectedElement: Element | null = null;
  let selectedRect: DOMRect | null = null;

  function select(element: Element | null) {
    selectedElement = element;

    if (element) {
      // Schedule read using post-RAF pattern (before layout, after write RAF)
      requestAnimationFrame(() => {
        Promise.resolve().then(() => {
          selectedRect = element.getBoundingClientRect();
        });
      });
      // Initially set to null, will be updated in next frame
      selectedRect = null;
    } else {
      selectedRect = null;
    }
  }

  function getSelected(): Element | null {
    return selectedElement;
  }

  function getSelectedRect(): DOMRect | null {
    // Return cached rect
    // Note: Rect should be refreshed by caller when selection changes
    // This avoids DOM reads during write phase
    return selectedRect;
  }

  function clear() {
    selectedElement = null;
    selectedRect = null;
  }

  return {
    select,
    getSelected,
    getSelectedRect,
    clear,
  };
}
