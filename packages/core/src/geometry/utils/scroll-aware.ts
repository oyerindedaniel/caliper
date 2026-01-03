/**
 * Translate a BoundingClientRect to Document coordinates (Scroll-Aware)
 */
export function getScrollAwareRect(rect: DOMRect): DOMRect {
  return new DOMRect(
    rect.left + window.scrollX,
    rect.top + window.scrollY,
    rect.width,
    rect.height
  );
}


export interface DeducedGeometry {
  rect: DOMRect;
  relativeRect: DOMRect;
  container: HTMLElement;
}

/**
 * Detect if an element is a scroll container and ensure it is positioned
 * so that absolute children anchor correctly to its content origin.
 */
function checkAndPrepareScrollContainer(element: Element): HTMLElement | null {
  const style = window.getComputedStyle(element);
  const isScrollable = /(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX);

  if (isScrollable) {
    // Force position: relative if it's currently static, 
    // so absolute children anchor to the container.
    if (style.position === "static") {
      (element as HTMLElement).style.position = "relative";
    }
    return element as HTMLElement;
  }
  return null;
}

/**
 * Find the best element to mount our portal into.
 * We want the closest ancestor that is a scroll container, or the body.
 */
export function findBestPortalHost(element: Element): HTMLElement {
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const container = checkAndPrepareScrollContainer(parent);
    if (container) return container;
    parent = parent.parentElement;
  }
  return document.body;
}

/**
 * Find a portal host that can accommodate BOTH elements without clipping.
 * This finds a scroll container that contains both, or falls back to body.
 */
export function findCommonPortalHost(el1: Element, el2: Element): HTMLElement {
  const host1 = findBestPortalHost(el1);
  const host2 = findBestPortalHost(el2);

  if (host1 === host2) return host1;

  // If hosts are different, check if one contains the other
  if (host1.contains(el2)) return host1;
  if (host2.contains(el1)) return host2;

  // Otherwise, find common ancestor scroll container or body
  let parent = host1.parentElement;
  while (parent && parent !== document.body) {
    if (parent.contains(el2)) {
      const container = checkAndPrepareScrollContainer(parent);
      if (container) return container;
    }
    parent = parent.parentElement;
  }

  return document.body;
}

/**
 * All geometry needed for sticky overlays.
 * Calculates document-relative rect, stable parent-relative rect, and identifies the portal container.
 */
export function deduceGeometry(element: Element): DeducedGeometry {
  const rect = element.getBoundingClientRect();
  const container = findBestPortalHost(element);
  const containerRect = container.getBoundingClientRect();

  // Stable Relative Rect: relative to the container's content origin.
  const relativeRect = new DOMRect(
    rect.left - containerRect.left + container.scrollLeft,
    rect.top - containerRect.top + container.scrollTop,
    rect.width,
    rect.height
  );

  return {
    rect: getScrollAwareRect(rect),
    relativeRect,
    container,
  };
}

