import { OVERLAY_CONTAINER_ID } from "../constants/index.js";

/**
 * Check if the provided element is a valid renderable object in any context.
 */
export function isRenderable(element: Element | null | undefined): element is HTMLElement | SVGElement {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const doc = element.ownerDocument;
    const win = doc?.defaultView;

    const HTMLElement = win?.HTMLElement;
    const SVGElement = win?.SVGElement;

    if (HTMLElement && element instanceof HTMLElement) return true;
    if (SVGElement && element instanceof SVGElement) return true;

    return "tagName" in element && "getAttribute" in element;
}

export function getOverlayRoot(): HTMLElement {
    return (document.getElementById(OVERLAY_CONTAINER_ID) as HTMLElement) || document.documentElement;
}
