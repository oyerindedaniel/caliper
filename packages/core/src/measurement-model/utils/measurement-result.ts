import type { CursorContext } from "../../shared/types/index.js";

/**
 * Pure data structure for measurement lines
 */
export interface MeasurementLine {
  type: "left" | "top" | "right" | "bottom" | "distance";
  value: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
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
  primaryRelative: DOMRect | null;
  secondaryRelative: DOMRect | null;
  secondaryElement: Element | null;
  container: Element | null;
  secondaryContainer: Element | null;
  secondaryLocalRelative: DOMRect | null;
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
    // Case A: ONE line - shortest distance between edges
    const distance = calculateSiblingDistance(primary, secondary);
    lines.push(distance);
  } else if (context === "parent" || context === "child") {
    // Case B/C: FOUR lines - padding distances
    const padding = calculatePaddingLines(primary, secondary, context);
    lines.push(...padding);
  }

  return lines;
}

/**
 * Calculate distance between two elements using Top/Bottom faces
 */
function calculateSiblingDistance(
  primary: DOMRect,
  sibling: DOMRect
): MeasurementLine {
  // 1. Check for Spans (Overlap on individual axes)
  const overlapXStart = Math.max(primary.left, sibling.left);
  const overlapXEnd = Math.min(primary.right, sibling.right);
  const hasOverlapX = overlapXEnd > overlapXStart;

  const overlapYStart = Math.max(primary.top, sibling.top);
  const overlapYEnd = Math.min(primary.bottom, sibling.bottom);
  const hasOverlapY = overlapYEnd > overlapYStart;

  // 2. Decide Priority
  // Case A: Stacked vertically (Shared Horizontal Span)
  if (hasOverlapX && !hasOverlapY) {
    const centerX = (overlapXStart + overlapXEnd) / 2;
    const distBtoT = Math.abs(sibling.top - primary.bottom);
    const distTtoB = Math.abs(primary.top - sibling.bottom);

    // Pick closest faces on the shared span
    const startY = distBtoT < distTtoB ? primary.bottom : primary.top;
    const endY = distBtoT < distTtoB ? sibling.top : sibling.bottom;

    return {
      type: "distance",
      value: Math.min(distBtoT, distTtoB),
      start: { x: centerX, y: startY },
      end: { x: centerX, y: endY },
    };
  }

  // Case B: Side-by-Side (Shared Vertical Span)
  if (hasOverlapY && !hasOverlapX) {
    const centerY = (overlapYStart + overlapYEnd) / 2;
    const distRtoL = Math.abs(sibling.left - primary.right);
    const distLtoR = Math.abs(primary.left - sibling.right);

    // Pick closest faces on the shared span
    const startX = distRtoL < distLtoR ? primary.right : primary.left;
    const endX = distRtoL < distLtoR ? sibling.left : sibling.right;

    return {
      type: "distance",
      value: Math.min(distRtoL, distLtoR),
      start: { x: startX, y: centerY },
      end: { x: endX, y: centerY },
    };
  }

  // Case C: Pure Diagonal (No shared spans) or Overlap (Total overlap)
  // Fallback to closest Top/Bottom centers
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

  const dx = bestP!.x - bestS!.x;
  const dy = bestP!.y - bestS!.y;

  // Snap to axis if nearly aligned 
  const finalX = Math.abs(dx) < 1 ? bestP!.x : bestS!.x;
  const finalY = Math.abs(dy) < 1 ? bestP!.y : bestS!.y;

  return {
    type: "distance",
    value: Math.sqrt(minD2),
    start: { x: bestP!.x, y: bestP!.y },
    end: { x: finalX, y: finalY },
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
      },
      {
        type: "top",
        value: Math.abs(primary.top - container.top),
        start: { x: primary.left + primary.width / 2, y: container.top },
        end: { x: primary.left + primary.width / 2, y: primary.top },
      },
      {
        type: "right",
        value: Math.abs(container.right - primary.right),
        start: { x: primary.right, y: primary.top + primary.height / 2 },
        end: { x: container.right, y: primary.top + primary.height / 2 },
      },
      {
        type: "bottom",
        value: Math.abs(container.bottom - primary.bottom),
        start: { x: primary.left + primary.width / 2, y: primary.bottom },
        end: { x: primary.left + primary.width / 2, y: container.bottom },
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
      },
      {
        type: "top",
        value: Math.abs(container.top - primary.top),
        start: { x: container.left + container.width / 2, y: primary.top },
        end: { x: container.left + container.width / 2, y: container.top },
      },
      {
        type: "right",
        value: Math.abs(primary.right - container.right),
        start: { x: container.right, y: container.top + container.height / 2 },
        end: { x: primary.right, y: container.top + container.height / 2 },
      },
      {
        type: "bottom",
        value: Math.abs(primary.bottom - container.bottom),
        start: { x: container.left + container.width / 2, y: container.bottom },
        end: { x: container.left + container.width / 2, y: primary.bottom },
      },
    ];
  }
}

