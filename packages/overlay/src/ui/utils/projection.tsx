import { Show, createMemo, type Accessor, createSignal } from "solid-js";
import { PREFIX } from "../../css/styles.js";
import {
  type ProjectionState,
  type SelectionMetadata,
  getLiveGeometry,
  getProjectionLineGeometry,
  type MeasurementLine,
} from "@caliper/core";

interface ProjectionOverlayProps {
  projectionState: Accessor<ProjectionState>;
  metadata: Accessor<SelectionMetadata>;
  viewport: Accessor<{
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  }>;
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
        isFocused={props.isFocused}
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
  viewport: Accessor<{
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  }>;
  isFocused?: boolean;
  onLineClick?: (line: MeasurementLine, liveValue: number) => void;
}) {
  const lineData = createMemo(() => {
    const vp = props.viewport();
    vp.version;
    const state = props.projectionState();
    const value = parseFloat(state.value) || 0;
    const metadata = props.metadata();

    const live = getLiveGeometry(
      metadata.rect,
      metadata.scrollHierarchy,
      metadata.position,
      metadata.stickyConfig,
      metadata.initialWindowX,
      metadata.initialWindowY
    );

    if (!live || !state.direction) return null;

    return getProjectionLineGeometry({
      direction: state.direction,
      value,
      live,
      viewport: vp,
      docSize: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      displayValue: state.value,
    });
  });

  const [isHovered, setIsHovered] = createSignal(false);

  const handleLineClick = (e: MouseEvent) => {
    e.stopPropagation();
    const data = lineData();
    if (data) {
      props.onLineClick?.(
        {
          type: "distance",
          value: data.actualValue,
          start: { x: data.x1, y: data.y1 },
          end: { x: data.x2, y: data.y2 },
        },
        data.actualValue
      );
    }
  };

  return (
    <Show when={lineData() && !lineData()?.isHidden}>
      <svg class={`${PREFIX}viewport-fixed`} style={{ "z-index": 1000000 }}>
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
          stroke-width={props.isFocused || isHovered() ? 2 : 1}
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
  viewport: Accessor<{
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  }>;
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

    const shouldFlip = windowTop < inputHeight + margin;

    const y = shouldFlip ? windowTop + live.height + margin : windowTop - inputHeight;

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
      <span class={`${PREFIX}projection-direction-tag`}>{props.projectionState().direction}</span>
      <span class={`${PREFIX}projection-current-value`}>
        {props.projectionState().value || "0"}
      </span>
    </div>
  );
}
