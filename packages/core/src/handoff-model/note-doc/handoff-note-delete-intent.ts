import {
  docLength,
  docToWire,
  resolveHandoffNoteMentionEdit,
  spliceDocWireRange,
  type HandoffNoteDoc,
  type HandoffNoteEdit,
} from "./handoff-note-doc.js";
import {
  collapsedSelection,
  collapsedSelectionWithIntent,
  docPosToWireOffset,
  isAtomicNode,
  nodeTokenLength,
  normalizeDocPos,
  resolveDirectionalUnitFocus,
  type HandoffNoteCaretLandingIntent,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import {
  docPosAtAtomicStartTextAlias,
  docTextNodeHasEmbeddedNewline,
  embeddedBlankBandContentRowEndBeforeProbe,
  embeddedBlankBandHasSubstantiveRowAbove,
  embeddedBlankBandSubstantiveContentAbutsProbe,
  embeddedBlankBandSpacerBeforeProbeRowChip,
  insertDocPosAfterEmbeddedBlankProbe,
  isEmbeddedBlankBandCollapseProbeWire,
  isEmbeddedBlankBandProbeWire,
  isTextOwnedSameRowWhitespaceAtWire,
  resolveBackspaceFromEmptyContentRowEnd,
  resolveDeleteFromEmptyContentRowEnd,
  resolveContentRowEditBeforeEmbeddedBlankBand,
  resolveBlankVisualLineStartCollapse,
  resolveEmbeddedBlankBandCollapse,
  resolveEmbeddedBlankBandLineStartCollapse,
  resolveRowChipBeforeEmbeddedBlankProbe,
  resolveSubstantiveLineBreakJoin,
  resolveAtomicDeleteRowClearChip,
  type EmbeddedBlankBandCollapseMove,
} from "./handoff-note-embedded-newlines.js";

/** Delete outcome with finalized focus + affinity (snap is interior escape only). */
export type HandoffNoteDeleteIntentResult = {
  doc: HandoffNoteDoc;
  selection: HandoffNoteSelection;
};

export type HandoffNoteDeleteIntent =
  | { kind: "noop" }
  | { kind: "result"; result: HandoffNoteDeleteIntentResult };

/** Doc position rests on committed atomic-node end (not text-node alias at same wire). */
export function handoffNoteCaretOnAtomicNodeEnd(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): boolean {
  const node = doc.nodes[focus.nodeIndex];
  if (!isAtomicNode(node)) {
    return false;
  }
  return focus.nodeOffset >= nodeTokenLength(node);
}

/** Doc position rests on committed atomic-node start. */
export function handoffNoteCaretOnAtomicNodeStart(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): boolean {
  const node = doc.nodes[focus.nodeIndex];
  return isAtomicNode(node) && focus.nodeOffset === 0;
}

/**
 * Atomic end at a blank-band probe wire after substantive content abuts
 * (post-spacer chip). Doc focus owns the seam — not wire cursor re-classify.
 */
export function handoffNoteIsAtomicEndProbeAlias(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): boolean {
  const focusWire = docPosToWireOffset(doc, focus);
  return (
    handoffNoteCaretOnAtomicNodeEnd(doc, focus) &&
    isEmbeddedBlankBandProbeWire(doc, focusWire) &&
    embeddedBlankBandSubstantiveContentAbutsProbe(doc, focusWire)
  );
}

/** Whitespace-only separator between two atoms — not substantive text (contract: inter-atomic gap). */
function isWhitespaceOnlyInterAtomicGapText(text: string): boolean {
  return /^\s+$/.test(text) && !/[\n\r]/.test(text);
}

function isInterAtomicGap(doc: HandoffNoteDoc, focus: HandoffNoteDocPos): boolean {
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "text") {
    return false;
  }
  const prev = doc.nodes[focus.nodeIndex - 1];
  const next = doc.nodes[focus.nodeIndex + 1];
  if (!(isAtomicNode(prev) && isAtomicNode(next))) {
    return false;
  }
  if (docTextNodeHasEmbeddedNewline(doc, focus.nodeIndex)) {
    return false;
  }
  if (!isWhitespaceOnlyInterAtomicGapText(node.text)) {
    return false;
  }
  const focusWire = docPosToWireOffset(doc, focus);
  return !embeddedBlankBandSpacerBeforeProbeRowChip(doc, focusWire);
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
  // Standard in-row delete: caret stays where the unit was removed (not content-row-end).
  return { doc: next, selection: collapsedSelectionWithIntent(next, nextFocus, "deletion-point") };
}

