import { onMount, onCleanup, Show } from "solid-js";
import type { CalculatorState, CalculatorOperation } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { Icons } from "./icons.jsx";

interface CalculatorProps {
  state: CalculatorState;
  onInput: (key: string) => void;
  onBackspace: () => void;
  onDelete: () => void;
  onEnter: () => void;
  onClose: () => void;
  position: { x: number; y: number };
}

/**
 * Calculator input control
 */
export function Calculator(props: CalculatorProps) {

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!props.state.isActive) return;

      if (
        /^[0-9+\-*/]$/.test(e.key) ||
        e.key === "Backspace" ||
        e.key === "Delete" ||
        e.key === "Enter" ||
        e.key === "Escape"
      ) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (/^[0-9]$/.test(e.key)) {
        props.onInput(e.key);
      } else if (
        e.key === "+" ||
        e.key === "-" ||
        e.key === "*" ||
        e.key === "/"
      ) {
        props.onInput(e.key as CalculatorOperation);
      } else if (e.key === "Backspace") {
        props.onBackspace();
      } else if (e.key === "Delete") {
        props.onDelete();
      } else if (e.key === "Enter") {
        props.onEnter();
      } else if (e.key === "Escape") {
        props.onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  const formatValue = (value: number): string => {
    return Math.round(value * 100) / 100 + "";
  };

  return (
    <Show when={props.state.isActive}>
      <div
        class={`${PREFIX}calculator`}
        style={{
          left: `${props.position.x + 10}px`,
          top: `${props.position.y + 10}px`,
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
