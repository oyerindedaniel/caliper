import { createSignal, For, Show } from "solid-js";
import { type MeasurementLine, type LiveGeometry } from "@caliper/core";
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
 * Get live coordinates for a line endpoint in VIEWPORT space.
 */
function getLivePointViewport(
  pt: { x: number; y: number },
  owner: "primary" | "secondary" | undefined,
  line: MeasurementLine,
  primary: SyncData,
  secondary: SyncData,
  scrollX: number,
  scrollY: number
) {
  let syncX = owner === "secondary" ? secondary : primary;
  let syncY = owner === "secondary" ? secondary : primary;

  if (line.type === "left" || line.type === "right") {
    syncY = primary;
  } else if (line.type === "top" || line.type === "bottom") {
    syncX = primary;
  } else if (line.type === "distance") {
    if (Math.abs(line.start.x - line.end.x) < 1) syncX = primary;
    if (Math.abs(line.start.y - line.end.y) < 1) syncY = primary;
  }

  return {
    x: pt.x - (syncX?.delta.deltaX ?? 0) - scrollX,
    y: pt.y - (syncY?.delta.deltaY ?? 0) - scrollY,
  };
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
            const start = () => getLivePointViewport(
              line.start,
              line.startSync,
              line,
              props.data.primary,
              props.data.secondary,
              props.viewport.scrollX,
              props.viewport.scrollY
            );

            const endRaw = () => getLivePointViewport(
              line.end,
              line.endSync,
              line,
              props.data.primary,
              props.data.secondary,
              props.viewport.scrollX,
              props.viewport.scrollY
            );

            const end = () => {
              const s = start();
              const e = endRaw();
              if (line.type === "top" || line.type === "bottom") return { x: s.x, y: e.y };
              if (line.type === "left" || line.type === "right") return { x: e.x, y: s.y };
              return e;
            };

            const isHovered = () => hoveredLine() === index();

            return (
              <g
                onMouseEnter={() => setHoveredLine(index())}
                onMouseLeave={() => setHoveredLine(null)}
                onClick={() => {
                  const s = start();
                  const e = end();
                  const liveValue = Math.sqrt(Math.pow(s.x - e.x, 2) + Math.pow(s.y - e.y, 2));
                  props.onLineClick?.(line, liveValue);
                }}
                style={{ 'pointer-events': 'auto', cursor: 'pointer' }}
              >
                <line
                  class={`${PREFIX}line-hit-target`}
                  x1={start().x}
                  y1={start().y}
                  x2={end().x}
                  y2={end().y}
                />
                <line
                  class={`${PREFIX}line ${PREFIX}line-clickable`}
                  x1={start().x}
                  y1={start().y}
                  x2={end().x}
                  y2={end().y}
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