function atomsMergedAt(doc: HandoffNoteDoc, leftAtomIdx: number): boolean {
  return isAtomicNode(doc.nodes[leftAtomIdx]) && isAtomicNode(doc.nodes[leftAtomIdx + 1]);
}

/** Probe wire immediately after an atomic node end, when that end aliases the probe. */
function atomicNodeAbutsBlankBandProbe(doc: HandoffNoteDoc, nodeIndex: number): number | null {
  const node = doc.nodes[nodeIndex];
  if (!isAtomicNode(node)) {
    return null;
  }
  const endWire = docPosToWireOffset(doc, {
    nodeIndex,
    nodeOffset: nodeTokenLength(node),
  });
  if (!isEmbeddedBlankBandProbeWire(doc, endWire)) {
    return null;
  }
  return endWire;
}

/** Land after last substantive char when prefix text ends with a single spacer before the pill. */
function textEndForRowPrefixBackspace(text: string): number {
  if (text.length >= 2 && text.endsWith(" ") && /\S/.test(text.slice(0, -1))) {
    return text.length - 1;
  }
  return text.length;
}

/** After gap merge, land where the next key's left/right neighbor matches user intent — not left mention end. */
function caretAfterInterAtomicGapMerge(
  doc: HandoffNoteDoc,
  leftAtomIdx: number
): HandoffNoteDocPos {
  const rightAtomIdx = leftAtomIdx + 1;
  const prevNode = doc.nodes[leftAtomIdx - 1];
  if (prevNode?.type === "text" && /\S/.test(prevNode.text)) {
    const leftStartWire = docPosToWireOffset(doc, {
      nodeIndex: leftAtomIdx,
      nodeOffset: 0,
    });
    const wire = docToWire(doc);
    const lineStart = leftStartWire <= 0 ? 0 : wire.lastIndexOf("\n", leftStartWire - 1) + 1;
    if (/\S/.test(wire.slice(lineStart, leftStartWire))) {
      return normalizeDocPos(doc, {
        nodeIndex: leftAtomIdx - 1,
        nodeOffset: textEndForRowPrefixBackspace(prevNode.text),
      });
    }
  }
  return normalizeDocPos(doc, { nodeIndex: rightAtomIdx, nodeOffset: 0 });
}

function withCaretAfterInterAtomicGapDelete(
  result: HandoffNoteDeleteIntentResult,
  gapNodeIndex: number
): HandoffNoteDeleteIntentResult {
  const leftAtomIdx = gapNodeIndex - 1;
  if (!atomsMergedAt(result.doc, leftAtomIdx)) {
    return result;
  }
  return {
    doc: result.doc,
    selection: collapsedSelection(caretAfterInterAtomicGapMerge(result.doc, leftAtomIdx)),
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

/** True when a committed mention atom starts on the same row before `beforeWire`. */
function sameRowHasPriorMentionAtom(doc: HandoffNoteDoc, beforeWire: number): boolean {
  const wire = docToWire(doc);
  const lineStart = beforeWire <= 0 ? 0 : wire.lastIndexOf("\n", beforeWire - 1) + 1;
  for (let i = 0; i < doc.nodes.length; i++) {
    const node = doc.nodes[i]!;
    if (node.type !== "mention") {
      continue;
    }
    const start = docPosToWireOffset(doc, { nodeIndex: i, nodeOffset: 0 });
    if (start >= lineStart && start < beforeWire) {
      return true;
    }
  }
  return false;
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
      return mentionRemoveIntentResult(doc, focusWire, edit);
    }
    return null;
  }

  const end = focusWire + 1 + node.agentId.length;
  return spliceSelection(doc, focus, wireOffsetToDocPos(doc, end), "");
}

