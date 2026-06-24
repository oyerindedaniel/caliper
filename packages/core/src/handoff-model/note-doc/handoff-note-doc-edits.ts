import { resolveMentionQueryMultilineInsert } from "../utils/handoff-note.js";
import {
  describeLineBreakCaretRun,
  isHandoffNoteEnvTraceEnabled,
  lineBreakSuffixStartInText,
  traceLineBreakCaretBoundary,
} from "./handoff-note-line-break-caret.js";
import {
  describeHandoffNoteCursorContext,
  docLength,
  docToWire,
  insertMentionAt,
  spliceDocWireRange,
  type HandoffNoteDoc,
  type HandoffNoteEdit,
} from "./handoff-note-doc.js";
import { resolveHandoffNoteDeleteIntent } from "./handoff-note-delete-intent.js";
import {
  embeddedBlankBandContentRowEndBeforeProbe,
  embeddedBlankBandHasSubstantiveRowAbove,
  insertDocPosAfterEmbeddedBlankProbe,
  isEmbeddedBlankBandProbeWire,
  resolveEmbeddedBlankBandEofLineBreakCaretWire,
  type HandoffBlankBandDeleteOptions,
} from "./handoff-note-embedded-newlines.js";
import {
  collapsedSelection,
  docPosToWireOffset,
  normalizeDocPos,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";

export type HandoffDocEditResult = {
  doc: HandoffNoteDoc;
  selection: HandoffNoteSelection;
  chipBeforeBlankBand?: boolean;
};

export type HandoffDocDeleteContext = HandoffBlankBandDeleteOptions;

type HandoffDeleteCaretSnapOptions = {
  mentionRemoved?: boolean;
  preserveMentionInterior?: boolean;
};

type HandoffDeleteFinalizeOptions = HandoffDeleteCaretSnapOptions & {
  chipBeforeBlankBand?: boolean;
};

function selectionCollapsed(selection: HandoffNoteSelection): boolean {
  return (
    selection.anchor.nodeIndex === selection.focus.nodeIndex &&
    selection.anchor.nodeOffset === selection.focus.nodeOffset
  );
}

/** Delete caret policy: no resting inside committed pills; content-row end after mention delete at probe. */
export function snapDeleteCaretWire(
  doc: HandoffNoteDoc,
  wire: number,
  direction: HandoffNoteEdit,
  options?: HandoffDeleteCaretSnapOptions
): number {
  const context = describeHandoffNoteCursorContext(doc, wire);
  if (context.kind === "mention-interior") {
    // Directional pair: backspace → mention-end, delete → mention-start (default).
    // preserveMentionInterior is the backspace-only chip landing flag; delete symmetry uses
    // mentionRemoved + content-row-end snap at probes, not interior preservation.
    if (options?.preserveMentionInterior && direction === "backspace") {
      return wire;
    }
    return direction === "backspace" ? context.end : context.start;
  }
  if (
    options?.mentionRemoved &&
    isEmbeddedBlankBandProbeWire(doc, wire) &&
    embeddedBlankBandHasSubstantiveRowAbove(docToWire(doc), wire)
  ) {
    return embeddedBlankBandContentRowEndBeforeProbe(doc, wire);
  }
  return wire;
}

function applyDeleteCaretPolicy(
  result: HandoffDocEditResult,
  direction: HandoffNoteEdit,
  options?: HandoffDeleteCaretSnapOptions
): HandoffDocEditResult {
  const wire = docPosToWireOffset(result.doc, result.selection.focus);
  const resolved = snapDeleteCaretWire(result.doc, wire, direction, options);
  if (resolved === wire) {
    return result;
  }
  return {
    ...result,
    selection: collapsedSelection(
      normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, resolved))
    ),
  };
}

function finalizeDeleteResult(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  direction: HandoffNoteEdit,
  options?: HandoffDeleteFinalizeOptions
): HandoffDocEditResult {
  const base: HandoffDocEditResult = options?.chipBeforeBlankBand
    ? { doc, selection, chipBeforeBlankBand: true }
    : { doc, selection };
  return applyDeleteCaretPolicy(base, direction, options);
}

