import { Show } from "solid-js";
import type { CalculatorState } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { Icons } from "./icons.jsx";

interface CalculatorProps {
  state: CalculatorState;
  onClose: () => void;
  position: { x: number; y: number };
  isFocused?: boolean;
}

/**
 * Calculator input control
 */
export function Calculator(props: CalculatorProps) {
  const formatValue = (value: number): string => {
    return Math.round(value * 100) / 100 + "";
  };

  return (
    <Show when={props.state.isActive}>
      <div
        class={`${PREFIX}calculator ${props.isFocused ? `${PREFIX}calculator-focused` : ""}`}
        style={{
          top: "0",
          left: "0",
          transform: `translate3d(${props.position.x + 10}px, ${props.position.y + 10}px, 0)`,
        }}
      >
        <span
          class={`${PREFIX}calculator-base ${props.state.operation ? `${PREFIX}calculator-base-active` : ""}`}
        >
          {formatValue(props.state.baseValue)}
        </span>

        <Show keyed when={props.state.operation}>
          {(operation) => {
            const Icon = Icons[operation as keyof typeof Icons];
            return (
              <span class={`${PREFIX}calculator-operation`}>
                <Show when={Icon} fallback={operation}>
                  <Icon />
                </Show>
              </span>
            );
          }}
        </Show>

        <Show when={props.state.inputValue || props.state.operation}>
          <span class={`${PREFIX}calculator-input`}>
            {props.state.inputValue || "0"}
          </span>
        </Show>

        <Show when={props.state.result !== null}>
          <span class={`${PREFIX}calculator-result`}>
            ={" "}
            {props.state.result !== null ? formatValue(props.state.result) : ""}
          </span>
        </Show>
      </div>
    </Show>
  );
}
