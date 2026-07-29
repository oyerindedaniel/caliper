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
import type { HandoffNoteVisualRowSeat } from "./handoff-note-embedded-newlines.js";
import { insertDocPosAfterEmbeddedBlankProbe } from "./handoff-note-embedded-newlines.js";
import {
  collapsedSelection,
  collapsedSelectionWithIntent,
  docPosAfterAmbiguousContentRowEndChar,
  isCaretOnContentCharBeforeNewline,
  docPosToWireOffset,
  expandSelectionFocusToDocEndIfNeeded,
  normalizeDocPos,
  normalizeSelection,
  type HandoffNoteCaretAffinity,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";

export type HandoffDocEditResult = {
  doc: HandoffNoteDoc;
  selection: HandoffNoteSelection;
};

export type HandoffNoteDeletePostLayoutRemount = {
  kind: "blank-stop";
  replacementBlankStopWire: number;
};

export type HandoffDocDeleteResult = HandoffDocEditResult & {
  postLayoutRemount?: HandoffNoteDeletePostLayoutRemount;
};

function selectionCollapsed(selection: HandoffNoteSelection): boolean {
  return (
    selection.anchor.nodeIndex === selection.focus.nodeIndex &&
    selection.anchor.nodeOffset === selection.focus.nodeOffset
  );
}

/** Delete caret policy: directional interior escape only (out of atom interior). */
export function snapDeleteCaretWire(
  doc: HandoffNoteDoc,
  wire: number,
  direction: HandoffNoteEdit
): number {
  const context = describeHandoffNoteCursorContext(doc, wire);
  if (context.kind === "mention-interior") {
    return direction === "backspace" ? context.end : context.start;
  }
  return wire;
}

function applyDeleteCaretPolicy(
  result: HandoffDocEditResult,
  direction: HandoffNoteEdit
): HandoffDocEditResult {
  const wire = docPosToWireOffset(result.doc, result.selection.focus);
  const resolved = snapDeleteCaretWire(result.doc, wire, direction);
  if (resolved === wire) {
    return result;
  }
  // Interior escape only — preserve affinity intent already stamped by delete intent.
  const affinity = result.selection.focusAffinity;
  const intent = affinity === "after" ? "content-row-end" : ("deletion-point" as const);
  return {
    ...result,
    selection: collapsedSelectionWithIntent(
      result.doc,
      normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, resolved)),
      intent
    ),
  };
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
  // Collapsed land goes through normalizeSelection so CRE past-end becomes last char + after.
  return {
    doc: next,
    selection: normalizeSelection(next, collapsedSelection(nextFocus)),
  };
}

function postLayoutRemountRequest(
  priorDoc: HandoffNoteDoc,
  result: HandoffDocEditResult,
  direction: HandoffNoteEdit,
  replacementBlankStopWire: number | undefined
): HandoffNoteDeletePostLayoutRemount | undefined {
  if (direction !== "delete" || docToWire(priorDoc) === docToWire(result.doc)) {
    return undefined;
  }
  if (replacementBlankStopWire !== undefined) {
    return { kind: "blank-stop", replacementBlankStopWire };
  }
  return undefined;
}

/**
 * Resolve a Delete's progressive land after the mutation has been rendered and
 * measured. Core owns the rule; the editor only supplies the replacement seat lattice.
 */
export function resolveHandoffNoteDeletePostLayoutRemount(
  result: HandoffDocDeleteResult,
  replacementSeats: readonly HandoffNoteVisualRowSeat[]
): HandoffDocEditResult {
  const request = result.postLayoutRemount;
  if (request?.kind === "blank-stop") {
    // Blank-collapse remount corrects only when the surviving blank sits on Delete's
    // primary side (visually below the provisional land). Snapping to a blank above
    // would climb against progressive trash after a correct down/ahead land.
    const blankIndex = replacementSeats.findIndex(
      (seat) => seat.kind === "blank" && seat.wire === request.replacementBlankStopWire
    );
    if (blankIndex < 0) {
      return result;
    }
    const focusWire = docPosToWireOffset(result.doc, result.selection.focus);
    let provisionalIndex = replacementSeats.findIndex((seat) => seat.wire === focusWire);
    if (provisionalIndex < 0) {
      for (let i = replacementSeats.length - 1; i >= 0; i--) {
        if (replacementSeats[i]!.wire <= focusWire) {
          provisionalIndex = i;
          break;
        }
      }
    }
    if (blankIndex <= provisionalIndex) {
      return result;
    }
    return {
      doc: result.doc,
      selection: collapsedSelectionWithIntent(
        result.doc,
        normalizeDocPos(
          result.doc,
          wireOffsetToDocPos(result.doc, replacementSeats[blankIndex]!.wire)
        ),
        "deletion-point"
      ),
    };
  }
  return result;
}

