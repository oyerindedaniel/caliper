import { For, Show, createEffect, createMemo, type Accessor, type Ref } from "solid-js";
import { Portal } from "solid-js/web";
import { getOverlayRoot, HANDOFF_PALETTE, handoffItemLabel } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import type { MentionController } from "../../handoff/create-mention-controller.js";
import { mergeRefs } from "../../handoff/assign-ref.js";
import { measureNoteCursor } from "../../handoff/measure-handoff-note-cursor.js";
import { PresenceHost } from "../../handoff/presence-host.jsx";
import { HandoffMentionPill } from "./handoff-mention-pill.jsx";

const POPOVER_WIDTH = 280;
const POPOVER_MAX_HEIGHT = 200;
const POPOVER_ESTIMATED_HEIGHT = 160;

interface HandoffMentionPopoverProps {
  ref?: Ref<HTMLDivElement>;
  controller: MentionController;
  /** Bumps when the @ filter query or session membership changes (list content). */
  mentionListTick: Accessor<number>;
  /** Bumps when popover anchor geometry should remeasure (open, scroll, layout, viewport). */
  mentionAnchorTick: Accessor<number>;
  highlightedAgentId: Accessor<string | null>;
  viewport: Accessor<{
    width: number;
    height: number;
    version: number;
  }>;
  textareaRef: () => HTMLTextAreaElement | undefined;
  colorByAgentId: Accessor<Map<string, string>>;
  onHighlight: (agentId: string) => void;
  onSelect: (agentId: string) => void;
}

export function HandoffMentionPopover(props: HandoffMentionPopoverProps) {
  let listRef: HTMLDivElement | undefined;
  let lastPosition: Record<string, string> | undefined;

  const filteredItems = createMemo(() => {
    props.mentionListTick();
    return props.controller.getFilteredItems();
  });
  const session = createMemo(() => {
    props.mentionListTick();
    return props.controller.getSession();
  });
  const popoverPresent = createMemo(() => session().open);

  const steadyUnpositioned = (): Record<string, string> => ({
    visibility: "hidden",
    pointerEvents: "none",
    width: `${POPOVER_WIDTH}px`,
    maxHeight: `${POPOVER_MAX_HEIGHT}px`,
  });

  const popoverStyle = createMemo((): Record<string, string | undefined> => {
    props.mentionAnchorTick();

    const activeSession = props.controller.getSession();
    if (!activeSession.open) {
      return lastPosition ?? {};
    }

    const textarea = props.textareaRef();
    if (!textarea || activeSession.queryStart < 0) {
      return { ...lastPosition, ...steadyUnpositioned() };
    }

    const anchor = measureNoteCursor(textarea, {
      note: textarea.value,
      colorByAgentId: props.colorByAgentId(),
      selectionStart: activeSession.queryStart,
      space: "viewport",
    });
    if (!anchor) {
      return { ...lastPosition, ...steadyUnpositioned() };
    }

    const position = props.controller.resolveMentionPopoverPosition(
      anchor,
      props.viewport(),
      POPOVER_WIDTH,
      POPOVER_ESTIMATED_HEIGHT
    );
    lastPosition = {
      top: `${position.top}px`,
      left: `${position.left}px`,
      width: `${position.maxWidth}px`,
      maxHeight: `${POPOVER_MAX_HEIGHT}px`,
    };
    return lastPosition;
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
        onExitComplete={() => {
          lastPosition = undefined;
        }}
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
            {(item) => {
              const pillColor =
                HANDOFF_PALETTE[item.colorIndex % HANDOFF_PALETTE.length] ?? HANDOFF_PALETTE[0]!;
              const isHighlighted = () => props.highlightedAgentId() === item.agentId;

              return (
                <button
                  type="button"
                  id={`${PREFIX}handoff-mention-${item.agentId}`}
                  class={`${PREFIX}handoff-mention-option ${isHighlighted() ? `${PREFIX}handoff-mention-option-active` : ""}`}
                  role="option"
                  aria-selected={isHighlighted()}
                  onMouseEnter={() => props.onHighlight(item.agentId)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    props.onSelect(item.agentId);
                  }}
                  onFocus={() => props.onHighlight(item.agentId)}
                >
                  <span class={`${PREFIX}handoff-mention-label`}>
                    {handoffItemLabel(item.fingerprint)}
                  </span>
                  <HandoffMentionPill
                    agentId={item.agentId}
                    color={pillColor}
                    highlighted={isHighlighted()}
                    onPress={(agentId) => props.onHighlight(agentId)}
                  />
                </button>
              );
            }}
          </For>
        </Show>
      </PresenceHost>
    </Portal>
  );
}
