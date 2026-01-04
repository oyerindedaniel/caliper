import { For, Show, createMemo } from "solid-js";
import { type MeasurementLine, type LiveGeometry } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface SyncData {
  geo: LiveGeometry | null;
  delta: { deltaX: number; deltaY: number };
}

interface MeasurementLabelsProps {
  lines: MeasurementLine[];
  data: {
    primary: SyncData;
    secondary: SyncData;
    common: { minX: number; maxX: number; minY: number; maxY: number };
  };
  viewport: {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  };
}

/**
 * Render measurement labels using Viewport-Relative coordinates.
 */
export function MeasurementLabels(props: MeasurementLabelsProps) {
  const margin = 16;

  const getLivePointViewport = (line: MeasurementLine, type: "start" | "end") => {
    const pt = type === "start" ? line.start : line.end;
    const owner = type === "start" ? line.startSync : line.endSync;

    let syncX = owner === "secondary" ? props.data.secondary : props.data.primary;
    let syncY = owner === "secondary" ? props.data.secondary : props.data.primary;

    if (line.type === "left" || line.type === "right") {
      syncY = props.data.primary;
    } else if (line.type === "top" || line.type === "bottom") {
      syncX = props.data.primary;
    } else if (line.type === "distance") {
      if (Math.abs(line.start.x - line.end.x) < 1) syncX = props.data.primary;
      if (Math.abs(line.start.y - line.end.y) < 1) syncY = props.data.primary;
    }

    return {
      x: pt.x - (syncX?.delta.deltaX ?? 0) - props.viewport.scrollX,
      y: pt.y - (syncY?.delta.deltaY ?? 0) - props.viewport.scrollY,
    };
  };

  return (
    <div class={`${PREFIX}viewport-fixed`} style={{ 'z-index': 1000000 }}>
      <For each={props.lines}>
        {(line: MeasurementLine) => {
          const value = Math.round(line.value * 100) / 100;

          const position = createMemo(() => {
            props.viewport.version;

            const s = getLivePointViewport(line, "start");
            const e = getLivePointViewport(line, "end");

            const start = s;
            const end = { ...e };
            if (line.type === "top" || line.type === "bottom") end.x = s.x;
            if (line.type === "left" || line.type === "right") end.y = s.y;

            const dx = start.x - end.x;
            const dy = start.y - end.y;
            const liveValue = Math.sqrt(dx * dx + dy * dy);

            const naturalX = (start.x + end.x) / 2;
            const naturalY = (start.y + end.y) / 2;

            const vpMinX = 0;
            const vpMaxX = props.viewport.width;
            const vpMinY = 0;
            const vpMaxY = props.viewport.height;

            const common = props.data.common;
            const hasCommon = isFinite(common.minX);

            const cMinX = hasCommon ? Math.max(vpMinX, common.minX - props.viewport.scrollX) : vpMinX;
            const cMaxX = hasCommon ? Math.min(vpMaxX, common.maxX - props.viewport.scrollX) : vpMaxX;
            const cMinY = hasCommon ? Math.max(vpMinY, common.minY - props.viewport.scrollY) : vpMinY;
            const cMaxY = hasCommon ? Math.min(vpMaxY, common.maxY - props.viewport.scrollY) : vpMaxY;

            const lineMinX = Math.min(start.x, end.x);
            const lineMaxX = Math.max(start.x, end.x);
            const lineMinY = Math.min(start.y, end.y);
            const lineMaxY = Math.max(start.y, end.y);

            const isFullyHidden = (
              lineMaxY < cMinY ||
              lineMinY > cMaxY ||
              lineMaxX < cMinX ||
              lineMinX > cMaxX
            );

            if (isFullyHidden) return { x: 0, y: 0, isHidden: true, value: 0 };

            const visibleLineMinX = Math.max(lineMinX, cMinX);
            const visibleLineMaxX = Math.min(lineMaxX, cMaxX);
            const visibleLineMinY = Math.max(lineMinY, cMinY);
            const visibleLineMaxY = Math.min(lineMaxY, cMaxY);

            const centerX = (visibleLineMinX + visibleLineMaxX) / 2;
            const centerY = (visibleLineMinY + visibleLineMaxY) / 2;

            let targetX = naturalX;
            let targetY = naturalY;

            if (Math.abs(start.x - end.x) < 1) { // Vertical
              targetY = centerY;
              targetX = Math.max(cMinX + margin, Math.min(cMaxX - margin, targetX));
            } else if (Math.abs(start.y - end.y) < 1) { // Horizontal
              targetX = centerX;
              targetY = Math.max(cMinY + margin, Math.min(cMaxY - margin, targetY));
            } else {
              targetX = Math.max(cMinX + margin, Math.min(cMaxX - margin, naturalX));
              targetY = Math.max(cMinY + margin, Math.min(cMaxY - margin, naturalY));
            }

            return { x: targetX, y: targetY, isHidden: false, value: liveValue };
          });

          return (
            <Show when={position() && !position()!.isHidden}>
              <div
                class={`${PREFIX}label`}
                style={{
                  left: 0,
                  top: 0,
                  transform: `translate3d(${position()!.x}px, ${position()!.y}px, 0) translate(-50%, -50%)`,
                }}
              >
                {Math.round(position()!.value * 100) / 100}
              </div>
            </Show>
          );
        }}
      </For>
    </div>
  );
}