/**
 * Delete authority. `visualRowSeats` is the visual-row lattice progressive
 * land/collapse walks (see {@link resolveHandoffNoteDeleteIntent}). Callers must pass
 * the current paint-epoch seat set (including soft-wrap continuation rows when measured).
 * There is no fallback that derives seats from `doc` — omitting seats is a caller bug,
 * not a silent wire-line substitute.
 */
export function applyDocDelete(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  direction: HandoffNoteEdit,
  options: { visualRowSeats: readonly HandoffNoteVisualRowSeat[] }
): HandoffDocDeleteResult | null {
  if (!selectionCollapsed(selection)) {
    const anchor = normalizeDocPos(doc, selection.anchor);
    const focus = expandSelectionFocusToDocEndIfNeeded(
      doc,
      anchor,
      normalizeDocPos(doc, selection.focus)
    );
    return spliceDocSelection(doc, anchor, focus, "");
  }

  const intent = resolveHandoffNoteDeleteIntent(doc, selection, direction, options.visualRowSeats);
  if (!intent) {
    return null;
  }
  if (intent.kind === "noop") {
    return null;
  }

  const { result } = intent;
  const finalized = applyDeleteCaretPolicy(
    { doc: result.doc, selection: result.selection },
    direction
  );
  const postLayoutRemount = postLayoutRemountRequest(
    doc,
    finalized,
    direction,
    result.replacementBlankStopWire
  );
  return postLayoutRemount ? { ...finalized, postLayoutRemount } : finalized;
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

  const afterBlank = insertDocPosAfterEmbeddedBlankProbe(doc, focus);
  const insertFocus = insertDocPosAfterContentRowEndChar(doc, afterBlank, selection.focusAffinity);
  const focusWire = docPosToWireOffset(doc, insertFocus);
  const boundary = describeHandoffNoteCursorContext(doc, focusWire);

  if (replacement === "@") {
    if (boundary.kind === "mention-boundary" && boundary.edge === "end") {
      return insertAtSignOpeningSessionAfterMentionEnd(doc, boundary.end);
    }
    const mentionBefore = resolveMentionNodeIndexForAtSignBeforePill(doc, insertFocus, focusWire);
    if (mentionBefore !== null) {
      const mentionStartWire = docPosToWireOffset(doc, {
        nodeIndex: mentionBefore,
        nodeOffset: 0,
      });
      return insertAtSignOpeningSessionBeforeMentionStart(doc, mentionBefore, mentionStartWire);
    }
  }

  if (boundary.kind === "mention-boundary" && boundary.edge === "end") {
    const postMention = insertAfterMentionEndInFollowingText(
      doc,
      insertFocus,
      focusWire,
      replacement
    );
    if (postMention) {
      return postMention;
    }
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
      const result = appendInPreMentionText(doc, focus.nodeIndex + 1, replacement, {
        preserveSeparator: true,
      });
      if (result) {
        return result;
      }
    }
  }

  return snapInsertCaretToContentRowEnd(
    spliceDocSelection(doc, insertFocus, insertFocus, replacement),
    replacement
  );
}

/**
 * Insert position relative to an ambiguous CRE char.
 * - `before`: insert at the char (deletion-point).
 * - `after`: insert past the char (CRE) — including EOF last char.
 * - omit: append-after only before a following `\n` (row CRE default);
 *   EOF last char stays put so mention-end / spacer insert paths keep ownership.
 * Delete/affinity at EOF uses `isCaretOnAmbiguousContentRowEndChar` — separate gate.
 */
