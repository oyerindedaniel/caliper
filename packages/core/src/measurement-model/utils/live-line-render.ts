import type { LiveGeometry } from "@/geometry/utils/scroll-aware.js";
import { clampPointToGeometry } from "@/geometry/utils/scroll-aware.js";
import type { MeasurementLine } from "./measurement-result.js";
import { getLivePoint } from "./measurement-result.js";

export interface LiveLineSyncData {
  geo: LiveGeometry | null;
  delta: { deltaX: number; deltaY: number };
}

export interface ResolveLiveLineEndpointsInput {
  line: MeasurementLine;
  isSameContext: boolean;
  primary: LiveLineSyncData;
  secondary: LiveLineSyncData;
  viewport: { scrollX: number; scrollY: number };
}

export interface ResolvedLiveLineEndpoints {
  start: { x: number; y: number };
  end: { x: number; y: number };
  liveValue: number;
}

/**
 * Resolves viewport-relative line endpoints with optional cross-context clamping and axis alignment.
 */
export function resolveLiveLineEndpoints(
  input: ResolveLiveLineEndpointsInput
): ResolvedLiveLineEndpoints {
  const { line, isSameContext, primary, secondary, viewport } = input;

  const sRaw = getLivePoint(
    line.start,
    line.startSync,
    line,
    primary.delta,
    secondary.delta,
    viewport.scrollX,
    viewport.scrollY
  );

  const eRaw = getLivePoint(
    line.end,
    line.endSync,
    line,
    primary.delta,
    secondary.delta,
    viewport.scrollX,
    viewport.scrollY
  );

  let start = sRaw;
  let end = eRaw;

  if (!isSameContext) {
    start = clampPointToGeometry(
      sRaw,
      line.startSync === "secondary" ? secondary.geo : primary.geo,
      viewport
    );
    end = clampPointToGeometry(
      eRaw,
      line.endSync === "secondary" ? secondary.geo : primary.geo,
      viewport
    );
  }

  if (line.type === "top" || line.type === "bottom") {
    if (line.type === "top") start.x = end.x;
    else end.x = start.x;
  } else if (line.type === "left" || line.type === "right") {
    if (line.type === "left") start.y = end.y;
    else end.y = start.y;
  }

  let liveValue = 0;
  if (line.type === "top" || line.type === "bottom") {
    liveValue = Math.abs(start.y - end.y);
  } else if (line.type === "left" || line.type === "right") {
    liveValue = Math.abs(start.x - end.x);
  } else {
    liveValue = Math.sqrt((start.x - end.x) ** 2 + (start.y - end.y) ** 2);
  }

  return { start, end, liveValue };
}

export interface VisibilityWindow {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface MeasurementLabelPositionInput {
  line: MeasurementLine;
  endpoints: ResolvedLiveLineEndpoints;
  common: VisibilityWindow;
  viewport: { scrollX: number; scrollY: number; width: number; height: number };
  margin?: number;
}

export interface MeasurementLabelPosition {
  x: number;
  y: number;
  isHidden: boolean;
  value: number;
}

/**
 * Viewport-relative label position for a measurement line within the common visibility window.
 */
export function resolveMeasurementLabelPosition(
  input: MeasurementLabelPositionInput
): MeasurementLabelPosition {
  const margin = input.margin ?? 16;
  const { start, end, liveValue } = input.endpoints;
  const { viewport, common } = input;

  const naturalX = (start.x + end.x) / 2;
  const naturalY = (start.y + end.y) / 2;

  const vpMinX = 0;
  const vpMaxX = viewport.width;
  const vpMinY = 0;
  const vpMaxY = viewport.height;

  const hasCommon = Number.isFinite(common.minX);

  const cMinX = hasCommon ? Math.max(vpMinX, common.minX - viewport.scrollX) : vpMinX;
  const cMaxX = hasCommon ? Math.min(vpMaxX, common.maxX - viewport.scrollX) : vpMaxX;
  const cMinY = hasCommon ? Math.max(vpMinY, common.minY - viewport.scrollY) : vpMinY;
  const cMaxY = hasCommon ? Math.min(vpMaxY, common.maxY - viewport.scrollY) : vpMaxY;

  const lineMinX = Math.min(start.x, end.x);
  const lineMaxX = Math.max(start.x, end.x);
  const lineMinY = Math.min(start.y, end.y);
  const lineMaxY = Math.max(start.y, end.y);

  const isFullyHidden =
    lineMaxY < cMinY || lineMinY > cMaxY || lineMaxX < cMinX || lineMinX > cMaxX;

  if (isFullyHidden) {
    return { x: 0, y: 0, isHidden: true, value: liveValue };
  }

  const visibleLineMinX = Math.max(lineMinX, cMinX);
  const visibleLineMaxX = Math.min(lineMaxX, cMaxX);
  const visibleLineMinY = Math.max(lineMinY, cMinY);
  const visibleLineMaxY = Math.min(lineMaxY, cMaxY);

  const centerX = (visibleLineMinX + visibleLineMaxX) / 2;
  const centerY = (visibleLineMinY + visibleLineMaxY) / 2;

  let targetX = naturalX;
  let targetY = naturalY;

  if (Math.abs(start.x - end.x) < 1) {
    targetY = centerY;
    targetX = Math.max(cMinX + margin, Math.min(cMaxX - margin, targetX));
  } else if (Math.abs(start.y - end.y) < 1) {
    targetX = centerX;
    targetY = Math.max(cMinY + margin, Math.min(cMaxY - margin, targetY));
  } else {
    targetX = Math.max(cMinX + margin, Math.min(cMaxX - margin, naturalX));
    targetY = Math.max(cMinY + margin, Math.min(cMaxY - margin, naturalY));
  }

  return { x: targetX, y: targetY, isHidden: false, value: liveValue };
}