function applyInterAtomicGapDelete(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  direction: HandoffNoteEdit
): HandoffNoteDeleteIntentResult | null {
  const focus = normalizeDocPos(doc, selection.focus);
  if (!isInterAtomicGap(doc, focus)) {
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
    return withCaretAfterInterAtomicGapDelete(
      spliceSelection(doc, focus, wireOffsetToDocPos(doc, focusWire + 1), ""),
      gapNodeIndex
    );
  }

  if (focus.nodeOffset > 0) {
    const focusWire = docPosToWireOffset(doc, focus);
    return withCaretAfterInterAtomicGapDelete(
      withCaretAtTextEndBeforeMention(
        doc,
        spliceSelection(doc, wireOffsetToDocPos(doc, focusWire - 1), focus, ""),
        focus
      ),
      gapNodeIndex
    );
  }

  // Offset 0 backspace: chip the first whitespace ahead (separator), not the left pill.
  if (!textNode.text.length) {
    return null;
  }

  const focusWire = docPosToWireOffset(doc, focus);
  return withCaretAfterInterAtomicGapDelete(
    spliceSelection(doc, focus, wireOffsetToDocPos(doc, focusWire + 1), ""),
    gapNodeIndex
  );
}

/**
 * Collapse producers already set {@link EmbeddedBlankBandCollapseMove.focus}
 * (prior-owned alias vs probe infrastructure). Intent only normalizes + affinity.
 */
function blankBandMoveToResult(move: EmbeddedBlankBandCollapseMove): HandoffNoteDeleteIntentResult {
  const focus = normalizeDocPos(move.doc, move.focus);
  return {
    doc: move.doc,
    selection: collapsedSelectionWithIntent(move.doc, focus, move.affinityIntent),
  };
}

function mentionRemoveIntentResult(
  priorDoc: HandoffNoteDoc,
  focusWire: number,
  mentionEdit: { doc: HandoffNoteDoc; cursor: number }
): HandoffNoteDeleteIntentResult {
  const mentionStartWire = mentionEdit.cursor;
  const rowClearChip = resolveAtomicDeleteRowClearChip(priorDoc, focusWire, mentionEdit.doc);
  const doc = mentionEdit.doc;
  const wire = docToWire(doc);
  let caretWire = rowClearChip?.caretWire ?? mentionStartWire;
  // One unit: atom only. Leftover post-atom commit spacer (text residue at cursor) keeps
  // deletion-point by default. Probe land with substantive row above is CRE — not a
  // wire-char `" "` sniff (space and blank-band probes are distinct wires).
  let affinityIntent: HandoffNoteCaretLandingIntent = "deletion-point";
  if (
    !rowClearChip &&
    isEmbeddedBlankBandProbeWire(doc, caretWire) &&
    embeddedBlankBandHasSubstantiveRowAbove(wire, caretWire)
  ) {
    caretWire = embeddedBlankBandContentRowEndBeforeProbe(doc, caretWire);
    affinityIntent = "content-row-end";
  }
  return {
    doc,
    selection: collapsedSelectionWithIntent(
      doc,
      normalizeDocPos(doc, wireOffsetToDocPos(doc, caretWire)),
      affinityIntent
    ),
  };
}

