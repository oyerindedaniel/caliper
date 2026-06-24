import {
  describeHandoffNoteCursorContext,
  docLength,
  docToWire,
  resolveHandoffNoteMentionEdit,
  spliceDocWireRange,
  type HandoffNoteDoc,
  type HandoffNoteEdit,
} from "./handoff-note-doc.js";
import {
  collapsedSelection,
  docPosToWireOffset,
  normalizeDocPos,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import {
  docPosAtEmbeddedBlankBandProbeAliasLanding,
  embeddedBlankBandSubstantiveContentAbutsProbe,
  insertDocPosAfterEmbeddedBlankProbe,
  isEmbeddedBlankBandProbeWire,
  resolveBackspaceFromEmptyContentRowEnd,
  resolveDeleteFromEmptyContentRowEnd,
  resolveEmbeddedBlankBandDelete,
  resolveEmbeddedBlankBandLineStartCollapse,
  resolveRowChipBeforeEmbeddedBlankProbe,
  type EmbeddedBlankBandDeleteMove,
  type HandoffBlankBandDeleteOptions,
} from "./handoff-note-embedded-newlines.js";

/** Raw delete outcome before caret snap / chip flags are finalized in doc-edits. */
export type HandoffNoteDeleteIntentResult = {
  doc: HandoffNoteDoc;
  selection: HandoffNoteSelection;
  chipBeforeBlankBand?: boolean;
  preserveMentionInterior?: boolean;
  mentionRemoved?: boolean;
  /** Skip finalizeDeleteResult — caller runs applyDeleteCaretPolicy only. */
  caretPolicyOnly?: boolean;
};

export type HandoffNoteDeleteIntent =
  | { kind: "noop" }
  | { kind: "result"; result: HandoffNoteDeleteIntentResult };

function mentionTokenLength(node: HandoffNoteDoc["nodes"][number]): number {
  return node.type === "mention" ? 1 + node.agentId.length : 0;
}

/** Doc position rests on committed mention-end (not text-node alias at same wire). */
export function handoffNoteCaretOnMentionNodeEnd(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): boolean {
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "mention") {
    return false;
  }
  return focus.nodeOffset >= mentionTokenLength(node);
}

/** Doc position rests on committed mention-start. */
export function handoffNoteCaretOnMentionNodeStart(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): boolean {
  const node = doc.nodes[focus.nodeIndex];
  return node?.type === "mention" && focus.nodeOffset === 0;
}

/** Wire aliases content row end with first probe after substantive abuts (post-spacer chip). */
export function handoffNoteIsMentionEndProbeAliasWire(
  doc: HandoffNoteDoc,
  focusWire: number
): boolean {
  const context = describeHandoffNoteCursorContext(doc, focusWire);
  const semanticEnd = context.kind === "mention-boundary" && context.edge === "end";
  return (
    semanticEnd &&
    isEmbeddedBlankBandProbeWire(doc, focusWire) &&
    embeddedBlankBandSubstantiveContentAbutsProbe(doc, focusWire)
  );
}

function handoffNoteSpacerBeforeProbeRowChip(doc: HandoffNoteDoc, focusWire: number): boolean {
  const wire = docToWire(doc);
  const ch = wire[focusWire];
  return (
    ch !== undefined &&
    /\s/.test(ch) &&
    focusWire + 1 < wire.length &&
    isEmbeddedBlankBandProbeWire(doc, focusWire + 1)
  );
}

function isInterMentionGap(doc: HandoffNoteDoc, focus: HandoffNoteDocPos): boolean {
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "text") {
    return false;
  }
  const prev = doc.nodes[focus.nodeIndex - 1];
  const next = doc.nodes[focus.nodeIndex + 1];
  if (!(prev?.type === "mention" && next?.type === "mention")) {
    return false;
  }
  const focusWire = docPosToWireOffset(doc, focus);
  return !handoffNoteSpacerBeforeProbeRowChip(doc, focusWire);
}

function spliceSelection(
  doc: HandoffNoteDoc,
  anchor: HandoffNoteDocPos,
  focus: HandoffNoteDocPos,
  insertion: string
): HandoffNoteDeleteIntentResult {
  const anchorWire = docPosToWireOffset(doc, anchor);
  const focusWire = docPosToWireOffset(doc, focus);
  const start = Math.min(anchorWire, focusWire);
  const end = Math.max(anchorWire, focusWire);
  const next = spliceDocWireRange(doc, start, end, insertion);
  const cursorWire = start + insertion.length;
  const nextFocus = normalizeDocPos(next, wireOffsetToDocPos(next, cursorWire));
  return { doc: next, selection: collapsedSelection(nextFocus) };
}

