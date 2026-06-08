import type { LiveGeometry } from "./scroll-aware.js";

export type HandoffPanelPositionInput = {
  anchor: LiveGeometry;
  viewport: {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
  };
  panelWidth: number;
  panelHeight: number;
  margin?: number;
};

export type HandoffPanelPosition = {
  left: number;
  top: number;
  maxWidth: number;
};

export function resolveHandoffPanelPosition(
  input: HandoffPanelPositionInput
): HandoffPanelPosition {
  const margin = input.margin ?? 10;
  const viewportMargin = 16;

  const windowTop = input.anchor.top - input.viewport.scrollY;
  const windowLeft = input.anchor.left - input.viewport.scrollX;
  const windowBottom = windowTop + input.anchor.height;

  const maxWidth = Math.min(input.panelWidth, input.viewport.width - viewportMargin * 2);

  let top = windowBottom + margin;
  if (top + input.panelHeight > input.viewport.height - viewportMargin) {
    const above = windowTop - input.panelHeight - margin;
    if (above >= viewportMargin) {
      top = above;
    } else {
      top = Math.max(viewportMargin, input.viewport.height - viewportMargin - input.panelHeight);
    }
  }

  let left = windowLeft;
  if (left + maxWidth > input.viewport.width - viewportMargin) {
    left = input.viewport.width - viewportMargin - maxWidth;
  }
  left = Math.max(viewportMargin, left);

  const visibleLeft = Math.max(input.anchor.visibleMinX - input.viewport.scrollX, viewportMargin);
  const visibleRight = Math.min(
    input.anchor.visibleMaxX - input.viewport.scrollX,
    input.viewport.width - viewportMargin
  );
  if (visibleRight > visibleLeft) {
    const centered = (visibleLeft + visibleRight) / 2 - maxWidth / 2;
    left = Math.max(
      viewportMargin,
      Math.min(centered, input.viewport.width - viewportMargin - maxWidth)
    );
  }

  return { left, top, maxWidth };
}