function resolveDeleteForwardFromAtomicAbuttingProbe(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): HandoffNoteDeleteIntent | null {
  if (handoffNoteCaretOnAtomicNodeStart(doc, focus)) {
    return null;
  }
  if (!isAtomicNode(doc.nodes[focus.nodeIndex])) {
    return null;
  }
  const probeWire = atomicNodeAbutsBlankBandProbe(doc, focus.nodeIndex);
  if (probeWire === null) {
    return null;
  }
  const move = resolveEmbeddedBlankBandCollapse(doc, probeWire, "delete", focus, {
    atomicEndCollapse: true,
  });
  if (move) {
    return {
      kind: "result",
      result: blankBandMoveToResult(move),
    };
  }
  const emptyRowEnd = resolveDeleteFromEmptyContentRowEnd(doc, probeWire, focus);
  if (emptyRowEnd.status === "move") {
    return {
      kind: "result",
      result: blankBandMoveToResult(emptyRowEnd.move),
    };
  }
  return null;
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
  const tokenLength = nodeTokenLength(node);
  if (focus.nodeOffset <= 0 || focus.nodeOffset >= tokenLength) {
    return null;
  }
  if (atomicNodeAbutsBlankBandProbe(doc, focus.nodeIndex) === null) {
    return null;
  }
  const edit = resolveHandoffNoteMentionEdit(doc, focusWire, "backspace");
  if (!edit) {
    return null;
  }
  return {
    kind: "result",
    result: mentionRemoveIntentResult(doc, focusWire, edit),
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
  if (direction === "backspace" && handoffNoteCaretOnAtomicNodeEnd(doc, focus)) {
    const edit = resolveHandoffNoteMentionEdit(doc, focusWire, "backspace");
    if (edit) {
      return {
        kind: "result",
        result: mentionRemoveIntentResult(doc, focusWire, edit),
      };
    }
  }

  if (direction === "delete" && wasAtTextEndBeforeMention(doc, focus)) {
    const wire = docToWire(doc);
    const lineStart = focusWire <= 0 ? 0 : wire.lastIndexOf("\n", focusWire - 1) + 1;
    const segment = wire.slice(lineStart, focusWire);
    if (segment.length > 0 && /\S/.test(segment) && sameRowHasPriorMentionAtom(doc, focusWire)) {
      return { kind: "noop" };
    }
    return null;
  }

  return null;
}

/**
 * Single delete authority — resolves meaning before any splice. Called by applyDocDelete.
 */
export function resolveHandoffNoteDeleteIntent(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  direction: HandoffNoteEdit
): HandoffNoteDeleteIntent | null {
  const { focus, contentCharUnit } = resolveDirectionalUnitFocus(
    doc,
    selection.focus,
    selection.focusAffinity,
    direction
  );
  const focusWire = docPosToWireOffset(doc, focus);

  // Affinity said this keystroke's unit is exactly the focused content char (Backspace+after).
  if (contentCharUnit) {
    const rowChip = resolveRowChipBeforeEmbeddedBlankProbe(doc, contentCharUnit.startWire);
    if (rowChip) {
      return {
        kind: "result",
        result: blankBandMoveToResult(rowChip),
      };
    }
    return {
      kind: "result",
      result: spliceSelection(
        doc,
        wireOffsetToDocPos(doc, contentCharUnit.startWire),
        wireOffsetToDocPos(doc, contentCharUnit.endWire),
        ""
      ),
    };
  }

  if (direction === "backspace") {
    const interiorAbutting = resolveBackspaceOnMentionInteriorAbuttingProbe(doc, focus, focusWire);
    if (interiorAbutting) {
      return interiorAbutting;
    }
  }

  if (direction === "delete") {
    const forwardBlank = resolveDeleteForwardFromAtomicAbuttingProbe(doc, focus);
    if (forwardBlank) {
      return forwardBlank;
    }
  }

  const boundary = resolveBoundaryDeleteIntent(doc, focusWire, direction, focus);
  if (boundary) {
    return boundary;
  }

  const contentBeforeBlankBand = resolveContentRowEditBeforeEmbeddedBlankBand(
    doc,
    focusWire,
    direction,
    focus
  );
  if (contentBeforeBlankBand) {
    return {
      kind: "result",
      result: blankBandMoveToResult(contentBeforeBlankBand),
    };
  }

  // Atomic-end abutting probe is handled earlier by resolveDeleteForwardFromAtomicAbuttingProbe
  // (focus-tied).
  const blankStopCollapse = resolveBlankVisualLineStartCollapse(doc, focusWire, direction, focus);
  if (blankStopCollapse) {
    return {
      kind: "result",
      result: blankBandMoveToResult(blankStopCollapse),
    };
  }

  const blankBandCollapse = resolveEmbeddedBlankBandCollapse(doc, focusWire, direction, focus);
  if (blankBandCollapse) {
    return {
      kind: "result",
      result: blankBandMoveToResult(blankBandCollapse),
    };
  }

  if (direction === "backspace" && !handoffNoteIsAtomicEndProbeAlias(doc, focus)) {
    const emptyRowEnd = resolveBackspaceFromEmptyContentRowEnd(doc, focusWire, focus);
    if (emptyRowEnd) {
      return {
        kind: "result",
        result: blankBandMoveToResult(emptyRowEnd),
      };
    }
  }

  if (direction === "delete" && !handoffNoteIsAtomicEndProbeAlias(doc, focus)) {
    const emptyRowEnd = resolveDeleteFromEmptyContentRowEnd(doc, focusWire, focus);
    if (emptyRowEnd.status === "move") {
      return {
        kind: "result",
        result: blankBandMoveToResult(emptyRowEnd.move),
      };
    }
  }

  // line-start collapse is Backspace-only (leading blanks). Delete on the same
  // line-start `\n` uses the generic forward splice below — lands at lower visual start.
  if (direction === "backspace") {
    const lineStartCollapse = resolveEmbeddedBlankBandLineStartCollapse(doc, focus);
    if (lineStartCollapse) {
      return { kind: "result", result: blankBandMoveToResult(lineStartCollapse) };
    }
  }

  const lineBreakJoin = resolveSubstantiveLineBreakJoin(doc, focusWire, direction);
  if (lineBreakJoin) {
    return { kind: "result", result: blankBandMoveToResult(lineBreakJoin) };
  }

  if (isInterAtomicGap(doc, focus)) {
    const gapResult = applyInterAtomicGapDelete(doc, selection, direction);
    if (gapResult) {
      return { kind: "result", result: gapResult };
    }
    // e.g. Delete at gap text end — do not fall through to mention-atom remove.
    return { kind: "noop" };
  }

  if (direction === "backspace") {
    const mentionStartBackspace = applyBackspaceAtMentionStart(doc, focus);
    if (mentionStartBackspace) {
      return { kind: "result", result: mentionStartBackspace };
    }
  }

  const mentionEdit = resolveHandoffNoteMentionEdit(doc, focusWire, direction);
  if (mentionEdit) {
    return {
      kind: "result",
      result: mentionRemoveIntentResult(doc, focusWire, mentionEdit),
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
    if (isEmbeddedBlankBandCollapseProbeWire(doc, focusWire, focus)) {
      return { kind: "noop" };
    }
    if (focusWire >= docLength(doc)) {
      return { kind: "noop" };
    }
    const spliced = spliceSelection(doc, focus, wireOffsetToDocPos(doc, focusWire + 1), "");
    const textAlias = docPosAtAtomicStartTextAlias(spliced.doc, focusWire);
    if (textAlias && isTextOwnedSameRowWhitespaceAtWire(doc, focusWire)) {
      return {
        kind: "result",
        result: {
          doc: spliced.doc,
          selection: collapsedSelectionWithIntent(
            spliced.doc,
            normalizeDocPos(spliced.doc, textAlias),
            "deletion-point"
          ),
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
