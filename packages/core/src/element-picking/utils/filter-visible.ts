import { isRenderable } from "../../shared/utils/dom-utils.js";

/**
 * Check if an element is visible
 * Elements are ignored if they are invisible or zero-size
 */
export function isVisible(element: Element): boolean {
  if (!isRenderable(element)) {
    return false;
  }

  const tagName = element.tagName.toUpperCase();

  // Explicitly ignore non-renderable metadata/structural tags
  if (["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE", "META", "LINK", "HEAD"].includes(tagName)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  const contentVisibility = style.contentVisibility || style.getPropertyValue("content-visibility");

  if (style.display === "none" || contentVisibility === "hidden") {
    return false;
  }

  // We include visibility: hidden and opacity: 0 elements because they
  // still occupy space in the layout and are relevant for geometric audits.
  // The walk engine and picker will handle the "hidden" state via computed styles.
  return true;
}

/**
 * Check if an element has dimensions
 * Elements with zero width or height are ignored
 */
export function hasSize(element: Element): boolean {
  if (!isRenderable(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Check if an element is a form input or editable area
 */
export function isEditable(element: Element | null): boolean {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }

  const tagName = element.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    element.isContentEditable
  );
}

/**
 * Check if element is eligible for measurement
 * Combines visibility and size checks
 */
export function isEligible(element: Element): boolean {
  if (element.closest("[data-caliper-ignore]")) {
    return false;
  }
  return isVisible(element) && hasSize(element);
}
