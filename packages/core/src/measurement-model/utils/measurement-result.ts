import type { CursorContext, SyncSource } from "../../shared/types/index.js";
import {
  type ScrollState,
  type PositionMode,
  type StickyConfig,
  getTotalScrollDelta,
} from "../../geometry/utils/scroll-aware.js";

/**
 * Pure data structure for measurement lines
 */
export interface MeasurementLine {
  type: "left" | "top" | "right" | "bottom" | "distance";
  value: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  // Which element each point should sync its scroll with
  startSync?: SyncSource;
  endSync?: SyncSource;
}

/**
 * Pure data structure for measurement result
 */
export interface MeasurementResult {
  context: CursorContext;
  lines: MeasurementLine[];
  primary: DOMRect;
  secondary: DOMRect | null;
  timestamp: number;
  primaryHierarchy: ScrollState[];
  secondaryHierarchy: ScrollState[];
  secondaryElement: Element | null;

  // Position modes for precision sync
  primaryPosition: PositionMode;
  secondaryPosition: PositionMode;

  // Sticky configs for precision sync
  primarySticky?: StickyConfig;
  secondarySticky?: StickyConfig;

  // Initial window scrolls for precision sync
  primaryWinX: number;
  primaryWinY: number;
  secondaryWinX: number;
  secondaryWinY: number;
}

/**
 * Create measurement lines based on context
 */
export function createMeasurementLines(
  context: CursorContext,
  primary: DOMRect,
  secondary: DOMRect | null
): MeasurementLine[] {
  if (!context || !secondary) {
    return [];
  }

  const lines: MeasurementLine[] = [];

  if (context === "sibling") {
    const distance = calculateSiblingDistance(primary, secondary);
    lines.push(distance);
  } else if (context === "parent" || context === "child") {
    const padding = calculatePaddingLines(primary, secondary, context);
    lines.push(...padding);
  }

  return lines;
}

/**
 * Calculate distance between two elements using Top/Bottom faces
 */
function calculateSiblingDistance(primary: DOMRect, sibling: DOMRect): MeasurementLine {
  const overlapXStart = Math.max(primary.left, sibling.left);
  const overlapXEnd = Math.min(primary.right, sibling.right);
  const hasOverlapX = overlapXEnd > overlapXStart;

  const overlapYStart = Math.max(primary.top, sibling.top);
  const overlapYEnd = Math.min(primary.bottom, sibling.bottom);
  const hasOverlapY = overlapYEnd > overlapYStart;

  const syncBase = { startSync: "primary", endSync: "secondary" } as const;

  if (hasOverlapX && !hasOverlapY) {
    const centerX = (overlapXStart + overlapXEnd) / 2;
    const distBtoT = Math.abs(sibling.top - primary.bottom);
    const distTtoB = Math.abs(primary.top - sibling.bottom);

    const startY = distBtoT < distTtoB ? primary.bottom : primary.top;
    const endY = distBtoT < distTtoB ? sibling.top : sibling.bottom;

    return {
      type: "distance",
      value: Math.min(distBtoT, distTtoB),
      start: { x: centerX, y: startY },
      end: { x: centerX, y: endY },
      ...syncBase,
    };
  }

  if (hasOverlapY && !hasOverlapX) {
    const centerY = (overlapYStart + overlapYEnd) / 2;
    const distRtoL = Math.abs(sibling.left - primary.right);
    const distLtoR = Math.abs(primary.left - sibling.right);

    const startX = distRtoL < distLtoR ? primary.right : primary.left;
    const endX = distRtoL < distLtoR ? sibling.left : sibling.right;

    return {
      type: "distance",
      value: Math.min(distRtoL, distLtoR),
      start: { x: startX, y: centerY },
      end: { x: endX, y: centerY },
      ...syncBase,
    };
  }

  const pFaces = [
    { x: (primary.left + primary.right) / 2, y: primary.top },
    { x: (primary.left + primary.right) / 2, y: primary.bottom },
  ];
  const sFaces = [
    { x: (sibling.left + sibling.right) / 2, y: sibling.top },
    { x: (sibling.left + sibling.right) / 2, y: sibling.bottom },
  ];

  let minD2 = Infinity;
  let bestP = pFaces[0];
  let bestS = sFaces[0];

  for (const p of pFaces) {
    for (const s of sFaces) {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2) {
        minD2 = d2;
        bestP = p;
        bestS = s;
      }
    }
  }

  const pFace = bestP ?? pFaces[0]!;
  const sFace = bestS ?? sFaces[0]!;

  return {
    type: "distance",
    value: Math.sqrt(minD2),
    start: { x: pFace.x, y: pFace.y },
    end: { x: sFace.x, y: sFace.y },
    ...syncBase,
  };
}

