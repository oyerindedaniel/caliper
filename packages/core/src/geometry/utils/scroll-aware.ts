/**
 * Scroll-Aware Geometry Engine
 */
import type { ScrollState, PositionMode, StickyConfig } from "../../shared/types/index.js";
import type { SelectionMetadata as BaseSelectionMetadata } from "@oyerinde/caliper-schema";
import { isRenderable } from "../../shared/utils/dom-utils.js";

export interface DeducedGeometry extends Omit<
  BaseSelectionMetadata,
  "scrollHierarchy" | "rect" | "stickyConfig"
> {
  rect: DOMRect;
  scrollHierarchy: ScrollState[];
  stickyConfig?: StickyConfig;
  depth: number;
  containingBlock: HTMLElement | null;
  position: PositionMode;
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

export type ScrollGeometryStyle = Pick<
  CSSStyleDeclaration,
  | "position"
  | "overflow"
  | "overflowX"
  | "overflowY"
  | "transform"
  | "filter"
  | "perspective"
  | "contain"
  | "willChange"
  | "top"
  | "bottom"
  | "left"
  | "right"
>;

function getScrollGeometryStyle(element: Element): ScrollGeometryStyle {
  const computedStyle = window.getComputedStyle(element);
  return {
    position: computedStyle.position,
    overflow: computedStyle.overflow,
    overflowX: computedStyle.overflowX,
    overflowY: computedStyle.overflowY,
    transform: computedStyle.transform,
    filter: computedStyle.filter,
    perspective: computedStyle.perspective,
    contain: computedStyle.contain,
    willChange: computedStyle.willChange,
    top: computedStyle.top,
    bottom: computedStyle.bottom,
    left: computedStyle.left,
    right: computedStyle.right,
  };
}

export function getScrollAwareRect(elementRect: DOMRect): DOMRect {
  return new DOMRect(
    elementRect.left + window.scrollX,
    elementRect.top + window.scrollY,
    elementRect.width,
    elementRect.height
  );
}

/** True if overflow/overflowX/overflowY indicate a clipping or scrolling box (auto, scroll, hidden, clip). */
function overflowIndicatesClipping(style: ScrollGeometryStyle | CSSStyleDeclaration): boolean {
  return /(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowY + style.overflowX);
}

export function isScrollContainer(element: Element): boolean {
  if (!isRenderable(element)) return false;
  if (element.tagName.toLowerCase() === "svg") return false;
  const style = getScrollGeometryStyle(element);
  // Broad definition: scroll or clip.
  return overflowIndicatesClipping(style);
}

/**
 * Returns true if an element establishes a scrolling box (can have scrollTop/Left).
 * 'overflow: clip' does NOT establish a scrolling box.
 */
function establishesScrollingBox(element: Element): boolean {
  const style = getScrollGeometryStyle(element);
  return /(auto|scroll|hidden)/.test(style.overflow + style.overflowY + style.overflowX);
}

interface FullHierarchyResult {
  scrollHierarchy: ScrollState[];
  positionMode: PositionMode;
  scrollAnchor: HTMLElement | null;
  containingBlock: HTMLElement | null;
  treeDepth: number;
  anchorAbsoluteDepth: number;
}

/**
 * Build scroll hierarchy and inherited position mode (fixed/sticky) from element to document.
 * Depth from document root is computed per ancestor during the same walk.
 */
function getFullHierarchy(element: Element): FullHierarchyResult {
  const ancestors: Element[] = [];
  let current: Element | null = element;
  while (current) {
    ancestors.push(current);
    if (current === document.documentElement) break;
    current = current.parentElement;
  }
  const n = ancestors.length;
  if (n <= 1) {
    return {
      scrollHierarchy: [],
      positionMode: "static",
      scrollAnchor: null,
      containingBlock: null,
      treeDepth: 0,
      anchorAbsoluteDepth: -1,
    };
  }

  const styles: ScrollGeometryStyle[] = [];
  for (let i = 0; i < n; i++) {
    const node = ancestors[i];
    if (node !== undefined) styles.push(getScrollGeometryStyle(node));
  }

  const hasStickyAbove: boolean[] = [];
  hasStickyAbove[n - 1] = false;
  for (let i = n - 2; i >= 0; i--) {
    const nextStyle = styles[i + 1];
    hasStickyAbove[i] =
      (nextStyle !== undefined && nextStyle.position === "sticky") ||
      (hasStickyAbove[i + 1] ?? false);
  }

  const scrollHierarchy: ScrollState[] = [];
  let positionMode: PositionMode = "static";
  let scrollAnchor: HTMLElement | null = null;
  let containingBlock: HTMLElement | null = null;
  let anchorAbsoluteDepth = -1;

  for (let i = 0; i < n; i++) {
    const ancestor = ancestors[i];
    if (ancestor === undefined || ancestor === document.documentElement) break;
    if (!isRenderable(ancestor)) continue;

    const style = styles[i];
    if (style === undefined) continue;
    const depthFromRoot = n - 1 - i;

    if (positionMode === "static") {
      if (style.position === "fixed") {
        positionMode = "fixed";
        scrollAnchor = ancestor as HTMLElement;
        anchorAbsoluteDepth = depthFromRoot;
      } else if (style.position === "sticky") {
        positionMode = "sticky";
        scrollAnchor = ancestor as HTMLElement;
        anchorAbsoluteDepth = depthFromRoot;
      }
    }

    if (
      ancestor !== element &&
      !containingBlock &&
      (style.transform !== "none" ||
        style.filter !== "none" ||
        style.perspective !== "none" ||
        style.contain === "paint" ||
        style.contain === "layout" ||
        style.willChange === "transform" ||
        style.willChange === "filter")
    ) {
      containingBlock = ancestor as HTMLElement;
    }

    if (i >= 1 && overflowIndicatesClipping(style)) {
      const containerElement = ancestor as HTMLElement;
      scrollHierarchy.push({
        element: containerElement,
        initialScrollTop: containerElement.scrollTop,
        initialScrollLeft: containerElement.scrollLeft,
        containerRect: getScrollAwareRect(containerElement.getBoundingClientRect()),
        absoluteDepth: depthFromRoot,
        hasStickyAncestor: hasStickyAbove[i] ?? false,
      });
    }
  }

  return {
    scrollHierarchy,
    positionMode,
    scrollAnchor,
    containingBlock,
    treeDepth: n - 1,
    anchorAbsoluteDepth,
  };
}

export function getScrollHierarchy(element: Element): ScrollState[] {
  return getFullHierarchy(element).scrollHierarchy;
}

/**
 * Internal logic for capped sticky position
 */
function calculateStickyRef(
  scrollOffset: number,
  naturalPosition: number,
  threshold: number,
  containerDimension: number,
  elementDimension: number,
  isOppositeMode: boolean
): number {
  const staticRelationship = naturalPosition - scrollOffset;

  // Check if containerDimension is negative (indicates cross-container capping mode)
  const isCrossContainerMode = containerDimension < 0;
  const absContainerDim = Math.abs(containerDimension);

  if (!isOppositeMode) {
    let stuck = Math.max(staticRelationship, threshold);

    if (isCrossContainerMode) {
      // Cross-container capping: distance from element to container bottom
      // Max viewport pos = (naturalPos + distance) - elementDim - scrollOffset
      const maxViewportPos = naturalPosition + absContainerDim - elementDimension - scrollOffset;
      stuck = Math.min(stuck, maxViewportPos);
    } else {
      // Same-container capping: total container height
      stuck = Math.min(stuck, absContainerDim - elementDimension);
    }

    return stuck;
  } else {
    let stuck = Math.min(staticRelationship, absContainerDim - elementDimension - threshold);
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
  naturalPosition: number,
  threshold: number | null,
  containerDimension: number,
  elementDimension: number,
  isOppositeMode = false
): number {
  if (threshold === null) return currentScroll - initialScroll;

  const startRef = calculateStickyRef(
    initialScroll,
    naturalPosition,
    threshold ?? -Infinity,
    containerDimension,
    elementDimension,
    isOppositeMode
  );

  const endRef = calculateStickyRef(
    currentScroll,
    naturalPosition,
    threshold ?? -Infinity,
    containerDimension,
    elementDimension,
    isOppositeMode
  );

  return startRef - endRef;
}

/**
 * Calculates the total scroll offset required to sync an overlay element
 * with its DOM target.
 *
 * UNIFIED COORDINATE MODEL (Document-Space Shift):
 * To keep a fixed-root overlay synced with a moving target element, we calculate
 * how much the target has moved in Document Space since the selection was captured.
 *
 * Shift = InitialDocumentPosition - CurrentDocumentPosition
 *
 * 1. Internal Scrollers: Movement of child relative to container parent.
 * 2. Window Scroller: Movement of the entire document relative to the viewport.
 *
 * By accumulating (Initial - Current) across the entire hierarchy, we get the exact
 * negative displacement needed to "counter-act" the move and stay glued to the target.
 */
export function getTotalScrollDelta(
  hierarchy: ScrollState[],
  position: PositionMode = "static",
  sticky?: StickyConfig,
  initialWindowX = 0,
  initialWindowY = 0,
  hasContainingBlock = false
) {
  let totalDeltaX = 0;
  let totalDeltaY = 0;
  let stickyApplied = false;

  for (let index = 0; index < hierarchy.length; index++) {
    const scrollState = hierarchy[index];
    if (!scrollState) continue;

    const element = scrollState.element!;
    const style = getScrollGeometryStyle(element);
    const isFixed = style.position === "fixed";
    const isScrollingBox = establishesScrollingBox(element);

    if (isScrollingBox) {
      /**
       * Depth-Aware Sticky Logic:
       * Only apply sticky pinning thresholds if the current scroller is at or above
       * the sticky anchor's depth in the tree. This prevents "sticky leakage"
       * where internal scrollers inside a sticky element incorrectly attempt to pin.
       */
      const isDescendantOfStickyAnchor =
        sticky && scrollState.absoluteDepth > sticky.anchorAbsoluteDepth;

      let thresholdX = null;
      let thresholdY = null;
      let isOppX = false;
      let isOppY = false;

      if (!stickyApplied && position === "sticky" && sticky && !isDescendantOfStickyAnchor) {
        if (sticky.top !== null) {
          thresholdY = sticky.top;
        } else if (sticky.bottom !== null) {
          thresholdY = sticky.bottom;
          isOppY = true;
        }

        if (sticky.left !== null) {
          thresholdX = sticky.left;
        } else if (sticky.right !== null) {
          thresholdX = sticky.right;
          isOppX = true;
        }
      }

      /**
       * Internal Document Shift:
       * calculateStickyDelta returns (InitialRef - CurrentRef), which handles
       * both static scrolling and sticky pinning within this specific box.
       */
      totalDeltaX += calculateStickyDelta(
        element.scrollLeft,
        scrollState.initialScrollLeft,
        sticky?.naturalLeft ?? 0,
        thresholdX,
        sticky?.containerWidth ?? 0,
        sticky?.elementWidth ?? 0,
        isOppX
      );
      totalDeltaY += calculateStickyDelta(
        element.scrollTop,
        scrollState.initialScrollTop,
        sticky?.naturalTop ?? 0,
        thresholdY,
        sticky?.containerHeight ?? 0,
        sticky?.elementHeight ?? 0,
        isOppY
      );

      if (thresholdX !== null || thresholdY !== null) {
        stickyApplied = true;
      }
    }

    /**
     * Terminate hierarchy at fixed elements (unless portaled/constrained).
     * Since 'fixed' elements are pinned to the viewport, when the window scrolls,
     * their Document Position changes by exactly (InitialWindowScroll - CurrentWindowScroll).
     */
    if (isFixed && !hasContainingBlock) {
      totalDeltaX += initialWindowX - window.scrollX;
      totalDeltaY += initialWindowY - window.scrollY;
      return { deltaX: totalDeltaX, deltaY: totalDeltaY };
    }
  }

  /**
   * Window Scroll Fallback:
   * After processing all internal scrollers, handle positioning relative to the window.
   *
   * CRITICAL INSIGHT:
   * - For STATIC elements: Document position is INVARIANT with window scroll.
   *   stableRect is already in document coords, so NO window delta is needed.
   * - For FIXED elements: They pin to viewport, so document position shifts by
   *   (currentWindowScroll - initialWindowScroll). Our delta = (initial - current).
   * - For STICKY elements: Apply sticky clamping formula to get the delta from
   *   captured position to current live position.
   */
  if (!hasContainingBlock) {
    if (position === "fixed") {
      // Fixed elements: viewport-pinned, document position changes inversely with scroll
      totalDeltaX += initialWindowX - window.scrollX;
      totalDeltaY += initialWindowY - window.scrollY;
    } else if (position === "sticky" && sticky && !stickyApplied) {
      // Sticky elements: clamped pinning at window level
      //
      // DERIVATION:
      // liveDoc = liveViewport + currentScroll
      // stableDoc = captureViewport + captureScroll
      // deltaY = stableDoc - liveDoc
      //        = (captureViewport - liveViewport) + (captureScroll - currentScroll)
      //        = stickyViewportDelta + (initWinY - window.scrollY)
      //
      // Where:
      //   stickyViewportDelta = captureViewport - liveViewport
      //                       = stickyRef(initWinY, ...) - stickyRef(window.scrollY, ...)
      //                       = calculateStickyDelta(window.scrollY, initWinY, ...)
      //   scrollDelta = initWinY - window.scrollY
      //
      const scrollDeltaX = initialWindowX - window.scrollX;
      const scrollDeltaY = initialWindowY - window.scrollY;

      let thresholdX = null;
      let thresholdY = null;
      let isOppX = false;
      let isOppY = false;

      if (sticky.top !== null) {
        thresholdY = sticky.top;
      } else if (sticky.bottom !== null) {
        thresholdY = sticky.bottom;
        isOppY = true;
      }

      if (sticky.left !== null) {
        thresholdX = sticky.left;
      } else if (sticky.right !== null) {
        thresholdX = sticky.right;
        isOppX = true;
      }

      const stickyViewportDeltaX = calculateStickyDelta(
        window.scrollX,
        initialWindowX,
        sticky.naturalLeft,
        thresholdX,
        sticky.containerWidth,
        sticky.elementWidth,
        isOppX
      );
      const stickyViewportDeltaY = calculateStickyDelta(
        window.scrollY,
        initialWindowY,
        sticky.naturalTop,
        thresholdY,
        sticky.containerHeight,
        sticky.elementHeight,
        isOppY
      );

      // deltaY = stickyViewportDelta + scrollDelta
      totalDeltaX += stickyViewportDeltaX + scrollDeltaX;
      totalDeltaY += stickyViewportDeltaY + scrollDeltaY;
    }

    // For STATIC: No window delta needed. Document position is invariant.
  }

  return { deltaX: totalDeltaX, deltaY: totalDeltaY };
}

/**
 * Find shared scroll containers between two elements.
 * When containers have sticky ancestors, their document-space position shifts
 * with window scroll. initWinX/initWinY specify the window scroll at capture
 * time so the clipping bounds can be adjusted to their live positions.
 */
export function getCommonVisibilityWindow(
  hierarchy1: ScrollState[],
  hierarchy2: ScrollState[],
  element1: Element,
  element2: Element,
  initWinX = 0,
  initWinY = 0
) {
  const h1Map = new Map<HTMLElement, number>();
  for (let index = 0; index < hierarchy1.length; index++) {
    const item = hierarchy1[index];
    if (item && item.element) h1Map.set(item.element, index);
  }

  const h2Map = new Map<HTMLElement, number>();
  for (let index = 0; index < hierarchy2.length; index++) {
    const item = hierarchy2[index];
    if (item && item.element) h2Map.set(item.element, index);
  }

  const commonElements: ScrollState[] = [];

  // Check shared ancestors
  for (let index = 0; index < hierarchy1.length; index++) {
    const scrollState = hierarchy1[index];
    if (scrollState && scrollState.element && h2Map.has(scrollState.element)) {
      commonElements.push(scrollState);
    }
  }

  // Check edge cases where one element is the container of the other
  if (isScrollContainer(element2)) {
    const scrollIndex = h1Map.get(element2 as HTMLElement);
    if (scrollIndex !== undefined) {
      const scrollState = hierarchy1[scrollIndex];
      if (scrollState && !commonElements.includes(scrollState)) commonElements.push(scrollState);
    }
  }
  if (isScrollContainer(element1)) {
    const scrollIndex = h2Map.get(element1 as HTMLElement);
    if (scrollIndex !== undefined) {
      const scrollState = hierarchy2[scrollIndex];
      if (scrollState && !commonElements.includes(scrollState)) commonElements.push(scrollState);
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
  const getSuffixSums = (scrollHierarchy: ScrollState[]) => {
    const sumsX = new Float64Array(scrollHierarchy.length + 1);
    const sumsY = new Float64Array(scrollHierarchy.length + 1);
    for (let index = scrollHierarchy.length - 1; index >= 0; index--) {
      const item = scrollHierarchy[index];
      if (item && item.element) {
        sumsX[index] = (sumsX[index + 1] ?? 0) + (item.element.scrollLeft - item.initialScrollLeft);
        sumsY[index] = (sumsY[index + 1] ?? 0) + (item.element.scrollTop - item.initialScrollTop);
      } else if (item) {
        sumsX[index] = sumsX[index + 1] ?? 0;
        sumsY[index] = sumsY[index + 1] ?? 0;
      }
    }
    return { sumsX, sumsY };
  };

  const h1Suffix = getSuffixSums(hierarchy1);
  const h2Suffix = getSuffixSums(hierarchy2);

  for (let index = 0; index < commonElements.length; index++) {
    const scrollState = commonElements[index];
    if (!scrollState) continue;

    if (!scrollState.element) continue;

    const isH1 = h1Map.has(scrollState.element);
    const suffix = isH1 ? h1Suffix : h2Suffix;
    const sIndex = isH1 ? h1Map.get(scrollState.element) : h2Map.get(scrollState.element);

    if (sIndex === undefined || sIndex === -1) continue;

    const containerRect = scrollState.containerRect;
    if (!containerRect) continue;

    const ancestorDeltaX = suffix.sumsX[sIndex + 1] ?? 0;
    const ancestorDeltaY = suffix.sumsY[sIndex + 1] ?? 0;

    // Sticky ancestor adjustment: if this container sits inside a sticky
    // element, its document-space position drifts with window scroll.
    let windowScrollAdjustmentX = 0;
    let windowScrollAdjustmentY = 0;

    let hasStickyAncestorFlag: boolean;
    if (typeof scrollState.hasStickyAncestor === "boolean") {
      hasStickyAncestorFlag = scrollState.hasStickyAncestor;
    } else if (scrollState.element) {
      let checkElement: Element | null = scrollState.element;
      hasStickyAncestorFlag = false;
      while (checkElement && checkElement !== document.documentElement) {
        const checkStyle = getScrollGeometryStyle(checkElement);
        if (checkStyle.position === "sticky") {
          hasStickyAncestorFlag = true;
          break;
        }
        if (checkStyle.position === "fixed") break;
        checkElement = checkElement.parentElement;
      }
    } else {
      hasStickyAncestorFlag = false;
    }

    if (hasStickyAncestorFlag) {
      windowScrollAdjustmentX = window.scrollX - initWinX;
      windowScrollAdjustmentY = window.scrollY - initWinY;
    }

    const containerLiveLeft = containerRect.left - ancestorDeltaX + windowScrollAdjustmentX;
    const containerLiveTop = containerRect.top - ancestorDeltaY + windowScrollAdjustmentY;

    const clipLeft = containerLiveLeft + (scrollState.element?.clientLeft ?? 0);
    const clipTop = containerLiveTop + (scrollState.element?.clientTop ?? 0);
    const clipRight = clipLeft + (scrollState.element?.clientWidth ?? containerRect.width);
    const clipBottom = clipTop + (scrollState.element?.clientHeight ?? containerRect.height);

    if (minX === -Infinity) {
      minX = clipLeft;
      maxX = clipRight;
      minY = clipTop;
      maxY = clipBottom;
    } else {
      minX = Math.max(minX, clipLeft);
      maxX = Math.min(maxX, clipRight);
      minY = Math.max(minY, clipTop);
      maxY = Math.min(maxY, clipBottom);
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

  const hierarchyLength = hierarchy.length;
  const suffixSumsX = new Float64Array(hierarchyLength + 1);
  const suffixSumsY = new Float64Array(hierarchyLength + 1);
  for (let index = hierarchyLength - 1; index >= 0; index--) {
    const item = hierarchy[index];
    if (item && item.element) {
      suffixSumsX[index] =
        (suffixSumsX[index + 1] ?? 0) + (item.element.scrollLeft - item.initialScrollLeft);
      suffixSumsY[index] =
        (suffixSumsY[index + 1] ?? 0) + (item.element.scrollTop - item.initialScrollTop);
    } else if (item) {
      suffixSumsX[index] = suffixSumsX[index + 1] ?? 0;
      suffixSumsY[index] = suffixSumsY[index + 1] ?? 0;
    }
  }

  // Clipping logic - calculate each container's live document position
  // For sticky containers, their doc position changes with window scroll
  // Semantics: initWinX/Y = capture-time scroll, window.scrollX/Y = current scroll

  for (let index = 0; index < hierarchyLength; index++) {
    const scrollState = hierarchy[index];
    if (!scrollState) continue;

    const containerRect = scrollState.containerRect;
    if (!containerRect) continue;

    const ancestorDeltaX = suffixSumsX[index + 1] ?? 0;
    const ancestorDeltaY = suffixSumsY[index + 1] ?? 0;

    let windowScrollAdjustmentX = 0;
    let windowScrollAdjustmentY = 0;

    let hasStickyAncestorFlag: boolean;
    if (typeof scrollState.hasStickyAncestor === "boolean") {
      hasStickyAncestorFlag = scrollState.hasStickyAncestor;
    } else if (scrollState.element) {
      let checkElement: Element | null = scrollState.element;
      hasStickyAncestorFlag = false;
      while (checkElement && checkElement !== document.documentElement) {
        const checkStyle = getScrollGeometryStyle(checkElement);
        if (checkStyle.position === "sticky") {
          hasStickyAncestorFlag = true;
          break;
        }
        // Fixed elements break the chain - their children don't move with window scroll
        if (checkStyle.position === "fixed") break;
        checkElement = checkElement.parentElement;
      }
    } else {
      hasStickyAncestorFlag = false;
    }

    if (hasStickyAncestorFlag) {
      // For containers with sticky ancestors: they move with the sticky element,
      // so their document position changes with window scroll.
      // liveDoc = capturedDoc + (currentScroll - captureScroll)
      windowScrollAdjustmentX = window.scrollX - initWinX;
      windowScrollAdjustmentY = window.scrollY - initWinY;
    }

    const containerLiveLeft = containerRect.left - ancestorDeltaX + windowScrollAdjustmentX;
    const containerLiveTop = containerRect.top - ancestorDeltaY + windowScrollAdjustmentY;

    const clipLeft = containerLiveLeft + (scrollState.element?.clientLeft ?? 0);
    const clipTop = containerLiveTop + (scrollState.element?.clientTop ?? 0);

    if (vMinX === -Infinity) {
      vMinX = clipLeft;
      vMaxX = clipLeft + (scrollState.element?.clientWidth ?? containerRect.width);
      vMinY = clipTop;
      vMaxY = clipTop + (scrollState.element?.clientHeight ?? containerRect.height);
    } else {
      vMinX = Math.max(vMinX, clipLeft);
      vMaxX = Math.min(vMaxX, clipLeft + (scrollState.element?.clientWidth ?? containerRect.width));
      vMinY = Math.max(vMinY, clipTop);
      vMaxY = Math.min(
        vMaxY,
        clipTop + (scrollState.element?.clientHeight ?? containerRect.height)
      );
    }
  }

  const left = stableRect.left - deltaX;
  const top = stableRect.top - deltaY;
  const width = stableRect.width;
  const height = stableRect.height;

  const isHidden =
    vMinX !== -Infinity &&
    (top + height < vMinY || top > vMaxY || left + width < vMinX || left > vMaxX);

  const topClip = Math.max(0, vMinY - top);
  const leftClip = Math.max(0, vMinX - left);
  const bottomClip = Math.max(0, top + height - vMaxY);
  const rightClip = Math.max(0, left + width - vMaxX);

  return {
    left,
    top,
    width,
    height,
    clipPath:
      vMinX === -Infinity
        ? "none"
        : `inset(${topClip}px ${rightClip}px ${bottomClip}px ${leftClip}px)`,
    isHidden,
    visibleMinX: vMinX,
    visibleMaxX: vMaxX,
    visibleMinY: vMinY,
    visibleMaxY: vMaxY,
  };
}

function parseStickyOffset(rawValue: string): number | null {
  if (rawValue === "auto") return null;
  const parsed = parseFloat(rawValue);
  return isNaN(parsed) ? null : parsed;
}

/** Finds effectively inherited positioning mode (fixed/sticky) from ancestors. */
export function getInheritedPositionMode(element: Element): {
  positionMode: PositionMode;
  scrollAnchor: HTMLElement | null;
  containingBlock: HTMLElement | null;
  treeDepth: number;
  anchorAbsoluteDepth: number;
} {
  const full = getFullHierarchy(element);
  return {
    positionMode: full.positionMode,
    scrollAnchor: full.scrollAnchor,
    containingBlock: full.containingBlock,
    treeDepth: full.treeDepth,
    anchorAbsoluteDepth: full.anchorAbsoluteDepth,
  };
}

function getRootOffset(element: Element): { top: number; left: number } {
  let top = 0;
  let left = 0;
  let curr: Element | null = element;
  while (curr instanceof HTMLElement) {
    top += curr.offsetTop;
    left += curr.offsetLeft;
    const parent: Element | null = curr.offsetParent;
    if (parent instanceof HTMLElement) {
      top += parent.clientTop || 0;
      left += parent.clientLeft || 0;
    }
    curr = parent;
  }
  return { top, left };
}

function collectStickyOnPath(
  from: HTMLElement,
  to: Element
): Array<{ element: HTMLElement; originalPosition: string }> {
  const out: Array<{ element: HTMLElement; originalPosition: string }> = [];
  let current: Element | null = from;
  while (current) {
    if (current instanceof HTMLElement) {
      const style = getScrollGeometryStyle(current);
      if (style.position === "sticky") {
        out.push({ element: current, originalPosition: current.style.position });
      }
    }
    if (current === to) break;
    if (current === document.documentElement) break;
    current = current.parentElement;
  }
  return out;
}

/**
 * Calculates the exact layout offset of an element relative to a container.
 * Sticky elements on the path are temporarily set to static so the offset chain is consistent, then restored.
 */
function getDistanceFromContainer(targetElement: HTMLElement, containerElement: Element) {
  const stickyElements = collectStickyOnPath(targetElement, containerElement);
  for (const { element } of stickyElements) element.style.position = "static";
  try {
    const targetOffset = getRootOffset(targetElement);
    const containerOffset = getRootOffset(containerElement);
    return {
      offsetX: targetOffset.left - containerOffset.left,
      offsetY: targetOffset.top - containerOffset.top,
    };
  } finally {
    for (const { element, originalPosition } of stickyElements) {
      element.style.position = originalPosition || "sticky";
    }
  }
}

/**
 * Compute natural position (anchor to scroller) and optionally capping position (capping to scroller)
 * with sticky set to static along both paths, then restore.
 */
function getDistancesWithSingleToggle(
  scrollAnchor: HTMLElement,
  scrollingContainer: Element,
  cappingContainer: HTMLElement | null
): {
  naturalPosition: { offsetX: number; offsetY: number };
  cappingNaturalPosition: { offsetX: number; offsetY: number } | null;
} {
  const seen = new Set<HTMLElement>();
  const list: Array<{ element: HTMLElement; originalPosition: string }> = [];
  for (const { element, originalPosition } of collectStickyOnPath(
    scrollAnchor,
    scrollingContainer
  )) {
    if (!seen.has(element)) {
      seen.add(element);
      list.push({ element, originalPosition });
    }
  }
  if (cappingContainer && cappingContainer !== scrollAnchor) {
    for (const { element, originalPosition } of collectStickyOnPath(
      cappingContainer,
      scrollingContainer
    )) {
      if (!seen.has(element)) {
        seen.add(element);
        list.push({ element, originalPosition });
      }
    }
  }
  for (const { element } of list) element.style.position = "static";
  try {
    const scrollOffset = getRootOffset(scrollingContainer as HTMLElement);
    const anchorOffset = getRootOffset(scrollAnchor);
    const naturalPosition = {
      offsetX: anchorOffset.left - scrollOffset.left,
      offsetY: anchorOffset.top - scrollOffset.top,
    };
    let cappingNaturalPosition: { offsetX: number; offsetY: number } | null = null;
    if (cappingContainer && cappingContainer !== scrollingContainer) {
      const capOffset = getRootOffset(cappingContainer);
      cappingNaturalPosition = {
        offsetX: capOffset.left - scrollOffset.left,
        offsetY: capOffset.top - scrollOffset.top,
      };
    }
    return { naturalPosition, cappingNaturalPosition };
  } finally {
    for (const { element, originalPosition } of list) {
      element.style.position = originalPosition || "sticky";
    }
  }
}

export function deduceGeometry(element: Element): DeducedGeometry {
  const rect = element.getBoundingClientRect();
  const initialWindowX = window.scrollX;
  const initialWindowY = window.scrollY;

  const {
    scrollHierarchy,
    positionMode,
    scrollAnchor,
    containingBlock,
    treeDepth,
    anchorAbsoluteDepth,
  } = getFullHierarchy(element);

  let stickyConfig;
  if (positionMode === "sticky" && scrollAnchor) {
    const style = getScrollGeometryStyle(scrollAnchor);

    let scrollingContainer: Element = document.documentElement;
    let currentParent = scrollAnchor.parentElement;
    while (currentParent && currentParent !== document.documentElement) {
      if (establishesScrollingBox(currentParent)) {
        scrollingContainer = currentParent;
        break;
      }
      currentParent = currentParent.parentElement;
    }

    const cappingContainer = scrollAnchor.parentElement || document.documentElement;
    const isDocLevelCapping =
      cappingContainer === document.documentElement || cappingContainer === document.body;
    const cappingStyle =
      cappingContainer instanceof HTMLElement ? getScrollGeometryStyle(cappingContainer) : null;
    const isCappingContainerSticky = cappingStyle?.position === "sticky";

    const anchorRect = scrollAnchor.getBoundingClientRect();
    const childRelTop = rect.top - anchorRect.top;
    const childRelLeft = rect.left - anchorRect.left;
    const childRelBottom = anchorRect.bottom - rect.bottom;
    const childRelRight = anchorRect.right - rect.right;

    const topSticky = parseStickyOffset(style.top);
    const bottomSticky = parseStickyOffset(style.bottom);
    const leftSticky = parseStickyOffset(style.left);
    const rightSticky = parseStickyOffset(style.right);

    const needCappingDistance =
      !isDocLevelCapping && cappingContainer !== scrollingContainer && !isCappingContainerSticky;

    let naturalPosition: { offsetX: number; offsetY: number };
    let cappingNaturalPosition: { offsetX: number; offsetY: number } | null = null;
    if (needCappingDistance) {
      const dist = getDistancesWithSingleToggle(
        scrollAnchor,
        scrollingContainer,
        cappingContainer as HTMLElement
      );
      naturalPosition = dist.naturalPosition;
      cappingNaturalPosition = dist.cappingNaturalPosition;
    } else {
      naturalPosition = getDistanceFromContainer(scrollAnchor, scrollingContainer);
    }

    let containerHeight: number;
    let containerWidth: number;
    const isWindowLevel = scrollingContainer === document.documentElement;

    if (isDocLevelCapping) {
      containerHeight = window.innerHeight;
      containerWidth = window.innerWidth;
    } else if (cappingContainer === scrollingContainer || isCappingContainerSticky) {
      containerHeight = (scrollingContainer as HTMLElement).clientHeight;
      containerWidth = (scrollingContainer as HTMLElement).clientWidth;
    } else if (isWindowLevel && cappingNaturalPosition) {
      const cappingHeight = (cappingContainer as HTMLElement).clientHeight;
      const cappingWidth = (cappingContainer as HTMLElement).clientWidth;
      const parentTrackHeight =
        cappingNaturalPosition.offsetY + cappingHeight - naturalPosition.offsetY;
      const parentTrackWidth =
        cappingNaturalPosition.offsetX + cappingWidth - naturalPosition.offsetX;
      containerHeight = -parentTrackHeight;
      containerWidth = -parentTrackWidth;
    } else if (cappingNaturalPosition) {
      const scrollerHeight = (scrollingContainer as HTMLElement).clientHeight;
      const scrollerWidth = (scrollingContainer as HTMLElement).clientWidth;
      const cappingHeight = (cappingContainer as HTMLElement).clientHeight;
      const cappingWidth = (cappingContainer as HTMLElement).clientWidth;
      const parentTrackHeight =
        cappingNaturalPosition.offsetY + cappingHeight - naturalPosition.offsetY;
      const parentTrackWidth =
        cappingNaturalPosition.offsetX + cappingWidth - naturalPosition.offsetX;
      containerHeight = parentTrackHeight < scrollerHeight ? -parentTrackHeight : scrollerHeight;
      containerWidth = parentTrackWidth < scrollerWidth ? -parentTrackWidth : scrollerWidth;
    } else {
      containerHeight = (scrollingContainer as HTMLElement).clientHeight;
      containerWidth = (scrollingContainer as HTMLElement).clientWidth;
    }

    stickyConfig = {
      top: topSticky === null ? null : topSticky + childRelTop,
      bottom: bottomSticky === null ? null : bottomSticky + childRelBottom,
      left: leftSticky === null ? null : leftSticky + childRelLeft,
      right: rightSticky === null ? null : rightSticky + childRelRight,
      naturalTop: naturalPosition.offsetY + childRelTop,
      naturalLeft: naturalPosition.offsetX + childRelLeft,
      containerWidth,
      containerHeight,
      elementWidth: anchorRect.width,
      elementHeight: anchorRect.height,
      anchorAbsoluteDepth: anchorAbsoluteDepth,
    };
  }

  return {
    rect: getScrollAwareRect(rect),
    scrollHierarchy,
    position: positionMode,
    stickyConfig,
    initialWindowX,
    initialWindowY,
    depth: treeDepth,
    hasContainingBlock: !!containingBlock,
    containingBlock,
  };
}

/**
 * Clamp a viewport-relative point to the visibility window of a geometry,
 * accounting for the current viewport scroll.
 */
export function clampPointToGeometry(
  point: { x: number; y: number },
  geometry: LiveGeometry | null | undefined,
  viewport: { scrollX: number; scrollY: number }
): { x: number; y: number } {
  if (!geometry) return point;

  return {
    x: Math.max(
      geometry.visibleMinX - viewport.scrollX,
      Math.min(point.x, geometry.visibleMaxX - viewport.scrollX)
    ),
    y: Math.max(
      geometry.visibleMinY - viewport.scrollY,
      Math.min(point.y, geometry.visibleMaxY - viewport.scrollY)
    ),
  };
}