function insertDocPosAfterContentRowEndChar(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  focusAffinity?: HandoffNoteCaretAffinity
): HandoffNoteDocPos {
  if (focusAffinity === "before") {
    return pos;
  }
  if (focusAffinity === "after" || isCaretOnContentCharBeforeNewline(doc, pos)) {
    return docPosAfterAmbiguousContentRowEndChar(doc, pos);
  }
  return pos;
}

/**
 * After insert, rest on the last inserted char when splice left the caret on the
 * following `\n` (probe or content break) — Rule 4 content row end, not break paint.
 * Affinity `after` so the next keystroke appends.
 */
function snapInsertCaretToContentRowEnd(
  result: HandoffDocEditResult,
  replacement: string
): HandoffDocEditResult {
  if (replacement.length === 0 || replacement.includes("\n")) {
    return result;
  }
  const nextWire = docToWire(result.doc);
  const landed = docPosToWireOffset(result.doc, result.selection.focus);
  if (landed <= 0 || nextWire[landed] !== "\n" || nextWire[landed - 1] === "\n") {
    return result;
  }
  return {
    ...result,
    selection: collapsedSelectionWithIntent(
      result.doc,
      normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, landed - 1)),
      "content-row-end"
    ),
  };
}

function resolveFollowingTextIdxAfterMentionEnd(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): number | null {
  const node = doc.nodes[focus.nodeIndex];
  if (!node) {
    return null;
  }

  if (node.type === "mention") {
    const tokenLength = 1 + node.agentId.length;
    if (focus.nodeOffset < tokenLength) {
      return null;
    }
    const textIdx = focus.nodeIndex + 1;
    return doc.nodes[textIdx]?.type === "text" ? textIdx : null;
  }

  if (node.type === "text" && doc.nodes[focus.nodeIndex - 1]?.type === "mention") {
    return focus.nodeIndex;
  }

  return null;
}

function insertAfterMentionEndInFollowingText(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  focusWire: number,
  replacement: string
): HandoffDocEditResult | null {
  const boundary = describeHandoffNoteCursorContext(doc, focusWire);
  if (boundary.kind !== "mention-boundary" || boundary.edge !== "end") {
    return null;
  }

  const textIdx = resolveFollowingTextIdxAfterMentionEnd(doc, focus);
  if (textIdx === null) {
    return null;
  }

  const textNode = doc.nodes[textIdx];
  if (textNode?.type !== "text") {
    return null;
  }

  const insertOffset = 1;
  const nextText =
    textNode.text.slice(0, insertOffset) + replacement + textNode.text.slice(insertOffset);
  const next: HandoffNoteDoc = {
    nodes: doc.nodes.map((node, index) =>
      index === textIdx ? { type: "text", text: nextText } : node
    ),
  };
  const nextFocus = {
    nodeIndex: textIdx,
    nodeOffset: insertOffset + replacement.length,
  };
  return {
    doc: next,
    selection: collapsedSelection(normalizeDocPos(next, nextFocus)),
  };
}

function isSingleRowWhitespacePreMentionGap(text: string): boolean {
  return /^\s+$/.test(text) && !/[\n\r]/.test(text);
}

/**
 * Typed `@` immediately before a committed pill — mention atom start, pre-mention
 * text-tail alias at that wire, or caret on same-row whitespace still ahead of the pill.
 */
