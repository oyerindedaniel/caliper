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
 * Calculate shortest distance between sibling elements
 */
function calculateSiblingDistance(
  primary: DOMRect,
  sibling: DOMRect
): MeasurementLine {
  // Find the shortest edge distance
  const distances = [
    {
      type: "distance" as const,
      value: Math.abs(sibling.left - primary.right),
      start: { x: primary.right, y: (primary.top + primary.bottom) / 2 },
      end: { x: sibling.left, y: (sibling.top + sibling.bottom) / 2 },
    },
    {
      type: "distance" as const,
      value: Math.abs(primary.left - sibling.right),
      start: { x: sibling.right, y: (sibling.top + sibling.bottom) / 2 },
      end: { x: primary.left, y: (primary.top + primary.bottom) / 2 },
    },
    {
      type: "distance" as const,
      value: Math.abs(sibling.top - primary.bottom),
      start: { x: (primary.left + primary.right) / 2, y: primary.bottom },
      end: { x: (sibling.left + sibling.right) / 2, y: sibling.top },
    },
    {
      type: "distance" as const,
      value: Math.abs(primary.top - sibling.bottom),
      start: { x: (sibling.left + sibling.right) / 2, y: sibling.bottom },
      end: { x: (primary.left + primary.right) / 2, y: primary.top },
    },
  ];

  // Return the shortest distance
  return distances.reduce((min, dist) =>
    Math.abs(dist.value) < Math.abs(min.value) ? dist : min
  );
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

