/**
 * Check if an element is visible
 * Elements are ignored if they are invisible or zero-size
 */
export function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);

  // Check display
  if (style.display === "none") {
    return false;
  }

  // Check visibility
  if (style.visibility === "hidden") {
    return false;
  }

  // Check opacity
  if (parseFloat(style.opacity) === 0) {
    return false;
  }

  return true;
}

/**
 * Check if an element has dimensions
 * Elements with zero width or height are ignored
 */
export function hasSize(element: Element): boolean {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Check if element is eligible for measurement
 * Combines visibility and size checks
 */
export function isEligible(element: Element): boolean {
  if (element.hasAttribute("data-caliper-ignore")) {
    return false;
  }
  return isVisible(element) && hasSize(element);
}
