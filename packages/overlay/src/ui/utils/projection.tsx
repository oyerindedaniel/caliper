import { Show, createMemo, type Accessor, createSignal } from "solid-js";
import { PREFIX } from "../../css/styles.js";
import { type ProjectionState, type SelectionMetadata, getLiveGeometry, type MeasurementLine } from "@caliper/core";

interface ProjectionOverlayProps {
    projectionState: Accessor<ProjectionState>;
    metadata: Accessor<SelectionMetadata>;
    viewport: Accessor<{ scrollX: number; scrollY: number; width: number; height: number; version: number }>;
    isFocused?: boolean;
    onLineClick?: (line: MeasurementLine, liveValue: number) => void;
}

export function ProjectionOverlay(props: ProjectionOverlayProps) {
    return (
        <Show when={props.metadata().element && props.projectionState().direction}>
            <ProjectionLines
                projectionState={props.projectionState}
                metadata={props.metadata}
                viewport={props.viewport}
                onLineClick={props.onLineClick}
            />
            <ProjectionInput
                projectionState={props.projectionState}
                metadata={props.metadata}
                viewport={props.viewport}
                isFocused={props.isFocused}
            />
        </Show>
    );
}

function ProjectionLines(props: {
    projectionState: Accessor<ProjectionState>;
    metadata: Accessor<SelectionMetadata>;
    viewport: Accessor<{ scrollX: number; scrollY: number; width: number; height: number; version: number }>;
    onLineClick?: (line: MeasurementLine, liveValue: number) => void;
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
        let visibleY1 = 0, visibleY2 = 0, visibleX1 = 0, visibleX2 = 0;

        const docWidth = document.documentElement.scrollWidth;
        const docHeight = document.documentElement.scrollHeight;

        const liveX = live.left - vp.scrollX;
        const liveY = live.top - vp.scrollY;


        let isOffScreen = false;

        switch (state.direction) {
            case "top":
                x1 = x2 = liveX + live.width / 2;
                y1 = liveY;
                y2 = Math.max(-vp.scrollY, y1 - value);
                labelX = x1;
                visibleY1 = Math.max(0, Math.min(vp.height, y1));
                visibleY2 = Math.max(0, Math.min(vp.height, y2));
                if (Math.abs(visibleY1 - visibleY2) < 1) isOffScreen = true;
                labelY = (Math.min(visibleY1, visibleY2) + Math.max(visibleY1, visibleY2)) / 2;
                break;
            case "bottom":
                x1 = x2 = liveX + live.width / 2;
                y1 = liveY + live.height;
                y2 = Math.min(docHeight - vp.scrollY, y1 + value);
                labelX = x1;
                visibleY1 = Math.max(0, Math.min(vp.height, y1));
                visibleY2 = Math.max(0, Math.min(vp.height, y2));
                if (Math.abs(visibleY1 - visibleY2) < 1) isOffScreen = true;
                labelY = (Math.min(visibleY1, visibleY2) + Math.max(visibleY1, visibleY2)) / 2;
                break;
            case "left":
                y1 = y2 = liveY + live.height / 2;
                x1 = liveX;
                x2 = Math.max(-vp.scrollX, x1 - value);
                visibleX1 = Math.max(0, Math.min(vp.width, x1));
                visibleX2 = Math.max(0, Math.min(vp.width, x2));
                if (Math.abs(visibleX1 - visibleX2) < 1) isOffScreen = true;
                labelX = (Math.min(visibleX1, visibleX2) + Math.max(visibleX1, visibleX2)) / 2;
                labelY = y1;
                break;
            case "right":
                y1 = y2 = liveY + live.height / 2;
                x1 = liveX + live.width;
                x2 = Math.min(docWidth - vp.scrollX, x1 + value);
                visibleX1 = Math.max(0, Math.min(vp.width, x1));
                visibleX2 = Math.max(0, Math.min(vp.width, x2));
                if (Math.abs(visibleX1 - visibleX2) < 1) isOffScreen = true;
                labelX = (Math.min(visibleX1, visibleX2) + Math.max(visibleX1, visibleX2)) / 2;
                labelY = y1;
                break;
        }

        const actualValue = Math.round(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2));
        const labelWidthGuess = String(actualValue).length * 8 + 12; // Estimation: 8px per digit + 12px padding
        const showLabel = actualValue >= labelWidthGuess * 3;

        return { x1, y1, x2, y2, labelX, labelY, actualValue, isHidden: live.isHidden || isOffScreen, showLabel };
    });

    const [isHovered, setIsHovered] = createSignal(false);

    const handleLineClick = (e: MouseEvent) => {
        e.stopPropagation();
        const data = lineData();
        if (data) {
            props.onLineClick?.({
                type: "distance",
                value: data.actualValue,
                start: { x: data.x1, y: data.y1 },
                end: { x: data.x2, y: data.y2 }
            }, data.actualValue);
        }
    };

    return (
        <Show when={lineData() && !lineData()?.isHidden}>
            <svg class={`${PREFIX}viewport-fixed`} style={{ "z-index": 1000000, "pointer-events": "none" }}>
                <line
                    x1={lineData()!.x1}
                    y1={lineData()!.y1}
                    x2={lineData()!.x2}
                    y2={lineData()!.y2}
                    class={`${PREFIX}line-hit-target`}
                    data-caliper-ignore
                    stroke="transparent"
                    stroke-width="15"
                    onClick={handleLineClick}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                />
                <line
                    x1={lineData()!.x1}
                    y1={lineData()!.y1}
                    x2={lineData()!.x2}
                    y2={lineData()!.y2}
                    class={`${PREFIX}projection-line`}
                    stroke-width={isHovered() ? 2 : 1}
                />
            </svg>
            <Show when={lineData()!.showLabel}>
                <div
                    class={`${PREFIX}label ${PREFIX}projection-label`}
                    data-caliper-ignore
                    style={{
                        top: 0,
                        left: 0,
                        transform: `translate3d(${lineData()!.labelX}px, ${lineData()!.labelY}px, 0) translate(-50%, -50%)`,
                    }}
                    onClick={handleLineClick}
                >
                    {lineData()!.actualValue}
                </div>
            </Show>
        </Show>
    );
}

function ProjectionInput(props: {
    projectionState: Accessor<ProjectionState>;
    metadata: Accessor<SelectionMetadata>;
    viewport: Accessor<{ scrollX: number; scrollY: number; width: number; height: number; version: number }>;
    isFocused?: boolean;
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

        const windowTop = live.top - vp.scrollY;
        const windowLeft = live.left - vp.scrollX;

        const inputHeight = 35;
        const margin = 10;

        const shouldFlip = windowTop < (inputHeight + margin);

        const y = shouldFlip
            ? windowTop + live.height + margin
            : windowTop - inputHeight;

        return {
            top: "0",
            left: "0",
            transform: `translate3d(${windowLeft}px, ${y}px, 0)`,
        };
    });

    return (
        <div
            class={`${PREFIX}projection-input ${props.isFocused ? `${PREFIX}projection-input-focused` : ""}`}
            data-caliper-ignore
            style={style()}
        >
            <span class={`${PREFIX}projection-direction-tag`}>
                {props.projectionState().direction}
            </span>
            <span class={`${PREFIX}projection-current-value`}>
                {props.projectionState().value || "0"}
            </span>
        </div>
    );
}
