import { Show, createMemo } from "solid-js";
import {
    type SelectionMetadata,
    diagnosticLogger,
    formatElement,
    formatRect
} from "@caliper/core";
import { Portal } from "solid-js/web";
import { PREFIX } from "../../css/styles.js";

interface SelectionLabelProps {
    metadata: SelectionMetadata;
    isAltPressed: boolean;
    isFrozen: boolean;
    viewport: {
        scrollX: number;
        scrollY: number;
        width: number;
        height: number;
    };
}

/**
 * Render dimensions label beneath the selected element
 */
export function SelectionLabel(props: SelectionLabelProps) {
    const margin = 16;

    const labelData = createMemo(() => {
        const metadata = props.metadata;
        const rect = metadata.rect;
        if (!rect) return null;

        const width = Math.round(rect.width);
        const height = Math.round(rect.height);

        // Viewport data for snapping
        const vLeft = props.viewport.scrollX;
        const vRight = props.viewport.scrollX + props.viewport.width;
        const vBottom = props.viewport.scrollY + props.viewport.height;

        const visibleLeft = Math.max(rect.left, vLeft + margin);
        const visibleRight = Math.min(rect.right, vRight - margin);

        // Default X/Y in document space
        let snapX = (visibleLeft + visibleRight) / 2;
        let snapY = rect.bottom + 8;

        // Snapping: Float at bottom of viewport if clipped
        if (snapY > vBottom - margin - 24) {
            if (rect.top < vBottom - margin) {
                snapY = vBottom - margin - 24;
            }
        }
        snapY = Math.max(snapY, rect.top + margin);

        // Coordinates relative to container content origin
        // (relativeRect is already scroll-stable)
        const relX = snapX - rect.left + metadata.relativeRect!.left;
        const relY = snapY - rect.top + metadata.relativeRect!.top;

        return {
            width,
            height,
            relX,
            relY,
            container: metadata.container
        };
    });

    return (
        <Show when={labelData()}>
            {(data) => {
                diagnosticLogger.log(`[SelectionLabel] Mount: ${formatElement(data().container)}, RelX/Y: ${data().relX.toFixed(2)}, ${data().relY.toFixed(2)}`);

                return (
                    <Portal mount={data().container || document.body}>
                        <div
                            class={`${PREFIX}selection-label`}
                            style={{
                                left: 0,
                                top: 0,
                                transform: `translate3d(${data().relX}px, ${data().relY}px, 0) translate(-50%, 0)`,
                                opacity: (props.isAltPressed || props.isFrozen) ? 0 : 1,
                            }}
                        >
                            {data().width} × {data().height}
                        </div>
                    </Portal>
                );
            }}
        </Show>
    );
}
