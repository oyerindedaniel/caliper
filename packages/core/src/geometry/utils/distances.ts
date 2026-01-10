/**
 * Calculate the shortest distance between two rectangles
 * Returns the minimum distance between any edges
 */
export function shortestDistance(rect1: DOMRect, rect2: DOMRect): number {
  // Check if rectangles overlap
  if (
    rect1.right >= rect2.left &&
    rect1.left <= rect2.right &&
    rect1.bottom >= rect2.top &&
    rect1.top <= rect2.bottom
  ) {
    return 0; // Overlapping
  }

  // Calculate horizontal distance
  const horizontalDist =
    rect1.right < rect2.left ? rect2.left - rect1.right : rect1.left - rect2.right;

  // Calculate vertical distance
  const verticalDist =
    rect1.bottom < rect2.top ? rect2.top - rect1.bottom : rect1.top - rect2.bottom;

  // If rectangles are separated horizontally
  if (rect1.right < rect2.left || rect1.left > rect2.right) {
    // Check if they overlap vertically
    if (rect1.bottom >= rect2.top && rect1.top <= rect2.bottom) {
      return horizontalDist;
    }
    // Diagonal distance
    return Math.sqrt(horizontalDist * horizontalDist + verticalDist * verticalDist);
  }

  // If rectangles are separated vertically
  return verticalDist;
}

/**
 * Calculate padding distances from inner element to parent edges
 * Returns left, top, right, bottom distances
 */
export function calculatePadding(
  inner: DOMRect,
  parent: DOMRect
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: inner.left - parent.left,
    top: inner.top - parent.top,
    right: parent.right - inner.right,
    bottom: parent.bottom - inner.bottom,
  };
}

/**
 * Get the shortest edge distance between two rectangles
 * Returns which edge and the distance
 */
export function getShortestEdgeDistance(
  rect1: DOMRect,
  rect2: DOMRect
): { edge: "left" | "top" | "right" | "bottom"; distance: number } {
  const padding = calculatePadding(rect1, rect2);

  let minDistance = padding.left;
  let edge: "left" | "top" | "right" | "bottom" = "left";

  if (padding.top < minDistance) {
    minDistance = padding.top;
    edge = "top";
  }
  if (padding.right < minDistance) {
    minDistance = padding.right;
    edge = "right";
  }
  if (padding.bottom < minDistance) {
    minDistance = padding.bottom;
    edge = "bottom";
  }

  return { edge, distance: minDistance };
}