export function spliceDocSelection(
  doc: HandoffNoteDoc,
  anchor: HandoffNoteDocPos,
  focus: HandoffNoteDocPos,
  insertion: string
): HandoffDocEditResult {
  const anchorWire = docPosToWireOffset(doc, anchor);
  const focusWire = docPosToWireOffset(doc, focus);
  const start = Math.min(anchorWire, focusWire);
  const end = Math.max(anchorWire, focusWire);
  const next = spliceDocWireRange(doc, start, end, insertion);
  const cursorWire = start + insertion.length;
  const nextFocus = normalizeDocPos(next, wireOffsetToDocPos(next, cursorWire));
  return { doc: next, selection: collapsedSelection(nextFocus) };
}

export function applyDocDelete(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  direction: HandoffNoteEdit,
  context?: HandoffDocDeleteContext
): HandoffDocEditResult | null {
  if (!selectionCollapsed(selection)) {
    return spliceDocSelection(doc, selection.anchor, selection.focus, "");
  }

  const intent = resolveHandoffNoteDeleteIntent(doc, selection, direction, context);
  if (!intent) {
    return null;
  }
  if (intent.kind === "noop") {
    return null;
  }

  const { result } = intent;
  if (result.caretPolicyOnly) {
    return applyDeleteCaretPolicy({ doc: result.doc, selection: result.selection }, direction);
  }

  return finalizeDeleteResult(result.doc, result.selection, direction, {
    chipBeforeBlankBand: result.chipBeforeBlankBand,
    preserveMentionInterior: result.preserveMentionInterior,
    mentionRemoved: result.mentionRemoved,
  });
}

function applyMentionQueryMultilineInsert(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  replacement: string
): HandoffDocEditResult | null {
  const focus = normalizeDocPos(doc, selection.focus);
  const wire = docToWire(doc);
  const cursor = docPosToWireOffset(doc, focus);
  const active = resolveMentionQueryMultilineInsert(wire, cursor);
  if (!active) {
    return null;
  }

  const insertAt = active.queryStart + 1;
  const gapSlice = wire.slice(insertAt, cursor);
  if (!gapSlice.includes("\n")) {
    return null;
  }

  const newQuery = active.query + replacement;
  return spliceDocSelection(doc, wireOffsetToDocPos(doc, insertAt), focus, newQuery);
}

export function applyDocInsertText(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  replacement: string
): HandoffDocEditResult {
  if (!selectionCollapsed(selection)) {
    return spliceDocSelection(doc, selection.anchor, selection.focus, replacement);
  }

  const focus = normalizeDocPos(doc, selection.focus);
  const multilineQueryInsert = applyMentionQueryMultilineInsert(doc, selection, replacement);
  if (multilineQueryInsert) {
    return multilineQueryInsert;
  }

  const insertFocus = insertDocPosAfterEmbeddedBlankProbe(doc, focus);
  const focusWire = docPosToWireOffset(doc, insertFocus);
  const boundary = describeHandoffNoteCursorContext(doc, focusWire);

  if (boundary.kind === "mention-boundary" && boundary.edge === "end" && replacement === "@") {
    const insert = " @";
    return spliceDocSelection(
      doc,
      wireOffsetToDocPos(doc, boundary.end),
      wireOffsetToDocPos(doc, boundary.end),
      insert
    );
  }

  const nextNode = doc.nodes[focus.nodeIndex + 1];
  if (
    boundary.kind === "mention-boundary" &&
    boundary.edge === "start" &&
    doc.nodes[focus.nodeIndex]?.type === "mention"
  ) {
    const result = appendInPreMentionText(doc, focus.nodeIndex, replacement);
    if (result) {
      return result;
    }
    return spliceDocSelection(
      doc,
      wireOffsetToDocPos(doc, boundary.start),
      wireOffsetToDocPos(doc, boundary.start),
      replacement
    );
  }

  const textNode = doc.nodes[focus.nodeIndex];
  if (textNode?.type === "text" && nextNode?.type === "mention") {
    const atTrailingEdge = focus.nodeOffset >= textNode.text.length;
    if (atTrailingEdge) {
      const result = appendInPreMentionText(doc, focus.nodeIndex + 1, replacement);
      if (result) {
        return result;
      }
    }
  }

  return spliceDocSelection(doc, insertFocus, insertFocus, replacement);
}

function appendInPreMentionText(
  doc: HandoffNoteDoc,
  mentionNodeIndex: number,
  replacement: string
): HandoffDocEditResult | null {
  const textIdx = mentionNodeIndex - 1;
  const textNode = doc.nodes[textIdx];
  if (textNode?.type !== "text") {
    return null;
  }
  const nextText = textNode.text + replacement;
  const next: HandoffNoteDoc = {
    nodes: doc.nodes.map((node, index) =>
      index === textIdx ? { type: "text", text: nextText } : node
    ),
  };
  return {
    doc: next,
    selection: collapsedSelection(
      normalizeDocPos(next, { nodeIndex: textIdx, nodeOffset: nextText.length })
    ),
  };
}

