import { For } from "solid-js";
import type { MeasurementLine } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface MeasurementLabelsProps {
  lines: MeasurementLine[];
  cursorX: number;
  cursorY: number;
}

/**
 * Render measurement labels positioned at the midpoint of each line
 */
export function MeasurementLabels(props: MeasurementLabelsProps) {
  return (
    <For each={props.lines}>
      {(line) => {
        const midX = (line.start.x + line.end.x) / 2;
        const midY = (line.start.y + line.end.y) / 2;
        const value = Math.round(line.value * 100) / 100;

        return (
          <div
            class={`${PREFIX}label`}
            style={{
              left: 0,
              top: 0,
              transform: `translate3d(${midX}px, ${midY}px, 0) translate(-50%, -50%)`,
            }}
          >
            {value}px
          </div>
        );
      }}
    </For>
  );
}
