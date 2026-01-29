/**
 * Scroll-Aware Geometry Engine
 */
import type {
  ScrollState as BaseScrollState,
  PositionMode as BasePositionMode,
  StickyConfig as BaseStickyConfig,
  SelectionMetadata as BaseSelectionMetadata,
} from "@oyerinde/caliper-schema";
import { isRenderable } from "../../shared/utils/dom-utils.js";

export interface ScrollState extends Omit<BaseScrollState, "containerRect"> {
  element: HTMLElement;
  containerRect: DOMRect; // In document coordinates
}

export type PositionMode = BasePositionMode;

export type StickyConfig = BaseStickyConfig;

export interface DeducedGeometry extends Omit<BaseSelectionMetadata, "scrollHierarchy" | "rect"> {
  rect: DOMRect;
  scrollHierarchy: ScrollState[];
  containingBlock: HTMLElement | null;
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

export function getScrollAwareRect(rect: DOMRect): DOMRect {
  return new DOMRect(
    rect.left + window.scrollX,
    rect.top + window.scrollY,
    rect.width,
    rect.height
  );
}

export function isScrollContainer(element: Element): boolean {
  if (!isRenderable(element)) return false;
  const style = window.getComputedStyle(element);
  return /(auto|scroll|clip)/.test(style.overflow + style.overflowY + style.overflowX);
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
 * Internal logic for capped sticky position
 */
function calculateStickyRef(
  scroll: number,
  naturalPos: number,
  threshold: number,
  containerDim: number,
  elementDim: number,
  isOppositeMode: boolean
): number {
  const staticRel = naturalPos - scroll;
  if (!isOppositeMode) {
    let stuck = Math.max(staticRel, threshold);
    stuck = Math.min(stuck, containerDim - elementDim);
    return stuck;
  } else {
    let stuck = Math.min(staticRel, containerDim - elementDim - threshold);
    stuck = Math.max(stuck, 0);
    return stuck;
  }
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

  const startRef = calculateStickyRef(
    initialScroll,
    naturalPos,
    threshold,
    containerDim,
    elementDim,
    isOppositeMode
  );

  const endRef = calculateStickyRef(
    currentScroll,
    naturalPos,
    threshold,
    containerDim,
    elementDim,
    isOppositeMode
  );

  return startRef - endRef;
}

export function getTotalScrollDelta(
  hierarchy: ScrollState[],
  position: PositionMode = "static",
  sticky?: StickyConfig,
  initWinX = 0,
  initWinY = 0,
  hasContainingBlock = false
) {
  let deltaX = 0;
  let deltaY = 0;

  for (let i = 0; i < hierarchy.length; i++) {
    const s = hierarchy[i];
    if (!s) continue;

    // Check if THIS container is fixed. 
    // If it is, any scroll above it doesn't move it relative to viewport.
    const style = window.getComputedStyle(s.element);
    const isFixed = style.position === "fixed";

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

    if (isFixed) {
      // We've hit the fixed horizon. Stop adding ancestor scroll.
      // Add the window scroll counter (unless captured by a containing block)
      if (!hasContainingBlock) {
        deltaX += initWinX - window.scrollX;
        deltaY += initWinY - window.scrollY;
      }
      return { deltaX, deltaY };
    }
  }

  // If we finished loop and we are effectively fixed but the fixed anchor wasn't 
  // a "scroll container" itself, we still need window pinning.
  if (position === "fixed" && !hasContainingBlock) {
    deltaX += initWinX - window.scrollX;
    deltaY += initWinY - window.scrollY;
  }

  // Handle Window Sticky (when hierarchy is empty or no scroll-containers above stick)
  if (hierarchy.length === 0 && position === "sticky" && sticky) {
    deltaX += calculateStickyDelta(
      window.scrollX,
      initWinX,
      sticky.naturalLeft,
      sticky.left,
      window.innerWidth,
      sticky.elementWidth
    );
    deltaY += calculateStickyDelta(
      window.scrollY,
      initWinY,
      sticky.naturalTop,
      sticky.top,
      window.innerHeight,
      sticky.elementHeight
    );
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
      minX = clipL;
      maxX = clipR;
      minY = clipT;
      maxY = clipB;
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
  initWinY = 0,
  hasContainingBlock = false
): LiveGeometry | null {
  if (!stableRect) return null;

  const { deltaX, deltaY } = getTotalScrollDelta(
    hierarchy,
    position,
    sticky,
    initWinX,
    initWinY,
    hasContainingBlock
  );

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
      vMinX = clipL;
      vMaxX = clipL + s.element.clientWidth;
      vMinY = clipT;
      vMaxY = clipT + s.element.clientHeight;
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

  const isHidden =
    vMinX !== -Infinity &&
    (top + height < vMinY || top > vMaxY || left + width < vMinX || left > vMaxX);

  const t = Math.max(0, vMinY - top);
  const l = Math.max(0, vMinX - left);
  const b = Math.max(0, top + height - vMaxY);
  const r = Math.max(0, left + width - vMaxX);

  return {
    left,
    top,
    width,
    height,
    clipPath: vMinX === -Infinity ? "none" : `inset(${t}px ${r}px ${b}px ${l}px)`,
    isHidden,
    visibleMinX: vMinX,
    visibleMaxX: vMaxX,
    visibleMinY: vMinY,
    visibleMaxY: vMaxY,
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
function getInheritedPositionMode(element: Element): {
  mode: PositionMode;
  anchor: HTMLElement | null;
  containingBlock: HTMLElement | null;
} {
  let curr: Element | null = element;
  let mode: PositionMode = "static";
  let anchor: HTMLElement | null = null;
  let containingBlock: HTMLElement | null = null;

  while (curr) {
    if (!isRenderable(curr)) {
      curr = curr.parentElement;
      continue;
    }

    const style = window.getComputedStyle(curr);

    // Identify effective positioning mode (nearest positioned ancestor in fixed/sticky track)
    if (mode === "static") {
      if (style.position === "fixed") {
        mode = "fixed";
        anchor = curr as HTMLElement;
      } else if (style.position === "sticky") {
        mode = "sticky";
        anchor = curr as HTMLElement;
      }
    }

    // Capture the first ancestor that establishes a containing block for our element
    // NOTE: An element does not establish a containing block for itself in the 'fixed' sense
    if (curr !== element && !containingBlock && (
      style.transform !== "none" ||
      style.filter !== "none" ||
      style.perspective !== "none" ||
      style.contain === "paint" ||
      style.contain === "layout" ||
      style.willChange === "transform" ||
      style.willChange === "filter"
    )) {
      containingBlock = curr as HTMLElement;
    }

    if (curr === document.documentElement) break;
    curr = curr.parentElement;
  }

  return { mode, anchor, containingBlock };
}

/**
 * Calculates the exact layout offset of an element relative to a container.
 */
function getDistanceFromContainer(target: HTMLElement, container: Element) {
  let x = 0;
  let y = 0;
  let current = target;

  while (current && current !== container && current.offsetParent) {
    x += current.offsetLeft;
    y += current.offsetTop;

    const parent = current.offsetParent as HTMLElement;
    x += parent.clientLeft || 0;
    y += parent.clientTop || 0;

    current = parent;
  }

  if (container instanceof HTMLElement) {
    x -= container.clientLeft || 0;
    y -= container.clientTop || 0;
  }

  return { x, y };
}

export function deduceGeometry(element: Element): DeducedGeometry {
  const rect = element.getBoundingClientRect();
  const scrollHierarchy = getScrollHierarchy(element);

  const initialWindowX = window.scrollX;
  const initialWindowY = window.scrollY;

  const { mode: position, anchor, containingBlock } = getInheritedPositionMode(element);

  let stickyConfig;
  if (position === "sticky" && anchor) {
    const style = window.getComputedStyle(anchor);

    const parent = getScrollHierarchy(anchor)[0]?.element || document.documentElement;
    const isDoc = parent === document.documentElement;

    const anchorRect = anchor.getBoundingClientRect();

    const childRelTop = rect.top - anchorRect.top;
    const childRelLeft = rect.left - anchorRect.left;
    const childRelBottom = anchorRect.bottom - rect.bottom;
    const childRelRight = anchorRect.right - rect.right;

    const t = parseStickyOffset(style.top);
    const b = parseStickyOffset(style.bottom);
    const l = parseStickyOffset(style.left);
    const r = parseStickyOffset(style.right);

    const naturalPos = getDistanceFromContainer(anchor, parent);

    stickyConfig = {
      top: t === null ? null : t + childRelTop,
      bottom: b === null ? null : b + childRelBottom,
      left: l === null ? null : l + childRelLeft,
      right: r === null ? null : r + childRelRight,
      naturalTop: naturalPos.y + childRelTop,
      naturalLeft: naturalPos.x + childRelLeft,
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
    initialWindowY,
    hasContainingBlock: !!containingBlock,
    containingBlock,
  };
}

/**
 * Clamp a viewport-relative point to the visibility window of a geometry,
 * accounting for the current viewport scroll.
 */
export function clampPointToGeometry(
  pt: { x: number; y: number },
  geo: LiveGeometry | null | undefined,
  viewport: { scrollX: number; scrollY: number }
): { x: number; y: number } {
  if (!geo) return pt;

  return {
    x: Math.max(
      geo.visibleMinX - viewport.scrollX,
      Math.min(pt.x, geo.visibleMaxX - viewport.scrollX)
    ),
    y: Math.max(
      geo.visibleMinY - viewport.scrollY,
      Math.min(pt.y, geo.visibleMaxY - viewport.scrollY)
    ),
  };
}
