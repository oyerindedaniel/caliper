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
  element?: HTMLElement;
  containerRect: DOMRect | null; // In document coordinates (can be null in serialized state)
}

export type PositionMode = BasePositionMode;

export type StickyConfig = BaseStickyConfig;

export interface DeducedGeometry extends Omit<BaseSelectionMetadata, "scrollHierarchy" | "rect"> {
  rect: DOMRect;
  scrollHierarchy: ScrollState[];
  depth: number;
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

export function getScrollAwareRect(elementRect: DOMRect): DOMRect {
  return new DOMRect(
    elementRect.left + window.scrollX,
    elementRect.top + window.scrollY,
    elementRect.width,
    elementRect.height
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

  while (parent && parent !== document.documentElement) {
    if (isScrollContainer(parent)) {
      const containerElement = parent as HTMLElement;
      hierarchy.push({
        element: containerElement,
        initialScrollTop: containerElement.scrollTop,
        initialScrollLeft: containerElement.scrollLeft,
        containerRect: getScrollAwareRect(containerElement.getBoundingClientRect()),
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
  scrollOffset: number,
  naturalPosition: number,
  threshold: number,
  containerDimension: number,
  elementDimension: number,
  isOppositeMode: boolean
): number {
  const staticRelationship = naturalPosition - scrollOffset;
  if (!isOppositeMode) {
    let stuck = Math.max(staticRelationship, threshold);
    stuck = Math.min(stuck, containerDimension - elementDimension);
    return stuck;
  } else {
    let stuck = Math.min(staticRelationship, containerDimension - elementDimension - threshold);
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
    threshold,
    containerDimension,
    elementDimension,
    isOppositeMode
  );

  const endRef = calculateStickyRef(
    currentScroll,
    naturalPosition,
    threshold,
    containerDimension,
    elementDimension,
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

  for (let index = 0; index < hierarchy.length; index++) {
    const scrollState = hierarchy[index];
    if (!scrollState) continue;

    // Check if THIS container is fixed.
    // If it is, any scroll above it doesn't move it relative to viewport.
    const isFixed = scrollState.element
      ? window.getComputedStyle(scrollState.element).position === "fixed"
      : false;

    let stepDeltaX = scrollState.element
      ? scrollState.element.scrollLeft - scrollState.initialScrollLeft
      : 0;
    let stepDeltaY = scrollState.element
      ? scrollState.element.scrollTop - scrollState.initialScrollTop
      : 0;

    // Apply sticking behavior to the nearest container scroll
    if (index === 0 && position === "sticky" && sticky && scrollState.element) {
      stepDeltaX = calculateStickyDelta(
        scrollState.element.scrollLeft,
        scrollState.initialScrollLeft,
        sticky.naturalLeft,
        sticky.left,
        sticky.containerWidth,
        sticky.elementWidth
      );
      stepDeltaY = calculateStickyDelta(
        scrollState.element.scrollTop,
        scrollState.initialScrollTop,
        sticky.naturalTop,
        sticky.top,
        sticky.containerHeight,
        sticky.elementHeight
      );
    }

    deltaX += stepDeltaX;
    deltaY += stepDeltaY;

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
  hierarchy1: ScrollState[],
  hierarchy2: ScrollState[],
  element1: Element,
  element2: Element
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
        sumsX[index] =
          (sumsX[index + 1] ?? 0) + (item.element.scrollLeft - item.initialScrollLeft);
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

    const containerLiveLeft = containerRect.left - ancestorDeltaX;
    const containerLiveTop = containerRect.top - ancestorDeltaY;

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

  // Clipping logic remains document-space relative
  for (let index = 0; index < hierarchyLength; index++) {
    const scrollState = hierarchy[index];
    if (!scrollState) continue;

    const containerRect = scrollState.containerRect;
    if (!containerRect) continue;

    const ancestorDeltaX = suffixSumsX[index + 1] ?? 0;
    const ancestorDeltaY = suffixSumsY[index + 1] ?? 0;

    const containerLiveLeft = containerRect.left - ancestorDeltaX;
    const containerLiveTop = containerRect.top - ancestorDeltaY;

    const clipLeft = containerLiveLeft + (scrollState.element?.clientLeft ?? 0);
    const clipTop = containerLiveTop + (scrollState.element?.clientTop ?? 0);

    if (vMinX === -Infinity) {
      vMinX = clipLeft;
      vMaxX = clipLeft + (scrollState.element?.clientWidth ?? containerRect.width);
      vMinY = clipTop;
      vMaxY = clipTop + (scrollState.element?.clientHeight ?? containerRect.height);
    } else {
      vMinX = Math.max(vMinX, clipLeft);
      vMaxX = Math.min(
        vMaxX,
        clipLeft + (scrollState.element?.clientWidth ?? containerRect.width)
      );
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
      vMinX === -Infinity ? "none" : `inset(${topClip}px ${rightClip}px ${bottomClip}px ${leftClip}px)`,
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

/**
 * Finds effectively inherited positioning mode (fixed/sticky) from ancestors.
 */
function getInheritedPositionMode(element: Element): {
  positionMode: PositionMode;
  scrollAnchor: HTMLElement | null;
  containingBlock: HTMLElement | null;
  treeDepth: number;
} {
  let currentElement: Element | null = element;
  let positionMode: PositionMode = "static";
  let scrollAnchor: HTMLElement | null = null;
  let containingBlock: HTMLElement | null = null;
  let treeDepth = 0;

  while (currentElement) {
    if (!isRenderable(currentElement)) {
      currentElement = currentElement.parentElement;
      continue;
    }

    const style = window.getComputedStyle(currentElement);

    // Identify effective positioning mode (nearest positioned ancestor in fixed/sticky track)
    if (positionMode === "static") {
      if (style.position === "fixed") {
        positionMode = "fixed";
        scrollAnchor = currentElement as HTMLElement;
      } else if (style.position === "sticky") {
        positionMode = "sticky";
        scrollAnchor = currentElement as HTMLElement;
      }
    }

    // Capture the first ancestor that establishes a containing block for our element
    // NOTE: An element does not establish a containing block for itself in the 'fixed' sense
    if (
      currentElement !== element &&
      !containingBlock &&
      (style.transform !== "none" ||
        style.filter !== "none" ||
        style.perspective !== "none" ||
        style.contain === "paint" ||
        style.contain === "layout" ||
        style.willChange === "transform" ||
        style.willChange === "filter")
    ) {
      containingBlock = currentElement as HTMLElement;
    }

    if (currentElement === document.documentElement) break;
    currentElement = currentElement.parentElement;
    treeDepth++;
  }

  return { positionMode, scrollAnchor, containingBlock, treeDepth };
}

/**
 * Calculates the exact layout offset of an element relative to a container.
 */
function getDistanceFromContainer(targetElement: HTMLElement, containerElement: Element) {
  let offsetX = 0;
  let offsetY = 0;
  let currentElement = targetElement;

  while (
    currentElement &&
    currentElement !== containerElement &&
    currentElement.offsetParent
  ) {
    offsetX += currentElement.offsetLeft;
    offsetY += currentElement.offsetTop;

    const parentContainer = currentElement.offsetParent as HTMLElement;
    offsetX += parentContainer.clientLeft || 0;
    offsetY += parentContainer.clientTop || 0;

    currentElement = parentContainer;
  }

  if (containerElement instanceof HTMLElement) {
    offsetX -= containerElement.clientLeft || 0;
    offsetY -= containerElement.clientTop || 0;
  }

  return { offsetX, offsetY };
}

export function deduceGeometry(element: Element): DeducedGeometry {
  const rect = element.getBoundingClientRect();
  const scrollHierarchy = getScrollHierarchy(element);

  const initialWindowX = window.scrollX;
  const initialWindowY = window.scrollY;

  const {
    positionMode,
    scrollAnchor,
    containingBlock,
    treeDepth,
  } = getInheritedPositionMode(element);

  let stickyConfig;
  if (positionMode === "sticky" && scrollAnchor) {
    const style = window.getComputedStyle(scrollAnchor);

    const parentElement =
      getScrollHierarchy(scrollAnchor)[0]?.element || document.documentElement;
    const isDoc = parentElement === document.documentElement;

    const anchorRect = scrollAnchor.getBoundingClientRect();

    const childRelTop = rect.top - anchorRect.top;
    const childRelLeft = rect.left - anchorRect.left;
    const childRelBottom = anchorRect.bottom - rect.bottom;
    const childRelRight = anchorRect.right - rect.right;

    const topSticky = parseStickyOffset(style.top);
    const bottomSticky = parseStickyOffset(style.bottom);
    const leftSticky = parseStickyOffset(style.left);
    const rightSticky = parseStickyOffset(style.right);

    const naturalPosition = getDistanceFromContainer(scrollAnchor, parentElement);

    stickyConfig = {
      top: topSticky === null ? null : topSticky + childRelTop,
      bottom: bottomSticky === null ? null : bottomSticky + childRelBottom,
      left: leftSticky === null ? null : leftSticky + childRelLeft,
      right: rightSticky === null ? null : rightSticky + childRelRight,
      naturalTop: naturalPosition.offsetY + childRelTop,
      naturalLeft: naturalPosition.offsetX + childRelLeft,
      containerWidth: isDoc ? window.innerWidth : (parentElement as HTMLElement).clientWidth,
      containerHeight: isDoc ? window.innerHeight : (parentElement as HTMLElement).clientHeight,
      elementWidth: anchorRect.width,
      elementHeight: anchorRect.height,
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
