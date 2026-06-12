import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Accessor,
  type Ref,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  getOverlayRoot,
  HANDOFF_PALETTE,
  handoffItemLabel,
  type HandoffRegistryItem,
} from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import type { MentionController } from "../../handoff/create-mention-controller.js";
import { mergeRefs } from "../../handoff/assign-ref.js";
import type { HandoffNoteEditorHost } from "../../handoff/note-editor/create-handoff-note-editor.js";
import { PresenceHost, type PresencePlacementSide } from "../../handoff/presence-host.jsx";
import { HandoffMentionPill } from "./handoff-mention-pill.jsx";

const POPOVER_WIDTH = 280;
const POPOVER_MAX_HEIGHT = 200;
const POPOVER_EMPTY_HEIGHT = 36;
const POPOVER_ROW_HEIGHT = 44;

interface HandoffMentionPopoverProps {
  ref?: Ref<HTMLDivElement>;
  controller: MentionController;
  mentionOpen: Accessor<boolean>;
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
  editorHost: () => HandoffNoteEditorHost | undefined;
  onHighlight: (agentId: string) => void;
  onSelect: (agentId: string) => void;
}

type PopoverChrome = {
  pinStyle: Record<string, string>;
  side: PresencePlacementSide;
};

const DEFAULT_POPOVER_SIDE: PresencePlacementSide = "bottom";

export function HandoffMentionPopover(props: HandoffMentionPopoverProps) {
  let listRef: HTMLDivElement | undefined;
  let lastChrome: PopoverChrome | undefined;
  const [displayItems, setDisplayItems] = createSignal<HandoffRegistryItem[]>([]);

  const filteredItems = createMemo(() => {
    props.mentionListTick();
    return props.controller.getFilteredItems();
  });
  const showEmptyFallback = createMemo(() => {
    props.mentionListTick();
    const session = props.controller.getSession();
    return props.mentionOpen() && session.open && filteredItems().length === 0;
  });
  const popoverPresent = () => props.mentionOpen();

  // Live while open; on close the effect stops updating so the signal keeps the last frame.
  createEffect(() => {
    if (!props.mentionOpen()) {
      return;
    }
    setDisplayItems(filteredItems());
  });

  const steadyUnpositioned = (): Record<string, string> => ({
    visibility: "hidden",
    pointerEvents: "none",
    width: `${POPOVER_WIDTH}px`,
    maxHeight: `${POPOVER_MAX_HEIGHT}px`,
  });

  const resolvePopoverHeight = (itemCount: number) => {
    if (itemCount === 0) {
      return POPOVER_EMPTY_HEIGHT;
    }
    return Math.min(POPOVER_MAX_HEIGHT, itemCount * POPOVER_ROW_HEIGHT + 8);
  };

  const popoverChrome = createMemo((): PopoverChrome => {
    props.mentionAnchorTick();

    if (!props.mentionOpen()) {
      return (
        lastChrome ?? {
          pinStyle: { width: `${POPOVER_WIDTH}px`, maxHeight: `${POPOVER_MAX_HEIGHT}px` },
          side: DEFAULT_POPOVER_SIDE,
        }
      );
    }

    const activeSession = props.controller.getSession();

    if (!activeSession.open) {
      if (lastChrome) {
        return lastChrome;
      }
      return {
        pinStyle: { width: `${POPOVER_WIDTH}px`, maxHeight: `${POPOVER_MAX_HEIGHT}px` },
        side: DEFAULT_POPOVER_SIDE,
      };
    }

    const editorHost = props.editorHost();
    if (!editorHost || !activeSession.queryStart) {
      if (lastChrome) {
        return lastChrome;
      }
      return {
        pinStyle: steadyUnpositioned(),
        side: DEFAULT_POPOVER_SIDE,
      };
    }

    const anchorOffset = editorHost.getCursor();
    const rect = editorHost.getAnchorRectAtOffset(anchorOffset);
    if (!rect) {
      if (lastChrome) {
        return lastChrome;
      }
      return {
        pinStyle: steadyUnpositioned(),
        side: DEFAULT_POPOVER_SIDE,
      };
    }

    const anchor = {
      top: rect.top,
      left: rect.left,
      height: rect.height,
    };

    const viewport = props.viewport();
    const itemCount = filteredItems().length;
    const popoverHeight = resolvePopoverHeight(itemCount);
    const position = props.controller.resolveMentionPopoverPosition(
      anchor,
      viewport,
      POPOVER_WIDTH,
      popoverHeight
    );
    lastChrome = {
      pinStyle: {
        translate: `${position.left}px ${position.top}px 0`,
        width: `${position.maxWidth}px`,
        maxHeight: `${POPOVER_MAX_HEIGHT}px`,
      },
      side: position.side,
    };
    return lastChrome;
  });

  const popoverStyle = createMemo(() => popoverChrome().pinStyle);
  const popoverSide = createMemo(() => popoverChrome().side);

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
          lastChrome = undefined;
          setDisplayItems([]);
        }}
        dataSide={popoverSide}
        dataAlign={() => "start"}
        ref={mergeRefs(props.ref, (element) => {
          listRef = element;
        })}
        id={`${PREFIX}handoff-mention-list`}
        class={`${PREFIX}handoff-presence ${PREFIX}handoff-mention-popover`}
        style={popoverStyle}
        role="listbox"
        ariaLabel="Mention handoff item"
        dataCaliperIgnore
      >
        <Show
          when={displayItems().length > 0}
          fallback={
            <Show when={showEmptyFallback()}>
              <div class={`${PREFIX}handoff-mention-empty`} tabindex="0">
                No matching items
              </div>
            </Show>
          }
        >
          <For each={displayItems()}>
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
                  }}
                  onClick={() => props.onSelect(item.agentId)}
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
