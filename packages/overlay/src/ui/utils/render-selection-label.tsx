import { Show, createMemo } from "solid-js";
import {
    type SelectionMetadata,
    getLiveGeometry,
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
        version: number;
    };
}

/**
 * Render dimensions label beneath the selected element, aware of container boundaries
 */
export function SelectionLabel(props: SelectionLabelProps) {
    const margin = 16;

    const liveGeo = createMemo(() => {
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

    const labelData = createMemo(() => {
        const geo = liveGeo();
        if (!geo || geo.isHidden) return null;

        const vLeft = props.viewport.scrollX;
        const vRight = props.viewport.scrollX + props.viewport.width;
        const vBottom = props.viewport.scrollY + props.viewport.height;

        const cLeft = geo.visibleMinX;
        const cRight = geo.visibleMaxX;
        const cBottom = geo.visibleMaxY;

        const effectiveMinX = Math.max(vLeft, cLeft);
        const effectiveMaxX = Math.min(vRight, cRight);
        const effectiveMaxY = Math.min(vBottom, cBottom);

        const visibleLeft = Math.max(geo.left, effectiveMinX + margin);
        const visibleRight = Math.min(geo.left + geo.width, effectiveMaxX - margin);

        let snapX = (visibleLeft + visibleRight) / 2;
        let snapY = geo.top + geo.height + 8;

        // Snapping: Float at bottom of effective visible area if clipped
        if (snapY > effectiveMaxY - margin - 24) {
            if (geo.top < effectiveMaxY - margin) {
                snapY = effectiveMaxY - margin - 24;
            }
        }
        snapY = Math.max(snapY, geo.top + margin);

        return {
            width: Math.round(geo.width),
            height: Math.round(geo.height),
            x: snapX,
            y: snapY
        };
    });

    return (
        <Show when={labelData()}>
            {(data) => (
                <Portal mount={document.body}>
                    <div
                        class={`${PREFIX}selection-label`}
                        style={{
                            left: 0,
                            top: 0,
                            transform: `translate3d(${data().x - props.viewport.scrollX}px, ${data().y - props.viewport.scrollY}px, 0) translate(-50%, 0)`,
                            opacity: (props.isAltPressed || props.isFrozen) ? 0 : 1,
                        }}
                    >
                        {data().width} × {data().height}
                    </div>
                </Portal>
            )}
        </Show>
    );
}
