/**
 * Scroll-Aware Geometry Engine
 */

export function getScrollAwareRect(rect: DOMRect): DOMRect {
  return new DOMRect(
    rect.left + window.scrollX,
    rect.top + window.scrollY,
    rect.width,
    rect.height
  );
}

export interface ScrollState {
  element: HTMLElement;
  initialScrollTop: number;
  initialScrollLeft: number;
  containerRect: DOMRect; // In document coordinates
}

/**
 * Valid CSS position values that affect geometry sync
 */
export type PositionMode = "static" | "relative" | "absolute" | "fixed" | "sticky";

/**
 * Metadata for position: sticky elements
 */
export interface StickyConfig {
  top: number | null;
  bottom: number | null;
  left: number | null;
  right: number | null;
  naturalTop: number;
  naturalLeft: number;
  containerWidth: number;
  containerHeight: number;
  elementWidth: number;
  elementHeight: number;
}

export interface DeducedGeometry {
  rect: DOMRect;
  scrollHierarchy: ScrollState[];
  position: PositionMode;
  stickyConfig?: StickyConfig;
  initialWindowX: number;
  initialWindowY: number;
}

export interface LiveGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  clipPath: string;
  isHidden: boolean;
  visibleMinX: number;
  visibleMaxX: number;
  visibleMinY: number;
  visibleMaxY: number;
}

export function isScrollContainer(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  return /(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX);
}

export function getScrollHierarchy(element: Element): ScrollState[] {
  const hierarchy: ScrollState[] = [];
  let parent = element.parentElement;

  while (parent && parent !== document.body) {
    if (isScrollContainer(parent)) {
      const el = parent as HTMLElement;
      hierarchy.push({
        element: el,
        initialScrollTop: el.scrollTop,
        initialScrollLeft: el.scrollLeft,
        containerRect: getScrollAwareRect(el.getBoundingClientRect()),
      });
    }
    parent = parent.parentElement;
  }
  return hierarchy;
}

/**
 * Internal logic for capped sticky delta
 */
function calculateStickyDelta(
  currentScroll: number,
  initialScroll: number,
  naturalPos: number,
  threshold: number | null,
  containerDim: number,
  elementDim: number,
  isOppositeMode = false
): number {
  if (threshold === null) return currentScroll - initialScroll;

  // Static relative position if it weren't forced to stick
  const staticRel = naturalPos - currentScroll;

  let stuckRel = staticRel;
  if (!isOppositeMode) {
    // top / left
    stuckRel = Math.max(staticRel, threshold);
    // don't push outside bottom container edge
    stuckRel = Math.min(stuckRel, containerDim - elementDim);
  } else {
    // bottom / right
    stuckRel = Math.min(staticRel, containerDim - elementDim - threshold);
    stuckRel = Math.max(stuckRel, 0);
  }

  // Current physical position in container coords
  const currentPhysicalPos = naturalPos - currentScroll;
  // How much we've shifted from the "static" scroll path
  const stickyCorrection = currentPhysicalPos - stuckRel;

  return (currentScroll - initialScroll) + stickyCorrection;
}

export function getTotalScrollDelta(
  hierarchy: ScrollState[],
  position: PositionMode = "static",
  sticky?: StickyConfig,
  initWinX = 0,
  initWinY = 0
) {
  // It stays in viewport, so document coords must shift 
  // opposite to the window to result in a stable viewport transform.
  if (position === "fixed") {
    return {
      deltaX: initWinX - window.scrollX,
      deltaY: initWinY - window.scrollY
    };
  }

  let deltaX = 0;
  let deltaY = 0;

  for (let i = 0; i < hierarchy.length; i++) {
    const s = hierarchy[i];
    if (!s) continue;

    let dX = s.element.scrollLeft - s.initialScrollLeft;
    let dY = s.element.scrollTop - s.initialScrollTop;

    // Apply sticking behavior to the nearest container scroll
    if (i === 0 && position === "sticky" && sticky) {
      dX = calculateStickyDelta(
        s.element.scrollLeft,
        s.initialScrollLeft,
        sticky.naturalLeft,
        sticky.left,
        sticky.containerWidth,
        sticky.elementWidth
      );
      dY = calculateStickyDelta(
        s.element.scrollTop,
        s.initialScrollTop,
        sticky.naturalTop,
        sticky.top,
        sticky.containerHeight,
        sticky.elementHeight
      );
    }

    deltaX += dX;
    deltaY += dY;
  }

  // Handle Window Sticky (when hierarchy is empty)
  if (hierarchy.length === 0 && position === "sticky" && sticky) {
    deltaX = calculateStickyDelta(window.scrollX, initWinX, sticky.naturalLeft, sticky.left, window.innerWidth, sticky.elementWidth);
    deltaY = calculateStickyDelta(window.scrollY, initWinY, sticky.naturalTop, sticky.top, window.innerHeight, sticky.elementHeight);
  }

  return { deltaX, deltaY };
}

