/** Distinct boundary colors for multi-select handoff items (matches overlay CSS vars). */
export const HANDOFF_COLOR_COUNT = 8;

export const HANDOFF_PALETTE = [
  "rgba(24, 160, 251, 1)",
  "rgba(242, 78, 30, 1)",
  "rgba(139, 92, 246, 1)",
  "rgba(16, 185, 129, 1)",
  "rgba(234, 179, 8, 1)",
  "rgba(236, 72, 153, 1)",
  "rgba(6, 182, 212, 1)",
  "rgba(249, 115, 22, 1)",
] as const;

export function assignColorIndex(currentItemCount: number): number {
  return currentItemCount % HANDOFF_COLOR_COUNT;
}
