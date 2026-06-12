import { resolveMentionQueryMultilineInsert } from "../utils/handoff-note.js";
import {
  describeHandoffNoteCursorContext,
  docLength,
  docToWire,
  insertMentionAt,
  spliceDocWireRange,
  type HandoffNoteDoc,
  type HandoffNoteEdit,
  resolveHandoffNoteMentionEdit,
} from "./handoff-note-doc.js";
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
};

function selectionCollapsed(selection: HandoffNoteSelection): boolean {
  return (
    selection.anchor.nodeIndex === selection.focus.nodeIndex &&
    selection.anchor.nodeOffset === selection.focus.nodeOffset
  );
}

function isInterMentionGap(doc: HandoffNoteDoc, focus: HandoffNoteDocPos): boolean {
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "text") {
    return false;
  }
  const prev = doc.nodes[focus.nodeIndex - 1];
  const next = doc.nodes[focus.nodeIndex + 1];
  return prev?.type === "mention" && next?.type === "mention";
}

function mentionsMergedAt(doc: HandoffNoteDoc, leftMentionIdx: number): boolean {
  return (
    doc.nodes[leftMentionIdx]?.type === "mention" &&
    doc.nodes[leftMentionIdx + 1]?.type === "mention"
  );
}

function caretAtMentionEnd(doc: HandoffNoteDoc, mentionNodeIndex: number): HandoffNoteDocPos {
  const node = doc.nodes[mentionNodeIndex]!;
  const tokenLength = node.type === "mention" ? 1 + node.agentId.length : 0;
  return { nodeIndex: mentionNodeIndex, nodeOffset: tokenLength };
}

function withCaretAfterInterMentionGapDelete(
  result: HandoffDocEditResult,
  gapNodeIndex: number
): HandoffDocEditResult {
  const leftMentionIdx = gapNodeIndex - 1;
  if (!mentionsMergedAt(result.doc, leftMentionIdx)) {
    return result;
  }
  return {
    doc: result.doc,
    selection: collapsedSelection(
      normalizeDocPos(result.doc, caretAtMentionEnd(result.doc, leftMentionIdx))
    ),
  };
}

function wasAtTextEndBeforeMention(doc: HandoffNoteDoc, focus: HandoffNoteDocPos): boolean {
  const textNode = doc.nodes[focus.nodeIndex];
  const nextNode = doc.nodes[focus.nodeIndex + 1];
  return (
    textNode?.type === "text" &&
    nextNode?.type === "mention" &&
    focus.nodeOffset === textNode.text.length
  );
}

function withCaretAtTextEndBeforeMention(
  doc: HandoffNoteDoc,
  result: HandoffDocEditResult,
  priorFocus: HandoffNoteDocPos
): HandoffDocEditResult {
  if (!wasAtTextEndBeforeMention(doc, priorFocus)) {
    return result;
  }
  const textNode = result.doc.nodes[priorFocus.nodeIndex];
  if (textNode?.type !== "text") {
    return result;
  }
  return {
    doc: result.doc,
    selection: collapsedSelection(
      normalizeDocPos(result.doc, {
        nodeIndex: priorFocus.nodeIndex,
        nodeOffset: textNode.text.length,
      })
    ),
  };
}

function applyBackspaceAtMentionStart(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): HandoffDocEditResult | null {
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "mention" || focus.nodeOffset !== 0) {
    return null;
  }

  const focusWire = docPosToWireOffset(doc, focus);
  const prev = doc.nodes[focus.nodeIndex - 1];

  if (prev?.type === "text" && prev.text.length > 0) {
    const textIdx = focus.nodeIndex - 1;
    const result = spliceDocSelection(doc, wireOffsetToDocPos(doc, focusWire - 1), focus, "");
    const textNode = result.doc.nodes[textIdx];
    if (textNode?.type === "text") {
      return {
        doc: result.doc,
        selection: collapsedSelection(
          normalizeDocPos(result.doc, {
            nodeIndex: textIdx,
            nodeOffset: textNode.text.length,
          })
        ),
      };
    }
    return result;
  }

  const end = focusWire + 1 + node.agentId.length;
  return spliceDocSelection(doc, focus, wireOffsetToDocPos(doc, end), "");
}

function isForwardDeleteNoOpAtAdjacentMentions(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): boolean {
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "mention") {
    return false;
  }
  const tokenLength = 1 + node.agentId.length;
  if (focus.nodeOffset <= 0) {
    return doc.nodes[focus.nodeIndex - 1]?.type === "mention";
  }
  if (focus.nodeOffset >= tokenLength) {
    return doc.nodes[focus.nodeIndex + 1]?.type === "mention";
  }
  return false;
}

