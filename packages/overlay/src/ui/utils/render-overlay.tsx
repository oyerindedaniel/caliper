import { Show } from "solid-js";
import { Portal } from "solid-js/web";
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
  return (
    <>
      <BoundaryBoxes
        metadata={props.selectionMetadata()}
        result={props.result()}
        isAltPressed={props.isAltPressed()}
        isFrozen={props.isFrozen()}
        animation={props.animation}
      />
      <SelectionLabel
        metadata={props.selectionMetadata()}
        isAltPressed={props.isAltPressed()}
        isFrozen={props.isFrozen()}
        viewport={props.viewport()}
      />
      <Show when={(props.isAltPressed() || props.isFrozen()) ? props.result() : null}>
        {(result) => (
          <Portal mount={result().container || document.body}>
            <div class={`${PREFIX}overlay`}>
              <MeasurementLinesWithCalculator
                lines={result().lines}
                primary={result().primary}
                primaryRelative={result().primaryRelative}
                secondaryRelative={result().secondaryRelative}
                onLineClick={props.onLineClick}
              />
              <MeasurementLabels
                lines={result().lines}
                primary={result().primary}
                primaryRelative={result().primaryRelative}
                secondaryRelative={result().secondaryRelative}
                viewport={props.viewport()}
                cursorX={props.cursor().x}
                cursorY={props.cursor().y}
              />
            </div>
          </Portal>
        )}
      </Show>
      <Show when={props.calculatorState?.()}>
        {(calcState) => (
          <Calculator
            state={calcState()}
            onInput={props.onCalculatorInput || (() => { })}
            onBackspace={props.onCalculatorBackspace || (() => { })}
            onDelete={props.onCalculatorDelete || (() => { })}
            onEnter={props.onCalculatorEnter || (() => { })}
            onClose={props.onCalculatorClose || (() => { })}
            position={{ x: props.cursor().x, y: props.cursor().y }}
          />
        )}
      </Show>
    </>
  );
}
