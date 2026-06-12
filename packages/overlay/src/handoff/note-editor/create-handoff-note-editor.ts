import {
  applyDocDelete,
  applyDocInsertText,
  applyDocLineBreak,
  cloneSelection,
  collapsedSelection,
  describeHandoffNoteCursorContext,
  docEndPos,
  docPosToWireOffset,
  docSelectionToWire,
  docToWire,
  docsEqual,
  insertMentionAtSelection,
  normalizeHandoffNoteDoc,
  normalizeSelection,
  resolveDocArrowMove,
  selectionsEqual,
  spliceDocSelection,
  wireOffsetToCollapsedSelection,
  wireToDoc,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
} from "@caliper/core";
import { parseHandoffNoteDomToDoc, renderHandoffNoteDoc } from "./handoff-note-dom.js";
import {
  createHandoffNoteHistory,
  isRedoKeyboardEvent,
  isUndoKeyboardEvent,
  type HandoffNoteHistorySnapshot,
} from "./handoff-note-history.js";
import { flattenHandoffNoteLog, logCaretTrace } from "../handoff-note-debug.js";
import {
  getDocAnchorRect,
  readDocSelection,
  repairDocSelectionIfNeeded,
  resolveDomVerticalArrowMove,
  setDocSelection,
} from "./handoff-note-selection.js";

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
  getHighlightedAgentId?: () => string | null;
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
  const history = createHandoffNoteHistory();

  const onDocumentSelectionChange = () => {
    if (suppressDomSelectionSync || !root || composing) {
      return;
    }
    const native = root.ownerDocument.getSelection();
    if (!native?.rangeCount || !root.contains(native.anchorNode)) {
      return;
    }
    const live = readDocSelection(root, doc);
    selection = normalizeSelection(doc, live, { from: selection.focus });
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
    logCaretTrace(`syncWireOut>>${source}`, {
      wire,
      selection,
      liveCursor: root ? docPosToWireOffset(doc, selection.focus) : 0,
    });
    lastEmittedWire = wire;
    options.onWireChange(wire);
  };

  const writeSelection = (nextSelection: HandoffNoteSelection, source: string) => {
    const priorFocus = selection.focus;
    selection = normalizeSelection(doc, nextSelection, { from: priorFocus });
    if (!root) {
      return;
    }
    const requestedWire = docPosToWireOffset(doc, selection.focus);
    suppressDomSelectionSync = true;
    try {
      setDocSelection(root, doc, selection, {
        from: priorFocus,
        source,
      });
    } finally {
      suppressDomSelectionSync = false;
    }
    const live = readDocSelection(root, doc);
    const liveWire = docPosToWireOffset(doc, live.focus);
    if (liveWire < requestedWire) {
      logCaretTrace(`writeSelection>>keepAuthority>>${source}`, {
        requested: selection.focus,
        requestedWire,
        live: live.focus,
        liveWire,
      });
      return;
    }
    selection = normalizeSelection(doc, live, { from: priorFocus });
  };

  const renderDoc = (nextSelection: HandoffNoteSelection, source: string) => {
    if (!root) {
      selection = normalizeSelection(doc, nextSelection);
      return;
    }
    const wire = docToWire(doc);
    renderHandoffNoteDoc(root, doc, {
      colorByAgentId: options.getColorByAgentId(),
      highlightedAgentId: options.getHighlightedAgentId?.() ?? null,
    });
    writeSelection(nextSelection, `render.${source}`);
    logCaretTrace(`render>>${source}`, {
      wire,
      requestedSelection: nextSelection,
      liveSelection: selection,
    });
  };

  const syncSelectionFromDom = (): HandoffNoteSelection => {
    if (!root) {
      return selection;
    }
    const priorFocus = selection.focus;
    const live = readDocSelection(root, doc);
    if (
      live.anchor.nodeIndex !== live.focus.nodeIndex ||
      live.anchor.nodeOffset !== live.focus.nodeOffset
    ) {
      selection = normalizeSelection(doc, live, { from: priorFocus });
      return selection;
    }
    const focus = repairDocSelectionIfNeeded(root, doc, priorFocus);
    selection = collapsedSelection(focus);
    const priorWire = docPosToWireOffset(doc, priorFocus);
    const liveWire = docPosToWireOffset(doc, live.focus);
    const resolvedWire = docPosToWireOffset(doc, focus);
    if (liveWire !== resolvedWire) {
      logCaretTrace("syncSelectionFromDom", {
        priorFocus,
        priorWire,
        liveFocus: live.focus,
        liveWire,
        resolvedFocus: focus,
        resolvedWire,
      });
    }
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
    const normalized = normalizeHandoffNoteDoc(nextDoc);
    const resolvedSelection = normalizeSelection(normalized, nextSelection, {
      from: selection.focus,
    });
    if (record) {
      recordMutation();
    }
    doc = normalized;
    selection = resolvedSelection;
    renderDoc(resolvedSelection, source);
    syncWireOut(source);
    resize();
  };

  const mutateSelection = (focus: HandoffNoteDocPos, source: string) => {
    const nextSelection = collapsedSelection(focus);
    if (!root) {
      selection = normalizeSelection(doc, nextSelection);
      return;
    }
    writeSelection(nextSelection, source);
    flattenHandoffNoteLog(`caret>>${source}`, {
      selectionIn: selection,
      selectionOut: readDocSelection(root, doc),
    });
  };

  const restoreSnapshot = (snapshot: HandoffNoteHistorySnapshot) => {
    history.runRestore(() => {
      doc = normalizeHandoffNoteDoc(snapshot.doc);
      selection = normalizeSelection(doc, snapshot.selection);
      renderDoc(selection, "restoreSnapshot");
      syncWireOut("restoreSnapshot");
      options.onResize?.();
      resize();
    });
  };

  const resize = () => {
    if (!root) {
      return;
    }
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
        root.ownerDocument.removeEventListener("selectionchange", onDocumentSelectionChange);
      }
      root = next;
      if (root) {
        root.ownerDocument.addEventListener("selectionchange", onDocumentSelectionChange);
      }
    },

    getDoc: () => doc,
    getSelectionState: () => cloneSelection(selection),

    setDocFromWire(wire, wireCursor, setOptions) {
      if (setOptions?.resetHistory) {
        history.clear();
      }
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

      flattenHandoffNoteLog("ce.importWire", {
        wire,
        wireCursor,
        changed,
        selectionChanged,
        priorWire: docToWire(doc),
      });

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
      renderDoc(selection, "importWire.changed");
      resize();
      syncWireOut("importWire.changed");
      lastEmittedWire = wire;
    },

    refreshPresentation() {
      if (!root) {
        return;
      }
      renderHandoffNoteDoc(root, doc, {
        colorByAgentId: options.getColorByAgentId(),
        highlightedAgentId: options.getHighlightedAgentId?.() ?? null,
      });
    },

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
      const result = spliceDocSelection(doc, active.anchor, active.focus, "");
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
      const live = readDocSelection(root, doc);
      mutate(parseHandoffNoteDomToDoc(root), live, "compositionEnd", true);
      selection = collapsedSelection(repairDocSelectionIfNeeded(root, doc, selection.focus));
    },

    handleBeforeInput(event) {
      if (!root || composing || event.isComposing) {
        return;
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
        const deleted = applyDocDelete(doc, active, direction);
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
        event.preventDefault();
        const result = applyDocInsertText(doc, active, replacement);
        flattenHandoffNoteLog("ce.beforeInput>>insertText", {
          selection: active,
          replacement,
          nextSelection: result.selection,
        });
        mutate(result.doc, result.selection, "beforeInput.insertText", true);
        return;
      }

      if (event.inputType === "insertLineBreak") {
        event.preventDefault();
        const focusWire = docPosToWireOffset(doc, active.focus);
        const boundary = describeHandoffNoteCursorContext(doc, focusWire);
        const result = applyDocLineBreak(doc, active);
        const resolvedWire = docPosToWireOffset(result.doc, result.selection.focus);
        const focusKind = doc.nodes[active.focus.nodeIndex]?.type;
        flattenHandoffNoteLog("ce.beforeInput>>insertLineBreak", {
          selection: active,
          nextSelection: result.selection,
          focusKind,
          focusWire,
          resolvedWire,
          branch:
            boundary.kind === "mention-boundary" && boundary.edge === "start"
              ? focusKind === "mention"
                ? "mention-boundary-start.fromMentionAtom"
                : "mention-boundary-start.fromText"
              : "plain",
        });
        mutate(result.doc, result.selection, "beforeInput.insertLineBreak", true);
      }
    },

    handleInput() {
      if (!root || composing) {
        return;
      }
      syncSelectionFromDom();
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

      const active = syncSelectionFromDom();
      const collapsed =
        active.anchor.nodeIndex === active.focus.nodeIndex &&
        active.anchor.nodeOffset === active.focus.nodeOffset;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        if (!collapsed) {
          return false;
        }
        const direction = event.key === "ArrowLeft" ? "left" : "right";
        const move = resolveDocArrowMove(doc, active.focus, direction);
        if (!move.handled) {
          return false;
        }
        event.preventDefault();
        mutateSelection(move.pos, "arrowKey");
        return true;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        if (!collapsed || !root) {
          return false;
        }
        const direction = event.key === "ArrowUp" ? "up" : "down";
        const move = resolveDomVerticalArrowMove(root, doc, active.focus, direction);
        if (!move.handled) {
          return false;
        }
        event.preventDefault();
        mutateSelection(move.pos, "arrowKey");
        return true;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        if (!collapsed) {
          return false;
        }
        const deleted = applyDocDelete(
          doc,
          active,
          event.key === "Backspace" ? "backspace" : "delete"
        );
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
