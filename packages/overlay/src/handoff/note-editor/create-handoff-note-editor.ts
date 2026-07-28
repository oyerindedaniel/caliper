import {
  applyDocDelete,
  applyDocInsertText,
  applyDocLineBreak,
  cloneSelection,
  collapsedSelection,
  collapsedSelectionCarryingAffinity,
  collapsedSelectionReconcilingAffinity,
  docEndPos,
  docPosEqual,
  docPosToWireOffset,
  docSelectionToWire,
  docToWire,
  docsEqual,
  expandSelectionFocusToDocEndIfNeeded,
  insertMentionAtSelection,
  isArrow,
  isAtomicNode,
  isCaretOnAmbiguousContentRowEndChar,
  normalizeHandoffNoteDoc,
  normalizeDocPos,
  normalizeSelection,
  resolveHandoffNoteDeletePostLayoutRemount,
  selectionsEqual,
  spliceDocSelection,
  wireOffsetToCollapsedSelection,
  wireToDoc,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
  type HandoffNoteDeletePostLayoutRemount,
  type HandoffNoteSelection,
} from "@caliper/core";
import {
  parseHandoffNoteDomToDoc,
  renderHandoffNoteDoc,
  updateMentionPresentation,
  type RenderOutcome,
} from "./handoff-note-dom.js";
import {
  createHandoffNoteHistory,
  isRedoKeyboardEvent,
  isUndoKeyboardEvent,
  type HandoffNoteHistorySnapshot,
} from "./handoff-note-history.js";
import {
  readDocSelection,
  repairDocSelectionIfNeeded,
  resolveDomVerticalArrowMove,
  resolveSelectedMentionArrowExit,
  setDocSelection,
  logDocSelectionLayoutMapping,
  type HandoffNoteClickIngress,
} from "./handoff-note-selection.js";
import {
  logDelete,
  logVerArrow,
  logHorArrow,
  snapshotDocPosForLog,
  describeWireRemoval,
} from "../handoff-note-debug.js";
import {
  ensureHandoffNoteCaretVisible,
  getDocAnchorRect,
  resolvePaintContext,
  resolvePaintContextAtWire,
  resolvePaintHorizontalArrowMove,
} from "./handoff-note-dom-points.js";
import {
  buildHandoffNoteLayoutMap,
  invalidateHandoffNoteLayoutCache,
  layoutVisualRowSeats,
  measureReplacementDeleteVisualRowSeats,
} from "./handoff-note-layout-map.js";

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
  /** Fires when the editor scrollport moves (user scroll or caret ensure-visible). */
  onScroll?: () => void;
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
  /** Coalesce post-mutate sticky remasures (typing bursts / paste) into one paint-backed refresh. */
  let verticalGoalRefreshQueued = false;
  let verticalGoalRefreshGeneration = 0;
  let pendingClickIngress: HandoffNoteClickIngress | null = null;
  const history = createHandoffNoteHistory();

  /** Sticky goal = painted caret X (honor focusAffinity — `after` is after-glyph, not char start). */
  const refreshVerticalGoalFromFocus = (_reason: string) => {
    if (!root) {
      verticalGoalColumn = null;
      return;
    }
    const rect = getDocAnchorRect(root, doc, selection.focus, {
      focusAffinity: selection.focusAffinity,
    });
    const next = rect && (rect.height > 0 || rect.width > 0) ? rect.left : null;
    verticalGoalColumn = next;
  };

  const flushVerticalGoalRefresh = () => {
    if (!verticalGoalRefreshQueued) {
      return;
    }
    verticalGoalRefreshGeneration += 1;
    verticalGoalRefreshQueued = false;
    refreshVerticalGoalFromFocus("flush");
  };

  const scheduleVerticalGoalRefresh = (reason: string) => {
    const generation = (verticalGoalRefreshGeneration += 1);
    verticalGoalRefreshQueued = true;
    queueMicrotask(() => {
      if (generation !== verticalGoalRefreshGeneration) {
        return;
      }
      verticalGoalRefreshQueued = false;
      refreshVerticalGoalFromFocus(reason);
    });
  };

  const notifyScrollIfChanged = (beforeScrollTop: number) => {
    if (!root || root.scrollTop === beforeScrollTop) {
      return;
    }
    options.onScroll?.();
  };

  const ensureFocusCaretVisible = () => {
    if (!root) {
      return { scrolled: false, scrollTopBefore: 0, scrollTopAfter: 0 };
    }
    const before = root.scrollTop;
    const scrolled = ensureHandoffNoteCaretVisible(root, doc, selection.focus);
    if (scrolled) {
      notifyScrollIfChanged(before);
    }
    return { scrolled, scrollTopBefore: before, scrollTopAfter: root.scrollTop };
  };

  const onRootScroll = () => {
    options.onScroll?.();
  };

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
    const priorSelection = selection;
    const priorFocus = priorSelection.focus;
    const clickIngressPending = source === "selectionchange" ? pendingClickIngress : null;
    const useAuthorityRead =
      source === "sync" || (source === "selectionchange" && !clickIngressPending);
    const memoryWire = docPosToWireOffset(doc, priorFocus);
    const live = readDocSelection(root, doc, useAuthorityRead ? { from: priorFocus } : undefined);
    const liveWire = docPosToWireOffset(doc, live.focus);
    if (
      live.anchor.nodeIndex !== live.focus.nodeIndex ||
      live.anchor.nodeOffset !== live.focus.nodeOffset
    ) {
      selection = normalizeSelection(doc, live, { from: priorFocus });
      if (clickIngressPending) {
        logDocSelectionLayoutMapping(root, doc, selection.focus, `click.${source}.range`, {
          memoryWire,
          liveWire,
          affinity: selection.focusAffinity ?? null,
        });
      }
      return;
    }
    const repairMode = source === "selectionchange" ? "strand-only" : "full";
    const clickIngress = source === "selectionchange" ? pendingClickIngress : null;
    if (clickIngress) {
      pendingClickIngress = null;
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
    selection = collapsedSelectionReconcilingAffinity(doc, focus, live, priorSelection);
    if (clickIngress) {
      refreshVerticalGoalFromFocus("click");
      logDocSelectionLayoutMapping(root, doc, selection.focus, "click", {
        memoryWire,
        liveWireBeforeRepair: liveWire,
        repairedWire: docPosToWireOffset(doc, focus),
        affinity: selection.focusAffinity ?? null,
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

  const syncWireOut = () => {
    const wire = docToWire(doc);
    if (wire === lastEmittedWire) {
      return;
    }
    lastEmittedWire = wire;
    options.onWireChange(wire);
  };

  const writeSelection = (
    nextSelection: HandoffNoteSelection,
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
      setDocSelection(root, doc, selection);
    } finally {
      suppressDomSelectionSync = false;
    }

    ensureFocusCaretVisible();

    const live = readDocSelection(root, doc, { from: selection.focus });
    const liveWire = docPosToWireOffset(doc, live.focus);

    if (liveWire !== requestedWire) {
      logDocSelectionLayoutMapping(root, doc, selection.focus, "writeSelection.mismatch", {
        requestedWire,
        liveWire,
        affinity: selection.focusAffinity ?? null,
        priorFocusWire: docPosToWireOffset(doc, priorFocus),
      });
      return;
    }
    if (
      liveWire === requestedWire &&
      !docPosEqual(selection.focus, live.focus) &&
      isAtomicNode(doc.nodes[selection.focus.nodeIndex]) &&
      doc.nodes[live.focus.nodeIndex]?.type === "text"
    ) {
      return;
    }
    if (
      liveWire === requestedWire &&
      !docPosEqual(selection.focus, live.focus) &&
      doc.nodes[selection.focus.nodeIndex]?.type === "text" &&
      isAtomicNode(doc.nodes[live.focus.nodeIndex])
    ) {
      return;
    }
    if (
      liveWire === requestedWire &&
      docPosEqual(selection.focus, live.focus) &&
      isCaretOnAmbiguousContentRowEndChar(doc, selection.focus) &&
      selection.focusAffinity !== live.focusAffinity
    ) {
      // Intentional write already decided omit / before / after on the ambiguous
      // last char. DOM recovery feeds click/selectionchange ingress only — do not
      // upgrade omit→after (or otherwise override) after paint.
      return;
    }
    if (!afterRender.domReplaced) {
      return;
    }
    selection = normalizeSelection(doc, live, { from: priorFocus });
  };

  const renderDoc = (
    nextSelection: HandoffNoteSelection,
    renderOptions?: { trustDoc?: boolean; previousDoc?: HandoffNoteDoc },
    resolveReplacementSelection?: (selection: HandoffNoteSelection) => HandoffNoteSelection
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
    writeSelection(
      resolveReplacementSelection?.(nextSelection) ?? nextSelection,
      lastRenderOutcome
    );
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
    record = true,
    postLayoutRemount?: HandoffNoteDeletePostLayoutRemount
  ) => {
    selectedMentionNodeIndex = null;
    const prevDoc = doc;
    const normalized = normalizeHandoffNoteDoc(nextDoc);
    const resolvedSelection = normalizeSelection(normalized, nextSelection);
    if (record) {
      recordMutation();
    }
    doc = normalized;
    selection = resolvedSelection;
    const replacementRoot = root;
    renderDoc(
      resolvedSelection,
      { trustDoc: true, previousDoc: prevDoc },
      postLayoutRemount && replacementRoot
        ? (provisionalSelection) => {
            const focusWire = docPosToWireOffset(doc, provisionalSelection.focus);
            let replacementSeats;
            if (postLayoutRemount.kind === "blank-stop") {
              replacementSeats = layoutVisualRowSeats(
                buildHandoffNoteLayoutMap(replacementRoot, doc),
                doc
              );
            } else {
              replacementSeats = measureReplacementDeleteVisualRowSeats(replacementRoot, doc, {
                priorContentSeatWire: postLayoutRemount.priorContentSeatWire,
                focusWire,
              });
            }
            const resolved = resolveHandoffNoteDeletePostLayoutRemount(
              { doc, selection: provisionalSelection, postLayoutRemount },
              replacementSeats
            );
            logDelete("replacementLand", {
              direction: "delete",
              request: postLayoutRemount,
              provisionalWire: focusWire,
              provisionalDoc: snapshotDocPosForLog(doc, provisionalSelection.focus),
              provisionalAffinity: provisionalSelection.focusAffinity ?? null,
              replacementSeats,
              finalWire: docPosToWireOffset(doc, resolved.selection.focus),
              finalDoc: snapshotDocPosForLog(doc, resolved.selection.focus),
              finalAffinity: resolved.selection.focusAffinity ?? null,
              remounted: docPosToWireOffset(doc, resolved.selection.focus) !== focusWire,
            });
            return resolved.selection;
          }
        : undefined
    );
    syncWireOut();
    resize();
    scheduleVerticalGoalRefresh("mutate");
  };

  const logDeleteFinalSelection = (
    direction: "backspace" | "delete",
    provisional: { doc: HandoffNoteDoc; selection: HandoffNoteSelection }
  ) => {
    logDelete("final", {
      direction,
      provisionalWire: docPosToWireOffset(provisional.doc, provisional.selection.focus),
      provisionalDoc: snapshotDocPosForLog(provisional.doc, provisional.selection.focus),
      provisionalAffinity: provisional.selection.focusAffinity ?? null,
      finalWire: docPosToWireOffset(doc, selection.focus),
      finalDoc: snapshotDocPosForLog(doc, selection.focus),
      finalAffinity: selection.focusAffinity ?? null,
      changed:
        docPosToWireOffset(provisional.doc, provisional.selection.focus) !==
        docPosToWireOffset(doc, selection.focus),
    });
  };

  const mutateSelection = (focusOrSelection: HandoffNoteDocPos | HandoffNoteSelection) => {
    selectedMentionNodeIndex = null;
    const nextSelection =
      "anchor" in focusOrSelection && "focus" in focusOrSelection
        ? focusOrSelection
        : collapsedSelection(focusOrSelection);
    if (!root) {
      selection = normalizeSelection(doc, nextSelection);
      return;
    }
    writeSelection(nextSelection, lastRenderOutcome);
    refreshMentionPresentation();
  };

  const restoreSnapshot = (snapshot: HandoffNoteHistorySnapshot) => {
    history.runRestore(() => {
      const prevDoc = doc;
      doc = normalizeHandoffNoteDoc(snapshot.doc);
      selection = normalizeSelection(doc, snapshot.selection);
      renderDoc(selection, { trustDoc: true, previousDoc: prevDoc });
      syncWireOut();
      options.onResize?.();
      resize();
      scheduleVerticalGoalRefresh("restore");
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
    ensureFocusCaretVisible();
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
        root.removeEventListener("scroll", onRootScroll);
        root.ownerDocument.removeEventListener("selectionchange", onDocumentSelectionChange);
      }
      root = next;
      pendingClickIngress = null;
      if (root) {
        root.addEventListener("mousedown", onRootMouseDown);
        root.addEventListener("scroll", onRootScroll, { passive: true });
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
          ? collapsedSelection(resolvePaintContextAtWire(next, wireCursor).focusPos)
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
          writeSelection(selection);
          scheduleVerticalGoalRefresh("setDocFromWire.selection");
        }
        return;
      }

      doc = next;
      // Wire import: focusPos is authority — do not snap via prior-doc `from`.
      selection = normalizeSelection(doc, nextSelection);
      invalidateHandoffNoteLayoutCache(root);
      renderDoc(selection);
      resize();
      syncWireOut();
      lastEmittedWire = wire;
      scheduleVerticalGoalRefresh("setDocFromWire");
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
      mutate(normalizeHandoffNoteDoc(next), nextSelection, true);
    },

    insertDocText(text) {
      if (!text) {
        return;
      }
      const active = root ? syncSelectionFromDom() : selection;
      const result = applyDocInsertText(doc, active, text);
      mutate(result.doc, result.selection, true);
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
      mutate(result.doc, result.selection, true);
    },

    getWire: () => docToWire(doc),

    getCursor: () => docPosToWireOffset(doc, selection.focus),

    insertMentionAtomAt(agentId, replaceStart, replaceEnd) {
      const result = insertMentionAtSelection(doc, agentId, replaceStart, replaceEnd);
      mutate(result.doc, result.selection, true);
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
      mutate(parsed, live, true);
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
        const collapsed =
          docPosToWireOffset(doc, active.anchor) === docPosToWireOffset(doc, active.focus) &&
          docPosEqual(active.anchor, active.focus);
        const deleteFocus = resolvePaintContext(doc, active.focus, {
          from: authorityFocusBeforeSync,
          root: root ?? undefined,
        }).focusPos;
        // Range delete ignores affinity; collapsed Delete carries it via core helper.
        const deleteSelection = collapsed
          ? collapsedSelectionCarryingAffinity(doc, deleteFocus, active)
          : {
              anchor: resolvePaintContext(doc, active.anchor, {
                from: authorityFocusBeforeSync,
                root: root ?? undefined,
              }).focusPos,
              focus: deleteFocus,
            };
        const beforeWire = docToWire(doc);
        // Live editor: seats always come from the current layout epoch (same paint
        // pass Up/Down navigation uses) — never a silent wire-line fallback here.
        const deleteLayout = buildHandoffNoteLayoutMap(root, doc);
        const deleteSeats = layoutVisualRowSeats(deleteLayout, doc);
        const deleted = applyDocDelete(doc, deleteSelection, direction, {
          visualRowSeats: deleteSeats,
        });
        const afterWire = deleted ? docToWire(deleted.doc) : beforeWire;
        logDelete("beforeInput", {
          direction,
          fromWire: docPosToWireOffset(doc, deleteFocus),
          fromDoc: snapshotDocPosForLog(doc, deleteFocus),
          fromAffinity: deleteSelection.focusAffinity ?? null,
          toWire: deleted ? docPosToWireOffset(deleted.doc, deleted.selection.focus) : null,
          toDoc: deleted ? snapshotDocPosForLog(deleted.doc, deleted.selection.focus) : null,
          toAffinity: deleted?.selection.focusAffinity ?? null,
          wireBefore: beforeWire,
          wireAfter: afterWire,
          preMutationSeats: deleteSeats,
          ...describeWireRemoval(beforeWire, afterWire),
          handled: Boolean(deleted),
        });
        if (!deleted) {
          return;
        }
        event.preventDefault();
        mutate(deleted.doc, deleted.selection, true, deleted.postLayoutRemount);
        logDeleteFinalSelection(direction, deleted);
        return;
      }

      if (event.inputType === "insertText") {
        const replacement = event.data ?? "";
        if (!replacement) {
          return;
        }
        event.preventDefault();
        const result = applyDocInsertText(doc, active, replacement);
        mutate(result.doc, result.selection, true);
        return;
      }

      if (event.inputType === "insertLineBreak") {
        event.preventDefault();
        const result = applyDocLineBreak(doc, active);
        mutate(result.doc, result.selection, true);
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
        mutateSelection(exit);
        return true;
      }

      if (isArrow.horc(event)) {
        const direction = isArrow.horcDirection(event);
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        if (!collapsed) {
          return false;
        }
        if (direction === null) {
          return false;
        }
        const move = resolvePaintHorizontalArrowMove(doc, active.focus, direction, {
          root: root ?? undefined,
          focusAffinity: active.focusAffinity,
        });
        const fromWire = docPosToWireOffset(doc, active.focus);
        const toWire = docPosToWireOffset(doc, move.selection.focus);
        logHorArrow("land", {
          direction,
          fromWire,
          fromDoc: snapshotDocPosForLog(doc, active.focus),
          toWire,
          toDoc: snapshotDocPosForLog(doc, move.selection.focus),
          fromAffinity: active.focusAffinity ?? null,
          toAffinity: move.selection.focusAffinity ?? null,
          handled: move.handled,
        });
        if (!move.handled) {
          return false;
        }
        event.preventDefault();
        mutateSelection(move.selection);
        refreshVerticalGoalFromFocus("horizontal");
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
        flushVerticalGoalRefresh();
        const fromWire = docPosToWireOffset(doc, active.focus);
        const fromAffinity = active.focusAffinity ?? null;
        const move = resolveDomVerticalArrowMove(root, doc, active.focus, direction, {
          stickyGoalColumn: verticalGoalColumn,
          focusAffinity: active.focusAffinity,
        });
        const toWire = docPosToWireOffset(doc, move.pos);
        logVerArrow("land", {
          direction,
          fromWire,
          fromDoc: snapshotDocPosForLog(doc, active.focus),
          toWire,
          toDoc: snapshotDocPosForLog(doc, move.pos),
          fromAffinity,
          toAffinity: move.selection.focusAffinity ?? null,
          branch: move.branch ?? null,
          handled: move.handled,
        });
        if (!move.handled) {
          return false;
        }
        if (move.goalColumn !== undefined) {
          verticalGoalColumn = move.goalColumn;
        }
        event.preventDefault();
        mutateSelection(move.selection);
        return true;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        if (!collapsed) {
          return false;
        }
        const direction = event.key === "Backspace" ? "backspace" : "delete";
        const deleteFocus = resolvePaintContext(doc, active.focus, {
          from: authorityFocusBeforeSync,
          root: root ?? undefined,
        }).focusPos;
        const deleteSelection = collapsedSelectionCarryingAffinity(doc, deleteFocus, active);
        const beforeWire = docToWire(doc);
        // Live editor: seats always come from the current layout epoch (same paint
        // pass Up/Down navigation uses) — never a silent wire-line fallback here.
        const deleteLayout = buildHandoffNoteLayoutMap(root, doc);
        const deleteSeats = layoutVisualRowSeats(deleteLayout, doc);
        const deleted = applyDocDelete(doc, deleteSelection, direction, {
          visualRowSeats: deleteSeats,
        });
        const afterWire = deleted ? docToWire(deleted.doc) : beforeWire;
        logDelete("keydown", {
          direction,
          fromWire: docPosToWireOffset(doc, deleteFocus),
          fromDoc: snapshotDocPosForLog(doc, deleteFocus),
          fromAffinity: deleteSelection.focusAffinity ?? null,
          toWire: deleted ? docPosToWireOffset(deleted.doc, deleted.selection.focus) : null,
          toDoc: deleted ? snapshotDocPosForLog(deleted.doc, deleted.selection.focus) : null,
          toAffinity: deleted?.selection.focusAffinity ?? null,
          wireBefore: beforeWire,
          wireAfter: afterWire,
          preMutationSeats: deleteSeats,
          ...describeWireRemoval(beforeWire, afterWire),
          handled: Boolean(deleted),
        });
        if (!deleted) {
          return false;
        }
        event.preventDefault();
        mutate(deleted.doc, deleted.selection, true, deleted.postLayoutRemount);
        logDeleteFinalSelection(direction, deleted);
        return true;
      }

      return false;
    },

    resize,
  };

  return host;
}
