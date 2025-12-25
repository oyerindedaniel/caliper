/**
 * Snap a value to the nearest pixel
 */
export function snapToPixel(value: number): number {
  return Math.round(value);
}

/**
 * Snap a point to the nearest pixel
 */
export function snapPoint(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: snapToPixel(point.x),
    y: snapToPixel(point.y),
  };
}

/**
 * Clip a point to viewport bounds
 */
export function clipToViewport(
  point: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(window.innerWidth, point.x)),
    y: Math.max(0, Math.min(window.innerHeight, point.y)),
  };
}

