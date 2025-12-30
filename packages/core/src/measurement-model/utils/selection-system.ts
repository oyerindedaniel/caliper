/**
 * Selection system for tracking selected and hovered elements
 */

export interface SelectionSystem {
  select: (element: Element | null) => void;
  getSelected: () => Element | null;
  getSelectedRect: () => DOMRect | null;
  hover: (element: Element | null) => void;
  getHoveredRect: () => DOMRect | null;
  clear: () => void;
  onRectUpdate: (callback: (rect: DOMRect | null) => void) => () => void;
  onHoverRectUpdate: (callback: (rect: DOMRect | null) => void) => () => void;
}

export function createSelectionSystem(): SelectionSystem {
  let selectedElement: Element | null = null;
  let selectedRect: DOMRect | null = null;
  let hoveredElement: Element | null = null;
  let hoveredRect: DOMRect | null = null;

  const rectUpdateListeners = new Set<(rect: DOMRect | null) => void>();
  const hoverRectUpdateListeners = new Set<(rect: DOMRect | null) => void>();

  function notifyRectListeners() {
    rectUpdateListeners.forEach((listener) => listener(selectedRect));
  }

  function notifyHoverListeners() {
    hoverRectUpdateListeners.forEach((listener) => listener(hoveredRect));
  }

  function select(element: Element | null) {
    selectedElement = element;

    if (element) {
      selectedRect = null;
      notifyRectListeners();

      requestAnimationFrame(() => {
        Promise.resolve().then(() => {
          if (selectedElement === element) {
            selectedRect = element.getBoundingClientRect();
            notifyRectListeners();
          }
        });
      });
    } else {
      selectedRect = null;
      notifyRectListeners();
    }
  }

  function hover(element: Element | null) {
    if (hoveredElement === element) return;

    hoveredElement = element;

    if (element) {
      requestAnimationFrame(() => {
        Promise.resolve().then(() => {
          if (hoveredElement === element) {
            hoveredRect = element.getBoundingClientRect();
            notifyHoverListeners();
          }
        });
      });
    } else {
      hoveredRect = null;
      notifyHoverListeners();
    }
  }

  function getSelected(): Element | null {
    return selectedElement;
  }

  function getSelectedRect(): DOMRect | null {
    return selectedRect;
  }

  function getHoveredRect(): DOMRect | null {
    return hoveredRect;
  }

  function clear() {
    selectedElement = null;
    selectedRect = null;
    hoveredElement = null;
    hoveredRect = null;
    notifyRectListeners();
    notifyHoverListeners();
  }

  function onRectUpdate(callback: (rect: DOMRect | null) => void) {
    rectUpdateListeners.add(callback);
    return () => {
      rectUpdateListeners.delete(callback);
    };
  }

  function onHoverRectUpdate(callback: (rect: DOMRect | null) => void) {
    hoverRectUpdateListeners.add(callback);
    return () => {
      hoverRectUpdateListeners.delete(callback);
    };
  }

  return {
    select,
    getSelected,
    getSelectedRect,
    hover,
    getHoveredRect,
    clear,
    onRectUpdate,
    onHoverRectUpdate,
  };
}
