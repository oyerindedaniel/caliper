import { Show } from "solid-js";
import { MeasurementLinesWithCalculator } from "./render-lines-with-calculator.jsx";
import { MeasurementLabels } from "./render-labels.jsx";
import { Calculator } from "./calculator.jsx";
import { BoundaryBoxes } from "./render-boundary-boxes.jsx";
import { PREFIX } from "../../css/styles.js";
import type { OverlayProps } from "../../types.js";

/**
 * Main overlay component that renders all measurement UI
 */
export function Overlay(props: OverlayProps) {
  return (
    <>
      <BoundaryBoxes
        primary={props.selectedRect()}
        secondary={props.result()?.secondary || null}
      />
      <Show when={props.result()}>
        {(result) => (
          <div class={`${PREFIX}overlay`}>
            <MeasurementLinesWithCalculator
              lines={result().lines}
              onLineClick={props.onLineClick}
            />
            <MeasurementLabels
              lines={result().lines}
              cursorX={props.cursor().x}
              cursorY={props.cursor().y}
            />
          </div>
        )}
      </Show>
      <Show when={props.calculatorState?.()}>
        {(calcState) => (
          <Calculator
            state={calcState()}
            onInput={props.onCalculatorInput || (() => {})}
            onBackspace={props.onCalculatorBackspace || (() => {})}
            onDelete={props.onCalculatorDelete || (() => {})}
            onEnter={props.onCalculatorEnter || (() => {})}
            onClose={props.onCalculatorClose || (() => {})}
            position={{ x: props.cursor().x, y: props.cursor().y }}
          />
        )}
      </Show>
    </>
  );
}
