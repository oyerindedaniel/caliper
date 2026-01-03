import { For } from "solid-js";
import { type MeasurementLine, diagnosticLogger } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface MeasurementLabelsProps {
  lines: MeasurementLine[];
  primary: DOMRect;
  primaryRelative: DOMRect | null;
  secondaryRelative: DOMRect | null;
  viewport: {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
  };
  cursorX: number;
  cursorY: number;
}

/**
 * Render measurement labels positioned at the midpoint of each line
 */
export function MeasurementLabels(props: MeasurementLabelsProps) {
  const margin = 24;

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
    <For each={props.lines}>
      {(line) => {
        const value = Math.round(line.value * 100) / 100;

        const position = () => {
          // Default midpoint
          let labelX = (line.start.x + line.end.x) / 2;
          let labelY = (line.start.y + line.end.y) / 2;

          // Viewport in document coordinates
          const vLeft = props.viewport.scrollX + margin;
          const vRight = props.viewport.scrollX + props.viewport.width - margin;
          const vTop = props.viewport.scrollY + margin;
          const vBottom = props.viewport.scrollY + props.viewport.height - margin;

          const isVertical = Math.abs(line.start.x - line.end.x) < 0.1;
          const isHorizontal = Math.abs(line.start.y - line.end.y) < 0.1;

          if (isVertical) {
            const minY = Math.min(line.start.y, line.end.y);
            const maxY = Math.max(line.start.y, line.end.y);

            // 1. Vertical Slide: Stay on the line segments visible in viewport
            if (labelY < vTop || labelY > vBottom) {
              const clampedMinY = Math.max(minY, vTop);
              const clampedMaxY = Math.min(maxY, vBottom);
              if (clampedMaxY > clampedMinY) {
                labelY = (clampedMinY + clampedMaxY) / 2;
              } else {
                labelY = Math.max(vTop, Math.min(maxY, vBottom));
              }
            }
            // 2. Horizontal Stick: If element is scrolled horizontally, keep label visible
            labelX = Math.max(vLeft, Math.min(labelX, vRight));

          } else if (isHorizontal) {
            const minX = Math.min(line.start.x, line.end.x);
            const maxX = Math.max(line.start.x, line.end.x);

            // 1. Horizontal Slide: Stay on the line segments visible in viewport
            if (labelX < vLeft || labelX > vRight) {
              const clampedMinX = Math.max(minX, vLeft);
              const clampedMaxX = Math.min(maxX, vRight);
              if (clampedMaxX > clampedMinX) {
                labelX = (clampedMinX + clampedMaxX) / 2;
              } else {
                labelX = Math.max(vLeft, Math.min(maxX, vRight));
              }
            }
            // 2. Vertical Stick: If element is scrolled vertically, keep label visible
            labelY = Math.max(vTop, Math.min(labelY, vBottom));

          } else {
            // Diagonal line - clamp both axes to viewport
            labelX = Math.max(vLeft, Math.min(labelX, vRight));
            labelY = Math.max(vTop, Math.min(labelY, vBottom));
          }

          // Local coordinates from relative rects 
          if (props.primaryRelative) {
            labelX -= containerOriginX();
            labelY -= containerOriginY();
          }

          const pos = { x: labelX, y: labelY };
          diagnosticLogger.log(`[MeasurementLabel] Value: ${value}, X/Y: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}`);
          return pos;
        };

        return (
          <div
            class={`${PREFIX}label`}
            style={{
              left: 0,
              top: 0,
              transform: `translate3d(${position().x}px, ${position().y}px, 0) translate(-50%, -50%)`,
            }}
          >
            {value}
          </div>
        );
      }}
    </For>
  );
}
