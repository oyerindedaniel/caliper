/**
 * Get scroll-aware bounding rect
 * Accounts for scroll offsets in scroll containers
 */
export function getScrollAwareRect(
  element: Element,
  scrollContainer?: Element
): DOMRect {
  const rect = element.getBoundingClientRect();

  // If no scroll container specified, use window scroll
  if (!scrollContainer) {
    return rect;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const scrollLeft = scrollContainer.scrollLeft;
  const scrollTop = scrollContainer.scrollTop;

  // Adjust rect relative to scroll container
  return new DOMRect(
    rect.left - containerRect.left + scrollLeft,
    rect.top - containerRect.top + scrollTop,
    rect.width,
    rect.height
  );
}

/**
 * Clip a rectangle to the viewport
 */
export function clipToViewport(rect: DOMRect): DOMRect {
  const viewport = {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };

  const left = Math.max(rect.left, viewport.left);
  const top = Math.max(rect.top, viewport.top);
  const right = Math.min(rect.right, viewport.right);
  const bottom = Math.min(rect.bottom, viewport.bottom);

  return new DOMRect(
    left,
    top,
    Math.max(0, right - left),
    Math.max(0, bottom - top)
  );
}

/**
 * Get scroll offset for an element
 */
export function getScrollOffset(element: Element): { x: number; y: number } {
  if (element === document.documentElement || element === document.body) {
    return {
      x: window.scrollX,
      y: window.scrollY,
    };
  }

  if (element instanceof HTMLElement) {
    return {
      x: element.scrollLeft,
      y: element.scrollTop,
    };
  }

  return { x: 0, y: 0 };
}
