import { Show, createMemo, type Accessor } from "solid-js";
import { PREFIX } from "../../css/styles.js";
import { type ProjectionState, type SelectionMetadata, getLiveGeometry } from "@caliper/core";

interface ProjectionOverlayProps {
    projectionState: Accessor<ProjectionState>;
    metadata: Accessor<SelectionMetadata>;
    viewport: Accessor<{ scrollX: number; scrollY: number; width: number; height: number; version: number }>;
}

export function ProjectionOverlay(props: ProjectionOverlayProps) {
    return (
        <Show when={props.metadata().element && props.projectionState().direction}>
            <ProjectionLines
                projectionState={props.projectionState}
                metadata={props.metadata}
                viewport={props.viewport}
            />
            <ProjectionInput
                projectionState={props.projectionState}
                metadata={props.metadata}
                viewport={props.viewport}
            />
        </Show>
    );
}

function ProjectionLines(props: {
    projectionState: Accessor<ProjectionState>;
    metadata: Accessor<SelectionMetadata>;
    viewport: Accessor<{ scrollX: number; scrollY: number; width: number; height: number; version: number }>;
}) {
    const lineData = createMemo(() => {
        const vp = props.viewport();
        vp.version;
        const state = props.projectionState();
        const value = parseInt(state.value) || 0;
        const metadata = props.metadata();

        const live = getLiveGeometry(
            metadata.rect,
            metadata.scrollHierarchy,
            metadata.position,
            metadata.stickyConfig,
            metadata.initialWindowX,
            metadata.initialWindowY
        );

        if (!live) return null;

        let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        let labelX = 0, labelY = 0;

        const vWidth = vp.width;
        const vHeight = vp.height;

        const liveX = live.left - vp.scrollX;
        const liveY = live.top - vp.scrollY;

        switch (state.direction) {
            case "top":
                x1 = x2 = liveX + live.width / 2;
                y1 = liveY;
                y2 = Math.max(0, y1 - value);
                labelX = x1;
                labelY = y2 - 10;
                break;
            case "bottom":
                x1 = x2 = liveX + live.width / 2;
                y1 = liveY + live.height;
                y2 = Math.min(vHeight, y1 + value);
                labelX = x1;
                labelY = y2 + 10;
                break;
            case "left":
                y1 = y2 = liveY + live.height / 2;
                x1 = liveX;
                x2 = Math.max(0, x1 - value);
                labelX = x2 - 10;
                labelY = y1;
                break;
            case "right":
                y1 = y2 = liveY + live.height / 2;
                x1 = liveX + live.width;
                x2 = Math.min(vWidth, x1 + value);
                labelX = x2 + 10;
                labelY = y1;
                break;
        }

        const actualValue = Math.round(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2));

        return { x1, y1, x2, y2, labelX, labelY, actualValue, isHidden: live.isHidden };
    });

    return (
        <Show when={lineData() && !lineData()?.isHidden}>
            <svg class={`${PREFIX}viewport-fixed`} style={{ "z-index": 1000000, "pointer-events": "none" }}>
                <line
                    x1={lineData()!.x1}
                    y1={lineData()!.y1}
                    x2={lineData()!.x2}
                    y2={lineData()!.y2}
                    class={`${PREFIX}projection-line`}
                />
            </svg>
            <div
                class={`${PREFIX}label ${PREFIX}projection-label`}
                style={{
                    transform: `translate3d(${lineData()!.labelX}px, ${lineData()!.labelY}px, 0) translate(-50%, -50%)`,
                }}
            >
                {lineData()!.actualValue}px
            </div>
        </Show>
    );
}

function ProjectionInput(props: {
    projectionState: Accessor<ProjectionState>;
    metadata: Accessor<SelectionMetadata>;
    viewport: Accessor<{ scrollX: number; scrollY: number; width: number; height: number; version: number }>;
}) {
    const style = createMemo(() => {
        const vp = props.viewport();
        vp.version;
        const metadata = props.metadata();

        const live = getLiveGeometry(
            metadata.rect,
            metadata.scrollHierarchy,
            metadata.position,
            metadata.stickyConfig,
            metadata.initialWindowX,
            metadata.initialWindowY
        );

        if (!live || live.isHidden) return { display: "none" };

        return {
            top: "0",
            left: "0",
            transform: `translate3d(${live.left - vp.scrollX}px, ${live.top - vp.scrollY - 35}px, 0)`,
        };
    });

    return (
        <div
            class={`${PREFIX}projection-input`}
            style={style()}
        >
            <span class={`${PREFIX}projection-direction-tag`}>
                {props.projectionState().direction}
            </span>
            <span class={`${PREFIX}projection-current-value`}>
                {props.projectionState().value || "0"}
            </span>
            <span style={{ opacity: 0.5 }}>px</span>
        </div>
    );
}