/**
 * Calculate padding lines (left, top, right, bottom)
 */
function calculatePaddingLines(
  primary: DOMRect,
  container: DOMRect,
  context: "parent" | "child"
): MeasurementLine[] {
  if (context === "parent") {
    // Primary element's distance to parent edges
    return [
      {
        type: "left",
        value: Math.abs(primary.left - container.left),
        start: { x: container.left, y: primary.top + primary.height / 2 },
        end: { x: primary.left, y: primary.top + primary.height / 2 },
        startSync: "secondary",
        endSync: "primary",
      },
      {
        type: "top",
        value: Math.abs(primary.top - container.top),
        start: { x: primary.left + primary.width / 2, y: container.top },
        end: { x: primary.left + primary.width / 2, y: primary.top },
        startSync: "secondary",
        endSync: "primary",
      },
      {
        type: "right",
        value: Math.abs(container.right - primary.right),
        start: { x: primary.right, y: primary.top + primary.height / 2 },
        end: { x: container.right, y: primary.top + primary.height / 2 },
        startSync: "primary",
        endSync: "secondary",
      },
      {
        type: "bottom",
        value: Math.abs(container.bottom - primary.bottom),
        start: { x: primary.left + primary.width / 2, y: primary.bottom },
        end: { x: primary.left + primary.width / 2, y: container.bottom },
        startSync: "primary",
        endSync: "secondary",
      },
    ];
  } else {
    // Child element's distance to primary (selected) element edges
    return [
      {
        type: "left",
        value: Math.abs(container.left - primary.left),
        start: { x: primary.left, y: container.top + container.height / 2 },
        end: { x: container.left, y: container.top + container.height / 2 },
        startSync: "primary",
        endSync: "secondary",
      },
      {
        type: "top",
        value: Math.abs(container.top - primary.top),
        start: { x: container.left + container.width / 2, y: primary.top },
        end: { x: container.left + container.width / 2, y: container.top },
        startSync: "primary",
        endSync: "secondary",
      },
      {
        type: "right",
        value: Math.abs(primary.right - container.right),
        start: { x: container.right, y: container.top + container.height / 2 },
        end: { x: primary.right, y: container.top + container.height / 2 },
        startSync: "secondary",
        endSync: "primary",
      },
      {
        type: "bottom",
        value: Math.abs(primary.bottom - container.bottom),
        start: { x: container.left + container.width / 2, y: container.bottom },
        end: { x: container.left + container.width / 2, y: primary.bottom },
        startSync: "secondary",
        endSync: "primary",
      },
    ];
  }
}

/**
 * Calculate the live coordinates of a point in a line, accounting for scroll.
 */
export function getLivePoint(
  pt: { x: number; y: number },
  owner: SyncSource | undefined,
  line: Pick<MeasurementLine, "type" | "start" | "end">,
  primaryDelta: { deltaX: number; deltaY: number },
  secondaryDelta: { deltaX: number; deltaY: number },
  scrollX: number = 0,
  scrollY: number = 0
) {
  const syncX = owner === "secondary" ? secondaryDelta : primaryDelta;
  const syncY = owner === "secondary" ? secondaryDelta : primaryDelta;

  return {
    x: pt.x - (syncX?.deltaX ?? 0) - scrollX,
    y: pt.y - (syncY?.deltaY ?? 0) - scrollY,
  };
}

/**
 * Pure math helper to calculate the live distance of a line.
 */
export function getLiveLineValue(line: MeasurementLine, result: MeasurementResult | null): number {
  if (!result) {
    return line.value;
  }

  const primaryDelta = getTotalScrollDelta(
    result.primaryHierarchy,
    result.primaryPosition,
    result.primarySticky,
    result.primaryWinX,
    result.primaryWinY
  );

  const secondaryDelta = getTotalScrollDelta(
    result.secondaryHierarchy,
    result.secondaryPosition,
    result.secondarySticky,
    result.secondaryWinX,
    result.secondaryWinY
  );

  const startPoint = getLivePoint(line.start, line.startSync, line, primaryDelta, secondaryDelta);

  const endPoint = getLivePoint(line.end, line.endSync, line, primaryDelta, secondaryDelta);

  const dx = Math.abs(startPoint.x - endPoint.x);
  const dy = Math.abs(startPoint.y - endPoint.y);

  if (line.type === "top" || line.type === "bottom") {
    return dy;
  }
  if (line.type === "left" || line.type === "right") {
    return dx;
  }

  return Math.sqrt(dx * dx + dy * dy);
}
