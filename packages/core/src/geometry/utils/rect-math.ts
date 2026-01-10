/**
 * Check if a point is inside a rectangle
 */
export function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Check if two rectangles intersect
 */
export function rectsIntersect(rect1: DOMRect, rect2: DOMRect): boolean {
  return !(
    rect1.right < rect2.left ||
    rect1.left > rect2.right ||
    rect1.bottom < rect2.top ||
    rect1.top > rect2.bottom
  );
}

/**
 * Check if rect1 contains rect2
 */
export function rectContains(rect1: DOMRect, rect2: DOMRect): boolean {
  return (
    rect1.left <= rect2.left &&
    rect1.right >= rect2.right &&
    rect1.top <= rect2.top &&
    rect1.bottom >= rect2.bottom
  );
}

/**
 * Get the intersection rectangle of two rects
 */
export function rectIntersection(rect1: DOMRect, rect2: DOMRect): DOMRect | null {
  const left = Math.max(rect1.left, rect2.left);
  const top = Math.max(rect1.top, rect2.top);
  const right = Math.min(rect1.right, rect2.right);
  const bottom = Math.min(rect1.bottom, rect2.bottom);

  if (left >= right || top >= bottom) {
    return null;
  }

  return new DOMRect(left, top, right - left, bottom - top);
}
