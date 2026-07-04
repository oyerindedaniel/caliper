import {
  cloneDoc,
  cloneSelection,
  docsStructurallyEqual,
  docToWire,
  mentionCountInDoc,
  type HandoffNoteDoc,
  type HandoffNoteSelection,
} from "@caliper/core";

export type HandoffNoteHistorySnapshot = {
  doc: HandoffNoteDoc;
  selection: HandoffNoteSelection;
};

type HandoffNoteUndoEntry = HandoffNoteHistorySnapshot & {
  recordedAt: number;
};

const DEFAULT_MAX_DEPTH = 100;
const TYPING_COALESCE_MS = 400;

function snapshotsEqual(a: HandoffNoteHistorySnapshot, b: HandoffNoteHistorySnapshot): boolean {
  return (
    docsStructurallyEqual(a.doc, b.doc) &&
    a.selection.anchor.nodeIndex === b.selection.anchor.nodeIndex &&
    a.selection.anchor.nodeOffset === b.selection.anchor.nodeOffset &&
    a.selection.focus.nodeIndex === b.selection.focus.nodeIndex &&
    a.selection.focus.nodeOffset === b.selection.focus.nodeOffset
  );
}

/**
 * Custom undo/redo for the handoff CE editor.
 * Browser-native undo is unreliable once we preventDefault mention edits and re-render DOM.
 */
export function createHandoffNoteHistory(options?: { maxDepth?: number }) {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  let undoStack: HandoffNoteUndoEntry[] = [];
  /** Snapshots only — no `recordedAt`; typing coalesce reads `undoStack`, not redo targets. */
  let redoStack: HandoffNoteHistorySnapshot[] = [];
  let composing = false;
  let restoring = false;

  const clear = () => {
    undoStack = [];
    redoStack = [];
  };

  const setComposing = (value: boolean) => {
    composing = value;
  };

  const isRestoring = () => restoring;

  const canUndo = () => undoStack.length > 0;
  const canRedo = () => redoStack.length > 0;

  const shouldCoalesceTyping = (
    previous: HandoffNoteUndoEntry,
    next: HandoffNoteHistorySnapshot
  ): boolean => {
    const elapsed = Date.now() - previous.recordedAt;
    if (elapsed > TYPING_COALESCE_MS) {
      return false;
    }
    const prevWire = docToWire(previous.doc);
    const nextWire = docToWire(next.doc);
    if (mentionCountInDoc(previous.doc) !== mentionCountInDoc(next.doc)) {
      return false;
    }
    if (nextWire === prevWire) {
      return true;
    }
    if (Math.abs(nextWire.length - prevWire.length) !== 1) {
      return false;
    }
    return nextWire.startsWith(prevWire) || prevWire.startsWith(nextWire);
  };

  const recordBefore = (snapshot: HandoffNoteHistorySnapshot) => {
    if (restoring || composing) {
      return;
    }

    const stored = {
      doc: cloneDoc(snapshot.doc),
      selection: cloneSelection(snapshot.selection),
    };

    const last = undoStack[undoStack.length - 1];
    if (last && shouldCoalesceTyping(last, stored)) {
      return;
    }
    if (last && snapshotsEqual(last, stored)) {
      return;
    }

    undoStack.push({ ...stored, recordedAt: Date.now() });
    if (undoStack.length > maxDepth) {
      undoStack.shift();
    }
    redoStack = [];
  };

  /** Clone for restore; drops undo-only fields such as `recordedAt`. */
  const cloneHistorySnapshot = (
    snapshot: HandoffNoteHistorySnapshot | HandoffNoteUndoEntry
  ): HandoffNoteHistorySnapshot => ({
    doc: cloneDoc(snapshot.doc),
    selection: cloneSelection(snapshot.selection),
  });

  const undo = (current: HandoffNoteHistorySnapshot): HandoffNoteHistorySnapshot | null => {
    if (!undoStack.length) {
      return null;
    }
    const previous = undoStack.pop()!;
    if (!snapshotsEqual(previous, current)) {
      redoStack.push({
        doc: cloneDoc(current.doc),
        selection: cloneSelection(current.selection),
      });
    }
    return cloneHistorySnapshot(previous);
  };

  const redo = (current: HandoffNoteHistorySnapshot): HandoffNoteHistorySnapshot | null => {
    if (!redoStack.length) {
      return null;
    }
    const next = redoStack.pop()!;
    if (!snapshotsEqual(next, current)) {
      undoStack.push({
        doc: cloneDoc(current.doc),
        selection: cloneSelection(current.selection),
        recordedAt: Date.now(),
      });
    }
    return cloneHistorySnapshot(next);
  };

  const runRestore = <T>(run: () => T): T => {
    restoring = true;
    try {
      return run();
    } finally {
      restoring = false;
    }
  };

  return {
    clear,
    setComposing,
    isRestoring,
    recordBefore,
    undo,
    redo,
    canUndo,
    canRedo,
    runRestore,
  };
}

export type HandoffNoteHistory = ReturnType<typeof createHandoffNoteHistory>;

export function isUndoKeyboardEvent(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  return (event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey;
}

export function isRedoKeyboardEvent(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  return (event.ctrlKey || event.metaKey) && (key === "y" || (key === "z" && event.shiftKey));
}
