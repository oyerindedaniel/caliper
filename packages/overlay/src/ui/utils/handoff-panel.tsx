import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import {
  getLiveGeometry,
  getOverlayRoot,
  resolveHandoffPanelPosition,
  type HandoffRegistry,
  type HandoffUIState,
} from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { createHandoffFocusTrap } from "../../handoff/create-handoff-focus-trap.js";
import { createMentionController } from "../../handoff/create-mention-controller.js";
import { PresenceHost } from "../../handoff/presence-host.jsx";
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
}

export function HandoffPanel(props: HandoffPanelProps) {
  let textareaRef: HTMLTextAreaElement | undefined;
  let panelRootRef: HTMLDivElement | undefined;
  let popoverRootRef: HTMLDivElement | undefined;
  const [textareaEl, setTextareaEl] = createSignal<HTMLTextAreaElement | undefined>();
  const [mentionTick, setMentionTick] = createSignal(0);
  const [expanded, setExpanded] = createSignal(false);
  const [panelLayoutHeight, setPanelLayoutHeight] = createSignal(0);
  const [mentionOpen, setMentionOpen] = createSignal(false);

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
    onNoteChange: (note) => props.handoffRegistry.setPendingNote(note),
    onHighlight: (agentId) => props.handoffRegistry.setHighlightedAgentId(agentId),
    onOpenChange: (open) => {
      setMentionOpen(open);
      props.onMentionOpenChange?.(open);
      setMentionTick((n) => n + 1);
    },
  });

  createHandoffFocusTrap({
    enabled: panelPresent,
    mentionOpen,
    panelRoot: () => panelRootRef,
    popoverRoot: () => popoverRootRef,
    textarea: textareaEl,
  });

  const panelStyle = createMemo((): Record<string, string | undefined> => {
    props.viewport().version;
    panelLayoutHeight();

    const item = activeItem();
    if (!item) {
      return { top: "0", left: "0", width: `${HANDOFF_PANEL_WIDTH}px` };
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
      return { top: "0", left: "0", width: `${HANDOFF_PANEL_WIDTH}px` };
    }

    const measured = panelLayoutHeight();
    const textarea = textareaRef;
    const panelHeight =
      measured > 0
        ? measured
        : textarea
          ? readHandoffNoteMetrics(textarea).minHeight
          : HANDOFF_NOTE_MAX_HEIGHT;

    const position = resolveHandoffPanelPosition({
      anchor: live,
      viewport: props.viewport(),
      panelWidth: HANDOFF_PANEL_WIDTH,
      panelHeight,
    });

    return {
      top: "0",
      left: "0",
      transform: `translate3d(${position.left}px, ${position.top}px, 0)`,
      width: `${position.maxWidth}px`,
    };
  });

  const syncExpanded = (textarea: HTMLTextAreaElement) => {
    const { minHeight } = readHandoffNoteMetrics(textarea);
    setExpanded(textarea.scrollHeight > minHeight + 1);
  };

  const resizeTextarea = () => {
    const textarea = textareaRef;
    if (!textarea) return;

    const { maxHeight } = readHandoffNoteMetrics(textarea);
    textarea.style.height = "auto";
    const cap = maxHeight > 0 ? maxHeight : textarea.scrollHeight;
    textarea.style.height = `${Math.min(textarea.scrollHeight, cap)}px`;
    textarea.style.overflowY =
      maxHeight > 0 && textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    syncExpanded(textarea);
    setPanelLayoutHeight(textarea.offsetHeight);
  };

  createEffect(() => {
    if (!panelPresent()) {
      setPanelLayoutHeight(0);
      return;
    }

    const textarea = textareaEl();
    if (!textarea) {
      return;
    }

    textarea.value = props.handoffRegistry.getPendingNote();
    resizeTextarea();
    queueMicrotask(() => textarea.focus());
  });

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
    mentionController.closeSession();
    resizeTextarea();
    textarea.focus();
  };

  onCleanup(() => {
    mentionController.closeSession();
  });

  return (
    <Portal mount={getOverlayRoot()}>
      <PresenceHost
        present={panelPresent}
        ref={panelRootRef}
        class={`${PREFIX}handoff-panel`}
        style={panelStyle}
        dataCaliperIgnore
      >
        <textarea
          ref={(node) => {
            textareaRef = node;
            setTextareaEl(node);
          }}
          class={`${PREFIX}handoff-textarea`}
          rows={1}
          placeholder="Note · @ to tag"
          data-expanded={expanded() ? "true" : undefined}
          aria-controls={mentionOpen() ? `${PREFIX}handoff-mention-list` : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant()}
          onInput={(event) => {
            props.handoffRegistry.setPendingNote(event.currentTarget.value);
            mentionController.handleInput(event.currentTarget);
            resizeTextarea();
          }}
          onKeyDown={(event) => {
            if (mentionController.handleKeyDown(event.currentTarget, event)) {
              resizeTextarea();
            }
          }}
        />
        <HandoffMentionPopover
          ref={popoverRootRef}
          controller={mentionController}
          mentionTick={mentionTick}
          highlightedAgentId={() => props.handoffState()?.highlightedAgentId ?? null}
          viewport={() => ({
            width: props.viewport().width,
            height: props.viewport().height,
          })}
          textareaRef={textareaEl}
          onHighlight={(agentId) => mentionController.setHighlightByAgentId(agentId)}
          onSelect={handleSelectMention}
        />
      </PresenceHost>
    </Portal>
  );
}
