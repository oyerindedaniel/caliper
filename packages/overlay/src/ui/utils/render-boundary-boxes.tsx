import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import {
  lerpRect,
  type AnimationConfig,
  type SelectionMetadata,
  type MeasurementResult
} from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface BoundaryBoxesProps {
  metadata: SelectionMetadata;
  result: MeasurementResult | null;
  isAltPressed: boolean;
  isFrozen: boolean;
  animation: Required<AnimationConfig>;
}

interface AnimatedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Render boundary boxes for selected and secondary elements
 */
export function BoundaryBoxes(props: BoundaryBoxesProps) {
  const [anchor, setAnchor] = createSignal<AnimatedRect | null>(null);
  const [target, setTarget] = createSignal<AnimatedRect | null>(null);

  let rafId: number | null = null;

  const isRectSame = (
    a: AnimatedRect | DOMRect | null,
    b: AnimatedRect | DOMRect | null,
    threshold = 0.1
  ) => {
    if (!a || !b) return false;
    return (
      Math.abs(a.left - b.left) < threshold &&
      Math.abs(a.top - b.top) < threshold &&
      Math.abs(a.width - b.width) < threshold &&
      Math.abs(a.height - b.height) < threshold
    );
  };

  const lerpTo = (
    current: AnimatedRect | null,
    target: DOMRect | null,
    lerpFactor: number,
    startFrom: DOMRect | null = null
  ): AnimatedRect | null => {
    if (!target) return null;

    const targetRect = {
      left: target.left,
      top: target.top,
      width: target.width,
      height: target.height,
    };

    if (!current) {
      return startFrom
        ? { left: startFrom.left, top: startFrom.top, width: startFrom.width, height: startFrom.height }
        : targetRect;
    }

    const next = lerpRect(current, targetRect, lerpFactor);

    if (isRectSame(next, targetRect, 0.1)) {
      return targetRect;
    }

    return next;
  };

  createEffect(
    on(
      [
        () => props.metadata,
        () => props.result,
        () => props.isAltPressed,
        () => props.isFrozen,
      ],
      () => {
        const factor = props.animation.lerpFactor;

        const selectionTarget = props.metadata.relativeRect;

        // Secondary relative rect if in measurement mode. 
        // We use the local version for the box to avoid clipping.
        const measurementTarget = (props.isAltPressed || props.isFrozen)
          ? props.result?.secondaryLocalRelative
          : null;

        if (!selectionTarget) {
          setAnchor(null);
          setTarget(null);
          if (rafId) cancelAnimationFrame(rafId);
          return;
        }

        // Update target instantly for hover secondary box
        setTarget(measurementTarget ? {
          left: measurementTarget.left,
          top: measurementTarget.top,
          width: measurementTarget.width,
          height: measurementTarget.height
        } : null);

        const animate = () => {
          const nextAnchor = lerpTo(anchor(), selectionTarget, factor);
          setAnchor(nextAnchor);

          // Continue animating if anchor box hasn't reached its target
          const anchorMoving = nextAnchor && selectionTarget && !isRectSame(nextAnchor, selectionTarget, 0.01);

          if (anchorMoving) {
            rafId = requestAnimationFrame(animate);
          } else {
            rafId = null;
          }
        };

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(animate);
      }
    )
  );

  onCleanup(() => {
    if (rafId) cancelAnimationFrame(rafId);
  });

  return (
    <>
      <Show when={anchor()}>
        {(current) => (
          <Portal mount={props.metadata.container || document.body}>
            <div
              class={`${PREFIX}boundary-box ${PREFIX}boundary-box-selected`}
              style={{
                left: 0,
                top: 0,
                width: `${current().width}px`,
                height: `${current().height}px`,
                transform: `translate3d(${current().left}px, ${current().top}px, 0)`,
              }}
            />
          </Portal>
        )}
      </Show>
      <Show when={target()}>
        {(current) => (
          <Portal mount={props.result?.secondaryContainer || document.body}>
            <div
              class={`${PREFIX}boundary-box ${PREFIX}boundary-box-secondary`}
              style={{
                left: 0,
                top: 0,
                width: `${current().width}px`,
                height: `${current().height}px`,
                transform: `translate3d(${current().left}px, ${current().top}px, 0)`,
              }}
            />
          </Portal>
        )}
      </Show>
    </>
  );
}