/**
 * Find shared scroll containers between two elements.
 */
export function getCommonVisibilityWindow(
  h1: ScrollState[],
  h2: ScrollState[],
  el1: Element,
  el2: Element
) {
  const h1Map = new Map<HTMLElement, number>();
  for (let i = 0; i < h1.length; i++) {
    const item = h1[i];
    if (item) h1Map.set(item.element, i);
  }

  const h2Map = new Map<HTMLElement, number>();
  for (let i = 0; i < h2.length; i++) {
    const item = h2[i];
    if (item) h2Map.set(item.element, i);
  }

  const commonElements: ScrollState[] = [];

  // Check shared ancestors
  for (let i = 0; i < h1.length; i++) {
    const s = h1[i];
    if (s && h2Map.has(s.element)) {
      commonElements.push(s);
    }
  }

  // Check edge cases where one element is the container of the other
  if (isScrollContainer(el2)) {
    const sIdx = h1Map.get(el2 as HTMLElement);
    if (sIdx !== undefined) {
      const s = h1[sIdx];
      if (s && !commonElements.includes(s)) commonElements.push(s);
    }
  }
  if (isScrollContainer(el1)) {
    const sIdx = h2Map.get(el1 as HTMLElement);
    if (sIdx !== undefined) {
      const s = h2[sIdx];
      if (s && !commonElements.includes(s)) commonElements.push(s);
    }
  }

  if (commonElements.length === 0) {
    return { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
  }

  let minX = -Infinity;
  let maxX = Infinity;
  let minY = -Infinity;
  let maxY = Infinity;

  // Pre-calculate suffix sums for deltas
  const getSuffixSums = (h: ScrollState[]) => {
    const sumsX = new Float64Array(h.length + 1);
    const sumsY = new Float64Array(h.length + 1);
    for (let i = h.length - 1; i >= 0; i--) {
      const item = h[i];
      if (item) {
        sumsX[i] = (sumsX[i + 1] ?? 0) + (item.element.scrollLeft - item.initialScrollLeft);
        sumsY[i] = (sumsY[i + 1] ?? 0) + (item.element.scrollTop - item.initialScrollTop);
      }
    }
    return { sumsX, sumsY };
  };

  const h1Suffix = getSuffixSums(h1);
  const h2Suffix = getSuffixSums(h2);

  for (let i = 0; i < commonElements.length; i++) {
    const s = commonElements[i];
    if (!s) continue;

    const isH1 = h1Map.has(s.element);
    const suffix = isH1 ? h1Suffix : h2Suffix;
    const sIndex = isH1 ? h1Map.get(s.element) : h2Map.get(s.element);

    if (sIndex === undefined || sIndex === -1) continue;

    const ancestorDeltaX = suffix.sumsX[sIndex + 1] ?? 0;
    const ancestorDeltaY = suffix.sumsY[sIndex + 1] ?? 0;

    const cLiveLeft = s.containerRect.left - ancestorDeltaX;
    const cLiveTop = s.containerRect.top - ancestorDeltaY;

    const clipL = cLiveLeft + s.element.clientLeft;
    const clipT = cLiveTop + s.element.clientTop;
    const clipR = clipL + s.element.clientWidth;
    const clipB = clipT + s.element.clientHeight;

    if (minX === -Infinity) {
      minX = clipL; maxX = clipR; minY = clipT; maxY = clipB;
    } else {
      minX = Math.max(minX, clipL);
      maxX = Math.min(maxX, clipR);
      minY = Math.max(minY, clipT);
      maxY = Math.min(maxY, clipB);
    }
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Calculate live document position and visibility clipping.
 */
export function getLiveGeometry(
  stableRect: DOMRect | null,
  hierarchy: ScrollState[],
  position: PositionMode = "static",
  sticky?: StickyConfig,
  initWinX = 0,
  initWinY = 0
): LiveGeometry | null {
  if (!stableRect) return null;

  const { deltaX, deltaY } = getTotalScrollDelta(hierarchy, position, sticky, initWinX, initWinY);

  let vMinX = -Infinity;
  let vMaxX = Infinity;
  let vMinY = -Infinity;
  let vMaxY = Infinity;

  const len = hierarchy.length;
  const suffixX = new Float64Array(len + 1);
  const suffixY = new Float64Array(len + 1);
  for (let i = len - 1; i >= 0; i--) {
    const item = hierarchy[i];
    if (item) {
      suffixX[i] = (suffixX[i + 1] ?? 0) + (item.element.scrollLeft - item.initialScrollLeft);
      suffixY[i] = (suffixY[i + 1] ?? 0) + (item.element.scrollTop - item.initialScrollTop);
    }
  }

  // Clipping logic remains document-space relative
  for (let i = 0; i < len; i++) {
    const s = hierarchy[i];
    if (!s) continue;

    const ancestorDeltaX = suffixX[i + 1] ?? 0;
    const ancestorDeltaY = suffixY[i + 1] ?? 0;

    const cLiveLeft = s.containerRect.left - ancestorDeltaX;
    const cLiveTop = s.containerRect.top - ancestorDeltaY;

    const clipL = cLiveLeft + s.element.clientLeft;
    const clipT = cLiveTop + s.element.clientTop;

    if (vMinX === -Infinity) {
      vMinX = clipL; vMaxX = clipL + s.element.clientWidth;
      vMinY = clipT; vMaxY = clipT + s.element.clientHeight;
    } else {
      vMinX = Math.max(vMinX, clipL);
      vMaxX = Math.min(vMaxX, clipL + s.element.clientWidth);
      vMinY = Math.max(vMinY, clipT);
      vMaxY = Math.min(vMaxY, clipT + s.element.clientHeight);
    }
  }

  const left = stableRect.left - deltaX;
  const top = stableRect.top - deltaY;
  const width = stableRect.width;
  const height = stableRect.height;

  const isHidden = (vMinX !== -Infinity) && (
    top + height < vMinY ||
    top > vMaxY ||
    left + width < vMinX ||
    left > vMaxX
  );

  const t = Math.max(0, vMinY - top);
  const l = Math.max(0, vMinX - left);
  const b = Math.max(0, top + height - vMaxY);
  const r = Math.max(0, left + width - vMaxX);

  return {
    left,
    top,
    width,
    height,
    clipPath: (vMinX === -Infinity) ? "none" : `inset(${t}px ${r}px ${b}px ${l}px)`,
    isHidden,
    visibleMinX: vMinX,
    visibleMaxX: vMaxX,
    visibleMinY: vMinY,
    visibleMaxY: vMaxY
  };
}

function parseStickyOffset(val: string): number | null {
  if (val === "auto") return null;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Finds effectively inherited positioning mode (fixed/sticky) from ancestors.
 */
function getInheritedPositionMode(element: Element): { mode: PositionMode; anchor: HTMLElement | null } {
  let curr: Element | null = element;
  while (curr && curr !== document.body) {
    if (!(curr instanceof HTMLElement)) {
      curr = curr.parentElement;
      continue;
    }
    const style = window.getComputedStyle(curr);
    if (style.position === "fixed") return { mode: "fixed", anchor: curr };
    if (style.position === "sticky") return { mode: "sticky", anchor: curr };
    curr = curr.parentElement;
  }
  return { mode: "static", anchor: null };
}

export function deduceGeometry(element: Element): DeducedGeometry {
  const rect = element.getBoundingClientRect();
  const scrollHierarchy = getScrollHierarchy(element);

  const initialWindowX = window.scrollX;
  const initialWindowY = window.scrollY;

  // Determine actual effective positioning
  const { mode: position, anchor } = getInheritedPositionMode(element);

  let stickyConfig;
  if (position === "sticky" && anchor) {
    // Thresholds come from the anchor (even if deduced for a child)
    const style = window.getComputedStyle(anchor);

    // Nearest scroll container of the anchor
    const parent = getScrollHierarchy(anchor)[0]?.element || document.documentElement;
    const parentRect = parent.getBoundingClientRect();
    const isDoc = parent === document.documentElement;

    const currentScrollX = isDoc ? initialWindowX : (parent as HTMLElement).scrollLeft;
    const currentScrollY = isDoc ? initialWindowY : (parent as HTMLElement).scrollTop;

    const containerL = parentRect.left + (isDoc ? 0 : (parent as HTMLElement).clientLeft);
    const containerT = parentRect.top + (isDoc ? 0 : (parent as HTMLElement).clientTop);

    // Anchor's current rect in container space
    const anchorRect = anchor.getBoundingClientRect();
    const relLeft = anchorRect.left - containerL;
    const relTop = anchorRect.top - containerT;

    // StickyConfig tracks the ANCHOR behavior
    // But natural offset must also account for child-to-anchor offset
    const childRelX = rect.left - anchorRect.left;
    const childRelY = rect.top - anchorRect.top;

    stickyConfig = {
      top: parseStickyOffset(style.top),
      bottom: parseStickyOffset(style.bottom),
      left: parseStickyOffset(style.left),
      right: parseStickyOffset(style.right),
      naturalTop: relTop + currentScrollY + childRelY,
      naturalLeft: relLeft + currentScrollX + childRelX,
      containerWidth: isDoc ? window.innerWidth : (parent as HTMLElement).clientWidth,
      containerHeight: isDoc ? window.innerHeight : (parent as HTMLElement).clientHeight,
      elementWidth: anchorRect.width,
      elementHeight: anchorRect.height,
    };
  }

  return {
    rect: getScrollAwareRect(rect),
    scrollHierarchy,
    position,
    stickyConfig,
    initialWindowX,
    initialWindowY
  };
}
