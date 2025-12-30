import { createSignal, createEffect, onCleanup, on } from "solid-js";
import { lerpRect, type AnimationConfig } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface BoundaryBoxesProps {
  initialPrimaryRect: DOMRect | null;
  primary: DOMRect | null;
  secondary: DOMRect | null;
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
  const [primary, setPrimary] = createSignal<AnimatedRect | null>(null);
  const [secondary, setSecondary] = createSignal<AnimatedRect | null>(null);

  let rafId: number | null = null;

  const lerpTo = (
    current: AnimatedRect | null,
    target: DOMRect | null,
    lerpFactor: number,
    initial: DOMRect | null = null
  ): AnimatedRect | null => {
    if (!target) return null;

    const targetRect = {
      left: target.left,
      top: target.top,
      width: target.width,
      height: target.height,
    };

    if (!current) {
      return initial
        ? { left: initial.left, top: initial.top, width: initial.width, height: initial.height }
        : targetRect;
    }

    const next = lerpRect(current, targetRect, lerpFactor);

    if (
      Math.abs(next.left - targetRect.left) < 0.1 &&
      Math.abs(next.top - targetRect.top) < 0.1 &&
      Math.abs(next.width - targetRect.width) < 0.1 &&
      Math.abs(next.height - targetRect.height) < 0.1
    ) {
      return targetRect;
    }

    return next;
  };

  createEffect(
    on(
      [
        () => props.primary,
        () => props.secondary,
        () => props.isAltPressed,
        () => props.initialPrimaryRect,
      ],
      () => {
        const factor = props.animation.lerpFactor;
        const isAlt = props.isAltPressed;
        const initial = props.initialPrimaryRect;

        if (!initial) {
          setPrimary(null);
          setSecondary(null);
          return;
        }

        const animate = () => {
          // Primary box follows the current hover (or initial selection), which remains stationary during measurement.
          const primaryTarget = props.primary || initial;
          const nextPrimary = lerpTo(primary(), primaryTarget, factor, initial);
          setPrimary(nextPrimary);

          // Secondary: Only follow hover in Alt mode
          const secondaryTarget = isAlt ? props.secondary : null;
          const nextSecondary = lerpTo(secondary(), secondaryTarget, factor);
          setSecondary(nextSecondary);

          // Continue animating if either box hasn't reached its target
          const primaryIsMoving =
            nextPrimary &&
            primaryTarget &&
            (Math.abs(nextPrimary.left - primaryTarget.left) > 0.01 ||
              Math.abs(nextPrimary.top - primaryTarget.top) > 0.01 ||
              Math.abs(nextPrimary.width - primaryTarget.width) > 0.01 ||
              Math.abs(nextPrimary.height - primaryTarget.height) > 0.01);

          const secondaryIsMoving =
            nextSecondary &&
            secondaryTarget &&
            (Math.abs(nextSecondary.left - secondaryTarget.left) > 0.01 ||
              Math.abs(nextSecondary.top - secondaryTarget.top) > 0.01 ||
              Math.abs(nextSecondary.width - secondaryTarget.width) > 0.01 ||
              Math.abs(nextSecondary.height - secondaryTarget.height) > 0.01);

          if (primaryIsMoving || secondaryIsMoving || (isAlt && !secondary() && secondaryTarget)) {
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
      {primary() && (
        <div
          class={`${PREFIX}boundary-box ${PREFIX}boundary-box-selected`}
          style={{
            left: 0,
            top: 0,
            width: `${primary()!.width}px`,
            height: `${primary()!.height}px`,
            transform: `translate3d(${primary()!.left}px, ${primary()!.top}px, 0)`,
          }}
        />
      )}
      {secondary() && (
        <div
          class={`${PREFIX}boundary-box ${PREFIX}boundary-box-secondary`}
          style={{
            left: 0,
            top: 0,
            width: `${secondary()!.width}px`,
            height: `${secondary()!.height}px`,
            transform: `translate3d(${secondary()!.left}px, ${secondary()!.top}px, 0)`,
          }}
        />
      )}
    </>
  );
}