function mentionsMergedAt(doc: HandoffNoteDoc, leftMentionIdx: number): boolean {
  return (
    doc.nodes[leftMentionIdx]?.type === "mention" &&
    doc.nodes[leftMentionIdx + 1]?.type === "mention"
  );
}

function caretAtMentionEnd(doc: HandoffNoteDoc, mentionNodeIndex: number): HandoffNoteDocPos {
  const node = doc.nodes[mentionNodeIndex]!;
  return { nodeIndex: mentionNodeIndex, nodeOffset: mentionTokenLength(node) };
}

function withCaretAfterInterMentionGapDelete(
  result: HandoffNoteDeleteIntentResult,
  gapNodeIndex: number
): HandoffNoteDeleteIntentResult {
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
  result: HandoffNoteDeleteIntentResult,
  priorFocus: HandoffNoteDocPos
): HandoffNoteDeleteIntentResult {
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
): HandoffNoteDeleteIntentResult | null {
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "mention" || focus.nodeOffset !== 0) {
    return null;
  }

  const focusWire = docPosToWireOffset(doc, focus);
  const prev = doc.nodes[focus.nodeIndex - 1];

  if (prev?.type === "text" && prev.text.length > 0) {
    const textIdx = focus.nodeIndex - 1;
    const result = spliceSelection(doc, wireOffsetToDocPos(doc, focusWire - 1), focus, "");
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
  return spliceSelection(doc, focus, wireOffsetToDocPos(doc, end), "");
}

