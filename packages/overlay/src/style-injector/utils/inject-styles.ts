import { OVERLAY_STYLES } from "../../css/styles.js";

let styleElement: HTMLStyleElement | null = null;
let injectionCount = 0;

/**
 * Inject overlay styles into the document
 */
export function injectStyles(): void {
  if (styleElement) {
    injectionCount++;
    return;
  }

  styleElement = document.createElement("style");
  styleElement.textContent = OVERLAY_STYLES;
  styleElement.setAttribute("data-caliper-styles", "true");

  const head = document.head || document.getElementsByTagName("head")[0];
  head.appendChild(styleElement);

  injectionCount = 1;
}

/**
 * Remove overlay styles from the document
 * Only removes if all references are cleaned up
 */
export function removeStyles(): void {
  if (!styleElement) {
    return;
  }

  injectionCount--;
  if (injectionCount <= 0) {
    styleElement.remove();
    styleElement = null;
    injectionCount = 0;
  }
}

/**
 * Force remove styles (cleanup)
 */
export function forceRemoveStyles(): void {
  if (styleElement) {
    styleElement.remove();
    styleElement = null;
    injectionCount = 0;
  }
}