function resolveMentionNodeIndexForAtSignBeforePill(
  doc: HandoffNoteDoc,
  insertFocus: HandoffNoteDocPos,
  focusWire: number
): number | null {
  const node = doc.nodes[insertFocus.nodeIndex];
  if (node?.type === "mention" && insertFocus.nodeOffset === 0) {
    return insertFocus.nodeIndex;
  }
  if (node?.type === "text") {
    const next = doc.nodes[insertFocus.nodeIndex + 1];
    if (next?.type !== "mention") {
      return null;
    }
    const mentionNodeIndex = insertFocus.nodeIndex + 1;
    const mentionStartWire = docPosToWireOffset(doc, {
      nodeIndex: mentionNodeIndex,
      nodeOffset: 0,
    });
    if (insertFocus.nodeOffset >= node.text.length || focusWire === mentionStartWire) {
      return mentionNodeIndex;
    }
    const suffix = node.text.slice(insertFocus.nodeOffset);
    if (suffix.length > 0 && /^\s+$/.test(suffix) && !/[\n\r]/.test(suffix)) {
      return mentionNodeIndex;
    }
  }
  return null;
}

/**
 * Typed `@` at a committed mention boundary opens a new `@query` session.
 * Wire keeps a spacer so the typed `@` never glues to the pill (`@@id`).
 * Focus lands on the typed `@` — session parse rejects mention-boundary wires.
 */
function insertAtSignOpeningSessionAfterMentionEnd(
  doc: HandoffNoteDoc,
  mentionEndWire: number
): HandoffDocEditResult {
  const insertAt = wireOffsetToDocPos(doc, mentionEndWire);
  const spliced = spliceDocSelection(doc, insertAt, insertAt, " @");
  const atWire = mentionEndWire + 1;
  return {
    doc: spliced.doc,
    selection: collapsedSelection(
      normalizeDocPos(spliced.doc, wireOffsetToDocPos(spliced.doc, atWire))
    ),
  };
}

function insertAtSignOpeningSessionBeforeMentionStart(
  doc: HandoffNoteDoc,
  mentionNodeIndex: number,
  mentionStartWire: number
): HandoffDocEditResult {
  const textIdx = mentionNodeIndex - 1;
  const textNode = doc.nodes[textIdx];
  if (textNode?.type === "text") {
    const atOffset = textNode.text.length;
    const nextText = `${textNode.text}@ `;
    const next: HandoffNoteDoc = {
      nodes: doc.nodes.map((node, index) =>
        index === textIdx ? { type: "text", text: nextText } : node
      ),
    };
    return {
      doc: next,
      selection: collapsedSelection(
        normalizeDocPos(next, { nodeIndex: textIdx, nodeOffset: atOffset })
      ),
    };
  }

  const insertAt = wireOffsetToDocPos(doc, mentionStartWire);
  const spliced = spliceDocSelection(doc, insertAt, insertAt, "@ ");
  return {
    doc: spliced.doc,
    selection: collapsedSelection(
      normalizeDocPos(spliced.doc, wireOffsetToDocPos(spliced.doc, mentionStartWire))
    ),
  };
}

function appendInPreMentionText(
  doc: HandoffNoteDoc,
  mentionNodeIndex: number,
  replacement: string,
  options?: { preserveSeparator?: boolean }
): HandoffDocEditResult | null {
  const textIdx = mentionNodeIndex - 1;
  const textNode = doc.nodes[textIdx];
  if (textNode?.type !== "text") {
    return null;
  }
  const preserveSeparator =
    options?.preserveSeparator === true && isSingleRowWhitespacePreMentionGap(textNode.text);
  const nextText = preserveSeparator
    ? `${textNode.text}${replacement} `
    : textNode.text + replacement;
  const focusOffset = preserveSeparator
    ? textNode.text.length + replacement.length
    : nextText.length;
  const next: HandoffNoteDoc = {
    nodes: doc.nodes.map((node, index) =>
      index === textIdx ? { type: "text", text: nextText } : node
    ),
  };
  return {
    doc: next,
    selection: collapsedSelection(
      normalizeDocPos(next, { nodeIndex: textIdx, nodeOffset: focusOffset })
    ),
  };
}

/**
 * After Shift+Enter (or selection replace with `\n`), land on the new empty line slot.
 * Insert advanced the caret by one wire unit past the break point.
 */
