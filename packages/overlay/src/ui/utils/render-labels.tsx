import { For, createSignal, onMount, onCleanup } from "solid-js";
import type { MeasurementLine } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { snapPoint, clipToViewport } from "./pixel-snap.js";

interface MeasurementLabelsProps {
  lines: MeasurementLine[];
  cursorX: number;
  cursorY: number;
}

/**
 * Render measurement labels
 * Labels follow the cursor position
 */
export function MeasurementLabels(props: MeasurementLabelsProps) {
  const [mousePosition, setMousePosition] = createSignal({
    x: props.cursorX,
    y: props.cursorY,
  });

  onMount(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    onCleanup(() => {
      window.removeEventListener("mousemove", handleMouseMove);
    });
  });

  return (
    <For each={props.lines}>
      {(line) => {
        const pos = clipToViewport(snapPoint(mousePosition()));
        const value = Math.round(line.value * 100) / 100;

        return (
          <div
            class={`${PREFIX}label`}
            style={{
              left: `${pos.x + 10}px`,
              top: `${pos.y + 10}px`,
            }}
          >
            {value}px
          </div>
        );
      }}
    </For>
  );
}
