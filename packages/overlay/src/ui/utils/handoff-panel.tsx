import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Accessor,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  getLiveGeometry,
  getOverlayRoot,
  HANDOFF_PALETTE,
  parseHandoffNoteSegments,
  resolveHandoffNoteAtomicEdit,
  resolveHandoffPanelPosition,
  type HandoffRegistry,
  type HandoffUIState,
} from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { createCssAnimationPulse } from "../../handoff/create-css-animation-pulse.js";
import { createHandoffFocusTrap } from "../../handoff/create-handoff-focus-trap.js";
import { createMentionController } from "../../handoff/create-mention-controller.js";
import {
  measureNoteCursor,
  resolveNoteCursorFromPoint,
  snapNoteCursorOutOfMentionInterior,
  type NoteCursorRect,
} from "../../handoff/measure-handoff-note-cursor.js";
import { PresenceHost } from "../../handoff/presence-host.jsx";
import { HandoffMentionPill } from "./handoff-mention-pill.jsx";
import { HandoffMentionPopover } from "./handoff-mention-popover.jsx";

/** Matches `.handoff-textarea` in styles.ts */
const HANDOFF_PANEL_WIDTH = 320;
const HANDOFF_NOTE_MAX_HEIGHT = 120;

function readHandoffNoteMetrics(textarea: HTMLTextAreaElement) {
  const style = getComputedStyle(textarea);
  return {
    minHeight: parseFloat(style.minHeight) || 0,
    maxHeight: parseFloat(style.maxHeight) || 0,
  };
}

type PanelPinStyle = Record<string, string | undefined>;

type PanelPlacement = {
  side: "top" | "bottom";
  align: "start" | "center";
};

type PanelChrome = {
  pinStyle: PanelPinStyle;
  placement: PanelPlacement;
};

const DEFAULT_PANEL_PLACEMENT: PanelPlacement = { side: "bottom", align: "start" };

function resolvePanelPlacement(
  anchor: NonNullable<ReturnType<typeof getLiveGeometry>>,
  position: { left: number; top: number },
  viewport: { scrollX: number; scrollY: number; width: number; height: number },
  margin = 10
): PanelPlacement {
  const viewportMargin = 16;
  const windowTop = anchor.top - viewport.scrollY;
  const windowBottom = windowTop + anchor.height;
  const belowTop = windowBottom + margin;
  const placedAbove = position.top < belowTop - 1;

  const visibleLeft = Math.max(anchor.visibleMinX - viewport.scrollX, viewportMargin);
  const visibleRight = Math.min(
    anchor.visibleMaxX - viewport.scrollX,
    viewport.width - viewportMargin
  );

  return {
    side: placedAbove ? "top" : "bottom",
    align: visibleRight > visibleLeft ? "center" : "start",
  };
}

interface HandoffPanelProps {
  handoffRegistry: HandoffRegistry;
  handoffState: Accessor<HandoffUIState | null>;
  viewport: Accessor<{
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    version: number;
  }>;
  onMentionOpenChange?: (open: boolean) => void;
  submitShakeTick?: Accessor<number>;
}

