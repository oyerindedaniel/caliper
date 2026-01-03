import { For, createSignal } from "solid-js";
import type { MeasurementLine } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { snapPoint } from "./pixel-snap.js";

interface MeasurementLinesWithCalculatorProps {
  lines: MeasurementLine[];
  primary: DOMRect;
  primaryRelative: DOMRect | null;
  secondaryRelative: DOMRect | null;
  onLineClick?: (line: MeasurementLine) => void;
}

/**
 * Render measurement lines with click support for calculator
 */
export function MeasurementLinesWithCalculator(
  props: MeasurementLinesWithCalculatorProps
) {
  const [hoveredLine, setHoveredLine] = createSignal<number | null>(null);

  // The container's absolute position in document coordinates
  // (Where the 'top-left' of our portal box actually is in the global world)
  const containerOriginX = () => {
    if (props.primary && props.primaryRelative) {
      return props.primary.left - props.primaryRelative.left;
    }
    return 0;
  };

  const containerOriginY = () => {
    if (props.primary && props.primaryRelative) {
      return props.primary.top - props.primaryRelative.top;
    }
    return 0;
  };

  return (
    <svg class={`${PREFIX}overlay`} overflow="visible">
      <For each={props.lines}>
        {(line, index) => {
          const start = snapPoint({ x: line.start.x - containerOriginX(), y: line.start.y - containerOriginY() });
          const end = snapPoint({ x: line.end.x - containerOriginX(), y: line.end.y - containerOriginY() });
          const isHovered = hoveredLine() === index();

          const handleHover = () => setHoveredLine(index());
          const handleLeave = () => setHoveredLine(null);
          const handleClick = () => {
            if (props.onLineClick) {
              props.onLineClick(line);
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
