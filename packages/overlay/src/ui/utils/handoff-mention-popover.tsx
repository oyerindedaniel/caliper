import { For, Show, createEffect, createMemo, type Accessor, type Ref } from "solid-js";
import { Portal } from "solid-js/web";
import { getOverlayRoot, HANDOFF_PALETTE, handoffItemLabel } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import type { MentionController } from "../../handoff/create-mention-controller.js";
import { mergeRefs } from "../../handoff/assign-ref.js";
import { PresenceHost } from "../../handoff/presence-host.jsx";

const POPOVER_WIDTH = 280;
const POPOVER_MAX_HEIGHT = 200;
const POPOVER_ESTIMATED_HEIGHT = 160;

interface HandoffMentionPopoverProps {
  ref?: Ref<HTMLDivElement>;
  controller: MentionController;
  mentionTick: Accessor<number>;
  highlightedAgentId: Accessor<string | null>;
  viewport: Accessor<{
    width: number;
    height: number;
  }>;
  textareaRef: () => HTMLTextAreaElement | undefined;
  onHighlight: (agentId: string) => void;
  onSelect: (agentId: string) => void;
}

export function HandoffMentionPopover(props: HandoffMentionPopoverProps) {
  let listRef: HTMLDivElement | undefined;

  const filteredItems = createMemo(() => {
    props.mentionTick();
    return props.controller.getFilteredItems();
  });
  const session = createMemo(() => {
    props.mentionTick();
    return props.controller.getSession();
  });
  const popoverPresent = createMemo(() => session().open);

  const popoverStyle = createMemo((): Record<string, string | undefined> => {
    props.mentionTick();
    const textarea = props.textareaRef();
    if (!textarea) {
      return { visibility: "hidden", pointerEvents: "none" };
    }
    const anchor = props.controller.getCaretAnchorRect(textarea);
    if (!anchor) {
      return { visibility: "hidden", pointerEvents: "none" };
    }
    const position = props.controller.resolveMentionPopoverPosition(
      anchor,
      props.viewport(),
      POPOVER_WIDTH,
      POPOVER_ESTIMATED_HEIGHT
    );
    return {
      top: `${position.top}px`,
      left: `${position.left}px`,
      width: `${position.maxWidth}px`,
      maxHeight: `${POPOVER_MAX_HEIGHT}px`,
    };
  });

  createEffect(() => {
    const agentId = props.highlightedAgentId();
    if (!agentId || !listRef) {
      return;
    }
    const option = listRef.querySelector<HTMLElement>(
      `#${CSS.escape(`${PREFIX}handoff-mention-${agentId}`)}`
    );
    option?.scrollIntoView({ block: "nearest" });
  });

  return (
    <Portal mount={getOverlayRoot()}>
      <PresenceHost
        present={popoverPresent}
        ref={mergeRefs(props.ref, (element) => {
          listRef = element;
        })}
        id={`${PREFIX}handoff-mention-list`}
        class={`${PREFIX}handoff-mention-popover`}
        style={popoverStyle}
        role="listbox"
        ariaLabel="Mention handoff item"
        dataCaliperIgnore
      >
        <Show
          when={filteredItems().length > 0}
          fallback={
            <div class={`${PREFIX}handoff-mention-empty`} tabindex="0">
              No matching items
            </div>
          }
        >
          <For each={filteredItems()}>
            {(item) => (
              <button
                type="button"
                id={`${PREFIX}handoff-mention-${item.agentId}`}
                class={`${PREFIX}handoff-mention-option ${props.highlightedAgentId() === item.agentId ? `${PREFIX}handoff-mention-option-active` : ""}`}
                role="option"
                aria-selected={props.highlightedAgentId() === item.agentId}
                onMouseEnter={() => props.onHighlight(item.agentId)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  props.onSelect(item.agentId);
                }}
                onFocus={() => props.onHighlight(item.agentId)}
              >
                <span
                  class={`${PREFIX}handoff-mention-swatch`}
                  style={{
                    "background-color": HANDOFF_PALETTE[item.colorIndex % HANDOFF_PALETTE.length],
                  }}
                  aria-hidden="true"
                />
                <span class={`${PREFIX}handoff-mention-label`}>
                  {handoffItemLabel(item.fingerprint)}
                </span>
                <span class={`${PREFIX}handoff-mention-id`}>{item.agentId}</span>
              </button>
            )}
          </For>
        </Show>
      </PresenceHost>
    </Portal>
  );
}
