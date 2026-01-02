import { Show } from "solid-js";
import { PREFIX } from "../../css/styles.js";

interface SelectionLabelProps {
    selectionRect: DOMRect | null;
    isAltPressed: boolean;
    isFrozen: boolean;
}

/**
 * Render dimensions label beneath the selected element
 */
export function SelectionLabel(props: SelectionLabelProps) {
    return (
        <Show when={props.selectionRect} keyed>
            {(rect) => {
                const width = Math.round(rect.width);
                const height = Math.round(rect.height);

                // Position beneath the element
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height + 8; // 8px gap

                return (
                    <div
                        class={`${PREFIX}selection-label`}
                        style={{
                            left: 0,
                            top: 0,
                            transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, 0)`,
                            opacity: (props.isAltPressed || props.isFrozen) ? 0 : 1,
                        }}
                    >
                        {width} × {height}
                    </div>
                );
            }}
        </Show>
    );
}
