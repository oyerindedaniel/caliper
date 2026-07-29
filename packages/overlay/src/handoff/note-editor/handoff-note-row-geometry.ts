/** Minimum distinct vertical gap (px) to treat two anchors as separate visual rows. */
export const MIN_INTER_ROW_GAP_PX = 4;

export function rectMidY(rect: { top: number; height: number }): number {
  return rect.top + rect.height / 2;
}

export function pillElementMidY(pill: HTMLSpanElement): number | null {
  const rect = pill.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    return null;
  }
  return rectMidY(rect);
}

export function isDistinctVisualRow(a: number, b: number): boolean {
  return Math.abs(a - b) > MIN_INTER_ROW_GAP_PX;
}

export function sharesVisualRowBand(a: number, b: number): boolean {
  return !isDistinctVisualRow(a, b);
}

/** Cross-row when spacer anchor and following pill midY sit on different visual bands. */
export function isCrossRowSpacerAndPillDom(
  spacerRect: { top: number; height: number },
  pill: HTMLSpanElement
): boolean | null {
  const pillMidY = pillElementMidY(pill);
  if (pillMidY === null) {
    return null;
  }
  return isDistinctVisualRow(rectMidY(spacerRect), pillMidY);
}
