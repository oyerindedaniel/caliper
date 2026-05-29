import { For, Show, createMemo } from "solid-js";
import {
  type MeasurementLine,
  type LiveGeometry,
  resolveLiveLineEndpoints,
  resolveMeasurementLabelPosition,
} from "@caliper/core";
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
 * Render measurement labels using Viewport-Relative coordinates.
 */
export function MeasurementLabels(props: MeasurementLabelsProps) {
  return (
    <div class={`${PREFIX}viewport-fixed`} style={{ "z-index": 1000000 }}>
      <For each={props.lines}>
        {(line) => {
          const position = createMemo(() => {
            props.viewport.version;

            const endpoints = resolveLiveLineEndpoints({
              line,
              isSameContext: props.data.isSameContext,
              primary: props.data.primary,
              secondary: props.data.secondary,
              viewport: props.viewport,
            });

            return resolveMeasurementLabelPosition({
              line,
              endpoints,
              common: props.data.common,
              viewport: props.viewport,
            });
          });

          return (
            <Show when={position() && !position().isHidden}>
              <div
                class={`${PREFIX}label`}
                data-caliper-ignore
                style={{
                  left: 0,
                  top: 0,
                  transform: `translate3d(${position()!.x}px, ${position()!.y}px, 0) translate(-50%, -50%)`,
                }}
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  const pos = position();
                  if (pos && !pos.isHidden) {
                    props.onLineClick?.(line, pos.value);
                  }
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
