import { createSignal, createEffect, onCleanup, on } from "solid-js";
import { lerpRect, type AnimationConfig } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface BoundaryBoxesProps {
  selectionRect: DOMRect | null;
  measuredRect: DOMRect | null;
  isAltPressed: boolean;
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
        () => props.selectionRect,
        () => props.measuredRect,
        () => props.isAltPressed,
      ],
      () => {
        const factor = props.animation.lerpFactor;

        const selectionTarget = props.selectionRect;
        const measurementTarget = props.measuredRect;

        if (!selectionTarget) {
          setAnchor(null);
          setTarget(null);
          if (rafId) cancelAnimationFrame(rafId);
          return;
        }

        // Update target instantly
        setTarget(measurementTarget ? {
          left: measurementTarget.left,
          top: measurementTarget.top,
          width: measurementTarget.width,
          height: measurementTarget.height
        } : null);

        const animate = () => {
          // Anchor box follows the live selection (which freezes when Alt is held)
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
      {anchor() && (
        <div
          class={`${PREFIX}boundary-box ${PREFIX}boundary-box-selected`}
          style={{
            left: 0,
            top: 0,
            width: `${anchor()!.width}px`,
            height: `${anchor()!.height}px`,
            transform: `translate3d(${anchor()!.left}px, ${anchor()!.top}px, 0)`,
          }}
        />
      )}
      {target() && (
        <div
          class={`${PREFIX}boundary-box ${PREFIX}boundary-box-secondary`}
          style={{
            left: 0,
            top: 0,
            width: `${target()!.width}px`,
            height: `${target()!.height}px`,
            transform: `translate3d(${target()!.left}px, ${target()!.top}px, 0)`,
          }}
        />
      )}
    </>
  );
}
