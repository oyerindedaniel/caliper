import { For, Show, createSignal, createMemo, type Accessor, onMount, onCleanup } from "solid-js";
import { type RulerState, type RulerLine } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface RulerOverlayProps {
    state: Accessor<RulerState>;
    viewport: Accessor<{ width: number; height: number; scrollX: number; scrollY: number }>;
    onUpdate: (id: string, position: number) => void;
    onRemove: (id: string) => void;
    onClearAll: () => void;
}

/**
 * Ruler Layer
 */
export function RulerOverlay(props: RulerOverlayProps) {
    const [draggingId, setDraggingId] = createSignal<string | null>(null);
    const [hoveredId, setHoveredId] = createSignal<string | null>(null);
    const [selectedId, setSelectedId] = createSignal<string | null>(null);

    const handlePointerDown = (e: PointerEvent) => {
        const target = e.target as HTMLElement;
        const id = target.getAttribute("data-ruler-id");
        const type = target.getAttribute("data-ruler-type");

        if (!id || !type) {
            setSelectedId(null);
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        setDraggingId(id);
        setSelectedId(id);

        const onPointerMove = (moveEvent: PointerEvent) => {
            const vp = props.viewport();
            let pos = type === "vertical" ? moveEvent.clientX : moveEvent.clientY;

            const max = type === "vertical" ? vp.width : vp.height;
            pos = Math.max(0, Math.min(pos, max));

            props.onUpdate(id, pos);
        };

        const onPointerUp = () => {
            setDraggingId(null);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            props.onClearAll();
            setSelectedId(null);
            return;
        }

        const activeId = selectedId();
        if (!activeId) return;

        if (e.key === "Delete" || e.key === "Backspace") {
            props.onRemove(activeId);
            setSelectedId(null);
            return;
        }

        const activeLine = props.state().lines.find(l => l.id === activeId);
        if (!activeLine) return;

        const isV = activeLine.type === "vertical";
        let step = 1;
        if (e.shiftKey) step = 10;
        else if (e.altKey) step = 0.1;

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
            const max = isV ? vp.width : vp.height;
            const newPos = Math.max(0, Math.min(activeLine.position + delta, max));
            props.onUpdate(activeId, newPos);
        }
    };

    onMount(() => {
        window.addEventListener("keydown", handleKeyDown);
    });

    onCleanup(() => {
        window.removeEventListener("keydown", handleKeyDown);
    });

    const handleDoubleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const id = target.getAttribute("data-ruler-id");
        if (id) {
            props.onRemove(id);
            setSelectedId(null);
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

    return (
        <div
            class={`${PREFIX}ruler-layer`}
            style={{ "pointer-events": "none" }}
            onPointerDown={handlePointerDown}
            onDblClick={handleDoubleClick}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
        >
            <For each={props.state().lines}>
                {(line) => (
                    <RulerLineItem
                        line={line}
                        isDragging={draggingId() === line.id}
                        isHovered={hoveredId() === line.id}
                        isSelected={selectedId() === line.id}
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
            transform: `translate3d(${isV ? pos : 0}px, ${isV ? 0 : pos}px, 0) ${isActive ? (isV ? "scaleX(2)" : "scaleY(2)") : "scale(1)"}`,
            opacity: props.isSelected ? "1" : "0.8",
            filter: props.isSelected ? "drop-shadow(0 0 2px var(--caliper-primary))" : "none",
        };
    });

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
                    width: props.line.type === "vertical" ? "11px" : "100%",
                    height: props.line.type === "vertical" ? "100%" : "11px",
                    transform: `translate3d(${props.line.type === "vertical" ? props.line.position - 5 : 0}px, ${props.line.type === "vertical" ? 0 : props.line.position - 5}px, 0)`,
                    cursor: props.line.type === "vertical" ? "col-resize" : "row-resize",
                    "pointer-events": "auto",
                    "z-index": 1000001,
                }}
            />

            <div
                data-caliper-ignore
                class={`${PREFIX}ruler-line-visual`}
                style={{
                    position: "fixed",
                    "background-color": "var(--caliper-primary, rgba(24, 160, 251, 1))",
                    "z-index": 1000000,
                    ...lineStyle(),
                }}
            />

            <Show when={props.isDragging || props.isHovered || props.isSelected}>
                <div
                    data-caliper-ignore
                    class={`${PREFIX}label ${PREFIX}ruler-label`}
                    style={{
                        position: "fixed",
                        left: "0",
                        top: "0",
                        transform: `translate3d(${props.line.type === "vertical" ? props.line.position + 10 : 20}px, ${props.line.type === "vertical" ? 20 : props.line.position + 10}px, 0)`,
                        "z-index": 1000002,
                        opacity: props.isSelected && !props.isHovered && !props.isDragging ? "0.7" : "1",
                    }}
                >
                    {Math.round(props.line.position)}px
                </div>
            </Show>
        </>
    );
}
