import { createSignal, For, Show } from "solid-js";
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
            const startRaw = () => getLivePoint(
              line.start,
              line.startSync,
              line,
              props.data.primary.delta,
              props.data.secondary.delta,
              props.viewport.scrollX,
              props.viewport.scrollY
            );

            const endRaw = () => getLivePoint(
              line.end,
              line.endSync,
              line,
              props.data.primary.delta,
              props.data.secondary.delta,
              props.viewport.scrollX,
              props.viewport.scrollY
            );

            const getFinalCoords = () => {
              const sRaw = startRaw();
              const eRaw = endRaw();

              let start = sRaw;
              let end = eRaw;

              if (!props.data.isSameContext) {
                start = clampPointToGeometry(sRaw, line.startSync === "secondary" ? props.data.secondary.geo : props.data.primary.geo, props.viewport);
                const eRawClamped = clampPointToGeometry(eRaw, line.endSync === "secondary" ? props.data.secondary.geo : props.data.primary.geo, props.viewport);
                end = { ...eRawClamped };
              }

              if (line.type === "top" || line.type === "bottom") end.x = start.x;
              if (line.type === "left" || line.type === "right") end.y = start.y;

              return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
            };

            const isHovered = () => hoveredLine() === index();

            return (
              <g
                onMouseEnter={() => setHoveredLine(index())}
                onMouseLeave={() => setHoveredLine(null)}
                onClick={() => {
                  const { x1, y1, x2, y2 } = getFinalCoords();
                  const liveValue = Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
                  props.onLineClick?.(line, liveValue);
                }}
                style={{ 'pointer-events': 'auto', cursor: 'pointer' }}
              >
                <line
                  class={`${PREFIX}line-hit-target`}
                  x1={getFinalCoords().x1}
                  y1={getFinalCoords().y1}
                  x2={getFinalCoords().x2}
                  y2={getFinalCoords().y2}
                />
                <line
                  class={`${PREFIX}line ${PREFIX}line-clickable`}
                  x1={getFinalCoords().x1}
                  y1={getFinalCoords().y1}
                  x2={getFinalCoords().x2}
                  y2={getFinalCoords().y2}
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