export function HandoffPanel(props: HandoffPanelProps) {
  let textareaRef: HTMLTextAreaElement | undefined;
  let panelRootRef: HTMLDivElement | undefined;
  let popoverRootRef: HTMLDivElement | undefined;
  const [textareaEl, setTextareaEl] = createSignal<HTMLTextAreaElement | undefined>();
  const [mentionListTick, setMentionListTick] = createSignal(0);
  const [mentionAnchorTick, setMentionAnchorTick] = createSignal(0);
  const [expanded, setExpanded] = createSignal(false);
  const [panelLayoutHeight, setPanelLayoutHeight] = createSignal(0);
  const [mentionOpen, setMentionOpen] = createSignal(false);
  const [noteRevision, setNoteRevision] = createSignal(0);
  const [caretRect, setCaretRect] = createSignal<NoteCursorRect | null>(null);
  const [caretVisible, setCaretVisible] = createSignal(false);
  let mirrorRef: HTMLDivElement | undefined;
  let lastPanelChrome: PanelChrome | undefined;

  const pendingNote = () => {
    noteRevision();
    return props.handoffRegistry.getPendingNote();
  };

  const activeItem = createMemo(() => {
    props.handoffState();
    return props.handoffRegistry.getActiveItem();
  });
  const panelPresent = createMemo(() => {
    const state = props.handoffState();
    return !!(state?.inputOpen && activeItem());
  });

  const mentionController = createMentionController({
    getItems: () => {
      props.handoffState();
      return props.handoffRegistry.getItems();
    },
    onNoteChange: (note) => {
      props.handoffRegistry.setPendingNote(note);
      setNoteRevision((revision) => revision + 1);
    },
    onHighlight: (agentId) => props.handoffRegistry.setHighlightedAgentId(agentId),
    onOpenChange: (open) => {
      setMentionOpen(open);
      props.onMentionOpenChange?.(open);
      setMentionListTick((tick) => tick + 1);
      if (open) {
        setMentionAnchorTick((tick) => tick + 1);
      }
    },
  });

  createEffect(
    on(
      () => props.viewport().version,
      () => {
        if (mentionOpen()) {
          setMentionAnchorTick((tick) => tick + 1);
        }
      }
    )
  );

  const submitShakePulse = createCssAnimationPulse();
  let lastBumpedShakeTick = 0;

  createEffect(
    on(
      () => {
        panelPresent();
        if (!panelPresent() || !props.submitShakeTick) {
          return null;
        }
        return props.submitShakeTick();
      },
      (tick) => {
        if (!panelPresent()) {
          submitShakePulse.dispose();
          const currentTick = props.submitShakeTick?.();
          if (currentTick !== undefined && currentTick > 0) {
            lastBumpedShakeTick = currentTick;
          }
          return;
        }
        if (tick === null || tick <= 0 || tick <= lastBumpedShakeTick) {
          return;
        }
        lastBumpedShakeTick = tick;
        submitShakePulse.bump(tick);
      }
    )
  );

  onCleanup(() => submitShakePulse.dispose());

  const panelChrome = createMemo((): PanelChrome => {
    props.viewport().version;
    if (!panelPresent()) {
      return (
        lastPanelChrome ?? {
          pinStyle: { width: `${HANDOFF_PANEL_WIDTH}px` },
          placement: DEFAULT_PANEL_PLACEMENT,
        }
      );
    }

    panelLayoutHeight();

    const item = activeItem();
    if (!item) {
      return (
        lastPanelChrome ?? {
          pinStyle: { width: `${HANDOFF_PANEL_WIDTH}px` },
          placement: DEFAULT_PANEL_PLACEMENT,
        }
      );
    }

    const live = getLiveGeometry(
      item.metadata.rect,
      item.metadata.scrollHierarchy,
      item.metadata.position,
      item.metadata.stickyConfig,
      item.metadata.initialWindowX,
      item.metadata.initialWindowY,
      item.metadata.hasContainingBlock
    );
    if (!live) {
      return (
        lastPanelChrome ?? {
          pinStyle: { width: `${HANDOFF_PANEL_WIDTH}px` },
          placement: DEFAULT_PANEL_PLACEMENT,
        }
      );
    }

    const measured = panelLayoutHeight();
    const textarea = textareaRef;
    const panelHeight =
      measured > 0
        ? measured
        : textarea
          ? readHandoffNoteMetrics(textarea).minHeight
          : HANDOFF_NOTE_MAX_HEIGHT;

    const viewport = props.viewport();
    const position = resolveHandoffPanelPosition({
      anchor: live,
      viewport,
      panelWidth: HANDOFF_PANEL_WIDTH,
      panelHeight,
    });

    lastPanelChrome = {
      pinStyle: {
        translate: `${position.left}px ${position.top}px 0`,
        width: `${position.maxWidth}px`,
      },
      placement: resolvePanelPlacement(live, position, viewport),
    };
    return lastPanelChrome;
  });

  const panelStyle = createMemo(() => panelChrome().pinStyle);
  const panelSide = createMemo(() => panelChrome().placement.side);
  const panelAlign = createMemo(() => panelChrome().placement.align);

  const syncExpanded = (textarea: HTMLTextAreaElement, contentHeight = textarea.scrollHeight) => {
    const { minHeight } = readHandoffNoteMetrics(textarea);
    setExpanded(contentHeight > minHeight + 1);
  };

  const resizeTextarea = () => {
    const textarea = textareaRef;
    if (!textarea) return;

    const { maxHeight } = readHandoffNoteMetrics(textarea);
    textarea.style.height = "auto";
    const textareaHeight = textarea.scrollHeight;
    const mirrorHeight = mirrorRef?.scrollHeight ?? 0;
    const contentHeight = Math.max(textareaHeight, mirrorHeight);
    const cap = maxHeight > 0 ? maxHeight : contentHeight;
    textarea.style.height = `${Math.min(contentHeight, cap)}px`;
    textarea.style.overflowY = maxHeight > 0 && contentHeight > maxHeight ? "auto" : "hidden";
    syncExpanded(textarea, contentHeight);
    const nextHeight = textarea.offsetHeight;
    const heightChanged = nextHeight !== panelLayoutHeight();
    setPanelLayoutHeight(nextHeight);
    syncMirrorScroll();
    if (heightChanged && mentionOpen()) {
      setMentionAnchorTick((tick) => tick + 1);
    }
  };

  createEffect(
    on(
      () => [panelPresent(), textareaEl()] as const,
      ([present, textarea]) => {
        if (!present) {
          setCaretVisible(false);
          return;
        }

        if (!textarea) {
          return;
        }

        const pending = props.handoffRegistry.getPendingNote();
        if (textarea.value !== pending) {
          textarea.value = pending;
          setNoteRevision((revision) => revision + 1);
        }
        resizeTextarea();
        queueMicrotask(() => {
          textarea.focus();
          syncCaret();
        });
      }
    )
  );

  createEffect(() => {
    noteSegments();
    if (document.activeElement === textareaRef) {
      syncCaret();
    }
  });

  createEffect(() => {
    const textarea = textareaEl();
    if (!textarea) {
      return;
    }

    const onSelectionChange = () => syncCaret();
    document.addEventListener("selectionchange", onSelectionChange);
    onCleanup(() => document.removeEventListener("selectionchange", onSelectionChange));
  });

  const noteSegments = createMemo(() => parseHandoffNoteSegments(pendingNote()));

  const colorByAgentId = createMemo(() => {
    props.handoffState();
    const map = new Map<string, string>();
    for (const item of props.handoffRegistry.getItems()) {
      map.set(
        item.agentId,
        HANDOFF_PALETTE[item.colorIndex % HANDOFF_PALETTE.length] ?? HANDOFF_PALETTE[0]!
      );
    }
    return map;
  });

  const syncMirrorScroll = () => {
    const textarea = textareaRef;
    const mirror = mirrorRef;
    if (!textarea || !mirror) {
      return;
    }
    mirror.scrollTop = textarea.scrollTop;
  };

  const ensureNoteCursorNotInsideMention = (textarea: HTMLTextAreaElement): boolean => {
    const cursor = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? cursor;
    if (cursor !== end) {
      return false;
    }
    const snapped = snapNoteCursorOutOfMentionInterior(textarea.value, cursor);
    if (snapped === cursor) {
      return false;
    }
    textarea.setSelectionRange(snapped, snapped);
    return true;
  };

  const placeCaretFromPointer = (
    textarea: HTMLTextAreaElement,
    clientX: number,
    clientY: number
  ) => {
    const resolved = resolveNoteCursorFromPoint(textarea, clientX, clientY, {
      note: textarea.value,
      colorByAgentId: colorByAgentId(),
    });
    if (textarea.selectionStart !== resolved.index || textarea.selectionEnd !== resolved.index) {
      textarea.setSelectionRange(resolved.index, resolved.index);
    }
    syncCaret();
  };

  const syncCaret = () => {
    const textarea = textareaRef;
    if (!textarea) {
      setCaretVisible(false);
      return;
    }
    if (document.activeElement !== textarea) {
      setCaretVisible(false);
      return;
    }

    const rect = measureNoteCursor(textarea, {
      note: textarea.value,
      colorByAgentId: colorByAgentId(),
      space: "wrap",
    });
    setCaretRect(rect);
    setCaretVisible(!!rect);
  };

  const scheduleCaretSync = () => {
    queueMicrotask(() => syncCaret());
  };

  createHandoffFocusTrap({
    enabled: panelPresent,
    mentionOpen,
    panelRoot: () => panelRootRef,
    popoverRoot: () => popoverRootRef,
    textarea: textareaEl,
    mentionListKeyboard: {
      mentionOpen,
      isSessionOpen: () => mentionController.isOpen(),
      textarea: textareaEl,
      popoverRoot: () => popoverRootRef,
      highlightedAgentId: () => props.handoffState()?.highlightedAgentId ?? null,
      optionIdPrefix: `${PREFIX}handoff-mention-`,
      handleKeyDown: (textarea, event) => mentionController.handleKeyDown(textarea, event),
      onHandled: () => {
        resizeTextarea();
        scheduleCaretSync();
      },
    },
  });

  const handleAtomicMentionEdit = (
    textarea: HTMLTextAreaElement,
    event: KeyboardEvent
  ): boolean => {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return false;
    }

    const cursor = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? cursor;
    if (cursor !== end) {
      return false;
    }

    const edit =
      event.key === "Backspace"
        ? resolveHandoffNoteAtomicEdit(textarea.value, cursor, "backspace")
        : resolveHandoffNoteAtomicEdit(textarea.value, cursor, "delete");
    if (!edit) {
      return false;
    }

    event.preventDefault();
    textarea.value = edit.note;
    textarea.setSelectionRange(edit.cursor, edit.cursor);
    props.handoffRegistry.setPendingNote(edit.note);
    setNoteRevision((revision) => revision + 1);
    mentionController.handleInput(textarea);
    resizeTextarea();
    syncCaret();
    return true;
  };

  const activeDescendant = createMemo(() => {
    if (!mentionOpen()) {
      return undefined;
    }
    const agentId = props.handoffState()?.highlightedAgentId;
    return agentId ? `${PREFIX}handoff-mention-${agentId}` : undefined;
  });

  const handleSelectMention = (agentId: string) => {
    const textarea = textareaRef;
    if (!textarea) {
      return;
    }
    const session = mentionController.getSession();
    if (!session.open) {
      return;
    }
    const cursor = textarea.selectionStart ?? textarea.value.length;
    const before = textarea.value.slice(0, session.queryStart);
    const after = textarea.value.slice(cursor);
    const token = `@${agentId} `;
    const nextValue = `${before}${token}${after}`;
    const nextCursor = before.length + token.length;
    textarea.value = nextValue;
    textarea.setSelectionRange(nextCursor, nextCursor);
    props.handoffRegistry.setPendingNote(nextValue);
    setNoteRevision((revision) => revision + 1);
    mentionController.closeSession();
    resizeTextarea();
    textarea.focus();
    syncCaret();
  };

  onCleanup(() => {
    mentionController.closeSession();
  });

  return (
    <Portal mount={getOverlayRoot()}>
      <PresenceHost
        present={panelPresent}
        onExitComplete={() => {
          setPanelLayoutHeight(0);
          lastPanelChrome = undefined;
        }}
        ref={panelRootRef}
        class={`${PREFIX}handoff-presence ${PREFIX}handoff-panel`}
        style={panelStyle}
        dataSide={panelSide}
        dataAlign={panelAlign}
        dataCaliperIgnore
      >
        <div
          class={`${PREFIX}handoff-note-wrap`}
          data-expanded={expanded() ? "true" : undefined}
          data-shake={submitShakePulse.value()}
        >
          <textarea
            ref={(node) => {
              textareaRef = node;
              setTextareaEl(node);
            }}
            class={`${PREFIX}handoff-textarea ${PREFIX}handoff-textarea-overlay`}
            rows={1}
            placeholder="Note · @ to tag"
            aria-controls={mentionOpen() ? `${PREFIX}handoff-mention-list` : undefined}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendant()}
            onInput={(event) => {
              const textarea = event.currentTarget;
              props.handoffRegistry.setPendingNote(textarea.value);
              setNoteRevision((revision) => revision + 1);
              mentionController.handleInput(textarea);
              if (mentionController.isOpen()) {
                setMentionListTick((tick) => tick + 1);
              }
              resizeTextarea();
              syncCaret();
            }}
            onScroll={() => {
              syncMirrorScroll();
              syncCaret();
              if (mentionOpen()) {
                setMentionAnchorTick((tick) => tick + 1);
              }
            }}
            onSelect={() => {
              const textarea = textareaRef;
              if (textarea) {
                ensureNoteCursorNotInsideMention(textarea);
              }
              syncCaret();
            }}
            onMouseDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              event.preventDefault();
              const textarea = event.currentTarget;
              textarea.focus();
              placeCaretFromPointer(textarea, event.clientX, event.clientY);
            }}
            onFocus={() => {
              const textarea = textareaRef;
              if (textarea) {
                ensureNoteCursorNotInsideMention(textarea);
              }
              syncCaret();
            }}
            onBlur={() => setCaretVisible(false)}
            onKeyDown={(event) => {
              const textarea = event.currentTarget;
              if (handleAtomicMentionEdit(textarea, event)) {
                return;
              }
              if (mentionController.handleKeyDown(textarea, event)) {
                resizeTextarea();
              }
              scheduleCaretSync();
            }}
          />
          <div ref={mirrorRef} class={`${PREFIX}handoff-note-mirror`} aria-hidden="true">
            <For each={noteSegments()}>
              {(segment) =>
                segment.type === "mention" ? (
                  <HandoffMentionPill
                    agentId={segment.agentId}
                    color={colorByAgentId().get(segment.agentId) ?? HANDOFF_PALETTE[0]!}
                    highlighted={props.handoffState()?.highlightedAgentId === segment.agentId}
                    onPress={(agentId) => props.handoffRegistry.setHighlightedAgentId(agentId)}
                  />
                ) : (
                  <span>{segment.value}</span>
                )
              }
            </For>
          </div>
          <Show when={caretVisible() && caretRect()}>
            <div
              class={`${PREFIX}handoff-note-caret`}
              style={{
                top: `${caretRect()!.top}px`,
                left: `${caretRect()!.left}px`,
                height: `${caretRect()!.height}px`,
              }}
            />
          </Show>
        </div>
        <HandoffMentionPopover
          ref={popoverRootRef}
          controller={mentionController}
          mentionOpen={mentionOpen}
          mentionListTick={mentionListTick}
          mentionAnchorTick={mentionAnchorTick}
          highlightedAgentId={() => props.handoffState()?.highlightedAgentId ?? null}
          viewport={props.viewport}
          textareaRef={textareaEl}
          colorByAgentId={colorByAgentId}
          onHighlight={(agentId) => mentionController.setHighlightByAgentId(agentId)}
          onSelect={handleSelectMention}
        />
      </PresenceHost>
    </Portal>
  );
}