function applyInterMentionGapDelete(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  direction: HandoffNoteEdit
): HandoffDocEditResult | null {
  const focus = normalizeDocPos(doc, selection.focus);
  if (!isInterMentionGap(doc, focus)) {
    return null;
  }

  const textNode = doc.nodes[focus.nodeIndex]!;
  if (textNode.type !== "text") {
    return null;
  }

  const gapNodeIndex = focus.nodeIndex;

  if (direction === "delete") {
    if (focus.nodeOffset >= textNode.text.length) {
      return null;
    }
    const focusWire = docPosToWireOffset(doc, focus);
    return withCaretAfterInterMentionGapDelete(
      spliceDocSelection(doc, focus, wireOffsetToDocPos(doc, focusWire + 1), ""),
      gapNodeIndex
    );
  }

  if (focus.nodeOffset > 0) {
    const focusWire = docPosToWireOffset(doc, focus);
    return withCaretAfterInterMentionGapDelete(
      withCaretAtTextEndBeforeMention(
        doc,
        spliceDocSelection(doc, wireOffsetToDocPos(doc, focusWire - 1), focus, ""),
        focus
      ),
      gapNodeIndex
    );
  }

  if (!textNode.text.length) {
    return null;
  }

  const focusWire = docPosToWireOffset(doc, focus);
  return withCaretAfterInterMentionGapDelete(
    spliceDocSelection(doc, focus, wireOffsetToDocPos(doc, focusWire + 1), ""),
    gapNodeIndex
  );
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
  direction: HandoffNoteEdit
): HandoffDocEditResult | null {
  if (!selectionCollapsed(selection)) {
    return spliceDocSelection(doc, selection.anchor, selection.focus, "");
  }

  const focus = normalizeDocPos(doc, selection.focus);
  if (selectionCollapsed(selection) && isInterMentionGap(doc, focus)) {
    return applyInterMentionGapDelete(doc, selection, direction);
  }

  if (direction === "delete" && isForwardDeleteNoOpAtAdjacentMentions(doc, focus)) {
    return null;
  }

  const focusWire = docPosToWireOffset(doc, focus);

  if (direction === "backspace") {
    const mentionStartBackspace = applyBackspaceAtMentionStart(doc, focus);
    if (mentionStartBackspace) {
      return mentionStartBackspace;
    }
  }

  const mentionEdit = resolveHandoffNoteMentionEdit(doc, focusWire, direction);
  if (mentionEdit) {
    return {
      doc: mentionEdit.doc,
      selection: collapsedSelection(
        normalizeDocPos(mentionEdit.doc, wireOffsetToDocPos(mentionEdit.doc, mentionEdit.cursor))
      ),
    };
  }

  if (direction === "backspace") {
    if (focusWire <= 0) {
      return null;
    }
    return withCaretAtTextEndBeforeMention(
      doc,
      spliceDocSelection(doc, wireOffsetToDocPos(doc, focusWire - 1), focus, ""),
      focus
    );
  }

  if (focusWire >= docLength(doc)) {
    return null;
  }
  return spliceDocSelection(doc, focus, wireOffsetToDocPos(doc, focusWire + 1), "");
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

  const focusWire = docPosToWireOffset(doc, focus);
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

  return spliceDocSelection(doc, focus, focus, replacement);
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
  next: HandoffNoteDoc,
  textNodeIndex: number,
  priorText: string,
  mentionStartWire: number,
  fromMentionAtom: boolean
): HandoffNoteDocPos {
  const newlineOffset = priorText.length - 1;

  if (fromMentionAtom) {
    const beforeNewline = priorText.slice(0, newlineOffset);
    if (beforeNewline.trim().length > 0) {
      const contentEndPos = wireOffsetToDocPos(next, Math.max(0, mentionStartWire - 1));
      if (contentEndPos.nodeIndex === textNodeIndex && contentEndPos.nodeOffset < newlineOffset) {
        return contentEndPos;
      }
    }
    return { nodeIndex: textNodeIndex, nodeOffset: priorText.length };
  }

  return { nodeIndex: textNodeIndex, nodeOffset: priorText.length };
}

function applyMentionBoundaryLineBreak(
  doc: HandoffNoteDoc,
  mentionStartWire: number,
  fromMentionAtom: boolean
): HandoffDocEditResult {
  const next = spliceDocWireRange(doc, mentionStartWire, mentionStartWire, "\n");
  const mentionPos = wireOffsetToDocPos(next, mentionStartWire + 1);
  const textNodeIndex = mentionPos.nodeIndex - 1;
  const prior = next.nodes[textNodeIndex];
  if (prior?.type === "text") {
    const caretPos = caretAfterMentionBoundaryLineBreak(
      next,
      textNodeIndex,
      prior.text,
      mentionStartWire,
      fromMentionAtom
    );
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
    const result = spliceDocSelection(doc, selection.anchor, selection.focus, "\n");
    return result;
  }

  const focus = normalizeDocPos(doc, selection.focus);
  const focusWire = docPosToWireOffset(doc, focus);
  const boundary = describeHandoffNoteCursorContext(doc, focusWire);

  if (boundary.kind === "mention-boundary" && boundary.edge === "start") {
    const fromMentionAtom = doc.nodes[focus.nodeIndex]?.type === "mention";
    return applyMentionBoundaryLineBreak(doc, boundary.start, fromMentionAtom);
  }

  if (isOnContentLineBeforeNewlineMention(doc, focus)) {
    const mentionStartWire = docPosToWireOffset(doc, {
      nodeIndex: focus.nodeIndex + 1,
      nodeOffset: 0,
    });
    return applyMentionBoundaryLineBreak(doc, mentionStartWire, false);
  }

  return spliceDocSelection(doc, focus, focus, "\n");
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
