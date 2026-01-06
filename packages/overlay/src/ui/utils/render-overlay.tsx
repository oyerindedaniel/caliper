import { Show, createMemo } from "solid-js";
import { Portal } from "solid-js/web";
import {
  getLiveGeometry,
  getTotalScrollDelta,
  getCommonVisibilityWindow,
} from "@caliper/core";
import { MeasurementLinesWithCalculator } from "./render-lines-with-calculator.jsx";
import { MeasurementLabels } from "./render-labels.jsx";
import { Calculator } from "./calculator.jsx";
import { BoundaryBoxes } from "./render-boundary-boxes.jsx";
import { SelectionLabel } from "./render-selection-label.jsx";
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
      res.primaryWinY
    );
    if (!primaryGeo) return null;

    return {
      primary: {
        geo: primaryGeo,
        delta: getTotalScrollDelta(
          res.primaryHierarchy,
          res.primaryPosition,
          res.primarySticky,
          res.primaryWinX,
          res.primaryWinY
        )
      },
      secondary: {
        geo: getLiveGeometry(
          res.secondary,
          res.secondaryHierarchy,
          res.secondaryPosition,
          res.secondarySticky,
          res.secondaryWinX,
          res.secondaryWinY
        ),
        delta: getTotalScrollDelta(
          res.secondaryHierarchy,
          res.secondaryPosition,
          res.secondarySticky,
          res.secondaryWinX,
          res.secondaryWinY
        )
      },
      common: getCommonVisibilityWindow(
        res.primaryHierarchy,
        res.secondaryHierarchy,
        props.selectionMetadata().element!,
        res.secondaryElement!
      ),
      isSameContext: !!(
        (res.primaryPosition === res.secondaryPosition &&
          res.primaryHierarchy.length === res.secondaryHierarchy.length &&
          res.primaryHierarchy.every((p, i) => p.element === res.secondaryHierarchy[i]?.element)) ||
        res.secondaryElement?.contains(props.selectionMetadata().element!) ||
        props.selectionMetadata().element?.contains(res.secondaryElement!)
      )
    };
  });

  return (
    <>
      <BoundaryBoxes
        metadata={props.selectionMetadata()}
        result={props.result()}
        isAltPressed={props.isAltPressed()}
        isFrozen={props.isFrozen()}
        animation={props.animation}
        viewport={props.viewport()}
      />
      <SelectionLabel
        metadata={props.selectionMetadata()}
        isAltPressed={props.isAltPressed()}
        isFrozen={props.isFrozen()}
        viewport={props.viewport()}
      />
      <Show when={((props.isAltPressed() || props.isFrozen()) && resultData()) ? { res: props.result()!, data: resultData()! } : null}>
        {(sync) => (
          <Portal mount={document.body}>
            <div class={`${PREFIX}overlay`}>
              <MeasurementLinesWithCalculator
                lines={sync().res.lines}
                data={sync().data}
                viewport={props.viewport()}
                onLineClick={props.onLineClick}
              />
              <MeasurementLabels
                lines={sync().res.lines}
                data={sync().data}
                viewport={props.viewport()}
              />
            </div>
          </Portal>
        )}
      </Show>
      <Show when={props.calculatorState?.()}>
        {(calcState) => (
          <Portal mount={document.body}>
            <Calculator
              state={calcState()}
              onInput={props.onCalculatorInput || (() => { })}
              onBackspace={props.onCalculatorBackspace || (() => { })}
              onDelete={props.onCalculatorDelete || (() => { })}
              onEnter={props.onCalculatorEnter || (() => { })}
              onClose={props.onCalculatorClose || (() => { })}
              position={{ x: props.cursor().x, y: props.cursor().y }}
            />
          </Portal>
        )}
      </Show>
    </>
  );
}