function applyLineBreakCaretPolicy(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): HandoffDocEditResult {
  const priorWire = docPosToWireOffset(doc, focus);
  const normalized = normalizeDocPos(doc, focus);
  const wire = docToWire(doc);
  const run = describeLineBreakCaretRun(doc, wire, priorWire);
  if (run === null) {
    return spliceDocSelection(doc, focus, focus, "\n");
  }

  const textNode = doc.nodes[normalized.nodeIndex];
  if (textNode?.type !== "text") {
    return spliceDocSelection(doc, focus, focus, "\n");
  }

  const hadNewlineSuffix = textNode.text.length > lineBreakSuffixStartInText(textNode.text);
  const atContentEnd = run.atLastContent;
  const inNewlineRun = run.inSuffix;

  if (atContentEnd && hadNewlineSuffix && run.beforeMention && !run.afterMention && !inNewlineRun) {
    const insertPos = wireOffsetToDocPos(doc, run.suffixStartWire);
    const result = spliceDocSelection(doc, insertPos, insertPos, "\n");
    const resolvedWire = priorWire + 1;
    return {
      doc: result.doc,
      selection: collapsedSelection(
        normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, resolvedWire))
      ),
    };
  }

  if (atContentEnd && hadNewlineSuffix && run.afterMention && !inNewlineRun) {
    const insertPos = wireOffsetToDocPos(doc, run.suffixStartWire);
    const result = spliceDocSelection(doc, insertPos, insertPos, "\n");
    const nextTextNode = result.doc.nodes[normalized.nodeIndex];
    if (nextTextNode?.type === "text") {
      const resolvedWire = priorWire + 1;
      traceLineBreakCaretBoundary("line-break-after-mention-step", {
        priorWire,
        resolvedWire,
        requestedWire: priorWire,
      });
      return {
        doc: result.doc,
        selection: collapsedSelection(
          normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, resolvedWire))
        ),
      };
    }
  }

  const result = spliceDocSelection(doc, focus, focus, "\n");

  if (atContentEnd && !hadNewlineSuffix) {
    const resolvedWire = priorWire + 1;
    traceLineBreakCaretBoundary("line-break-content-end-blank", {
      priorWire,
      resolvedWire,
      requestedWire: priorWire,
      afterMention: run.afterMention,
      beforeMention: run.beforeMention,
    });
    return {
      doc: result.doc,
      selection: collapsedSelection(
        normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, resolvedWire))
      ),
    };
  }

  if (inNewlineRun) {
    const nextTextNode = result.doc.nodes[normalized.nodeIndex];
    if (run.afterMention && nextTextNode?.type === "text") {
      const caretWire = priorWire + 1;
      return {
        doc: result.doc,
        selection: collapsedSelection(
          normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, caretWire), { bias: "end" })
        ),
      };
    }
    if (run.beforeMention && nextTextNode?.type === "text") {
      const caretWire = priorWire + 1;
      return {
        doc: result.doc,
        selection: collapsedSelection(
          normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, caretWire))
        ),
      };
    }
    const caretWire = priorWire + 1;
    return {
      doc: result.doc,
      selection: collapsedSelection(
        normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, caretWire))
      ),
    };
  }

  return result;
}

function isOnContentLineBeforeNewlineMention(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): boolean {
  const textNode = doc.nodes[focus.nodeIndex];
  const nextNode = doc.nodes[focus.nodeIndex + 1];
  if (textNode?.type !== "text" || nextNode?.type !== "mention") {
    return false;
  }
  if (!textNode.text.endsWith("\n")) {
    return false;
  }
  return focus.nodeOffset < textNode.text.length - 1;
}

function caretAfterMentionBoundaryLineBreak(
  textNodeIndex: number,
  priorText: string
): HandoffNoteDocPos {
  return { nodeIndex: textNodeIndex, nodeOffset: priorText.length };
}

