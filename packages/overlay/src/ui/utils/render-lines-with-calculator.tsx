import { For, createSignal } from "solid-js";
import type { MeasurementLine } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { snapPoint } from "./pixel-snap.js";

interface MeasurementLinesWithCalculatorProps {
  lines: MeasurementLine[];
  onLineClick?: (line: MeasurementLine, event: MouseEvent) => void;
}

/**
 * Render measurement lines with click support for calculator
 */
export function MeasurementLinesWithCalculator(
  props: MeasurementLinesWithCalculatorProps
) {
  const [hoveredLine, setHoveredLine] = createSignal<number | null>(null);

  return (
    <svg class={`${PREFIX}overlay`}>
      <For each={props.lines}>
        {(line, index) => {
          const start = snapPoint(line.start);
          const end = snapPoint(line.end);
          const isHovered = hoveredLine() === index();

          return (
            <line
              class={`${PREFIX}line ${PREFIX}line-clickable`}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke-width={isHovered ? 2 : 1}
              onMouseEnter={() => setHoveredLine(index())}
              onMouseLeave={() => setHoveredLine(null)}
              onClick={(e) => {
                if (props.onLineClick) {
                  props.onLineClick(line, e);
                }
              }}
            />
          );
        }}
      </For>
    </svg>
  );
}
