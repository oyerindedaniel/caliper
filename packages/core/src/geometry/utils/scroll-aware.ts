/**
 * Get scroll-aware bounding rect
 * Returns a Page-Relative rect (Document coordinates)
 */
export function getScrollAwareRect(
  element: Element,
  scrollContainer?: Element
): DOMRect {
  const rect = element.getBoundingClientRect();

  // If inside a specific scrollable container (like a overflow: scroll div)
  if (scrollContainer && scrollContainer !== document.documentElement && scrollContainer !== document.body) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const scrollLeft = scrollContainer.scrollLeft;
    const scrollTop = scrollContainer.scrollTop;

    return new DOMRect(
      rect.left - containerRect.left + scrollLeft,
      rect.top - containerRect.top + scrollTop,
      rect.width,
      rect.height
    );
  }

  // Default: Page-relative (relative to Document)
  return new DOMRect(
    rect.left + window.scrollX,
    rect.top + window.scrollY,
    rect.width,
    rect.height
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
