import { For, Show, createMemo } from "solid-js";
import { Portal } from "solid-js/web";
import {
  getLiveGeometry,
  getOverlayRoot,
  HANDOFF_PALETTE,
  type HandoffRegistry,
  type HandoffUIState,
} from "@caliper/core";
import type { Accessor } from "solid-js";
import { PREFIX } from "../../css/styles.js";

interface HandoffBoxesProps {
  handoffRegistry: HandoffRegistry;
  handoffState: Accessor<HandoffUIState | null>;
  viewport: {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  };
}

export function HandoffBoxes(props: HandoffBoxesProps) {
  const items = createMemo(() => {
    props.handoffState();
    props.viewport.version;
    return props.handoffRegistry.getItems();
  });

  const visible = createMemo(() => (props.handoffState()?.presentation ?? "hidden") === "visible");
  const highlightedAgentId = createMemo(() => props.handoffState()?.highlightedAgentId ?? null);
  const isSingle = createMemo(() => items().length === 1);

  return (
    <Show when={visible() && items().length > 0}>
      <Portal mount={getOverlayRoot()}>
        <For each={items()}>
          {(item) => {
            const boxStyle = createMemo(() => {
              props.viewport.version;
              const live = getLiveGeometry(
                item.metadata.rect,
                item.metadata.scrollHierarchy,
                item.metadata.position,
                item.metadata.stickyConfig,
                item.metadata.initialWindowX,
                item.metadata.initialWindowY,
                item.metadata.hasContainingBlock
              );
              if (!live || live.isHidden) {
                return { display: "none" };
              }

              return {
                top: "0",
                left: "0",
                transform: `translate3d(${live.left - props.viewport.scrollX}px, ${live.top - props.viewport.scrollY}px, 0)`,
                width: `${live.width}px`,
                height: `${live.height}px`,
                "--caliper-handoff-item-color":
                  HANDOFF_PALETTE[item.colorIndex % HANDOFF_PALETTE.length],
              };
            });

            const innerClass = createMemo(() => {
              const classes = [`${PREFIX}handoff-box-inner`];
              if (highlightedAgentId() === item.agentId) {
                classes.push(`${PREFIX}handoff-box-highlighted`);
              } else if (isSingle()) {
                classes.push(`${PREFIX}handoff-box-single`);
              }
              return classes.join(" ");
            });

            return (
              <div
                class={`${PREFIX}handoff-box ${PREFIX}handoff-box-color-${item.colorIndex % HANDOFF_PALETTE.length}`}
                style={boxStyle()}
              >
                <div class={innerClass()} />
              </div>
            );
          }}
        </For>
      </Portal>
    </Show>
  );
}