function selectionAfterLineBreak(
  result: HandoffDocEditResult,
  priorWire: number,
  options?: { bias?: "end" }
): HandoffDocEditResult {
  const caretWire = priorWire + 1;
  return {
    doc: result.doc,
    selection: collapsedSelection(
      normalizeDocPos(result.doc, wireOffsetToDocPos(result.doc, caretWire), options)
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
    return selectionAfterLineBreak(spliceDocSelection(doc, insertPos, insertPos, "\n"), priorWire);
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
      return selectionAfterLineBreak(result, priorWire);
    }
  }

  const result = spliceDocSelection(doc, focus, focus, "\n");

  if (atContentEnd && !hadNewlineSuffix) {
    return selectionAfterLineBreak(result, priorWire);
  }

  if (inNewlineRun) {
    const nextTextNode = result.doc.nodes[normalized.nodeIndex];
    if (run.afterMention && nextTextNode?.type === "text") {
      return selectionAfterLineBreak(result, priorWire, { bias: "end" });
    }
    return selectionAfterLineBreak(result, priorWire);
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

function traceLineBreakDispatch(
  branch: string,
  priorWire: number,
  result: HandoffDocEditResult
): void {
  if (!isHandoffNoteEnvTraceEnabled("HANDOFF_NOTE_LINE_BREAK_TRACE")) {
    return;
  }
  const resolvedWire = docPosToWireOffset(result.doc, result.selection.focus);
  console.log(
    "[handoff-note] insert>>lineBreak.dispatch",
    JSON.stringify({
      branch,
      priorWire,
      resolvedWire,
      resultWire: docToWire(result.doc),
      resultFocus: result.selection.focus,
      resultAffinity: result.selection.focusAffinity ?? null,
    })
  );
}

function finishLineBreak(
  branch: string,
  priorWire: number,
  result: HandoffDocEditResult
): HandoffDocEditResult {
  traceLineBreakDispatch(branch, priorWire, result);
  return result;
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

  // Pill-start break owns the atom edge — do not CRE-advance past a commit spacer first.
  if (boundary.kind === "mention-boundary" && boundary.edge === "start") {
    const fromMentionAtom = doc.nodes[focus.nodeIndex]?.type === "mention";
    return finishLineBreak(
      fromMentionAtom ? "mention-boundary.fromMentionAtom" : "mention-boundary.fromText",
      focusWire,
      applyMentionBoundaryLineBreak(doc, boundary.start)
    );
  }

  // Same insert-after gate as typed insert: CRE/`after` (and omit before `\n`) splice past
  // the focused char so a post-mention commit spacer is not pulled under the break.
  const insertFocus = insertDocPosAfterContentRowEndChar(doc, focus, selection.focusAffinity);
  const insertWire = docPosToWireOffset(doc, insertFocus);

  const run = describeLineBreakCaretRun(doc, docToWire(doc), insertWire);
  if (run !== null && (run.afterMention || run.beforeMention)) {
    return finishLineBreak(
      "line-break-caret",
      insertWire,
      applyLineBreakCaretPolicy(doc, insertFocus)
    );
  }

  if (isOnContentLineBeforeNewlineMention(doc, insertFocus)) {
    const mentionStartWire = docPosToWireOffset(doc, {
      nodeIndex: insertFocus.nodeIndex + 1,
      nodeOffset: 0,
    });
    return finishLineBreak(
      "before-newline-mention",
      insertWire,
      applyMentionBoundaryLineBreak(doc, mentionStartWire)
    );
  }

  return finishLineBreak(
    "plain.splice",
    insertWire,
    spliceDocSelection(doc, insertFocus, insertFocus, "\n")
  );
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
  // Land on the first post-atom content char as ordinary CRE (`after`). If the atom
  // abuts a row break with no content char yet, CRE is the char before that break.
  const wire = docToWire(next);
  const afterMentionWire = startWire + 1 + agentId.length;
  let landWire = Math.min(afterMentionWire, docLength(next));
  if (landWire < wire.length && wire[landWire] === "\n" && landWire > 0) {
    landWire -= 1;
  }
  const focus = normalizeDocPos(next, wireOffsetToDocPos(next, landWire));
  return {
    doc: next,
    selection: collapsedSelectionWithIntent(next, focus, "content-row-end"),
  };
}
