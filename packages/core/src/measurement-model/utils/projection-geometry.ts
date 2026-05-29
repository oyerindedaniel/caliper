import type { ProjectionDirection } from "@/shared/types/index.js";
import type { LiveGeometry } from "@/geometry/utils/scroll-aware.js";

export interface DocSize {
  width: number;
  height: number;
}

export interface ProjectionViewport {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

export interface ProjectionLineGeometryInput {
  direction: ProjectionDirection;
  value: number;
  live: LiveGeometry;
  viewport: ProjectionViewport;
  docSize: DocSize;
  /** Raw input string; used to estimate label width when non-empty */
  displayValue?: string;
}

export interface ProjectionLineGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  actualValue: number;
  isHidden: boolean;
  showLabel: boolean;
}

/**
 * Maximum projection distance (px) along a direction before hitting the document edge.
 */
export function getMaxProjectionDistance(
  dir: ProjectionDirection,
  live: { top: number; left: number; width: number; height: number },
  docSize: DocSize
): number {
  switch (dir) {
    case "top":
      return live.top;
    case "bottom":
      return docSize.height - (live.top + live.height);
    case "left":
      return live.left;
    case "right":
      return docSize.width - (live.left + live.width);
  }
}

/**
 * Viewport-relative projection line endpoints and label placement.
 */
export function getProjectionLineGeometry(
  input: ProjectionLineGeometryInput
): ProjectionLineGeometry | null {
  const { direction, value, live, viewport: vp, docSize } = input;
  if (!direction) return null;

  let x1 = 0;
  let y1 = 0;
  let x2 = 0;
  let y2 = 0;
  let labelX = 0;
  let labelY = 0;
  let visibleY1 = 0;
  let visibleY2 = 0;
  let visibleX1 = 0;
  let visibleX2 = 0;

  const liveX = live.left - vp.scrollX;
  const liveY = live.top - vp.scrollY;

  let isOffScreen = false;

  switch (direction) {
    case "top":
      x1 = x2 = liveX + live.width / 2;
      y1 = liveY;
      y2 = Math.max(-vp.scrollY, y1 - value);
      labelX = x1;
      visibleY1 = Math.max(0, Math.min(vp.height, y1));
      visibleY2 = Math.max(0, Math.min(vp.height, y2));
      if (Math.abs(visibleY1 - visibleY2) < 1) isOffScreen = true;
      labelY = (Math.min(visibleY1, visibleY2) + Math.max(visibleY1, visibleY2)) / 2;
      break;
    case "bottom":
      x1 = x2 = liveX + live.width / 2;
      y1 = liveY + live.height;
      y2 = Math.min(docSize.height - vp.scrollY, y1 + value);
      labelX = x1;
      visibleY1 = Math.max(0, Math.min(vp.height, y1));
      visibleY2 = Math.max(0, Math.min(vp.height, y2));
      if (Math.abs(visibleY1 - visibleY2) < 1) isOffScreen = true;
      labelY = (Math.min(visibleY1, visibleY2) + Math.max(visibleY1, visibleY2)) / 2;
      break;
    case "left":
      y1 = y2 = liveY + live.height / 2;
      x1 = liveX;
      x2 = Math.max(-vp.scrollX, x1 - value);
      visibleX1 = Math.max(0, Math.min(vp.width, x1));
      visibleX2 = Math.max(0, Math.min(vp.width, x2));
      if (Math.abs(visibleX1 - visibleX2) < 1) isOffScreen = true;
      labelX = (Math.min(visibleX1, visibleX2) + Math.max(visibleX1, visibleX2)) / 2;
      labelY = y1;
      break;
    case "right":
      y1 = y2 = liveY + live.height / 2;
      x1 = liveX + live.width;
      x2 = Math.min(docSize.width - vp.scrollX, x1 + value);
      visibleX1 = Math.max(0, Math.min(vp.width, x1));
      visibleX2 = Math.max(0, Math.min(vp.width, x2));
      if (Math.abs(visibleX1 - visibleX2) < 1) isOffScreen = true;
      labelX = (Math.min(visibleX1, visibleX2) + Math.max(visibleX1, visibleX2)) / 2;
      labelY = y1;
      break;
  }

  const rawValue = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const actualValue = Number.isInteger(rawValue) ? rawValue : Math.round(rawValue * 100) / 100;

  const displayValue = input.displayValue ?? String(actualValue);
  const labelWidthGuess = displayValue.length * 8 + 12;
  const labelHeightGuess = 20;

  const isHorizontal = direction === "left" || direction === "right";
  const visibleLineLength = isHorizontal
    ? Math.abs(visibleX1 - visibleX2)
    : Math.abs(visibleY1 - visibleY2);
  const labelSize = isHorizontal ? labelWidthGuess : labelHeightGuess;
  const showLabel = visibleLineLength >= labelSize * 1.5;

  return {
    x1,
    y1,
    x2,
    y2,
    labelX,
    labelY,
    actualValue,
    isHidden: live.isHidden || isOffScreen,
    showLabel,
  };
}
