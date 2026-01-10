import {
  For,
  Show,
  createSignal,
  createMemo,
  type Accessor,
  onMount,
  onCleanup,
  createEffect,
} from "solid-js";
import {
  type RulerState,
  type RulerLine,
  type ProjectionState,
  type SelectionMetadata,
  type MeasurementResult,
  type MeasurementLine,
  getLiveGeometry,
  RULER_SNAP_THRESHOLD,
  RULER_HIT_SIZE,
} from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface RulerOverlayProps {
  state: Accessor<RulerState>;
  viewport: Accessor<{
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  }>;
  projectionState?: Accessor<ProjectionState>;
  metadata?: Accessor<SelectionMetadata>;
  result?: Accessor<MeasurementResult | null>;
  onUpdate: (id: string, position: number) => void;
  onRemove: (id: string) => void;
  onLineClick?: (line: MeasurementLine, liveValue: number) => void;
}

/**
 * Ruler Layer
 */
export function RulerOverlay(props: RulerOverlayProps) {
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [hoveredId, setHoveredId] = createSignal<string | null>(null);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set<string>());

  createEffect(() => {
    const lines = props.state().lines;
    const currentIds = selectedIds();
    const validIds = new Set<string>();

    currentIds.forEach((id) => {
      if (lines.find((l) => l.id === id)) {
        validIds.add(id);
      }
    });

    if (validIds.size !== currentIds.size) {
      setSelectedIds(validIds);
    }
  });

  const getSnapPoints = (isV: boolean) => {
    const points: number[] = [];
    const state = props.projectionState?.();
    const meta = props.metadata?.();
    const res = props.result?.();
    const vp = props.viewport();

    if (meta && meta.element) {
      const live = getLiveGeometry(
        meta.rect,
        meta.scrollHierarchy,
        meta.position,
        meta.stickyConfig,
        meta.initialWindowX,
        meta.initialWindowY
      );

      if (live) {
        const liveX = live.left - vp.scrollX;
        const liveY = live.top - vp.scrollY;

        if (isV) {
          points.push(liveX, liveX + live.width, liveX + live.width / 2);
        } else {
          points.push(liveY, liveY + live.height, liveY + live.height / 2);
        }

        if (state && state.direction && state.element === meta.element) {
          const value = parseFloat(state.value) || 0;
          if (isV) {
            if (state.direction === "left") points.push(liveX - value);
            else if (state.direction === "right") points.push(liveX + live.width + value);
          } else {
            if (state.direction === "top") points.push(liveY - value);
            else if (state.direction === "bottom") points.push(liveY + live.height + value);
          }
        }
      }
    }

    if (res && res.secondary) {
      const live = getLiveGeometry(
        res.secondary,
        res.secondaryHierarchy,
        res.secondaryPosition,
        res.secondarySticky,
        res.secondaryWinX,
        res.secondaryWinY
      );

      if (live) {
        const liveX = live.left - vp.scrollX;
        const liveY = live.top - vp.scrollY;

        if (isV) {
          points.push(liveX, liveX + live.width, liveX + live.width / 2);
        } else {
          points.push(liveY, liveY + live.height, liveY + live.height / 2);
        }
      }
    }

    return points;
  };

  const applySnap = (pos: number, isV: boolean) => {
    const points = getSnapPoints(isV);
    for (const p of points) {
      if (Math.abs(pos - p) <= RULER_SNAP_THRESHOLD) {
        return p;
      }
    }
    return pos;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const activeIds = selectedIds();
    if (activeIds.size === 0) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      const idsToRemove = Array.from(activeIds);
      idsToRemove.forEach((id) => props.onRemove(id));
      setSelectedIds(new Set<string>());
      return;
    }

    const lines = props.state().lines;
    const activeLines = lines.filter((l) => activeIds.has(l.id));
    if (activeLines.length === 0) return;

    let step = 1;
    if (e.shiftKey) step = 10;
    else if (e.altKey) step = 0.1;

    const firstLine = activeLines[0];
    if (!firstLine) return;
    const isV = firstLine.type === "vertical";
    let delta = 0;

    if (isV) {
      if (e.key === "ArrowLeft") delta = -step;
      if (e.key === "ArrowRight") delta = step;
    } else {
      if (e.key === "ArrowUp") delta = -step;
      if (e.key === "ArrowDown") delta = step;
    }

    if (delta !== 0) {
      e.preventDefault();
      const vp = props.viewport();
      activeLines.forEach((line) => {
        const isLineV = line.type === "vertical";
        const max = (isLineV ? vp.width : vp.height) - 1;
        let newPos = Math.max(0, Math.min(line.position + delta, max));
        newPos = applySnap(newPos, isLineV);
        props.onUpdate(line.id, newPos);
      });
    }
  };

  onMount(() => {
    const handleGlobalClick = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest(`.${PREFIX}ruler-line-hit`) &&
        !target.closest(`.${PREFIX}ruler-bridge-label`) &&
        !target.closest(`.${PREFIX}line-hit-target`) &&
        !target.closest(`[data-caliper-ignore]`)
      ) {
        setSelectedIds(new Set<string>());
      }
    };

    window.addEventListener("pointerdown", handleGlobalClick, {
      capture: true,
    });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    onCleanup(() => {
      window.removeEventListener("pointerdown", handleGlobalClick, {
        capture: true,
      });
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    });
  });

  const handlePointerDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    const id = target.getAttribute("data-ruler-id");
    const type = target.getAttribute("data-ruler-type");

    if (!id || !type) return;

    e.preventDefault();
    e.stopPropagation();
    setDraggingId(id);
    target.setPointerCapture(e.pointerId);

    if (e.shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set<string>(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      if (!selectedIds().has(id)) {
        setSelectedIds(new Set<string>([id]));
      }
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      const vp = props.viewport();
      const isV = type === "vertical";
      let pos = isV ? moveEvent.clientX : moveEvent.clientY;
      const max = (isV ? vp.width : vp.height) - 1;

      pos = Math.max(0, Math.min(pos, max));
      pos = applySnap(pos, isV);
      props.onUpdate(id, pos);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      setDraggingId(null);
      target.releasePointerCapture(upEvent.pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleDoubleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const id = target.getAttribute("data-ruler-id");
    if (id) {
      props.onRemove(id);
      setSelectedIds((prev) => {
        const next = new Set<string>(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handlePointerOver = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    const id = target.getAttribute("data-ruler-id");
    if (id) setHoveredId(id);
  };

  const handlePointerOut = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.hasAttribute("data-ruler-id")) setHoveredId(null);
  };

  const bridges = createMemo(() => {
    const ids = selectedIds();
    if (ids.size < 2) return [];

    const lines = props.state().lines.filter((l) => ids.has(l.id));
    const vLines = lines
      .filter((l) => l.type === "vertical")
      .sort((a, b) => a.position - b.position);
    const hLines = lines
      .filter((l) => l.type === "horizontal")
      .sort((a, b) => a.position - b.position);

    const result: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      value: number;
      type: "vertical" | "horizontal";
      labelX: number;
      labelY: number;
    }> = [];

    const vp = props.viewport();

    for (let i = 0; i < vLines.length - 1; i++) {
      const l1 = vLines[i]!;
      const l2 = vLines[i + 1]!;
      const val = l2.position - l1.position;
      if (val > 0) {
        result.push({
          x1: l1.position,
          y1: vp.height / 2 + 100, // Move default bridge line off center for better visibility
          x2: l2.position,
          y2: vp.height / 2 + 100,
          value: val,
          type: "vertical",
          labelX: l1.position + val / 2,
          labelY: vp.height / 2 + 85,
        });
      }
    }

    for (let i = 0; i < hLines.length - 1; i++) {
      const l1 = hLines[i]!;
      const l2 = hLines[i + 1]!;
      const val = l2.position - l1.position;
      if (val > 0) {
        result.push({
          x1: vp.width / 2 + 100,
          y1: l1.position,
          x2: vp.width / 2 + 100,
          y2: l2.position,
          value: val,
          type: "horizontal",
          labelX: vp.width / 2 + 115,
          labelY: l1.position + val / 2,
        });
      }
    }

    return result;
  });

  const handleClick = (
    bridge: { value: number; x1: number; y1: number; x2: number; y2: number },
    e: MouseEvent
  ) => {
    e.stopPropagation();
    props.onLineClick?.(
      {
        type: "distance",
        value: bridge.value,
        start: { x: bridge.x1, y: bridge.y1 },
        end: { x: bridge.x2, y: bridge.y2 },
      },
      bridge.value
    );
  };

  return (
    <div
      class={`${PREFIX}ruler-layer`}
      data-caliper-ignore
      onPointerDown={handlePointerDown}
      onDblClick={handleDoubleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <svg class={`${PREFIX}viewport-fixed`} style={{ "z-index": 999999 }}>
        <For each={bridges()}>
          {(bridge) => (
            <g
              data-caliper-ignore
              style={{ cursor: "pointer", "pointer-events": "auto" }}
              onClick={(e: MouseEvent) => handleClick(bridge, e)}
            >
              <line
                class={`${PREFIX}line-hit-target`}
                x1={bridge.x1}
                y1={bridge.y1}
                x2={bridge.x2}
                y2={bridge.y2}
                stroke="transparent"
                stroke-width="15"
              />
              <line
                x1={bridge.x1}
                y1={bridge.y1}
                x2={bridge.x2}
                y2={bridge.y2}
                stroke="var(--caliper-secondary)"
                stroke-width="1"
                stroke-dasharray="4 2"
              />
              <circle cx={bridge.x1} cy={bridge.y1} r="2.5" fill="var(--caliper-secondary)" />
              <circle cx={bridge.x2} cy={bridge.y2} r="2.5" fill="var(--caliper-secondary)" />
            </g>
          )}
        </For>
      </svg>

      <For each={bridges()}>
        {(bridge) => (
          <div
            data-caliper-ignore
            class={`${PREFIX}label ${PREFIX}ruler-bridge-label`}
            style={{
              left: "0",
              top: "0",
              transform: `translate3d(${bridge.labelX}px, ${bridge.labelY}px, 0) translate(-50%, -50%)`,
            }}
            onClick={(e: MouseEvent) => handleClick(bridge, e)}
          >
            {Math.round(bridge.value * 100) / 100}
          </div>
        )}
      </For>

      <For each={props.state().lines}>
        {(line) => (
          <RulerLineItem
            line={line}
            isDragging={draggingId() === line.id}
            isHovered={hoveredId() === line.id}
            isSelected={selectedIds().has(line.id)}
            onLineClick={props.onLineClick}
            viewport={props.viewport}
          />
        )}
      </For>
    </div>
  );
}

function RulerLineItem(props: {
  line: RulerLine;
  isDragging: boolean;
  isHovered: boolean;
  isSelected: boolean;
  onLineClick?: (line: MeasurementLine, liveValue: number) => void;
  viewport: Accessor<{
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  }>;
}) {
  const lineStyle = createMemo(() => {
    const isV = props.line.type === "vertical";
    const pos = props.line.position;
    const isActive = props.isDragging || props.isHovered || props.isSelected;
    return {
      left: "0",
      top: "0",
      width: isV ? "1px" : "100%",
      height: isV ? "100%" : "1px",
      transform: `translate3d(${isV ? pos : 0}px, ${isV ? 0 : pos}px, 0) ${isActive ? (isV ? "scaleX(1.5)" : "scaleY(1.5)") : "scale(1)"}`,
      opacity: props.isSelected ? "1" : props.isHovered ? "0.8" : "0.6",
      filter: props.isSelected ? "drop-shadow(0 0 1.5px var(--caliper-primary))" : "none",
      "transform-origin": "center",
    };
  });

  const hitSize = createMemo(() => `${RULER_HIT_SIZE}px`);
  const hitOffset = createMemo(() => (RULER_HIT_SIZE - 1) / 2);

  return (
    <>
      <div
        data-caliper-ignore
        data-ruler-id={props.line.id}
        data-ruler-type={props.line.type}
        class={`${PREFIX}ruler-line-hit`}
        style={{
          position: "fixed",
          left: "0",
          top: "0",
          width: props.line.type === "vertical" ? hitSize() : "100%",
          height: props.line.type === "vertical" ? "100%" : hitSize(),
          transform: `translate3d(${props.line.type === "vertical" ? props.line.position - hitOffset() : 0}px, ${props.line.type === "vertical" ? 0 : props.line.position - hitOffset()}px, 0)`,
          cursor: props.line.type === "vertical" ? "col-resize" : "row-resize",
          "pointer-events": "auto",
          "z-index": 1000001,
        }}
      />

      <div
        data-caliper-ignore
        class={`${PREFIX}ruler-line-visual`}
        style={{
          ...lineStyle(),
        }}
      />

      <Show when={props.isDragging || props.isHovered || props.isSelected}>
        <div
          data-caliper-ignore
          class={`${PREFIX}label ${PREFIX}ruler-label`}
          style={{
            left: "0",
            top: "0",
            transform: `translate3d(${props.line.type === "vertical" ? props.line.position + 10 : 20}px, ${props.line.type === "vertical" ? 20 : props.line.position + 10}px, 0)`,
            opacity: props.isSelected && !props.isHovered && !props.isDragging ? "0.7" : "1",
          }}
          onClick={(e) => {
            e.stopPropagation();
            const isV = props.line.type === "vertical";
            const vp = props.viewport();
            props.onLineClick?.(
              {
                type: "distance",
                value: props.line.position,
                start: isV ? { x: props.line.position, y: 0 } : { x: 0, y: props.line.position },
                end: isV
                  ? { x: props.line.position, y: vp.height }
                  : { x: vp.width, y: props.line.position },
              },
              props.line.position
            );
          }}
        >
          {Math.round(props.line.position * 100) / 100}
        </div>
      </Show>
    </>
  );
}
