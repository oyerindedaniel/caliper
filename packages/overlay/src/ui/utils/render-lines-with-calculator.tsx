import { createSignal, createMemo, For, Show } from "solid-js";
import { type MeasurementLine, type LiveGeometry, getLivePoint, clampPointToGeometry } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface SyncData {
  geo: LiveGeometry | null;
  delta: { deltaX: number; deltaY: number };
}

interface MeasurementLinesProps {
  lines: MeasurementLine[];
  data: {
    primary: SyncData;
    secondary: SyncData;
    common: { minX: number; maxX: number; minY: number; maxY: number };
    isSameContext: boolean;
  };
  viewport: {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  };
  onLineClick?: (line: MeasurementLine, liveValue: number) => void;
}

/**
 * Render measurement lines using Viewport-Relative coordinates.
 */
export function MeasurementLinesWithCalculator(props: MeasurementLinesProps) {
  const [hoveredLine, setHoveredLine] = createSignal<number | null>(null);

  const hasClipping = () => isFinite(props.data.common.minX);
  const clipPathId = createSignal(`caliper-lines-clip-${Math.random().toString(36).substring(2, 9)}`)[0]();

  const vCommon = () => ({
    minX: props.data.common.minX - props.viewport.scrollX,
    maxX: props.data.common.maxX - props.viewport.scrollX,
    minY: props.data.common.minY - props.viewport.scrollY,
    maxY: props.data.common.maxY - props.viewport.scrollY,
  });

  return (
    <svg
      class={`${PREFIX}viewport-fixed`}
      style={{ 'z-index': 999999 }}
    >
      <Show when={hasClipping()}>
        <defs>
          <clipPath id={clipPathId}>
            <rect
              x={vCommon().minX}
              y={vCommon().minY}
              width={Math.max(0, vCommon().maxX - vCommon().minX)}
              height={Math.max(0, vCommon().maxY - vCommon().minY)}
            />
          </clipPath>
        </defs>
      </Show>

      <g clip-path={hasClipping() ? `url(#${clipPathId})` : undefined}>
        <For each={props.lines}>
          {(line, index) => {
            const lineData = createMemo(() => {

              const sRaw = getLivePoint(
                line.start,
                line.startSync,
                line,
                props.data.primary.delta,
                props.data.secondary.delta,
                props.viewport.scrollX,
                props.viewport.scrollY
              );

              const eRaw = getLivePoint(
                line.end,
                line.endSync,
                line,
                props.data.primary.delta,
                props.data.secondary.delta,
                props.viewport.scrollX,
                props.viewport.scrollY
              );

              let start = sRaw;
              let end = eRaw;

              if (!props.data.isSameContext) {
                start = clampPointToGeometry(sRaw, line.startSync === "secondary" ? props.data.secondary.geo : props.data.primary.geo, props.viewport);
                const eRawClamped = clampPointToGeometry(eRaw, line.endSync === "secondary" ? props.data.secondary.geo : props.data.primary.geo, props.viewport);
                end = { ...eRawClamped };
              }

              if (line.type === "top" || line.type === "bottom") {
                // If start is primary, end follows start.x, vice versa.
                if (line.startSync === "primary") end.x = start.x;
                else start.x = end.x;
              } else if (line.type === "left" || line.type === "right") {
                if (line.startSync === "primary") end.y = start.y;
                else start.y = end.y;
              }

              let liveValue = 0;
              if (line.type === "top" || line.type === "bottom") {
                liveValue = Math.abs(start.y - end.y);
              } else if (line.type === "left" || line.type === "right") {
                liveValue = Math.abs(start.x - end.x);
              } else {
                liveValue = Math.sqrt(Math.pow(start.x - end.x, 2) + Math.pow(start.y - end.y, 2));
              }

              return { x1: start.x, y1: start.y, x2: end.x, y2: end.y, liveValue };
            });

            const isHovered = () => hoveredLine() === index();

            return (
              <g
                onMouseEnter={() => setHoveredLine(index())}
                onMouseLeave={() => setHoveredLine(null)}
                data-caliper-ignore
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  const data = lineData();
                  props.onLineClick?.(line, data.liveValue);
                }}
                style={{ 'pointer-events': 'auto', cursor: 'pointer' }}
              >
                <line
                  class={`${PREFIX}line-hit-target`}
                  x1={lineData().x1}
                  y1={lineData().y1}
                  x2={lineData().x2}
                  y2={lineData().y2}
                />
                <line
                  class={`${PREFIX}line ${PREFIX}line-clickable`}
                  x1={lineData().x1}
                  y1={lineData().y1}
                  x2={lineData().x2}
                  y2={lineData().y2}
                  stroke-width={isHovered() ? 2 : 1}
                />
              </g>
            );
          }}
        </For>
      </g>
    </svg>
  );
}
