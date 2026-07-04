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
  docPosAfterPartialContentRowChipBeforeProbe,
  docPosAfterEmptiedContentRowChipBeforeProbe,
  docAfterForwardMentionRemoveAbsorbAdjacentSpacer,
  docPosAtEmbeddedBlankBandProbeAliasLanding,
  docPosAtMentionStartTextAlias,
  docTextNodeHasEmbeddedNewline,
  embeddedBlankBandAtEmptyContentRowEnd,
  embeddedBlankBandRowAboveProbeIsEmpty,
  embeddedBlankBandSubstantiveContentAbutsProbe,
  insertDocPosAfterEmbeddedBlankProbe,
  isEmbeddedBlankBandDeleteProbeWire,
  isEmbeddedBlankBandProbeWire,
  listEmbeddedBlankBandProbeWires,
  blankBandDeleteBranchUsesContentRowEndLanding,
  blankBandDeleteBranchUsesProbeInfrastructureLanding,
  resolveBackspaceFromEmptyContentRowEnd,
  resolveDeleteFromEmptyContentRowEnd,
  resolveContentRowDeleteBeforeEmbeddedBlankBand,
  resolveEmbeddedBlankBandDelete,
  resolveEmbeddedBlankBandLineStartCollapse,
  resolveSubstantiveLineBreakJoin,
  resolveMentionDeleteRowClearChip,
  rowHasSubstantivePrefixBeforeMention,
  mentionStartGluedToPrefixInWire,
  type EmbeddedBlankBandDeleteMove,
} from "./handoff-note-embedded-newlines.js";