function isForwardDeleteNoOpAtAdjacentMentions(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): boolean {
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "mention") {
    return false;
  }
  const tokenLength = mentionTokenLength(node);
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
): HandoffNoteDeleteIntentResult | null {
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
      spliceSelection(doc, focus, wireOffsetToDocPos(doc, focusWire + 1), ""),
      gapNodeIndex
    );
  }

  if (focus.nodeOffset > 0) {
    const focusWire = docPosToWireOffset(doc, focus);
    return withCaretAfterInterMentionGapDelete(
      withCaretAtTextEndBeforeMention(
        doc,
        spliceSelection(doc, wireOffsetToDocPos(doc, focusWire - 1), focus, ""),
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
    spliceSelection(doc, focus, wireOffsetToDocPos(doc, focusWire + 1), ""),
    gapNodeIndex
  );
}

function blankBandMoveToResult(
  doc: HandoffNoteDoc,
  move: EmbeddedBlankBandDeleteMove
): HandoffNoteDeleteIntentResult {
  return {
    doc: move.doc,
    selection: collapsedSelection(
      normalizeDocPos(move.doc, wireOffsetToDocPos(move.doc, move.caretWire))
    ),
    chipBeforeBlankBand: move.chipBeforeBlankBand,
    preserveMentionInterior: move.preserveMentionInterior,
  };
}

/**
 * Boundary disambiguation — doc position beats wire index before blank-band chain.
 * Backspace: mention node end → atomic remove (not blank collapse).
 * Delete: mention node end at content row end → no forward nip on populated row.
 */
function resolveBoundaryDeleteIntent(
  doc: HandoffNoteDoc,
  focusWire: number,
  direction: HandoffNoteEdit,
  focus: HandoffNoteDocPos
): HandoffNoteDeleteIntent | null {
  if (direction === "backspace" && handoffNoteCaretOnMentionNodeEnd(doc, focus)) {
    if (handoffNoteSpacerBeforeProbeRowChip(doc, focusWire)) {
      return null;
    }
    if (isInterMentionGap(doc, focus) && focus.nodeOffset === 0) {
      return null;
    }
    const edit = resolveHandoffNoteMentionEdit(doc, focusWire, "backspace");
    if (edit) {
      return {
        kind: "result",
        result: {
          doc: edit.doc,
          selection: collapsedSelection(
            normalizeDocPos(edit.doc, wireOffsetToDocPos(edit.doc, edit.cursor))
          ),
          mentionRemoved: true,
        },
      };
    }
  }

  if (
    direction === "delete" &&
    handoffNoteCaretOnMentionNodeEnd(doc, focus) &&
    handoffNoteIsMentionEndProbeAliasWire(doc, focusWire)
  ) {
    return { kind: "noop" };
  }

  if (direction === "delete" && wasAtTextEndBeforeMention(doc, focus)) {
    return { kind: "noop" };
  }

  return null;
}

function blankCollapseBlockedAtAlias(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  focusWire: number
): boolean {
  return (
    handoffNoteCaretOnMentionNodeEnd(doc, focus) &&
    handoffNoteIsMentionEndProbeAliasWire(doc, focusWire)
  );
}

/**
 * Single delete authority — resolves meaning before any splice. Called by applyDocDelete.
 */
export function resolveHandoffNoteDeleteIntent(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  direction: HandoffNoteEdit,
  context?: HandoffBlankBandDeleteOptions
): HandoffNoteDeleteIntent | null {
  const focus = normalizeDocPos(doc, selection.focus);
  const focusWire = docPosToWireOffset(doc, focus);

  const boundary = resolveBoundaryDeleteIntent(doc, focusWire, direction, focus);
  if (boundary) {
    return boundary;
  }

  const blankBandDelete = resolveEmbeddedBlankBandDelete(doc, focusWire, direction, context);
  if (blankBandDelete) {
    return { kind: "result", result: blankBandMoveToResult(doc, blankBandDelete) };
  }

  if (direction === "backspace" && !blankCollapseBlockedAtAlias(doc, focus, focusWire)) {
    const emptyRowEnd = resolveBackspaceFromEmptyContentRowEnd(doc, focusWire, context);
    if (emptyRowEnd) {
      return { kind: "result", result: blankBandMoveToResult(doc, emptyRowEnd) };
    }
  }

  if (direction === "delete" && !blankCollapseBlockedAtAlias(doc, focus, focusWire)) {
    const emptyRowEnd = resolveDeleteFromEmptyContentRowEnd(doc, focusWire, context);
    if (emptyRowEnd) {
      return { kind: "result", result: blankBandMoveToResult(doc, emptyRowEnd) };
    }
  }

  const lineStartCollapse = resolveEmbeddedBlankBandLineStartCollapse(doc, focusWire, context);
  if (lineStartCollapse && (direction === "backspace" || direction === "delete")) {
    return { kind: "result", result: blankBandMoveToResult(doc, lineStartCollapse) };
  }

  const gapResult = applyInterMentionGapDelete(doc, selection, direction);
  if (isInterMentionGap(doc, focus)) {
    if (gapResult) {
      return { kind: "result", result: { ...gapResult, caretPolicyOnly: true } };
    }
    return { kind: "noop" };
  }

  if (direction === "delete" && isForwardDeleteNoOpAtAdjacentMentions(doc, focus)) {
    return { kind: "noop" };
  }

  if (direction === "backspace") {
    const mentionStartBackspace = applyBackspaceAtMentionStart(doc, focus);
    if (mentionStartBackspace) {
      return { kind: "result", result: { ...mentionStartBackspace, caretPolicyOnly: true } };
    }
  }

  const rowChip = resolveRowChipBeforeEmbeddedBlankProbe(doc, focusWire);
  if (rowChip) {
    const mentionLanding = docPosAtEmbeddedBlankBandProbeAliasLanding(
      rowChip.doc,
      rowChip.caretWire
    );
    const focusPos = mentionLanding ?? wireOffsetToDocPos(rowChip.doc, rowChip.caretWire);
    return {
      kind: "result",
      result: {
        doc: rowChip.doc,
        selection: collapsedSelection(normalizeDocPos(rowChip.doc, focusPos)),
        chipBeforeBlankBand: rowChip.chipBeforeBlankBand,
        preserveMentionInterior: rowChip.preserveMentionInterior,
      },
    };
  }

  const mentionEdit = resolveHandoffNoteMentionEdit(doc, focusWire, direction);
  if (mentionEdit) {
    return {
      kind: "result",
      result: {
        doc: mentionEdit.doc,
        selection: collapsedSelection(
          normalizeDocPos(mentionEdit.doc, wireOffsetToDocPos(mentionEdit.doc, mentionEdit.cursor))
        ),
        mentionRemoved: true,
      },
    };
  }

  if (direction === "backspace") {
    if (focusWire <= 0) {
      return { kind: "noop" };
    }
    const deleteFocus = insertDocPosAfterEmbeddedBlankProbe(doc, focus);
    const deleteFocusWire = docPosToWireOffset(doc, deleteFocus);
    if (deleteFocusWire <= 0) {
      return { kind: "noop" };
    }
    return {
      kind: "result",
      result: withCaretAtTextEndBeforeMention(
        doc,
        spliceSelection(doc, wireOffsetToDocPos(doc, deleteFocusWire - 1), deleteFocus, ""),
        focus
      ),
    };
  }

  if (focusWire + 1 >= docLength(doc)) {
    return { kind: "noop" };
  }

  return {
    kind: "result",
    result: spliceSelection(doc, focus, wireOffsetToDocPos(doc, focusWire + 1), ""),
  };
}