/** Phase 3 — enable with HANDOFF_NOTE_LINE_BREAK_TRACE=1 */
function traceLineBreakDispatch(
  branch: string,
  priorWire: number,
  result: HandoffDocEditResult
): void {
  if (!isHandoffNoteEnvTraceEnabled("HANDOFF_NOTE_LINE_BREAK_TRACE")) {
    return;
  }
  console.log(
    JSON.stringify({
      event: "lineBreak.dispatch",
      branch,
      priorWire,
      resolvedWire: docPosToWireOffset(result.doc, result.selection.focus),
    })
  );
}

function finishLineBreak(
  branch: string,
  priorWire: number,
  result: HandoffDocEditResult
): HandoffDocEditResult {
  traceLineBreakDispatch(branch, priorWire, result);
  const resolvedWire = docPosToWireOffset(result.doc, result.selection.focus);
  if (resolveMentionQueryMultilineInsert(docToWire(result.doc), docToWire(result.doc).length)) {
    return result;
  }
  const caretWire = resolveEmbeddedBlankBandEofLineBreakCaretWire(result.doc, resolvedWire);
  if (caretWire === resolvedWire) {
    return result;
  }
  return {
    doc: result.doc,
    selection: collapsedSelection(
      normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, caretWire))
    ),
  };
}

function applyMentionBoundaryLineBreak(
  doc: HandoffNoteDoc,
  mentionStartWire: number
): HandoffDocEditResult {
  const next = spliceDocWireRange(doc, mentionStartWire, mentionStartWire, "\n");
  const mentionPos = wireOffsetToDocPos(next, mentionStartWire + 1);
  const textNodeIndex = mentionPos.nodeIndex - 1;
  const prior = next.nodes[textNodeIndex];
  if (prior?.type === "text") {
    const caretPos = caretAfterMentionBoundaryLineBreak(textNodeIndex, prior.text);
    return {
      doc: next,
      selection: collapsedSelection(normalizeDocPos(next, caretPos)),
    };
  }
  return {
    doc: next,
    selection: collapsedSelection(
      normalizeDocPos(next, { nodeIndex: mentionPos.nodeIndex, nodeOffset: 0 })
    ),
  };
}

export function applyDocLineBreak(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection
): HandoffDocEditResult {
  if (!selectionCollapsed(selection)) {
    const anchorWire = docPosToWireOffset(doc, selection.anchor);
    return finishLineBreak(
      "plain.selection",
      anchorWire,
      spliceDocSelection(doc, selection.anchor, selection.focus, "\n")
    );
  }

  const focus = normalizeDocPos(doc, selection.focus);
  const focusWire = docPosToWireOffset(doc, focus);
  const boundary = describeHandoffNoteCursorContext(doc, focusWire);

  if (boundary.kind === "mention-boundary" && boundary.edge === "start") {
    const fromMentionAtom = doc.nodes[focus.nodeIndex]?.type === "mention";
    return finishLineBreak(
      fromMentionAtom ? "mention-boundary.fromMentionAtom" : "mention-boundary.fromText",
      focusWire,
      applyMentionBoundaryLineBreak(doc, boundary.start)
    );
  }

  const run = describeLineBreakCaretRun(doc, docToWire(doc), focusWire);
  if (run !== null && (run.afterMention || run.beforeMention)) {
    return finishLineBreak("line-break-caret", focusWire, applyLineBreakCaretPolicy(doc, focus));
  }

  if (isOnContentLineBeforeNewlineMention(doc, focus)) {
    const mentionStartWire = docPosToWireOffset(doc, {
      nodeIndex: focus.nodeIndex + 1,
      nodeOffset: 0,
    });
    return finishLineBreak(
      "before-newline-mention",
      focusWire,
      applyMentionBoundaryLineBreak(doc, mentionStartWire)
    );
  }

  return finishLineBreak("plain.splice", focusWire, spliceDocSelection(doc, focus, focus, "\n"));
}

export function insertMentionAtSelection(
  doc: HandoffNoteDoc,
  agentId: string,
  replaceStart: HandoffNoteDocPos,
  replaceEnd: HandoffNoteDocPos
): HandoffDocEditResult {
  const startWire = docPosToWireOffset(doc, replaceStart);
  const endWire = docPosToWireOffset(doc, replaceEnd);
  const next = insertMentionAt(doc, agentId, startWire, endWire);
  const cursorWire = Math.min(startWire + `@${agentId} `.length, docLength(next));
  const focus = normalizeDocPos(next, wireOffsetToDocPos(next, cursorWire));
  return { doc: next, selection: collapsedSelection(focus) };
}
