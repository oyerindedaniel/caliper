import { createEffect, createSignal, on, onCleanup, Show, createMemo } from "solid-js";
import { Portal } from "solid-js/web";
import {
  lerpRect,
  type AnimationConfig,
  type SelectionMetadata,
  type MeasurementResult,
  getLiveGeometry,
  type LiveGeometry,
} from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface BoundaryBoxesProps {
  metadata: SelectionMetadata;
  result: MeasurementResult | null;
  isAltPressed: boolean;
  isFrozen: boolean;
  animation: Required<AnimationConfig>;
  viewport: {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  };
}

interface AnimatedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Render boundary boxes for selected and secondary elements.
 */
export function BoundaryBoxes(props: BoundaryBoxesProps) {
  const [anchor, setAnchor] = createSignal<LiveGeometry | null>(null);
  const [target, setTarget] = createSignal<LiveGeometry | null>(null);

  let lastElement: Element | null = null;
  let rafId: number | null = null;

  const isRectSame = (
    a: AnimatedRect | null,
    b: AnimatedRect | null,
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
    current: LiveGeometry | null,
    targetGeo: LiveGeometry | null,
    lerpFactor: number
  ): LiveGeometry | null => {
    if (!targetGeo) return null;
    if (!current) return { ...targetGeo };

    const next = lerpRect(current, targetGeo, lerpFactor);

    if (isRectSame(next, targetGeo, 0.1)) {
      return { ...targetGeo };
    }

    return {
      ...targetGeo,
      left: next.left,
      top: next.top,
      width: next.width,
      height: next.height
    };
  };

  const liveSelectionTarget = createMemo(() => {
    props.viewport.version;
    return getLiveGeometry(
      props.metadata.rect,
      props.metadata.scrollHierarchy,
      props.metadata.position,
      props.metadata.stickyConfig,
      props.metadata.initialWindowX,
      props.metadata.initialWindowY
    );
  });

  const liveSecondaryTarget = createMemo(() => {
    props.viewport.version;
    const res = props.result;
    if (!(props.isAltPressed || props.isFrozen) || !res) return null;
    return getLiveGeometry(
      res.secondary,
      res.secondaryHierarchy,
      res.secondaryPosition,
      res.secondarySticky,
      res.secondaryWinX,
      res.secondaryWinY
    );
  });

  createEffect(
    on(
      [
        liveSelectionTarget,
        liveSecondaryTarget,
        () => props.animation.lerpFactor,
        () => props.metadata.element
      ],
      ([selection, secondary, factor, element]) => {
        if (!selection) {
          setAnchor(null);
          setTarget(null);
          lastElement = null;
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          return;
        }

        const isNewElement = lastElement !== element;

        setTarget(secondary);

        if (isNewElement) {
          // SELECTION CHANGE: Start lerp animation
          lastElement = element;

          const animate = () => {
            const currentAnchor = anchor();
            const nextAnchor = lerpTo(currentAnchor, selection, factor);
            setAnchor(nextAnchor);

            if (!isRectSame(nextAnchor, selection, 0.05)) {
              rafId = requestAnimationFrame(animate);
            } else {
              rafId = null;
            }
          };

          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(animate);
        } else {
          // SCROLL or SAME ELEMENT: Snap instantly to stay glued
          // We don't update lastElement here because it hasn't changed
          if (!rafId) {
            setAnchor(selection);
          }
          // Note: If an animation IS running (rafId exists) and we scroll, 
          // we let the animation loop handle the update to prevent 'jams'.
          // The animate loop uses 'selection' which is a memo that includes viewport.version
        }
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
          <Portal mount={document.body}>
            <div
              class={`${PREFIX}boundary-box ${PREFIX}boundary-box-selected`}
              style={{
                left: 0,
                top: 0,
                width: `${current().width}px`,
                height: `${current().height}px`,
                transform: `translate3d(${current().left - props.viewport.scrollX}px, ${current().top - props.viewport.scrollY}px, 0)`,
                "clip-path": current().clipPath
              }}
            />
          </Portal>
        )}
      </Show>
      <Show when={target()}>
        {(current) => (
          <Portal mount={document.body}>
            <div
              class={`${PREFIX}boundary-box ${PREFIX}boundary-box-secondary`}
              style={{
                left: 0,
                top: 0,
                width: `${current().width}px`,
                height: `${current().height}px`,
                transform: `translate3d(${current().left - props.viewport.scrollX}px, ${current().top - props.viewport.scrollY}px, 0)`,
                "clip-path": current().clipPath
              }}
            />
          </Portal>
        )}
      </Show>
    </>
  );
}
