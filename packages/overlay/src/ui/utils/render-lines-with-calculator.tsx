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

          const handleHover = () => setHoveredLine(index());
          const handleLeave = () => setHoveredLine(null);
          const handleClick = (e: MouseEvent) => {
            if (props.onLineClick) {
              props.onLineClick(line, e);
            }
          };

          return (
            <g
              onMouseEnter={handleHover}
              onMouseLeave={handleLeave}
              onClick={handleClick}
            >
              {/* Invisible Hit Target (Thick) */}
              <line
                class={`${PREFIX}line-hit-target`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
              />
              {/* Visible Line (Thin/Styled) */}
              <line
                class={`${PREFIX}line ${PREFIX}line-clickable`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke-width={isHovered ? 2 : 1}
              />
            </g>
          );
        }}
      </For>
    </svg>
  );
}
