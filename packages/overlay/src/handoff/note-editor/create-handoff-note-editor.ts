import {
  applyDocDelete,
  applyDocInsertText,
  applyDocLineBreak,
  cloneSelection,
  collapsedSelection,
  docEndPos,
  docPosEqual,
  docPosToWireOffset,
  docSelectionToWire,
  docToWire,
  docsEqual,
  expandSelectionFocusToDocEndIfNeeded,
  insertMentionAtSelection,
  isArrow,
  normalizeHandoffNoteDoc,
  normalizeDocPos,
  normalizeSelection,
  resolveDocHorizontalArrowMove,
  selectionsEqual,
  spliceDocSelection,
  wireOffsetToCollapsedSelection,
  wireToDoc,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
  listEmbeddedBlankBandProbeWires,
} from "@caliper/core";
import {
  parseHandoffNoteDomToDoc,
  renderHandoffNoteDoc,
  updateMentionPresentation,
  type RenderOutcome,
} from "./handoff-note-dom.js";
import { resolveSelectedMentionArrowExit } from "./handoff-note-mention-selection.js";
import {
  createHandoffNoteHistory,
  isRedoKeyboardEvent,
  isUndoKeyboardEvent,
  type HandoffNoteHistorySnapshot,
} from "./handoff-note-history.js";
import {
  buildCaretStateSnapshot,
  escapeWireForLog,
  logCaretBoundaryTrace,
  logEditStateTrace,
  logSelectionChangeFirstTouch,
} from "../handoff-note-debug.js";
import {
  describeSyncRepairBranch,
  readDocSelection,
  repairDocSelectionIfNeeded,
  resolveDomVerticalArrowMove,
  setDocSelection,
  type HandoffNoteClickIngress,
} from "./handoff-note-selection.js";
import { getDocAnchorRect } from "./handoff-note-dom-points.js";
import { invalidateHandoffNoteLayoutCache } from "./handoff-note-layout-map.js";

export type HandoffNoteEditorHost = {
  getWire(): string;
  getCursor(): number;
  getDoc(): HandoffNoteDoc;
  getSelectionState(): HandoffNoteSelection;
  insertMentionAtomAt(
    agentId: string,
    replaceStart: HandoffNoteDocPos,
    replaceEnd: HandoffNoteDocPos
  ): void;
  focus(): void;
  getAnchorRectAtOffset(offset: number): DOMRect | null;
};

export type HandoffNoteEditorOptions = {
  getColorByAgentId: () => Map<string, string>;
  isMentionPopoverOpen?: () => boolean;
  onWireChange: (wire: string) => void;
  onResize?: () => void;
};

export type HandoffNoteEditor = HandoffNoteEditorHost & {
  getRoot(): HTMLElement | undefined;
  setRoot(root: HTMLElement | undefined): void;
  setDocFromWire(wire: string, cursor?: number, options?: { resetHistory?: boolean }): void;
  getDoc(): HandoffNoteDoc;
  getSelectionState(): HandoffNoteSelection;
  applyDoc(doc: HandoffNoteDoc, selection: HandoffNoteSelection): void;
  insertDocText(text: string): void;
  getSelectionWire(): string;
  deleteSelection(): void;
  handleBeforeInput(event: InputEvent): void;
  handleInput(): void;
  handleKeyDown(event: KeyboardEvent): boolean;
  handleCompositionStart(): void;
  handleCompositionEnd(): void;
  isComposing(): boolean;
  resize(): void;
  refreshPresentation(): void;
  selectMentionNode(nodeIndex: number): void;
  clearMentionSelection(): void;
  getSelectedMentionNodeIndex(): number | null;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
};

function readHandoffNoteMetrics(root: HTMLElement) {
  const style = getComputedStyle(root);
  return {
    minHeight: parseFloat(style.minHeight) || 0,
    maxHeight: parseFloat(style.maxHeight) || 0,
  };
}