/** Raw delete outcome before caret snap is finalized in doc-edits. */
export type HandoffNoteDeleteIntentResult = {
  doc: HandoffNoteDoc;
  selection: HandoffNoteSelection;
  mentionRemoved?: boolean;
  /** Snap only — intent already finalized caret landing; omit mentionRemoved snap. */
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
  if (docTextNodeHasEmbeddedNewline(doc, focus.nodeIndex)) {
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

/** Land after last substantive char when prefix text ends with a single spacer before the pill. */
function textEndForRowPrefixBackspace(text: string): number {
  if (text.length >= 2 && text.endsWith(" ") && /\S/.test(text.slice(0, -1))) {
    return text.length - 1;
  }
  return text.length;
}

/** After gap merge, land where the next key's left/right neighbor matches user intent — not left mention end. */
function caretAfterInterMentionGapMerge(
  doc: HandoffNoteDoc,
  leftMentionIdx: number
): HandoffNoteDocPos {
  const rightMentionIdx = leftMentionIdx + 1;
  const prevNode = doc.nodes[leftMentionIdx - 1];
  if (prevNode?.type === "text" && /\S/.test(prevNode.text)) {
    const leftStartWire = docPosToWireOffset(doc, {
      nodeIndex: leftMentionIdx,
      nodeOffset: 0,
    });
    const wire = docToWire(doc);
    const lineStart = leftStartWire <= 0 ? 0 : wire.lastIndexOf("\n", leftStartWire - 1) + 1;
    if (/\S/.test(wire.slice(lineStart, leftStartWire))) {
      return normalizeDocPos(doc, {
        nodeIndex: leftMentionIdx - 1,
        nodeOffset: textEndForRowPrefixBackspace(prevNode.text),
      });
    }
  }
  return normalizeDocPos(doc, { nodeIndex: rightMentionIdx, nodeOffset: 0 });
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
    selection: collapsedSelection(caretAfterInterMentionGapMerge(result.doc, leftMentionIdx)),
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

/** True when another committed mention appears on the same row before mentionStartWire. */
function sameRowWireHasPriorMention(doc: HandoffNoteDoc, mentionStartWire: number): boolean {
  const wire = docToWire(doc);
  const lineStart = mentionStartWire <= 0 ? 0 : wire.lastIndexOf("\n", mentionStartWire - 1) + 1;
  return wire.slice(lineStart, mentionStartWire).includes("@");
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

  if (prev?.type === "mention") {
    const edit = resolveHandoffNoteMentionEdit(doc, focusWire, "backspace");
    if (edit) {
      return mentionRemoveIntentResult(doc, focusWire, edit, "backspace");
    }
    return null;
  }

  const end = focusWire + 1 + node.agentId.length;
  return spliceSelection(doc, focus, wireOffsetToDocPos(doc, end), "");
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

function probeWireAfterRowChip(doc: HandoffNoteDoc, caretWire: number): number {
  if (isEmbeddedBlankBandProbeWire(doc, caretWire)) {
    return caretWire;
  }
  if (caretWire + 1 < docToWire(doc).length && isEmbeddedBlankBandProbeWire(doc, caretWire + 1)) {
    return caretWire + 1;
  }
  return caretWire;
}

function blankBandSelectionFocus(
  doc: HandoffNoteDoc,
  caretWire: number,
  move?: Pick<EmbeddedBlankBandDeleteMove, "branch" | "probeInfrastructureLanding">
): HandoffNoteDocPos {
  if (move && blankBandDeleteBranchUsesContentRowEndLanding(move.branch)) {
    const probeWire = probeWireAfterRowChip(doc, caretWire);
    return docPosAfterPartialContentRowChipBeforeProbe(doc, probeWire);
  }
  const collapseLanding = move && blankBandDeleteBranchUsesProbeInfrastructureLanding(move.branch);
  if (
    collapseLanding &&
    move?.probeInfrastructureLanding !== false &&
    isEmbeddedBlankBandProbeWire(doc, caretWire)
  ) {
    return wireOffsetToDocPos(doc, caretWire);
  }
  if (move?.probeInfrastructureLanding === false) {
    for (const probe of listEmbeddedBlankBandProbeWires(doc)) {
      if (!embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)) {
        continue;
      }
      const mentionAlias = docPosAtEmbeddedBlankBandProbeAliasLanding(doc, probe);
      if (mentionAlias) {
        return mentionAlias;
      }
    }
  }
  const alias = docPosAtEmbeddedBlankBandProbeAliasLanding(doc, caretWire);
  if (alias) {
    return alias;
  }
  if (
    isEmbeddedBlankBandProbeWire(doc, caretWire) &&
    embeddedBlankBandRowAboveProbeIsEmpty(doc, caretWire)
  ) {
    return docPosAfterEmptiedContentRowChipBeforeProbe(doc, caretWire);
  }
  return wireOffsetToDocPos(doc, caretWire);
}

function blankCollapsePreservesMentionEndProbeAlias(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  focusWire: number
): boolean {
  return (
    handoffNoteCaretOnMentionNodeEnd(doc, focus) &&
    embeddedBlankBandSubstantiveContentAbutsProbe(doc, focusWire)
  );
}

function blankBandMoveFromEmptyRowEnd(
  doc: HandoffNoteDoc,
  move: EmbeddedBlankBandDeleteMove,
  focus: HandoffNoteDocPos,
  focusWire: number
): HandoffNoteDeleteIntentResult {
  if (!blankCollapsePreservesMentionEndProbeAlias(doc, focus, focusWire)) {
    return blankBandMoveToResult(doc, move);
  }
  return blankBandMoveToResult(doc, { ...move, probeInfrastructureLanding: false });
}

function blankBandMoveToResult(
  doc: HandoffNoteDoc,
  move: EmbeddedBlankBandDeleteMove
): HandoffNoteDeleteIntentResult {
  return {
    doc: move.doc,
    selection: collapsedSelection(
      normalizeDocPos(move.doc, blankBandSelectionFocus(move.doc, move.caretWire, move))
    ),
  };
}

function mentionRemoveIntentResult(
  priorDoc: HandoffNoteDoc,
  focusWire: number,
  mentionEdit: { doc: HandoffNoteDoc; cursor: number },
  direction: HandoffNoteEdit
): HandoffNoteDeleteIntentResult {
  const mentionStartWire = mentionEdit.cursor;
  const rowClearChip = resolveMentionDeleteRowClearChip(priorDoc, focusWire, mentionEdit.doc);
  let doc = mentionEdit.doc;
  let caretWire = rowClearChip?.caretWire ?? mentionStartWire;
  if (
    direction === "delete" &&
    !rowClearChip &&
    rowHasSubstantivePrefixBeforeMention(priorDoc, mentionStartWire) &&
    mentionStartGluedToPrefixInWire(priorDoc, mentionStartWire)
  ) {
    const absorbed = docAfterForwardMentionRemoveAbsorbAdjacentSpacer(doc, caretWire);
    doc = absorbed.doc;
    caretWire = absorbed.caretWire;
  }
  return {
    doc,
    selection: collapsedSelection(normalizeDocPos(doc, wireOffsetToDocPos(doc, caretWire))),
    mentionRemoved: true,
  };
}

function mentionNodeAbutsBlankBandProbe(
  doc: HandoffNoteDoc,
  mentionNodeIndex: number
): number | null {
  const endPos = caretAtMentionEnd(doc, mentionNodeIndex);
  const endWire = docPosToWireOffset(doc, endPos);
  if (!isEmbeddedBlankBandProbeWire(doc, endWire)) {
    return null;
  }
  return endWire;
}

function caretOnMentionAbuttingBlankBandProbe(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): number | null {
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "mention") {
    return null;
  }
  return mentionNodeAbutsBlankBandProbe(doc, focus.nodeIndex);
}

function resolveDeleteForwardFromMentionAbuttingProbe(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): HandoffNoteDeleteIntent | null {
  if (handoffNoteCaretOnMentionNodeStart(doc, focus)) {
    return null;
  }
  const probeWire = caretOnMentionAbuttingBlankBandProbe(doc, focus);
  if (probeWire === null) {
    return null;
  }
  const move = resolveEmbeddedBlankBandDelete(doc, probeWire, "delete", focus, {
    mentionEndCollapse: true,
  });
  if (move) {
    return {
      kind: "result",
      result: blankBandMoveToResult(doc, { ...move, probeInfrastructureLanding: false }),
    };
  }
  const emptyRowEnd = resolveDeleteFromEmptyContentRowEnd(doc, probeWire, focus);
  if (!emptyRowEnd) {
    return null;
  }
  return {
    kind: "result",
    result: blankBandMoveFromEmptyRowEnd(doc, emptyRowEnd, focus, probeWire),
  };
}

function resolveBackspaceOnMentionInteriorAbuttingProbe(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  focusWire: number
): HandoffNoteDeleteIntent | null {
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "mention") {
    return null;
  }
  const tokenLength = mentionTokenLength(node);
  if (focus.nodeOffset <= 0 || focus.nodeOffset >= tokenLength) {
    return null;
  }
  if (mentionNodeAbutsBlankBandProbe(doc, focus.nodeIndex) === null) {
    return null;
  }
  const edit = resolveHandoffNoteMentionEdit(doc, focusWire, "backspace");
  if (!edit) {
    return null;
  }
  return {
    kind: "result",
    result: mentionRemoveIntentResult(doc, focusWire, edit, "backspace"),
  };
}

/**
 * Boundary disambiguation — doc position beats wire index before blank-band chain.
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
        result: mentionRemoveIntentResult(doc, focusWire, edit, "backspace"),
      };
    }
  }

  if (direction === "delete" && wasAtTextEndBeforeMention(doc, focus)) {
    const wire = docToWire(doc);
    const lineStart = focusWire <= 0 ? 0 : wire.lastIndexOf("\n", focusWire - 1) + 1;
    const segment = wire.slice(lineStart, focusWire);
    if (segment.length > 0 && /\S/.test(segment) && sameRowWireHasPriorMention(doc, focusWire)) {
      return { kind: "noop" };
    }
    return null;
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
  direction: HandoffNoteEdit
): HandoffNoteDeleteIntent | null {
  const focus = normalizeDocPos(doc, selection.focus);
  const focusWire = docPosToWireOffset(doc, focus);

  if (direction === "backspace") {
    const interiorAbutting = resolveBackspaceOnMentionInteriorAbuttingProbe(doc, focus, focusWire);
    if (interiorAbutting) {
      return interiorAbutting;
    }
  }

  if (direction === "delete") {
    const forwardBlank = resolveDeleteForwardFromMentionAbuttingProbe(doc, focus);
    if (forwardBlank) {
      return forwardBlank;
    }
  }

  const boundary = resolveBoundaryDeleteIntent(doc, focusWire, direction, focus);
  if (boundary) {
    return boundary;
  }

  const contentBeforeBlankBand = resolveContentRowDeleteBeforeEmbeddedBlankBand(
    doc,
    focusWire,
    direction,
    focus
  );
  if (contentBeforeBlankBand) {
    return {
      kind: "result",
      result: blankBandMoveFromEmptyRowEnd(doc, contentBeforeBlankBand, focus, focusWire),
    };
  }

  let blankBandDelete = resolveEmbeddedBlankBandDelete(doc, focusWire, direction, focus);
  if (!blankBandDelete && direction === "delete" && handoffNoteCaretOnMentionNodeEnd(doc, focus)) {
    const abuttingProbe = listEmbeddedBlankBandProbeWires(doc).find((probe) =>
      embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)
    );
    if (abuttingProbe !== undefined) {
      blankBandDelete = resolveEmbeddedBlankBandDelete(doc, abuttingProbe, direction, focus, {
        mentionEndCollapse: true,
      });
    }
  }
  if (blankBandDelete) {
    return {
      kind: "result",
      result: blankBandMoveFromEmptyRowEnd(doc, blankBandDelete, focus, focusWire),
    };
  }

  if (direction === "backspace" && !blankCollapseBlockedAtAlias(doc, focus, focusWire)) {
    const emptyRowEnd = resolveBackspaceFromEmptyContentRowEnd(doc, focusWire, focus);
    if (emptyRowEnd) {
      return {
        kind: "result",
        result: blankBandMoveFromEmptyRowEnd(doc, emptyRowEnd, focus, focusWire),
      };
    }
  }

  if (direction === "delete" && !blankCollapseBlockedAtAlias(doc, focus, focusWire)) {
    const emptyRowEnd = resolveDeleteFromEmptyContentRowEnd(doc, focusWire, focus);
    if (emptyRowEnd) {
      return {
        kind: "result",
        result: blankBandMoveFromEmptyRowEnd(doc, emptyRowEnd, focus, focusWire),
      };
    }
  }

  const lineStartCollapse = resolveEmbeddedBlankBandLineStartCollapse(doc, focusWire);
  if (lineStartCollapse && (direction === "backspace" || direction === "delete")) {
    return { kind: "result", result: blankBandMoveToResult(doc, lineStartCollapse) };
  }

  const lineBreakJoin = resolveSubstantiveLineBreakJoin(doc, focusWire, direction);
  if (lineBreakJoin) {
    return { kind: "result", result: blankBandMoveToResult(doc, lineBreakJoin) };
  }

  const gapResult = applyInterMentionGapDelete(doc, selection, direction);
  if (isInterMentionGap(doc, focus)) {
    if (gapResult) {
      return { kind: "result", result: { ...gapResult, caretPolicyOnly: true } };
    }
    return { kind: "noop" };
  }

  if (direction === "backspace") {
    const mentionStartBackspace = applyBackspaceAtMentionStart(doc, focus);
    if (mentionStartBackspace) {
      return { kind: "result", result: { ...mentionStartBackspace, caretPolicyOnly: true } };
    }
  }

  const mentionEdit = resolveHandoffNoteMentionEdit(doc, focusWire, direction);
  if (mentionEdit) {
    return {
      kind: "result",
      result: mentionRemoveIntentResult(doc, focusWire, mentionEdit, "delete"),
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

  if (direction === "delete") {
    const wire = docToWire(doc);
    if (
      embeddedBlankBandAtEmptyContentRowEnd(doc, focusWire, focus) &&
      focusWire + 1 >= wire.length
    ) {
      return { kind: "noop" };
    }
    if (isEmbeddedBlankBandDeleteProbeWire(doc, focusWire, focus)) {
      return { kind: "noop" };
    }
    if (focusWire >= docLength(doc)) {
      return { kind: "noop" };
    }
    const deletedChar = wire[focusWire]!;
    const spliced = spliceSelection(doc, focus, wireOffsetToDocPos(doc, focusWire + 1), "");
    const textAlias = docPosAtMentionStartTextAlias(spliced.doc, focusWire);
    if (textAlias && /^\s$/.test(deletedChar)) {
      return {
        kind: "result",
        result: {
          doc: spliced.doc,
          selection: collapsedSelection(normalizeDocPos(spliced.doc, textAlias)),
        },
      };
    }
    return {
      kind: "result",
      result: spliced,
    };
  }

  return { kind: "noop" };
}
