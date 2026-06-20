import {
  applyDocDelete,
  applyDocInsertText,
  applyDocLineBreak,
  cloneSelection,
  collapsedSelection,
  describeHandoffNoteCursorContext,
  docEndPos,
  docPosEqual,
  docPosToWireOffset,
  docSelectionToWire,
  docToWire,
  docsEqual,
  insertMentionAtSelection,
  isArrow,
  isEmbeddedBlankBandProbeWire,
  normalizeDocPos,
  normalizeHandoffNoteDoc,
  normalizeSelection,
  resolveDocHorizontalArrowMove,
  selectionsEqual,
  spliceDocSelection,
  wireOffsetToCollapsedSelection,
  wireToDoc,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
} from "@caliper/core";
import {
  parseHandoffNoteDomToDoc,
  renderHandoffNoteDoc,
  updateMentionPresentation,
  isHandoffBlankAnchorElement,
  isHandoffMentionElement,
  isHandoffWireBreakElement,
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
  flattenHandoffNoteLog,
  handoffNoteLayoutProbe,
  handoffNoteSelectionSnapshot,
  logCaretTrace,
} from "../handoff-note-debug.js";
import {
  readDocSelection,
  repairDocSelectionIfNeeded,
  resolveDomVerticalArrowMove,
  setDocSelection,
} from "./handoff-note-selection.js";
import {
  domPointToDocPos,
  domRectAnchorMidY,
  getDocAnchorRect,
} from "./handoff-note-dom-points.js";
import {
  buildHandoffNoteLayoutMap,
  invalidateHandoffNoteLayoutCache,
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

  const classifyNativeAnchor = (node: Node | null): { kind: string; parentKind: string | null } => {
    if (!node) {
      return { kind: "none", parentKind: null };
    }
    const parent = node.parentNode;
    const classify = (target: Node | null): string => {
      if (!target) {
        return "none";
      }
      if (target.nodeType === Node.TEXT_NODE) {
        const parentEl = target.parentNode;
        if (isHandoffBlankAnchorElement(parentEl)) {
          return "blankAnchorText";
        }
        if (parentEl && isHandoffMentionElement(parentEl)) {
          return "mentionText";
        }
        return "text";
      }
      if (isHandoffBlankAnchorElement(target)) {
        return "blankAnchor";
      }
      if (isHandoffWireBreakElement(target)) {
        return "wireBreak";
      }
      if (isHandoffMentionElement(target)) {
        return "mention";
      }
      if (target instanceof HTMLElement) {
        return target.tagName.toLowerCase();
      }
      return `node:${target.nodeType}`;
    };
    return { kind: classify(node), parentKind: classify(parent) };
  };

  const summarizeDomPoint = (container: Node | null, offset: number | null | undefined) => {
    if (!container || offset == null) {
      return null;
    }
    const text = container.nodeType === Node.TEXT_NODE ? (container.textContent ?? "") : null;
    let domChildIndex: number | null = null;
    if (root) {
      let current: Node | null = container;
      while (current && current.parentNode !== root) {
        current = current.parentNode;
      }
      if (current && current.parentNode === root) {
        domChildIndex = Array.prototype.indexOf.call(root.childNodes, current);
      }
    }
    return {
      ...classifyNativeAnchor(container),
      offset,
      domChildIndex,
      textLength: text?.length ?? null,
      textAround:
        text !== null
          ? text.slice(Math.max(0, offset - 12), Math.min(text.length, offset + 12))
          : container instanceof HTMLElement
            ? (container.textContent ?? "").slice(0, 40)
            : null,
    };
  };

  const reconcileSelectionFromDom = (source: "selectionchange" | "sync") => {
    if (!root) {
      return;
    }
    const priorFocus = selection.focus;
    const live = readDocSelection(root, doc);
    if (
      live.anchor.nodeIndex !== live.focus.nodeIndex ||
      live.anchor.nodeOffset !== live.focus.nodeOffset
    ) {
      selection = normalizeSelection(doc, live, { from: priorFocus });
      if (source === "selectionchange") {
        logCaretTrace("click>>selectionchange", {
          priorWire: docPosToWireOffset(doc, priorFocus),
          liveWire: docPosToWireOffset(doc, live.focus),
          resolvedWire: docPosToWireOffset(doc, selection.focus),
          repairMode: "nonCollapsed",
          adopted: "live",
        });
      }
      return;
    }
    const repairMode = source === "selectionchange" ? "strand-only" : "full";
    const focus = repairDocSelectionIfNeeded(root, doc, priorFocus, { mode: repairMode });
    selection = collapsedSelection(focus);
    const priorWire = docPosToWireOffset(doc, priorFocus);
    const liveWire = docPosToWireOffset(doc, live.focus);
    const resolvedWire = docPosToWireOffset(doc, focus);
    if (source === "selectionchange") {
      const liveRect = getDocAnchorRect(root, doc, live.focus);
      const native = root.ownerDocument.getSelection();
      const range = native && native.rangeCount > 0 ? native.getRangeAt(0) : null;
      const anchorNode = native?.anchorNode ?? null;
      const anchorOffset = native?.anchorOffset ?? null;
      const endContainer = range?.endContainer ?? null;
      const endOffset = range?.endOffset ?? null;
      const rawFromAnchor =
        anchorNode && anchorOffset !== null
          ? domPointToDocPos(root, doc, anchorNode, anchorOffset)
          : null;
      const rawFromRangeEnd =
        endContainer && endOffset !== null
          ? domPointToDocPos(root, doc, endContainer, endOffset)
          : null;
      const normalizedFromRangeEnd = rawFromRangeEnd
        ? normalizeDocPos(doc, rawFromRangeEnd, { from: rawFromRangeEnd })
        : null;
      logCaretTrace("click>>selectionchange", {
        priorWire,
        liveWire,
        resolvedWire,
        repairMode,
        adopted: liveWire === resolvedWire ? "live" : "repaired",
        liveIsBlankProbe: isEmbeddedBlankBandProbeWire(doc, liveWire),
        resolvedIsBlankProbe: isEmbeddedBlankBandProbeWire(doc, resolvedWire),
        liveCaretMidY: liveRect ? Math.round(domRectAnchorMidY(liveRect) * 100) / 100 : null,
        native: handoffNoteSelectionSnapshot(root),
        nativeAnchor: classifyNativeAnchor(anchorNode),
        nativeAnchorPoint: summarizeDomPoint(anchorNode, anchorOffset),
        rangeEndPoint: summarizeDomPoint(endContainer, endOffset),
        translate: {
          rawFromAnchor,
          rawFromAnchorWire: rawFromAnchor ? docPosToWireOffset(doc, rawFromAnchor) : null,
          rawFromRangeEnd,
          rawFromRangeEndWire: rawFromRangeEnd ? docPosToWireOffset(doc, rawFromRangeEnd) : null,
          normalizedFromRangeEnd,
          normalizedFromRangeEndWire: normalizedFromRangeEnd
            ? docPosToWireOffset(doc, normalizedFromRangeEnd)
            : null,
          liveFocus: live.focus,
        },
      });
    } else if (liveWire !== resolvedWire) {
      logCaretTrace(`reconcileSelectionFromDom>>${source}`, {
        priorFocus,
        priorWire,
        liveFocus: live.focus,
        liveWire,
        resolvedFocus: focus,
        resolvedWire,
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

  const writeSelection = (
    nextSelection: HandoffNoteSelection,
    source: string,
    afterRender: RenderOutcome = lastRenderOutcome
  ) => {
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
    if (liveWire !== requestedWire) {
      logCaretTrace(`writeSelection>>keepAuthority>>${source}`, {
        branch: liveWire < requestedWire ? "liveBehindRequested" : "liveAheadOfRequested",
        requested: selection.focus,
        requestedWire,
        live: live.focus,
        liveWire,
      });
      return;
    }
    if (
      liveWire === requestedWire &&
      !docPosEqual(selection.focus, live.focus) &&
      doc.nodes[selection.focus.nodeIndex]?.type === "mention" &&
      doc.nodes[live.focus.nodeIndex]?.type === "text"
    ) {
      logCaretTrace(`writeSelection>>keepAuthority>>${source}`, {
        branch: "mentionOverTextSameWire",
        requested: selection.focus,
        live: live.focus,
        wire: requestedWire,
      });
      return;
    }
    if (
      liveWire === requestedWire &&
      !docPosEqual(selection.focus, live.focus) &&
      doc.nodes[selection.focus.nodeIndex]?.type === "text" &&
      doc.nodes[live.focus.nodeIndex]?.type === "mention"
    ) {
      logCaretTrace(`writeSelection>>keepAuthority>>${source}`, {
        branch: "textOverMentionSameWire",
        requested: selection.focus,
        live: live.focus,
        wire: requestedWire,
      });
      return;
    }
    if (!afterRender.domReplaced) {
      return;
    }
    if (!docPosEqual(selection.focus, live.focus)) {
      logCaretTrace(`writeSelection>>acceptDom>>${source}`, {
        branch: "livePosMismatch",
        requested: selection.focus,
        requestedWire,
        live: live.focus,
        liveWire,
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
    const wire = docToWire(doc);
    lastRenderOutcome = renderHandoffNoteDoc(root, doc, presentationOptions(), {
      trustDoc: renderOptions?.trustDoc,
      previousDoc: renderOptions?.previousDoc,
    });
    if (lastRenderOutcome.docChanged) {
      invalidateHandoffNoteLayoutCache();
    }
    writeSelection(nextSelection, `render.${source}`, lastRenderOutcome);
    logCaretTrace(`render>>${source}`, {
      wire,
      requestedSelection: nextSelection,
      liveSelection: selection,
      renderOutcome: lastRenderOutcome,
    });
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
    const resolvedSelection = normalizeSelection(normalized, nextSelection, {
      from: selection.focus,
    });
    if (record) {
      recordMutation();
    }
    doc = normalized;
    selection = resolvedSelection;
    renderDoc(resolvedSelection, source, { trustDoc: true, previousDoc: prevDoc });
    syncWireOut(source);
    resize();
  };

  const mutateSelection = (focus: HandoffNoteDocPos, source: string, key?: string) => {
    selectedMentionNodeIndex = null;
    const priorFocus = selection.focus;
    const priorWire = docPosToWireOffset(doc, priorFocus);
    const requestedWire = docPosToWireOffset(doc, focus);
    const nextSelection = collapsedSelection(focus);
    if (!root) {
      selection = normalizeSelection(doc, nextSelection);
      return;
    }
    writeSelection(nextSelection, source);
    refreshMentionPresentation();
    const authorityWire = docPosToWireOffset(doc, selection.focus);
    const liveSelection = readDocSelection(root, doc);
    const liveWire = docPosToWireOffset(doc, liveSelection.focus);
    if (source === "arrowKey") {
      const layout = buildHandoffNoteLayoutMap(root, doc, selection.focus);
      const authorityRect = getDocAnchorRect(root, doc, selection.focus);
      const liveRect = getDocAnchorRect(root, doc, liveSelection.focus);
      const authorityRowIndex = layout.rowIndexForWire(authorityWire);
      const requestedRowIndex = layout.rowIndexForWire(requestedWire);
      const liveRowIndex = layout.rowIndexForWire(liveWire);
      const authorityRowTop =
        authorityRowIndex >= 0 ? layout.rows[authorityRowIndex]?.top : undefined;
      const authorityCaretMidY = authorityRect ? domRectAnchorMidY(authorityRect) : null;
      const liveCaretMidY = liveRect ? domRectAnchorMidY(liveRect) : null;
      logCaretTrace("arrowKey>>parity", {
        ...(key ? { key } : {}),
        priorWire,
        requestedWire,
        authorityWire,
        liveWire,
        priorRowIndex: layout.rowIndexForWire(priorWire),
        requestedRowIndex,
        authorityRowIndex,
        liveRowIndex,
        rowStep: authorityRowIndex - layout.rowIndexForWire(priorWire),
        wiresMatch: authorityWire === liveWire,
        docPosMatch: docPosEqual(selection.focus, liveSelection.focus),
        authorityCaretMidY: authorityCaretMidY ? Math.round(authorityCaretMidY * 100) / 100 : null,
        liveCaretMidY: liveCaretMidY ? Math.round(liveCaretMidY * 100) / 100 : null,
        authorityRowTop: authorityRowTop ? Math.round(authorityRowTop * 100) / 100 : null,
        caretRowMidDelta:
          authorityCaretMidY !== null && authorityRowTop !== undefined
            ? Math.round((authorityCaretMidY - authorityRowTop) * 100) / 100
            : null,
        layoutRowTops: layout.rows.map((row) => Math.round(row.top * 100) / 100),
      });
    }
    flattenHandoffNoteLog(`caret>>${source}`, {
      ...(key ? { key } : {}),
      selectionIn: priorFocus,
      selectionOut: liveSelection.focus,
    });
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
    invalidateHandoffNoteLayoutCache();
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
      invalidateHandoffNoteLayoutCache();
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

      const authorityBefore = docPosToWireOffset(doc, selection.focus);
      const active = syncSelectionFromDom();

      if (
        event.inputType === "deleteContentBackward" ||
        event.inputType === "deleteContentForward"
      ) {
        const direction = event.inputType === "deleteContentBackward" ? "backspace" : "delete";
        const activeWire = docPosToWireOffset(doc, active.focus);
        logCaretTrace(`delete>>ingress>>beforeInput.${direction}`, {
          authorityBefore,
          activeWire,
          wire: docToWire(doc),
        });
        const deleted = applyDocDelete(doc, active, direction);
        if (!deleted) {
          logCaretTrace(`delete>>noop>>beforeInput.${direction}`, {
            activeWire,
            wire: docToWire(doc),
          });
          return;
        }
        logCaretTrace(`delete>>applied>>beforeInput.${direction}`, {
          priorWire: activeWire,
          caretWire: docPosToWireOffset(deleted.doc, deleted.selection.focus),
          wire: docToWire(deleted.doc),
        });
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
        flattenHandoffNoteLog(
          "ce.layoutProbe",
          handoffNoteLayoutProbe(root, docToWire(result.doc))
        );
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

      const authorityBefore = docPosToWireOffset(doc, selection.focus);
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
        const activeWire = docPosToWireOffset(doc, active.focus);
        logCaretTrace(`delete>>ingress>>keydown.${event.key}`, {
          authorityBefore,
          activeWire,
          wire: docToWire(doc),
        });
        const deleted = applyDocDelete(
          doc,
          active,
          event.key === "Backspace" ? "backspace" : "delete"
        );
        if (!deleted) {
          logCaretTrace(`delete>>noop>>keydown.${event.key}`, {
            activeWire,
            wire: docToWire(doc),
          });
          return false;
        }
        logCaretTrace(`delete>>applied>>keydown.${event.key}`, {
          priorWire: activeWire,
          caretWire: docPosToWireOffset(deleted.doc, deleted.selection.focus),
          wire: docToWire(deleted.doc),
        });
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
