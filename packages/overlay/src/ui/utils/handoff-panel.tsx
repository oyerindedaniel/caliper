import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import {
  getLiveGeometry,
  getOverlayRoot,
  HANDOFF_PALETTE,
  resolveHandoffPanelPosition,
  type HandoffRegistry,
  type HandoffUIState,
} from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { createCssAnimationPulse } from "../../handoff/create-css-animation-pulse.js";
import { createHandoffFocusTrap } from "../../handoff/create-handoff-focus-trap.js";
import { createMentionController } from "../../handoff/create-mention-controller.js";
import { flattenHandoffNoteLog } from "../../handoff/handoff-note-debug.js";
import { type HandoffNoteEditor } from "../../handoff/note-editor/create-handoff-note-editor.js";
import { HandoffNoteEditor as HandoffNoteEditorView } from "../../handoff/note-editor/handoff-note-editor.jsx";
import { PresenceHost } from "../../handoff/presence-host.jsx";
import { HandoffMentionPopover } from "./handoff-mention-popover.jsx";

const HANDOFF_PANEL_WIDTH = 320;
const HANDOFF_NOTE_MAX_HEIGHT = 120;

function readHandoffNoteMetrics(root: HTMLElement) {
  const style = getComputedStyle(root);
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
  let panelRootRef: HTMLDivElement | undefined;
  let popoverRootRef: HTMLDivElement | undefined;
  const [editor, setEditor] = createSignal<HandoffNoteEditor | undefined>();
  const [mentionListTick, setMentionListTick] = createSignal(0);
  const [mentionAnchorTick, setMentionAnchorTick] = createSignal(0);
  const [expanded, setExpanded] = createSignal(false);
  const [panelLayoutHeight, setPanelLayoutHeight] = createSignal(0);
  const [mentionOpen, setMentionOpen] = createSignal(false);
  const [noteRevision, setNoteRevision] = createSignal(0);
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

  const syncExpanded = (root: HTMLElement) => {
    const { minHeight } = readHandoffNoteMetrics(root);
    setExpanded(root.scrollHeight > minHeight + 1);
  };

  const syncPanelLayoutHeight = () => {
    const root = editor()?.getRoot();
    if (!root) {
      return;
    }
    syncExpanded(root);
    const nextHeight = root.offsetHeight;
    const heightChanged = nextHeight !== panelLayoutHeight();
    setPanelLayoutHeight(nextHeight);
    if (heightChanged && mentionOpen()) {
      setMentionAnchorTick((tick) => tick + 1);
    }
  };

  const handleEditorInput = () => {
    const currentEditor = editor();
    if (!currentEditor || currentEditor.isComposing()) {
      return;
    }
    const wire = currentEditor.getWire();
    props.handoffRegistry.setPendingNote(wire);
    setNoteRevision((revision) => revision + 1);
    mentionController.handleInput(currentEditor);
    if (mentionController.isOpen()) {
      setMentionListTick((tick) => tick + 1);
    }
    syncPanelLayoutHeight();
  };

  createEffect(
    on(
      () => [panelPresent(), editor()] as const,
      ([present, currentEditor]) => {
        if (!present || !currentEditor) {
          return;
        }
        const pending = props.handoffRegistry.getPendingNote();
        if (currentEditor.getWire() !== pending) {
          currentEditor.setDocFromWire(pending, currentEditor.getCursor());
        }
        queueMicrotask(() => {
          currentEditor.focus();
          syncPanelLayoutHeight();
        });
      }
    )
  );

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

  createHandoffFocusTrap({
    enabled: panelPresent,
    mentionOpen,
    panelRoot: () => panelRootRef,
    popoverRoot: () => popoverRootRef,
    editorRoot: () => editor()?.getRoot(),
    mentionListKeyboard: {
      mentionOpen,
      isSessionOpen: () => mentionController.isOpen(),
      editorRoot: () => editor()?.getRoot(),
      popoverRoot: () => popoverRootRef,
      highlightedAgentId: () => props.handoffState()?.highlightedAgentId ?? null,
      optionIdPrefix: `${PREFIX}handoff-mention-`,
      handleKeyDown: (event) => {
        const currentEditor = editor();
        return currentEditor ? mentionController.handleKeyDown(currentEditor, event) : false;
      },
      onHandled: () => {
        syncPanelLayoutHeight();
      },
    },
  });

  const activeDescendant = createMemo(() => {
    if (!mentionOpen()) {
      return undefined;
    }
    const agentId = props.handoffState()?.highlightedAgentId;
    return agentId ? `${PREFIX}handoff-mention-${agentId}` : undefined;
  });

  const handleSelectMention = (agentId: string) => {
    const currentEditor = editor();
    if (!currentEditor) {
      return;
    }
    const session = mentionController.getSession();
    flattenHandoffNoteLog("panel.selectMention", {
      agentId,
      wire: currentEditor.getWire(),
      session,
      cursor: currentEditor.getCursor(),
    });
    if (!mentionController.commitMention(currentEditor, agentId)) {
      return;
    }
    props.handoffRegistry.setPendingNote(currentEditor.getWire());
    setNoteRevision((revision) => revision + 1);
    currentEditor.focus();
    syncPanelLayoutHeight();
  };

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
    const editorRoot = editor()?.getRoot();
    const panelHeight =
      measured > 0
        ? measured
        : editorRoot
          ? readHandoffNoteMetrics(editorRoot).minHeight
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
          <HandoffNoteEditorView
            wire={pendingNote}
            colorByAgentId={colorByAgentId}
            highlightedAgentId={() => props.handoffState()?.highlightedAgentId ?? null}
            onWireChange={(wire) => {
              props.handoffRegistry.setPendingNote(wire);
              setNoteRevision((revision) => revision + 1);
              handleEditorInput();
            }}
            onResize={syncPanelLayoutHeight}
            onEditorReady={setEditor}
            onKeyDown={(event, currentEditor) => {
              if (mentionController.handleKeyDown(currentEditor, event)) {
                syncPanelLayoutHeight();
              }
            }}
            onMentionPress={(agentId) => props.handoffRegistry.setHighlightedAgentId(agentId)}
            ariaControls={() => (mentionOpen() ? `${PREFIX}handoff-mention-list` : undefined)}
            ariaActiveDescendant={activeDescendant}
            placeholder="Note · @ to tag"
          />
        </div>
        <HandoffMentionPopover
          ref={popoverRootRef}
          controller={mentionController}
          mentionOpen={mentionOpen}
          mentionListTick={mentionListTick}
          mentionAnchorTick={mentionAnchorTick}
          highlightedAgentId={() => props.handoffState()?.highlightedAgentId ?? null}
          viewport={props.viewport}
          editorHost={() => editor()}
          onHighlight={(agentId) => mentionController.setHighlightByAgentId(agentId)}
          onSelect={handleSelectMention}
        />
      </PresenceHost>
    </Portal>
  );
}
