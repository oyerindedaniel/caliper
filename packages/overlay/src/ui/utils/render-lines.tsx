import { For } from "solid-js";
import type { MeasurementLine } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { snapPoint } from "./pixel-snap.js";

interface MeasurementLinesProps {
  lines: MeasurementLine[];
}

/**
 * Render measurement lines using SolidJS
 * All lines use position: fixed and transforms
 */
export function MeasurementLines(props: MeasurementLinesProps) {
  return (
    <svg class={`${PREFIX}overlay`} overflow="visible">
      <For each={props.lines}>
        {(line) => {
          const start = snapPoint(line.start);
          const end = snapPoint(line.end);

          return (
            <line
              class={`${PREFIX}line`}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
            />
          );
        }}
      </For>
    </svg>
  );
}
