import { Show, createMemo } from "solid-js";
import { Portal } from "solid-js/web";
import {
  getLiveGeometry,
  getTotalScrollDelta,
  getCommonVisibilityWindow,
  getOverlayRoot,
  type ScrollState,
} from "@caliper/core";
import { MeasurementLinesWithCalculator } from "./render-lines-with-calculator.jsx";
import { MeasurementLabels } from "./render-labels.jsx";
import { Calculator } from "./calculator.jsx";
import { BoundaryBoxes } from "./render-boundary-boxes.jsx";
import { SelectionLabel } from "./render-selection-label.jsx";
import { ProjectionOverlay } from "./projection.jsx";
import { RulerOverlay } from "./ruler.jsx";
import { PREFIX } from "../../css/styles.js";
import type { OverlayProps } from "../../types.js";

/**
 * Main overlay component that renders all measurement UI
 */
export function Overlay(props: OverlayProps) {
  const resultData = createMemo(() => {
    const res = props.result();
    if (!res) return null;

    props.viewport().version;

    const primaryGeo = getLiveGeometry(
      res.primary,
      res.primaryHierarchy,
      res.primaryPosition,
      res.primarySticky,
      res.primaryWinX,
      res.primaryWinY,
      !!res.primaryHasContainingBlock
    );
    if (!primaryGeo) return null;

    const base = {
      primary: {
        geo: primaryGeo,
        delta: getTotalScrollDelta(
          res.primaryHierarchy,
          res.primaryPosition,
          res.primarySticky,
          res.primaryWinX,
          res.primaryWinY,
          !!res.primaryHasContainingBlock
        ),
      },
      secondary: {
        geo: getLiveGeometry(
          res.secondary,
          res.secondaryHierarchy,
          res.secondaryPosition,
          res.secondarySticky,
          res.secondaryWinX,
          res.secondaryWinY,
          !!res.secondaryHasContainingBlock
        ),
        delta: getTotalScrollDelta(
          res.secondaryHierarchy,
          res.secondaryPosition,
          res.secondarySticky,
          res.secondaryWinX,
          res.secondaryWinY,
          !!res.secondaryHasContainingBlock
        ),
      },
      common: getCommonVisibilityWindow(
        res.primaryHierarchy,
        res.secondaryHierarchy,
        props.selectionMetadata().element!,
        res.secondaryElement!,
        res.primaryWinX,
        res.primaryWinY
      ),
    };

    const hasSameStack =
      res.primaryPosition === res.secondaryPosition &&
      res.primaryHierarchy.length === res.secondaryHierarchy.length &&
      res.primaryHierarchy.every(
        (scrollState: ScrollState, index: number) =>
          scrollState.element === res.secondaryHierarchy[index]?.element
      );

    const isDirectParentChild =
      (res.primaryHierarchy.length > 0 &&
        res.primaryHierarchy[0]?.element === res.secondaryElement) ||
      (res.secondaryHierarchy.length > 0 &&
        res.secondaryHierarchy[0]?.element === props.selectionMetadata().element);

    return {
      ...base,
      isSameContext: hasSameStack || isDirectParentChild,
    };
  });

  return (
    <>
      <BoundaryBoxes
        metadata={props.selectionMetadata()}
        result={props.result()}
        isActivatePressed={props.isActivatePressed()}
        isFrozen={props.isFrozen()}
        animation={props.animation}
        viewport={props.viewport()}
      />
      <SelectionLabel
        metadata={props.selectionMetadata()}
        isActivatePressed={props.isActivatePressed()}
        isCopied={props.isCopied?.() ?? false}
        viewport={props.viewport()}
      />
      <Show when={(props.isActivatePressed() || props.isFrozen()) && resultData()}>
        <Portal mount={getOverlayRoot()}>
          <div class={`${PREFIX}overlay`}>
            <MeasurementLinesWithCalculator
              lines={props.result()!.lines}
              data={resultData()!}
              viewport={props.viewport()}
              onLineClick={props.onLineClick}
            />
            <MeasurementLabels
              lines={props.result()!.lines}
              data={resultData()!}
              viewport={props.viewport()}
              onLineClick={props.onLineClick}
            />
          </div>
        </Portal>
      </Show>
      <Show when={props.calculatorState && props.calculatorState() !== null}>
        <Portal mount={getOverlayRoot()}>
          <Calculator
            state={props.calculatorState!()!}
            onClose={props.onCalculatorClose || (() => {})}
            position={{ x: props.cursor().x, y: props.cursor().y }}
            isFocused={props.activeFocus?.() === "calculator"}
          />
        </Portal>
      </Show>
      <Show
        when={
          props.projectionState &&
          props.projectionState()?.direction !== null &&
          props.projectionState()?.element === props.selectionMetadata().element
        }
      >
        <Portal mount={getOverlayRoot()}>
          <ProjectionOverlay
            projectionState={props.projectionState!}
            metadata={props.selectionMetadata}
            viewport={props.viewport}
            isFocused={props.activeFocus?.() === "projection"}
            onLineClick={props.onLineClick}
          />
        </Portal>
      </Show>
      <Show when={props.rulerState && props.rulerState().lines.length > 0}>
        <Portal mount={getOverlayRoot()}>
          <RulerOverlay
            state={props.rulerState!}
            viewport={props.viewport}
            projectionState={props.projectionState}
            metadata={props.selectionMetadata}
            result={props.result}
            onUpdate={props.onRulerUpdate || (() => {})}
            onRemove={props.onRulerRemove || (() => {})}
            onLineClick={props.onLineClick}
          />
        </Portal>
      </Show>
    </>
  );
}
