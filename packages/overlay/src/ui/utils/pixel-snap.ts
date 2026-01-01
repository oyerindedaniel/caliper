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