export function createHandoffNoteEditor(options: HandoffNoteEditorOptions): HandoffNoteEditor {
  let root: HTMLElement | undefined;
  let doc: HandoffNoteDoc = wireToDoc("");
  let selection: HandoffNoteSelection = collapsedSelection(docEndPos(doc));
  let composing = false;
  let suppressDomSelectionSync = false;
  let lastEmittedWire = "";
  let lastRenderOutcome: RenderOutcome = { domReplaced: true, docChanged: true };
  let selectedMentionNodeIndex: number | null = null;
  let verticalGoalColumn: number | null = null;
  let pendingClickIngress: HandoffNoteClickIngress | null = null;
  const history = createHandoffNoteHistory();

  const presentationOptions = () => ({
    colorByAgentId: options.getColorByAgentId(),
    selectedMentionNodeIndex,
  });

  const clearNativeSelection = () => {
    if (!root) {
      return;
    }
    const native = root.ownerDocument.getSelection();
    native?.removeAllRanges();
  };

  const refreshMentionPresentation = () => {
    if (!root) {
      return;
    }
    updateMentionPresentation(root, presentationOptions());
    lastRenderOutcome = { domReplaced: false, docChanged: false };
  };

  const reconcileSelectionFromDom = (source: "selectionchange" | "sync") => {
    if (!root) {
      return;
    }
    const priorFocus = selection.focus;
    const clickIngressPending = source === "selectionchange" ? pendingClickIngress : null;
    const useAuthorityRead =
      source === "sync" || (source === "selectionchange" && !clickIngressPending);
    const live = readDocSelection(root, doc, useAuthorityRead ? { from: priorFocus } : undefined);
    if (
      live.anchor.nodeIndex !== live.focus.nodeIndex ||
      live.anchor.nodeOffset !== live.focus.nodeOffset
    ) {
      selection = normalizeSelection(doc, live, { from: priorFocus });
      return;
    }
    const repairMode = source === "selectionchange" ? "strand-only" : "full";
    const clickIngress = source === "selectionchange" ? pendingClickIngress : null;
    const hadClickIngress = clickIngress !== null;
    if (clickIngress) {
      pendingClickIngress = null;
      verticalGoalColumn = null;
    }
    const priorWire = docPosToWireOffset(doc, priorFocus);
    const liveWireBeforeRepair = docPosToWireOffset(doc, live.focus);
    if (source === "selectionchange") {
      logSelectionChangeFirstTouch(root, doc, {
        priorWire,
        liveWire: liveWireBeforeRepair,
        liveFocus: live.focus,
        clickIngress,
      });
    }
    suppressDomSelectionSync = true;
    let focus: HandoffNoteDocPos;
    try {
      focus = repairDocSelectionIfNeeded(root, doc, priorFocus, {
        mode: repairMode,
        click: clickIngress ?? undefined,
      });
    } finally {
      queueMicrotask(() => {
        suppressDomSelectionSync = false;
      });
    }
    selection = collapsedSelection(focus);
    const liveWire = liveWireBeforeRepair;
    const resolvedWire = docPosToWireOffset(doc, focus);
    const wireMoved = priorWire !== liveWire || liveWire !== resolvedWire;
    if (source === "selectionchange" && wireMoved) {
      logEditStateTrace("selectionchange", {
        priorWire,
        liveWire,
        resolvedWire,
        repairMode,
        hadClickIngress,
        adopted: liveWire !== resolvedWire ? "repaired" : "accepted",
        jitterRisk:
          hadClickIngress && liveWire !== resolvedWire
            ? "click-repair-painted"
            : !hadClickIngress && priorWire !== liveWire && liveWire === resolvedWire
              ? "follow-up-accepted-live"
              : null,
        ...buildCaretStateSnapshot({
          doc,
          authorityFocus: priorFocus,
          activeFocus: live.focus,
          root,
        }),
      });
    } else if (source === "sync") {
      const { probeAliasEligible, repairBranch } = describeSyncRepairBranch(
        doc,
        priorFocus,
        live.focus,
        focus
      );
      const noopSync =
        priorWire === liveWire &&
        liveWire === resolvedWire &&
        repairBranch === "acceptedLive" &&
        !probeAliasEligible;
      if (!noopSync) {
        logEditStateTrace("reconcile>>sync", {
          priorWire,
          liveWire,
          resolvedWire,
          repairMode,
          probeAliasEligible,
          repairBranch,
          ...buildCaretStateSnapshot({
            doc,
            authorityFocus: priorFocus,
            activeFocus: focus,
            root,
          }),
        });
      }
    } else if (liveWire !== resolvedWire) {
      logEditStateTrace(`reconcile>>${source}`, {
        priorWire,
        liveWire,
        resolvedWire,
        ...buildCaretStateSnapshot({
          doc,
          authorityFocus: priorFocus,
          activeFocus: live.focus,
          root,
        }),
      });
    }
  };

  const onDocumentSelectionChange = () => {
    if (suppressDomSelectionSync || !root || composing || selectedMentionNodeIndex !== null) {
      return;
    }
    const native = root.ownerDocument.getSelection();
    if (!native?.rangeCount || !root.contains(native.anchorNode)) {
      return;
    }
    reconcileSelectionFromDom("selectionchange");
  };

  const onRootMouseDown = (event: MouseEvent) => {
    if (!root || composing || selectedMentionNodeIndex !== null) {
      return;
    }
    if (!root.contains(event.target as Node)) {
      return;
    }
    pendingClickIngress = { clientX: event.clientX, clientY: event.clientY };
  };

  const captureSnapshot = (): HandoffNoteHistorySnapshot => ({
    doc: { nodes: doc.nodes.map((node) => ({ ...node })) },
    selection: cloneSelection(selection),
  });

  const syncWireOut = (source: string) => {
    const wire = docToWire(doc);
    if (wire === lastEmittedWire) {
      return;
    }
    lastEmittedWire = wire;
    options.onWireChange(wire);
  };

  const writeSelection = (
    nextSelection: HandoffNoteSelection,
    source: string,
    afterRender: RenderOutcome = lastRenderOutcome
  ) => {
    const priorFocus = selection.focus;
    selection = normalizeSelection(doc, nextSelection);
    if (!root) {
      return;
    }
    const requestedWire = docPosToWireOffset(doc, selection.focus);
    suppressDomSelectionSync = true;
    try {
      setDocSelection(root, doc, selection, {
        source,
      });
    } finally {
      suppressDomSelectionSync = false;
    }

    const live = readDocSelection(root, doc);
    const liveWire = docPosToWireOffset(doc, live.focus);
    if (liveWire !== requestedWire) {
      logCaretBoundaryTrace(`writeSelection>>keepAuthority>>${source}`, {
        branch: liveWire < requestedWire ? "liveBehindRequested" : "liveAheadOfRequested",
        priorWire: docPosToWireOffset(doc, priorFocus),
        liveWire,
        resolvedWire: requestedWire,
      });
      return;
    }
    if (
      liveWire === requestedWire &&
      !docPosEqual(selection.focus, live.focus) &&
      doc.nodes[selection.focus.nodeIndex]?.type === "mention" &&
      doc.nodes[live.focus.nodeIndex]?.type === "text"
    ) {
      logCaretBoundaryTrace(`writeSelection>>keepAuthority>>${source}`, {
        branch: "mentionOverTextSameWire",
        liveWire,
        resolvedWire: requestedWire,
      });
      return;
    }
    if (
      liveWire === requestedWire &&
      !docPosEqual(selection.focus, live.focus) &&
      doc.nodes[selection.focus.nodeIndex]?.type === "text" &&
      doc.nodes[live.focus.nodeIndex]?.type === "mention"
    ) {
      logCaretBoundaryTrace(`writeSelection>>keepAuthority>>${source}`, {
        branch: "textOverMentionSameWire",
        liveWire,
        resolvedWire: requestedWire,
      });
      return;
    }
    if (!afterRender.domReplaced) {
      return;
    }
    if (!docPosEqual(selection.focus, live.focus)) {
      logCaretBoundaryTrace(`writeSelection>>acceptDom>>${source}`, {
        branch: "livePosMismatch",
        liveWire,
        resolvedWire: requestedWire,
      });
    }
    selection = normalizeSelection(doc, live, { from: priorFocus });
  };

  const renderDoc = (
    nextSelection: HandoffNoteSelection,
    source: string,
    renderOptions?: { trustDoc?: boolean; previousDoc?: HandoffNoteDoc }
  ) => {
    if (!root) {
      selection = normalizeSelection(doc, nextSelection);
      return;
    }
    lastRenderOutcome = renderHandoffNoteDoc(root, doc, presentationOptions(), {
      trustDoc: renderOptions?.trustDoc,
      previousDoc: renderOptions?.previousDoc,
    });
    if (lastRenderOutcome.docChanged) {
      invalidateHandoffNoteLayoutCache(root);
    }
    writeSelection(nextSelection, `render.${source}`, lastRenderOutcome);
  };

  const syncSelectionFromDom = (): HandoffNoteSelection => {
    reconcileSelectionFromDom("sync");
    return selection;
  };

  const recordMutation = () => {
    if (history.isRestoring() || composing) {
      return;
    }
    history.recordBefore(captureSnapshot());
  };

  const mutate = (
    nextDoc: HandoffNoteDoc,
    nextSelection: HandoffNoteSelection,
    source: string,
    record = true
  ) => {
    selectedMentionNodeIndex = null;
    verticalGoalColumn = null;
    const prevDoc = doc;
    const normalized = normalizeHandoffNoteDoc(nextDoc);
    const resolvedSelection = normalizeSelection(normalized, nextSelection);
    if (record) {
      recordMutation();
    }
    doc = normalized;
    selection = resolvedSelection;
    renderDoc(resolvedSelection, source, { trustDoc: true, previousDoc: prevDoc });
    syncWireOut(source);
    resize();
    if (source.startsWith("beforeInput.") || source.startsWith("keydown.")) {
      const wireBefore = docToWire(prevDoc);
      const wireAfter = docToWire(doc);
      logEditStateTrace("mutate>>after", {
        source,
        wireBefore: escapeWireForLog(wireBefore),
        wireAfter: escapeWireForLog(wireAfter),
        wireLenBefore: wireBefore.length,
        wireLenAfter: wireAfter.length,
        probesBefore: listEmbeddedBlankBandProbeWires(prevDoc),
        probesAfter: listEmbeddedBlankBandProbeWires(doc),
        ...buildCaretStateSnapshot({
          doc,
          authorityFocus: resolvedSelection.focus,
          root,
          includeWire: true,
        }),
      });
    }
  };

  const mutateSelection = (focus: HandoffNoteDocPos, source: string, _key?: string) => {
    selectedMentionNodeIndex = null;
    const nextSelection = collapsedSelection(focus);
    if (!root) {
      selection = normalizeSelection(doc, nextSelection);
      return;
    }
    writeSelection(nextSelection, source);
    refreshMentionPresentation();
  };

  const restoreSnapshot = (snapshot: HandoffNoteHistorySnapshot) => {
    history.runRestore(() => {
      const prevDoc = doc;
      doc = normalizeHandoffNoteDoc(snapshot.doc);
      selection = normalizeSelection(doc, snapshot.selection);
      renderDoc(selection, "restoreSnapshot", { trustDoc: true, previousDoc: prevDoc });
      syncWireOut("restoreSnapshot");
      options.onResize?.();
      resize();
    });
  };

  const resize = () => {
    if (!root) {
      return;
    }
    invalidateHandoffNoteLayoutCache(root);
    const { maxHeight } = readHandoffNoteMetrics(root);
    root.style.height = "auto";
    const contentHeight = root.scrollHeight;
    const cap = maxHeight > 0 ? maxHeight : contentHeight;
    root.style.height = `${Math.min(contentHeight, cap)}px`;
    root.style.overflowY = maxHeight > 0 && contentHeight > maxHeight ? "auto" : "hidden";
    options.onResize?.();
  };

  const performUndo = (): boolean => {
    const previous = history.undo(captureSnapshot());
    if (!previous) {
      return false;
    }
    restoreSnapshot(previous);
    return true;
  };

  const performRedo = (): boolean => {
    const next = history.redo(captureSnapshot());
    if (!next) {
      return false;
    }
    restoreSnapshot(next);
    return true;
  };

  const host: HandoffNoteEditor = {
    getRoot: () => root,
    setRoot(next) {
      if (root) {
        root.removeEventListener("mousedown", onRootMouseDown);
        root.ownerDocument.removeEventListener("selectionchange", onDocumentSelectionChange);
      }
      root = next;
      pendingClickIngress = null;
      if (root) {
        root.addEventListener("mousedown", onRootMouseDown);
        root.ownerDocument.addEventListener("selectionchange", onDocumentSelectionChange);
      }
    },

    getDoc: () => doc,
    getSelectionState: () => cloneSelection(selection),

    setDocFromWire(wire, wireCursor, setOptions) {
      if (setOptions?.resetHistory) {
        history.clear();
      }
      selectedMentionNodeIndex = null;
      const next = wireToDoc(wire);
      const nextSelection =
        wireCursor !== undefined
          ? wireOffsetToCollapsedSelection(
              next,
              wireCursor,
              docPosToWireOffset(doc, selection.focus)
            )
          : collapsedSelection(docEndPos(next));
      const changed = !docsEqual(next, doc);
      const selectionChanged = !selectionsEqual(
        normalizeSelection(next, nextSelection, { from: selection.focus }),
        normalizeSelection(doc, selection)
      );

      if (!changed && !selectionChanged) {
        lastEmittedWire = wire;
        return;
      }

      if (!changed) {
        lastEmittedWire = wire;
        selection = normalizeSelection(doc, nextSelection, { from: selection.focus });
        if (root) {
          writeSelection(selection, "importWire.selectionOnly");
        }
        return;
      }

      doc = next;
      selection = normalizeSelection(doc, nextSelection, { from: selection.focus });
      invalidateHandoffNoteLayoutCache(root);
      renderDoc(selection, "importWire.changed");
      resize();
      syncWireOut("importWire.changed");
      lastEmittedWire = wire;
    },

    refreshPresentation() {
      refreshMentionPresentation();
    },

    selectMentionNode(nodeIndex) {
      const node = doc.nodes[nodeIndex];
      if (node?.type !== "mention") {
        return;
      }
      selectedMentionNodeIndex = nodeIndex;
      clearNativeSelection();
      refreshMentionPresentation();
    },

    clearMentionSelection() {
      if (selectedMentionNodeIndex === null) {
        return;
      }
      selectedMentionNodeIndex = null;
      refreshMentionPresentation();
    },

    getSelectedMentionNodeIndex: () => selectedMentionNodeIndex,

    applyDoc(next, nextSelection) {
      mutate(normalizeHandoffNoteDoc(next), nextSelection, "applyDoc", true);
    },

    insertDocText(text) {
      if (!text) {
        return;
      }
      const active = root ? syncSelectionFromDom() : selection;
      const result = applyDocInsertText(doc, active, text);
      mutate(result.doc, result.selection, "insertDocText", true);
    },

    getSelectionWire() {
      const active = root ? syncSelectionFromDom() : selection;
      const collapsed =
        active.anchor.nodeIndex === active.focus.nodeIndex &&
        active.anchor.nodeOffset === active.focus.nodeOffset;
      if (collapsed) {
        return "";
      }
      return docSelectionToWire(doc, active);
    },

    deleteSelection() {
      const active = root ? syncSelectionFromDom() : selection;
      const collapsed =
        active.anchor.nodeIndex === active.focus.nodeIndex &&
        active.anchor.nodeOffset === active.focus.nodeOffset;
      if (collapsed) {
        return;
      }
      const anchor = normalizeDocPos(doc, active.anchor);
      const focus = expandSelectionFocusToDocEndIfNeeded(
        doc,
        anchor,
        normalizeDocPos(doc, active.focus)
      );
      const result = spliceDocSelection(doc, anchor, focus, "");
      mutate(result.doc, result.selection, "deleteSelection", true);
    },

    getWire: () => docToWire(doc),

    getCursor: () => docPosToWireOffset(doc, selection.focus),

    insertMentionAtomAt(agentId, replaceStart, replaceEnd) {
      const result = insertMentionAtSelection(doc, agentId, replaceStart, replaceEnd);
      mutate(result.doc, result.selection, "insertMentionAtomAt", true);
    },

    focus() {
      root?.focus();
    },

    getAnchorRectAtOffset(offset) {
      if (!root) {
        return null;
      }
      return getDocAnchorRect(root, doc, wireOffsetToCollapsedSelection(doc, offset).focus);
    },

    isComposing: () => composing,

    undo: performUndo,
    redo: performRedo,
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),

    handleCompositionStart() {
      composing = true;
      history.setComposing(true);
    },

    handleCompositionEnd() {
      composing = false;
      history.setComposing(false);
      if (!root) {
        return;
      }
      const parsed = normalizeHandoffNoteDoc(parseHandoffNoteDomToDoc(root));
      const live = readDocSelection(root, parsed);
      mutate(parsed, live, "compositionEnd", true);
    },

    handleBeforeInput(event) {
      if (!root || composing || event.isComposing) {
        return;
      }

      if (selectedMentionNodeIndex !== null) {
        selectedMentionNodeIndex = null;
        refreshMentionPresentation();
      }

      if (event.inputType === "historyUndo") {
        event.preventDefault();
        performUndo();
        return;
      }

      if (event.inputType === "historyRedo") {
        event.preventDefault();
        performRedo();
        return;
      }

      if (event.inputType === "insertFromPaste") {
        event.preventDefault();
        return;
      }

      const active = syncSelectionFromDom();

      if (
        event.inputType === "deleteContentBackward" ||
        event.inputType === "deleteContentForward"
      ) {
        const direction = event.inputType === "deleteContentBackward" ? "backspace" : "delete";
        const authorityFocusBeforeSync = { ...selection.focus };
        const authorityWire = docPosToWireOffset(doc, authorityFocusBeforeSync);
        const activeWire = docPosToWireOffset(doc, active.focus);
        logEditStateTrace(`delete>>beforeInput>>${direction}>>before`, {
          ingress: "beforeInput",
          inputType: event.inputType,
          authorityWire,
          activeWire,
          ...buildCaretStateSnapshot({
            doc,
            authorityFocus: authorityFocusBeforeSync,
            activeFocus: active.focus,
            root,
            direction,
          }),
        });
        const deleted = applyDocDelete(doc, active, direction);
        logEditStateTrace(`delete>>beforeInput>>${direction}>>result`, {
          ingress: "beforeInput",
          noop: !deleted,
          resolvedWire: deleted
            ? docPosToWireOffset(deleted.doc, deleted.selection.focus)
            : activeWire,
          probesAfter: deleted ? listEmbeddedBlankBandProbeWires(deleted.doc) : undefined,
        });
        if (!deleted) {
          return;
        }
        event.preventDefault();
        mutate(deleted.doc, deleted.selection, `beforeInput.${direction}`, true);
        return;
      }

      if (event.inputType === "insertText") {
        const replacement = event.data ?? "";
        if (!replacement) {
          return;
        }
        const authorityWire = docPosToWireOffset(doc, selection.focus);
        const activeWire = docPosToWireOffset(doc, active.focus);
        logEditStateTrace("insert>>before", {
          ingress: "beforeInput",
          text: replacement,
          authorityWire,
          activeWire,
          authorityDrift: authorityWire !== activeWire,
          ...buildCaretStateSnapshot({
            doc,
            authorityFocus: selection.focus,
            activeFocus: active.focus,
          }),
        });
        event.preventDefault();
        const result = applyDocInsertText(doc, active, replacement);
        mutate(result.doc, result.selection, "beforeInput.insertText", true);
        return;
      }

      if (event.inputType === "insertLineBreak") {
        event.preventDefault();
        const result = applyDocLineBreak(doc, active);
        mutate(result.doc, result.selection, "beforeInput.insertLineBreak", true);
      }
    },

    handleInput() {
      if (!root || composing) {
        return;
      }
      resize();
    },

    handleKeyDown(event) {
      if (!root || composing || event.isComposing) {
        return false;
      }

      if (isUndoKeyboardEvent(event)) {
        event.preventDefault();
        return performUndo();
      }

      if (isRedoKeyboardEvent(event)) {
        event.preventDefault();
        return performRedo();
      }

      const authorityFocusBeforeSync = { ...selection.focus };
      const authorityBefore = docPosToWireOffset(doc, authorityFocusBeforeSync);
      const active = syncSelectionFromDom();
      const collapsed =
        active.anchor.nodeIndex === active.focus.nodeIndex &&
        active.anchor.nodeOffset === active.focus.nodeOffset;

      if (selectedMentionNodeIndex !== null && options.isMentionPopoverOpen?.() && isArrow(event)) {
        return false;
      }

      if (
        selectedMentionNodeIndex !== null &&
        !options.isMentionPopoverOpen?.() &&
        isArrow(event)
      ) {
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        const direction = isArrow.direction(event);
        if (direction === null) {
          return false;
        }
        const exit = resolveSelectedMentionArrowExit(doc, selectedMentionNodeIndex, direction);
        if (exit === null) {
          return false;
        }
        event.preventDefault();
        mutateSelection(exit, "mentionArrowExit");
        return true;
      }

      if (isArrow.horc(event)) {
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        if (!collapsed) {
          return false;
        }
        const direction = isArrow.horcDirection(event);
        if (direction === null) {
          return false;
        }
        verticalGoalColumn = null;
        const move = resolveDocHorizontalArrowMove(doc, active.focus, direction);
        if (!move.handled) {
          return false;
        }
        event.preventDefault();
        mutateSelection(move.pos, "arrowKey", event.key);
        return true;
      }

      if (isArrow.ver(event)) {
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        if (!collapsed || !root) {
          return false;
        }
        const direction = isArrow.verDirection(event);
        if (direction === null) {
          return false;
        }
        const move = resolveDomVerticalArrowMove(root, doc, active.focus, direction, {
          stickyGoalColumn: verticalGoalColumn,
        });
        if (!move.handled) {
          return false;
        }
        if (move.goalColumn !== undefined) {
          verticalGoalColumn = move.goalColumn;
        }
        event.preventDefault();
        mutateSelection(move.pos, "arrowKey", event.key);
        return true;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        if (!collapsed) {
          return false;
        }
        const direction = event.key === "Backspace" ? "backspace" : "delete";
        const activeWire = docPosToWireOffset(doc, active.focus);
        logEditStateTrace(`delete>>keydown>>${direction}>>before`, {
          ingress: "keydown",
          priorWire: authorityBefore,
          activeWire,
          ...buildCaretStateSnapshot({
            doc,
            authorityFocus: authorityFocusBeforeSync,
            activeFocus: active.focus,
            root,
            direction,
          }),
        });
        const deleted = applyDocDelete(doc, active, direction);
        logEditStateTrace(`delete>>keydown>>${direction}>>result`, {
          ingress: "keydown",
          priorWire: authorityBefore,
          activeWire,
          resolvedWire: deleted
            ? docPosToWireOffset(deleted.doc, deleted.selection.focus)
            : activeWire,
          noop: !deleted,
          probesAfter: deleted ? listEmbeddedBlankBandProbeWires(deleted.doc) : undefined,
        });
        if (!deleted) {
          return false;
        }
        event.preventDefault();
        mutate(deleted.doc, deleted.selection, `keydown.${event.key}`, true);
        return true;
      }

      return false;
    },

    resize,
  };

  return host;
}
