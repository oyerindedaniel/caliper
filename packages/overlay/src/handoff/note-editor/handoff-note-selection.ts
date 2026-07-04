import {
  collapsedSelection,
  describeHandoffNoteCursorContext,
  docPosEqual,
  docPosToWireOffset,
  docToWire,
  embeddedBlankBandContentRowEndBeforeProbe,
  isEmbeddedBlankBandProbeWire,
  isInlineSuffixBlankProbeWire,
  normalizeDocPos,
  normalizeSelection,
  resolveDocHorizontalArrowMove,
  resolveVerticalArrowMinWireLineStart,
  resolveVerticalArrowRowStartLanding,
  snapVerticalArrowLanding,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
  type HandoffNoteVerticalArrowDirection,
} from "@caliper/core";
import {
  flattenHandoffNoteLog,
  domPointInMentionPill,
  handoffNoteDomSnapshot,
  handoffNoteSelectionSnapshotCompact,
  logCaretBoundaryTrace,
  logVerArrow,
} from "../handoff-note-debug.js";
import {
  domPointToDocPos,
  getDocAnchorRect,
  probeDocPosAtVisualColumn,
  resolveDomPillBoundaryPosForGoalColumn,
  resolveDomPointAtDocPos,
  wireOffsetForPillHalfSplitColumn,
} from "./handoff-note-dom-points.js";
import {
  buildHandoffNoteLayoutMap,
  isAtLayoutRowStart,
  isSameWireSoftWrapBandCrossing,
  layoutRowTopTolerance,
  layoutVisualRowStartColumn,
  type HandoffNoteLayoutMap,
  type HandoffNoteLayoutRow,
} from "./handoff-note-layout-map.js";
import { type MeasuredWireOffset } from "./handoff-note-layout-map.js";

function readRawWireFocus(root: HTMLElement, doc: HandoffNoteDoc): number {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    return 0;
  }
  const range = selection.getRangeAt(0);
  const focus = domPointToDocPos(root, doc, range.endContainer, range.endOffset);
  return docPosToWireOffset(doc, focus);
}

/** DOM caret fell behind editor authority (e.g. popover pick left selection at superseded @query). */
function authorityIsMentionNodeEnd(doc: HandoffNoteDoc, pos: HandoffNoteDocPos): boolean {
  const node = doc.nodes[pos.nodeIndex];
  return node?.type === "mention" && pos.nodeOffset >= 1 + node.agentId.length;
}

/** Same wire: editor authority on mention node end, DOM painted text-node probe alias. */
export function liveIsProbeAliasOverMentionEndAuthority(
  doc: HandoffNoteDoc,
  live: HandoffNoteDocPos,
  from: HandoffNoteDocPos
): boolean {
  const wire = docPosToWireOffset(doc, live);
  if (wire !== docPosToWireOffset(doc, from)) {
    return false;
  }
  if (!authorityIsMentionNodeEnd(doc, from)) {
    return false;
  }
  if (doc.nodes[live.nodeIndex]?.type !== "text") {
    return false;
  }
  if (!isEmbeddedBlankBandProbeWire(doc, wire)) {
    return false;
  }
  const semanticEnd = embeddedBlankBandContentRowEndBeforeProbe(doc, wire);
  const semanticContext = describeHandoffNoteCursorContext(doc, semanticEnd);
  return semanticContext.kind === "mention-boundary" && semanticContext.edge === "end";
}

function shouldRestoreAuthorityOverDom(
  doc: HandoffNoteDoc,
  live: HandoffNoteDocPos,
  from: HandoffNoteDocPos
): boolean {
  const liveWire = docPosToWireOffset(doc, live);
  const fromWire = docPosToWireOffset(doc, from);
  const fromContext = describeHandoffNoteCursorContext(doc, fromWire);

  if (liveIsProbeAliasOverMentionEndAuthority(doc, live, from)) {
    return true;
  }

  if (
    (fromContext.kind === "mention-boundary" && fromContext.edge === "end") ||
    fromContext.kind === "mention-interior"
  ) {
    if (isEmbeddedBlankBandProbeWire(doc, liveWire) && liveWire > fromWire) {
      return true;
    }
  }

  if (fromContext.kind === "mention-boundary" && fromContext.edge === "start") {
    const liveContext = describeHandoffNoteCursorContext(doc, liveWire);
    if (
      liveContext.kind === "mention-interior" &&
      liveWire > fromWire &&
      liveWire < fromContext.end
    ) {
      return true;
    }
  }

  if (liveWire >= fromWire) {
    return false;
  }

  const liveNode = doc.nodes[live.nodeIndex];
  if (liveNode?.type === "text" && live.nodeOffset === liveNode.text.length) {
    return true;
  }

  const context = describeHandoffNoteCursorContext(doc, liveWire);
  if (context.kind === "mention-boundary" && context.edge === "start" && fromWire > context.end) {
    return true;
  }

  return false;
}

/** Diagnostics for reconcile>>sync — which repair path ran vs probe-alias eligibility. */
export function describeSyncRepairBranch(
  doc: HandoffNoteDoc,
  priorFocus: HandoffNoteDocPos,
  liveFocus: HandoffNoteDocPos,
  resolvedFocus: HandoffNoteDocPos
): { probeAliasEligible: boolean; repairBranch: string } {
  const probeAliasEligible = liveIsProbeAliasOverMentionEndAuthority(doc, liveFocus, priorFocus);
  if (
    docPosEqualNormalized(doc, resolvedFocus, priorFocus) &&
    !docPosEqualNormalized(doc, liveFocus, priorFocus)
  ) {
    return {
      probeAliasEligible,
      repairBranch: probeAliasEligible ? "probeAliasRestore" : "restoreAuthority",
    };
  }
  if (!docPosEqualNormalized(doc, resolvedFocus, liveFocus)) {
    return { probeAliasEligible, repairBranch: "normalized" };
  }
  return { probeAliasEligible, repairBranch: "acceptedLive" };
}

export function readDocSelection(root: HTMLElement, doc: HandoffNoteDoc): HandoffNoteSelection {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    return normalizeSelection(doc, {
      anchor: { nodeIndex: 0, nodeOffset: 0 },
      focus: { nodeIndex: 0, nodeOffset: 0 },
    });
  }

  const range = selection.getRangeAt(0);
  const rawAnchor = domPointToDocPos(root, doc, range.startContainer, range.startOffset);
  const rawFocus = domPointToDocPos(root, doc, range.endContainer, range.endOffset);
  const anchor = normalizeDocPos(doc, rawAnchor);
  const focus = normalizeDocPos(doc, rawFocus);
  return { anchor, focus };
}

export function readDocCursor(root: HTMLElement, doc: HandoffNoteDoc): HandoffNoteDocPos {
  return readDocSelection(root, doc).focus;
}

export function repairDocSelectionIfNeeded(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  from?: HandoffNoteDocPos,
  options?: { mode?: "full" | "strand-only" }
): HandoffNoteDocPos {
  const live = readDocSelection(root, doc);
  if (!docPosEqualNormalized(doc, live.anchor, live.focus)) {
    return live.focus;
  }

  const focusWire = readRawWireFocus(root, doc);
  const fromWire = from !== undefined ? docPosToWireOffset(doc, from) : undefined;
  const context = describeHandoffNoteCursorContext(doc, focusWire);

  if (
    context.kind === "mention-interior" &&
    fromWire !== undefined &&
    (fromWire <= context.start || fromWire > context.end)
  ) {
    const restored = wireOffsetToDocPos(doc, fromWire);
    logCaretBoundaryTrace("repair", {
      branch: "restoreFromOutsideMention",
      liveWire: focusWire,
      fromWire,
      resolvedWire: fromWire,
    });
    setDocSelection(root, doc, collapsedSelection(restored), { from, source: "repair" });
    return restored;
  }

  if (options?.mode === "strand-only") {
    if (from !== undefined && liveIsProbeAliasOverMentionEndAuthority(doc, live.focus, from)) {
      logCaretBoundaryTrace("repair", {
        branch: "restoreAuthority.probeAlias",
        liveWire: docPosToWireOffset(doc, live.focus),
        fromWire: docPosToWireOffset(doc, from),
        resolvedWire: docPosToWireOffset(doc, from),
      });
      setDocSelection(root, doc, collapsedSelection(from), { from, source: "repair.authority" });
      return from;
    }
    return normalizeDocPos(doc, live.focus, { from });
  }

  if (from !== undefined && shouldRestoreAuthorityOverDom(doc, live.focus, from)) {
    logCaretBoundaryTrace("repair", {
      branch: "restoreAuthority",
      liveWire: docPosToWireOffset(doc, live.focus),
      fromWire: docPosToWireOffset(doc, from),
      resolvedWire: docPosToWireOffset(doc, from),
    });
    setDocSelection(root, doc, collapsedSelection(from), { from, source: "repair.authority" });
    return from;
  }

  const normalized = normalizeDocPos(doc, live.focus, { from });
  if (docPosEqualNormalized(doc, normalized, live.focus)) {
    return normalized;
  }

  setDocSelection(root, doc, collapsedSelection(normalized), { from, source: "repair" });
  return normalized;
}

function docPosEqualNormalized(
  doc: HandoffNoteDoc,
  a: HandoffNoteDocPos,
  b: HandoffNoteDocPos
): boolean {
  const left = normalizeDocPos(doc, a);
  const right = normalizeDocPos(doc, b);
  return left.nodeIndex === right.nodeIndex && left.nodeOffset === right.nodeOffset;
}

export function setDocSelection(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  options?: {
    from?: HandoffNoteDocPos;
    source?: string;
  }
): void {
  const docSel = normalizeSelection(doc, selection);
  const docApi = root.ownerDocument;
  const native = docApi.getSelection();
  if (!native) {
    return;
  }

  const startPoint = resolveDomPointAtDocPos(root, doc, docSel.anchor);
  const endPoint = resolveDomPointAtDocPos(root, doc, docSel.focus);
  const source = options?.source ?? "unknown";

  if (!startPoint || !endPoint) {
    flattenHandoffNoteLog(
      `caret>>setDoc>>${source}>>miss`,
      {
        requested: docSel,
        from: options?.from,
        dom: handoffNoteDomSnapshot(root),
      },
      "warn"
    );
    return;
  }

  const range = docApi.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  native.removeAllRanges();
  native.addRange(range);

  const focusWire = docPosToWireOffset(doc, docSel.focus);
  const caretContext = describeHandoffNoteCursorContext(doc, focusWire);
  logCaretBoundaryTrace(`setDoc>>${source}`, {
    requestedWire: focusWire,
    caretKind: caretContext.kind,
    ...(caretContext.kind === "mention-boundary" ? { edge: caretContext.edge } : {}),
    paint: {
      nodeKind: endPoint.node.nodeType,
      offset: endPoint.offset,
      inMentionPill: domPointInMentionPill(root, endPoint.node),
    },
    dom: handoffNoteSelectionSnapshotCompact(root),
  });
}

function wireOffsetToRowStartDocPos(doc: HandoffNoteDoc, wire: number): HandoffNoteDocPos {
  let offset = 0;
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    const length = node.type === "text" ? node.text.length : 1 + node.agentId.length;
    if (wire === offset) {
      return { nodeIndex, nodeOffset: 0 };
    }
    if (node.type === "text" && wire > offset && wire <= offset + length) {
      return { nodeIndex, nodeOffset: wire - offset };
    }
    offset += length;
  }
  return wireOffsetToDocPos(doc, wire);
}

function pickConcreteRowStartSample(
  samples: MeasuredWireOffset[],
  wireLength: number
): MeasuredWireOffset | null {
  let best: MeasuredWireOffset | null = null;
  for (const sample of samples) {
    if (sample.wire >= wireLength) {
      continue;
    }
    if (
      best === null ||
      sample.left < best.left ||
      (sample.left === best.left && sample.wire < best.wire)
    ) {
      best = sample;
    }
  }
  return best;
}

function pickConcreteRowEndSample(
  samples: MeasuredWireOffset[],
  wireLength: number
): MeasuredWireOffset {
  let bestInterior: MeasuredWireOffset | null = null;
  for (const sample of samples) {
    if (sample.wire >= wireLength) {
      continue;
    }
    if (
      bestInterior === null ||
      sample.left > bestInterior.left ||
      (sample.left === bestInterior.left && sample.wire > bestInterior.wire)
    ) {
      bestInterior = sample;
    }
  }
  if (bestInterior) {
    return bestInterior;
  }
  let best = samples[0]!;
  for (const sample of samples) {
    if (sample.left > best.left) {
      best = sample;
    } else if (sample.left === best.left && sample.wire > best.wire) {
      best = sample;
    }
  }
  return best;
}

function sourceIsAtRowContentEnd(
  fromWire: number,
  goalColumn: number,
  sourceRowSamples: MeasuredWireOffset[] | undefined,
  wireLength: number,
  tolerance: number
): boolean {
  if (fromWire >= wireLength) {
    return true;
  }
  if (!sourceRowSamples || sourceRowSamples.length === 0) {
    return false;
  }
  const endSample = pickConcreteRowEndSample(sourceRowSamples, wireLength);
  if (Math.abs(goalColumn - endSample.left) > tolerance) {
    return false;
  }
  if (fromWire >= endSample.wire) {
    return true;
  }
  let maxInteriorWire = -1;
  for (const sample of sourceRowSamples) {
    if (sample.wire < wireLength) {
      maxInteriorWire = Math.max(maxInteriorWire, sample.wire);
    }
  }
  return fromWire >= maxInteriorWire;
}

function resolveVisualRowStartLanding(
  doc: HandoffNoteDoc,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  edgeColumn: number,
  edgeTolerance: number,
  wire: string
): HandoffNoteDocPos | null {
  if (targetLine.length === 0) {
    return null;
  }
  let rowStartColumn = targetLine[0]!.left;
  for (const sample of targetLine) {
    if (sample.left < rowStartColumn) {
      rowStartColumn = sample.left;
    }
  }
  if (edgeColumn > rowStartColumn + edgeTolerance) {
    return null;
  }
  const startSample = pickConcreteRowStartSample(targetLine, wire.length);
  const landingWire =
    startSample?.wire ?? wire.lastIndexOf("\n", Math.max(0, targetLine[0]!.wire - 1)) + 1;
  const rowStartPos = wireOffsetToRowStartDocPos(doc, landingWire);
  if (doc.nodes[rowStartPos.nodeIndex]?.type !== "text") {
    return null;
  }
  return snapVerticalArrowLanding(doc, rowStartPos, direction);
}

function sourceIsAtConcreteVisualStart(
  doc: HandoffNoteDoc,
  fromWire: number,
  edgeColumn: number,
  sourceRowSamples: MeasuredWireOffset[] | undefined,
  wireLength: number
): boolean {
  if (!sourceRowSamples || sourceRowSamples.length === 0) {
    return true;
  }
  const startSample = pickConcreteRowStartSample(sourceRowSamples, wireLength);
  if (startSample === null) {
    return false;
  }
  return fromWire === startSample.wire && Math.abs(edgeColumn - startSample.left) <= 2;
}

function targetRowTextPosForWire(
  doc: HandoffNoteDoc,
  wire: number,
  rowStart?: VisualRowStartContext
): HandoffNoteDocPos | null {
  if (!rowStart || rowStart.rowIndexForWire(wire) !== rowStart.targetLineIndex) {
    return null;
  }
  const pos = wireOffsetToRowStartDocPos(doc, wire);
  if (doc.nodes[pos.nodeIndex]?.type !== "text") {
    return null;
  }
  return pos;
}

function landedOutsideTargetRow(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  rowStart?: VisualRowStartContext
): boolean {
  return (
    rowStart !== undefined &&
    rowStart.rowIndexForWire(docPosToWireOffset(doc, pos)) !== rowStart.targetLineIndex
  );
}

function snapVerticalColumnLandingWire(
  doc: HandoffNoteDoc,
  wire: number,
  direction: HandoffNoteVerticalArrowDirection
): number {
  const context = describeHandoffNoteCursorContext(doc, wire);
  if (context.kind === "mention-interior") {
    return direction === "up" ? context.start : context.end;
  }
  return wire;
}

/** Past-end bleed carries no wire sample; bracket on unsampled interior wires snaps to nearest layout sample. */
function snapPastEndUnsampledBracketToLayoutSample(
  targetLine: MeasuredWireOffset[],
  bracketWire: number,
  goalColumn: number,
  fromWire: number,
  docWireLength: number
): number {
  if (fromWire < docWireLength) {
    return bracketWire;
  }
  const sampleWires = new Set(targetLine.map((sample) => sample.wire));
  if (sampleWires.has(bracketWire)) {
    return bracketWire;
  }
  let bestSample = targetLine[0]!;
  let bestDistance = Math.abs(bestSample.left - goalColumn);
  for (const sample of targetLine) {
    const distance = Math.abs(sample.left - goalColumn);
    if (distance < bestDistance) {
      bestSample = sample;
      bestDistance = distance;
    }
  }
  return bestSample.wire;
}

type VerticalLanding = {
  pos: HandoffNoteDocPos;
  branch: string;
};

type VisualRowStartContext = {
  root: HTMLElement;
  targetRowTop: number;
  targetLineIndex: number;
  rowIndexForWire: (wire: number) => number;
  coordsForWire: (wire: number) => MeasuredWireOffset | null;
  goalColumnTolerance: number;
};

function probeTargetRowAtColumn(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  column: number,
  rowStart?: VisualRowStartContext
): VerticalLanding | null {
  if (!rowStart) {
    return null;
  }

  const rowBandTolerance = Math.max(2, rowStart.goalColumnTolerance * 4);
  const pillPos = resolveDomPillBoundaryPosForGoalColumn(
    rowStart.root,
    doc,
    column,
    rowStart.targetRowTop,
    rowBandTolerance,
    rowStart.goalColumnTolerance
  );
  if (pillPos) {
    const pillLanding = snapVerticalArrowLanding(doc, pillPos, direction);
    const pillWire = docPosToWireOffset(doc, pillLanding);
    const pillRowIndex = rowStart.rowIndexForWire(pillWire);
    if (pillRowIndex === rowStart.targetLineIndex) {
      logVerArrow("resolve.domColumnProbe", {
        direction,
        fromWire: docPosToWireOffset(doc, focus),
        probeColumn: column,
        rowTop: rowStart.targetRowTop,
        resolvedWire: pillWire,
        probeRowIndex: pillRowIndex,
        targetLineIndex: rowStart.targetLineIndex,
        accepted: true,
        branch: "dom-pill-column-snap",
      });
      return {
        pos: normalizeDocPos(doc, pillLanding, { from: focus }),
        branch: "dom-pill-column-snap",
      };
    }
  }

  const probed = probeDocPosAtVisualColumn(rowStart.root, doc, rowStart.targetRowTop, column);
  if (!probed) {
    logVerArrow("resolve.domColumnProbe", {
      direction,
      fromWire: docPosToWireOffset(doc, focus),
      probeColumn: column,
      rowTop: rowStart.targetRowTop,
      branch: "probe-miss",
    });
    return null;
  }

  const landing = snapVerticalArrowLanding(doc, probed, direction);
  const resolvedWire = docPosToWireOffset(doc, landing);
  const probeRowIndex = rowStart.rowIndexForWire(resolvedWire);
  if (probeRowIndex !== rowStart.targetLineIndex) {
    logVerArrow("resolve.domColumnProbe", {
      direction,
      fromWire: docPosToWireOffset(doc, focus),
      probeColumn: column,
      rowTop: rowStart.targetRowTop,
      resolvedWire,
      probeRowIndex,
      targetLineIndex: rowStart.targetLineIndex,
      accepted: false,
      branch: "probe-wrong-row",
    });
    return null;
  }

  const probeCoord = rowStart.coordsForWire(resolvedWire);
  const anchorRect = getDocAnchorRect(rowStart.root, doc, landing);
  const hasCredibleAnchor = anchorRect !== null && (anchorRect.height > 0 || anchorRect.width > 0);
  const probeLeft = hasCredibleAnchor ? anchorRect!.left : null;
  if (
    hasCredibleAnchor &&
    probeLeft !== null &&
    Math.abs(probeLeft - column) > rowStart.goalColumnTolerance
  ) {
    logVerArrow("resolve.domColumnProbe", {
      direction,
      fromWire: docPosToWireOffset(doc, focus),
      probeColumn: column,
      rowTop: rowStart.targetRowTop,
      resolvedWire,
      probeRowIndex,
      targetLineIndex: rowStart.targetLineIndex,
      probeLeft,
      layoutSampleLeft: probeCoord?.left ?? null,
      accepted: false,
      branch: "probe-column-drift",
    });
    return null;
  }

  logVerArrow("resolve.domColumnProbe", {
    direction,
    fromWire: docPosToWireOffset(doc, focus),
    probeColumn: column,
    rowTop: rowStart.targetRowTop,
    resolvedWire,
    probeRowIndex,
    targetLineIndex: rowStart.targetLineIndex,
    probeLeft: probeLeft ?? probeCoord?.left ?? null,
    accepted: true,
    branch: "dom-column-probe",
  });
  return {
    pos: normalizeDocPos(doc, landing, { from: focus }),
    branch: "dom-column-probe",
  };
}

type VerticalContentLandingMode =
  | { kind: "blank-exit-row-start" }
  | { kind: "row-edge-to-row-edge"; edgeColumn: number }
  | { kind: "column-at-goal"; goalColumn: number };

function rowSampleColumnExtent(samples: MeasuredWireOffset[]): {
  minLeft: number;
  maxLeft: number;
} {
  let minLeft = Infinity;
  let maxLeft = -Infinity;
  for (const sample of samples) {
    minLeft = Math.min(minLeft, sample.left);
    maxLeft = Math.max(maxLeft, sample.left);
  }
  return { minLeft, maxLeft };
}

function clampGoalColumnToRowExtent(
  goalColumn: number,
  minLeft: number,
  maxLeft: number,
  tolerance: number
): number {
  if (goalColumn < minLeft - tolerance) {
    return minLeft;
  }
  if (goalColumn > maxLeft + tolerance) {
    return maxLeft;
  }
  return goalColumn;
}

type MentionColumnSpan = {
  startWire: number;
  endWire: number;
  startLeft: number;
  endLeft: number;
};

function mentionColumnSpansFromTargetLine(
  doc: HandoffNoteDoc,
  targetLine: MeasuredWireOffset[]
): MentionColumnSpan[] {
  const spans: MentionColumnSpan[] = [];
  for (const sample of targetLine) {
    const context = describeHandoffNoteCursorContext(doc, sample.wire);
    if (context.kind !== "mention-boundary" || context.edge !== "start") {
      continue;
    }
    const endSample = targetLine.find((candidate) => candidate.wire === context.end);
    if (!endSample) {
      continue;
    }
    spans.push({
      startWire: context.start,
      endWire: context.end,
      startLeft: sample.left,
      endLeft: endSample.left,
    });
  }
  return spans;
}

/** Pill half-split on sparse layout samples when goal column is inside a pill span. */
function resolveMentionAtomicityWireForGoal(
  doc: HandoffNoteDoc,
  targetLine: MeasuredWireOffset[],
  goalColumn: number,
  tolerance: number
): number | null {
  for (const span of mentionColumnSpansFromTargetLine(doc, targetLine)) {
    const wire = wireOffsetForPillHalfSplitColumn(
      goalColumn,
      span.startLeft,
      span.endLeft,
      span.startWire,
      span.endWire,
      tolerance
    );
    if (wire !== null) {
      return wire;
    }
  }
  return null;
}

function acceptColumnLanding(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  landingWire: number,
  targetLine: MeasuredWireOffset[],
  effectiveGoalColumn: number,
  rowStart: VisualRowStartContext | undefined,
  branch: string
): VerticalLanding | null {
  const tolerance = rowStart?.goalColumnTolerance ?? 2;
  const bracketWire = landingWire;
  const atomicWire = resolveMentionAtomicityWireForGoal(
    doc,
    targetLine,
    effectiveGoalColumn,
    tolerance
  );
  const resolvedWire = atomicWire ?? snapVerticalColumnLandingWire(doc, landingWire, direction);
  const mentionSnapApplied = resolvedWire !== bracketWire;
  let targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, resolvedWire), { from: focus });
  targetPos = snapVerticalArrowLanding(doc, targetPos, direction);
  if (landedOutsideTargetRow(doc, targetPos, rowStart)) {
    const rowContained = targetRowTextPosForWire(doc, resolvedWire, rowStart);
    if (!rowContained) {
      return null;
    }
    targetPos = rowContained;
  }
  const suffix = mentionSnapApplied ? "-mention-snap" : "";
  return { pos: targetPos, branch: `${branch}${suffix}` };
}

/** Soft-wrap continuation row start is structural geometry, not a user row-edge for row-start landing. */
function isWrapContinuationStructuralRowEdge(
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  rowIndex: number,
  wire: number,
  goalColumn: number
): boolean {
  if (rowIndex <= 0) {
    return false;
  }
  const row = layout.rows[rowIndex];
  if (!row || row.kind !== "content") {
    return false;
  }
  if (!isAtLayoutRowStart(layout, wire, goalColumn)) {
    return false;
  }
  return isSameWireSoftWrapBandCrossing(doc, rowIndex, rowIndex - 1, layout.rows);
}

export function classifyVerticalContentLandingMode(
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  fromWire: number,
  goalColumn: number,
  currentLineIndex: number,
  targetLineIndex: number,
  leavingBlankForContent: boolean
): VerticalContentLandingMode {
  if (leavingBlankForContent) {
    return { kind: "blank-exit-row-start" };
  }
  const atRowEdge = isAtLayoutRowStart(layout, fromWire, goalColumn);
  const structuralWrapEdge = isWrapContinuationStructuralRowEdge(
    doc,
    layout,
    currentLineIndex,
    fromWire,
    goalColumn
  );
  if (atRowEdge && !structuralWrapEdge) {
    return { kind: "row-edge-to-row-edge", edgeColumn: goalColumn };
  }
  return {
    kind: "column-at-goal",
    goalColumn,
  };
}

/** Blank-band exit: leftmost layout sample on the target row (layout owns row-start samples). */
function resolveBlankExitContentRowStart(
  doc: HandoffNoteDoc,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  wireLength: number
): { offset: number; branch: string } | null {
  if (targetLine.length === 0) {
    return null;
  }
  const startSample = pickConcreteRowStartSample(targetLine, wireLength);
  if (startSample) {
    const fromSample = resolveVerticalArrowRowStartLanding(
      doc,
      direction,
      [startSample],
      startSample.left
    );
    if (fromSample) {
      return fromSample;
    }
  }
  return resolveVerticalArrowMinWireLineStart(doc, direction, targetLine);
}

/** Painted left edge of a content row — min `left` among layout samples, not min-wire sample X. */
function contentRowPaintedVisualStartColumn(row: HandoffNoteLayoutRow): number {
  let minLeft = row.samples[0]?.left ?? 0;
  for (const sample of row.samples) {
    if (sample.left < minLeft) {
      minLeft = sample.left;
    }
  }
  return minLeft;
}

/** Blank-band exit lands at the target content row's painted visual start — not a prefix row above it. */
function resolveBlankExitEdgeColumn(
  layout: HandoffNoteLayoutMap,
  targetLineIndex: number,
  effectiveGoalColumn: number
): number {
  const targetRow = layout.rows[targetLineIndex];
  if (targetRow?.kind === "content" && targetRow.samples.length > 0) {
    return contentRowPaintedVisualStartColumn(targetRow);
  }
  return effectiveGoalColumn;
}

function resolveBlankExitVisualRowStart(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  wireLength: number
): VerticalLanding | null {
  const wireLineLanding = resolveBlankExitContentRowStart(doc, direction, targetLine, wireLength);
  if (!wireLineLanding) {
    return null;
  }
  return {
    pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, wireLineLanding.offset), { from: focus }),
    branch: "blank-exit-visual-row-start",
  };
}

/** Sparse fallback when DOM column probe misses — row start/end and past-end only, not interior columns. */
function resolveSparseEdgeColumnAtGoal(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  goalColumn: number,
  sourceRowSamples: MeasuredWireOffset[] | undefined,
  rowStart: VisualRowStartContext | undefined,
  wireLength: number
): VerticalLanding | null {
  if (targetLine.length === 0) {
    return null;
  }
  const tolerance = rowStart?.goalColumnTolerance ?? 2;
  const { minLeft, maxLeft } = rowSampleColumnExtent(targetLine);
  const effectiveGoal = clampGoalColumnToRowExtent(goalColumn, minLeft, maxLeft, tolerance);
  const fromWire = docPosToWireOffset(doc, focus);
  const sourceAtRowEnd = sourceIsAtRowContentEnd(
    fromWire,
    goalColumn,
    sourceRowSamples,
    wireLength,
    tolerance
  );

  const attempts: Array<{ wire: number; branch: string }> = [];

  if (effectiveGoal <= minLeft + tolerance) {
    const startSample = pickConcreteRowStartSample(targetLine, wireLength);
    if (startSample) {
      attempts.push({
        wire: startSample.wire,
        branch: "sparse-row-start",
      });
    }
  }

  if (sourceAtRowEnd || fromWire >= wireLength || effectiveGoal >= maxLeft - tolerance) {
    const endWire = snapPastEndUnsampledBracketToLayoutSample(
      targetLine,
      pickConcreteRowEndSample(targetLine, wireLength).wire,
      effectiveGoal,
      fromWire,
      wireLength
    );
    attempts.push({ wire: endWire, branch: "sparse-row-end" });
  }

  for (const attempt of attempts) {
    const landed = acceptColumnLanding(
      doc,
      focus,
      direction,
      attempt.wire,
      targetLine,
      effectiveGoal,
      rowStart,
      attempt.branch
    );
    if (landed) {
      return landed;
    }
  }
  return null;
}

function resolveRowEdgeToRowEdgeLanding(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  edgeColumn: number,
  sourceRowSamples: MeasuredWireOffset[] | undefined,
  rowStart: VisualRowStartContext | undefined,
  wire: string
): VerticalLanding | null {
  const fromWire = docPosToWireOffset(doc, focus);
  const domRowStart = probeTargetRowAtColumn(doc, focus, direction, edgeColumn, rowStart);
  if (domRowStart) {
    return { ...domRowStart, branch: "dom-row-start-probe" };
  }

  const sourceAtVisualStart = sourceIsAtConcreteVisualStart(
    doc,
    fromWire,
    edgeColumn,
    sourceRowSamples,
    wire.length
  );
  const visualStartLanding = sourceAtVisualStart
    ? resolveVisualRowStartLanding(
        doc,
        direction,
        targetLine,
        edgeColumn,
        rowStart?.goalColumnTolerance ?? 2,
        wire
      )
    : null;
  if (visualStartLanding) {
    return { pos: visualStartLanding, branch: "visual-row-start" };
  }

  const fallbackRowStartLanding = resolveVerticalArrowRowStartLanding(
    doc,
    direction,
    targetLine,
    edgeColumn
  );
  if (fallbackRowStartLanding) {
    return {
      pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, fallbackRowStartLanding.offset), {
        from: focus,
      }),
      branch: fallbackRowStartLanding.branch,
    };
  }
  return null;
}

function resolveColumnAtGoalLanding(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  goalColumn: number,
  sourceRowSamples: MeasuredWireOffset[] | undefined,
  rowStart: VisualRowStartContext | undefined,
  wireLength: number
): VerticalLanding | null {
  const domLanding = probeTargetRowAtColumn(doc, focus, direction, goalColumn, rowStart);
  if (domLanding) {
    return domLanding;
  }

  return resolveSparseEdgeColumnAtGoal(
    doc,
    focus,
    direction,
    targetLine,
    goalColumn,
    sourceRowSamples,
    rowStart,
    wireLength
  );
}

function resolveVerticalContentLanding(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  mode: VerticalContentLandingMode,
  sourceRowSamples: MeasuredWireOffset[] | undefined,
  rowStart: VisualRowStartContext | undefined,
  wire: string
): VerticalLanding {
  if (mode.kind === "blank-exit-row-start") {
    return { pos: focus, branch: "blank-exit-miss" };
  }

  if (mode.kind === "row-edge-to-row-edge") {
    const landed = resolveRowEdgeToRowEdgeLanding(
      doc,
      focus,
      direction,
      targetLine,
      mode.edgeColumn,
      sourceRowSamples,
      rowStart,
      wire
    );
    if (landed) {
      return landed;
    }
    return { pos: focus, branch: "row-edge-miss" };
  }

  const landed = resolveColumnAtGoalLanding(
    doc,
    focus,
    direction,
    targetLine,
    mode.goalColumn,
    sourceRowSamples,
    rowStart,
    wire.length
  );
  if (landed) {
    return landed;
  }
  return { pos: focus, branch: "dom-column-reject" };
}

function pickVerticalLandingOnLine(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  mode: VerticalContentLandingMode,
  sourceRowSamples: MeasuredWireOffset[] | undefined,
  rowStart: VisualRowStartContext | undefined,
  wire: string
): VerticalLanding {
  const landed = resolveVerticalContentLanding(
    doc,
    focus,
    direction,
    targetLine,
    mode,
    sourceRowSamples,
    rowStart,
    wire
  );
  if (mode.kind === "blank-exit-row-start" && landed.branch === "blank-exit-visual-row-start") {
    logVerArrow("resolve.rowStartProbe", {
      direction,
      fromWire: docPosToWireOffset(doc, focus),
      goalColumn: null,
      resolvedWire: docPosToWireOffset(doc, landed.pos),
      branch: landed.branch,
    });
  } else if (mode.kind === "row-edge-to-row-edge") {
    logVerArrow("resolve.rowStartProbe", {
      direction,
      fromWire: docPosToWireOffset(doc, focus),
      goalColumn: mode.edgeColumn,
      resolvedWire: docPosToWireOffset(doc, landed.pos),
      branch: landed.branch,
    });
  }
  return landed;
}

function isInlineBlankRowAdjacentToContent(
  layout: HandoffNoteLayoutMap,
  rowIndex: number,
  tolerance: number
): boolean {
  const row = layout.rows[rowIndex];
  if (!row || row.kind !== "blank") {
    return false;
  }
  const above = layout.rows[rowIndex - 1];
  if (above && above.kind !== "blank" && Math.abs(row.top - above.top) <= tolerance) {
    return true;
  }
  const below = layout.rows[rowIndex + 1];
  if (below && below.kind !== "blank" && Math.abs(row.top - below.top) <= tolerance) {
    return true;
  }
  return false;
}

function shouldSkipInlineBlankOnAscentFromContent(doc: HandoffNoteDoc, probeWire: number): boolean {
  return isInlineSuffixBlankProbeWire(doc, probeWire);
}

export function resolveVerticalTargetLineIndex(
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  direction: HandoffNoteVerticalArrowDirection,
  currentLineIndex: number,
  targetLineIndex: number
): number {
  if (currentLineIndex < 0) {
    return targetLineIndex;
  }
  const currentRow = layout.rows[currentLineIndex];
  if (!currentRow) {
    return targetLineIndex;
  }

  const tolerance = layoutRowTopTolerance(layout.lineHeight);

  if (direction === "down" && currentRow.kind !== "blank") {
    const inlineBlank = layout.rows[targetLineIndex];
    if (
      inlineBlank?.kind === "blank" &&
      Math.abs(inlineBlank.top - currentRow.top) <= tolerance &&
      isInlineBlankRowAdjacentToContent(layout, targetLineIndex, tolerance)
    ) {
      logVerArrow("layout.targetSkip", {
        direction,
        reason: "downSkipInlineBlankSameTop",
        currentLineIndex,
        skippedTargetIndex: targetLineIndex,
        resolvedTargetIndex: targetLineIndex + 1,
        currentTop: Math.round(currentRow.top * 100) / 100,
        blankTop: Math.round(inlineBlank.top * 100) / 100,
        breakProbeWire: inlineBlank.breakProbeWire ?? null,
      });
      return targetLineIndex + 1;
    }
    return targetLineIndex;
  }

  if (direction === "up" && currentRow.kind !== "blank") {
    const targetRow = layout.rows[targetLineIndex];
    if (
      targetRow?.kind === "blank" &&
      targetRow.breakProbeWire !== undefined &&
      isInlineBlankRowAdjacentToContent(layout, targetLineIndex, tolerance) &&
      shouldSkipInlineBlankOnAscentFromContent(doc, targetRow.breakProbeWire)
    ) {
      logVerArrow("layout.targetSkip", {
        direction,
        reason: "upSkipInlineSuffixBlank",
        currentLineIndex,
        skippedTargetIndex: targetLineIndex,
        resolvedTargetIndex: targetLineIndex - 1,
        breakProbeWire: targetRow.breakProbeWire,
      });
      return targetLineIndex - 1;
    }
    return targetLineIndex;
  }

  return targetLineIndex;
}

/** Visual start column for a blank row — measured blank-band geometry, not neighbor content X. */
function blankBandVisualStartColumn(layout: HandoffNoteLayoutMap, blankLineIndex: number): number {
  const blankRow = layout.rows[blankLineIndex];
  if (blankRow?.kind === "blank") {
    return layoutVisualRowStartColumn(blankRow);
  }
  return 0;
}

type LayoutVerticalMove = {
  pos: HandoffNoteDocPos;
  handled: boolean;
  branch?: string;
  goalColumn?: number;
};

function resolveBlankBandVerticalLanding(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  layout: HandoffNoteLayoutMap,
  targetRow: HandoffNoteLayoutRow,
  targetLineIndex: number
): LayoutVerticalMove {
  const visualStartColumn = blankBandVisualStartColumn(layout, targetLineIndex);
  const breakProbeWire = targetRow.breakProbeWire;

  if (breakProbeWire === undefined) {
    return { pos: focus, handled: false };
  }
  const pos = normalizeDocPos(doc, wireOffsetToDocPos(doc, breakProbeWire), { from: focus });
  return {
    pos,
    handled: !docPosEqual(pos, focus),
    branch: "blank-band-break-probe",
    goalColumn: visualStartColumn,
  };
}

export function resolveLayoutVerticalArrowMove(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  layout: HandoffNoteLayoutMap,
  goalColumn: number,
  root?: HTMLElement,
  wire = docToWire(doc)
): LayoutVerticalMove {
  const fromWire = docPosToWireOffset(doc, focus);
  if (layout.visualRowCount < 2) {
    return { pos: focus, handled: false };
  }

  const currentLineIndex = layout.rowIndexForWire(fromWire);
  const currentRow = layout.rows[currentLineIndex];
  let effectiveGoalColumn = goalColumn;
  if (currentRow?.kind === "blank") {
    effectiveGoalColumn = blankBandVisualStartColumn(layout, currentLineIndex);
  }
  let targetLineIndex = direction === "up" ? currentLineIndex - 1 : currentLineIndex + 1;
  targetLineIndex = resolveVerticalTargetLineIndex(
    doc,
    layout,
    direction,
    currentLineIndex,
    targetLineIndex
  );
  if (currentLineIndex < 0 || targetLineIndex < 0 || targetLineIndex >= layout.rows.length) {
    logVerArrow("resolve.reject", {
      direction,
      fromWire,
      reason: "lineIndexOutOfRange",
      currentLineIndex,
      targetLineIndex,
      visualRowCount: layout.visualRowCount,
    });
    return { pos: focus, handled: false };
  }

  const targetRow = layout.rows[targetLineIndex]!;
  const currentRowKind = currentRow?.kind ?? null;
  const edgeTolerance = layoutRowTopTolerance(layout.lineHeight);
  const leavingBlankForContent = currentRowKind === "blank" && targetRow.kind === "content";
  const landingMode = classifyVerticalContentLandingMode(
    doc,
    layout,
    fromWire,
    effectiveGoalColumn,
    currentLineIndex,
    targetLineIndex,
    leavingBlankForContent
  );
  const useRowStartLandingOnTarget = landingMode.kind !== "column-at-goal";
  logVerArrow("resolve.layout", {
    direction,
    fromWire,
    goalColumn,
    effectiveGoalColumn,
    landingMode: landingMode.kind,
    currentLineIndex,
    targetLineIndex,
    leavingBlankForContent,
    useRowStartLanding: useRowStartLandingOnTarget,
    currentRowKind,
    targetRowKind: targetRow.kind,
    targetRowTop: Math.round(targetRow.top * 100) / 100,
    targetBreakProbeWire: targetRow.breakProbeWire ?? null,
    targetRowWires: targetRow.samples.map((sample) => sample.wire),
    visualRowCount: layout.visualRowCount,
  });

  if (targetRow.kind === "blank" && targetRow.breakProbeWire !== undefined) {
    const blankMove = resolveBlankBandVerticalLanding(
      doc,
      focus,
      layout,
      targetRow,
      targetLineIndex
    );
    if (blankMove.handled) {
      logVerArrow("resolve.blankLand", {
        direction,
        fromWire,
        toWire: docPosToWireOffset(doc, blankMove.pos),
        targetLineIndex,
        targetTop: Math.round(targetRow.top * 100) / 100,
        goalColumnIn: effectiveGoalColumn,
        goalColumnOut: blankMove.goalColumn ?? null,
        branch: blankMove.branch ?? null,
      });
    }
    return blankMove;
  }

  if (leavingBlankForContent) {
    const edgeColumn = resolveBlankExitEdgeColumn(layout, targetLineIndex, effectiveGoalColumn);
    const blankExit = resolveBlankExitVisualRowStart(
      doc,
      focus,
      direction,
      targetRow.samples,
      wire.length
    );
    if (blankExit && !docPosEqual(blankExit.pos, focus)) {
      logVerArrow("resolve.rowStartProbe", {
        direction,
        fromWire,
        goalColumn: edgeColumn,
        resolvedWire: docPosToWireOffset(doc, blankExit.pos),
        branch: blankExit.branch,
      });
      return {
        pos: blankExit.pos,
        handled: true,
        branch: blankExit.branch,
        goalColumn: effectiveGoalColumn,
      };
    }
    return { pos: focus, handled: false };
  }

  const { pos: targetPos, branch } = pickVerticalLandingOnLine(
    doc,
    focus,
    direction,
    targetRow.samples,
    landingMode,
    currentLineIndex >= 0 ? layout.rows[currentLineIndex]!.samples : undefined,
    root
      ? {
          root,
          targetRowTop: targetRow.top,
          targetLineIndex,
          rowIndexForWire: layout.rowIndexForWire.bind(layout),
          coordsForWire: layout.coordsForWire.bind(layout),
          goalColumnTolerance: edgeTolerance,
        }
      : undefined,
    wire
  );

  if (docPosEqual(targetPos, focus)) {
    return { pos: focus, handled: false };
  }
  const landedWire = docPosToWireOffset(doc, targetPos);
  const landedColumn = layout.coordsForWire(landedWire)?.left;
  const preserveGoalColumn =
    landedColumn !== undefined &&
    layout.shouldPreserveGoalColumnOnShorterRowLanding({
      fromRowIndex: currentLineIndex,
      targetRowIndex: targetLineIndex,
      targetRow,
      effectiveGoalColumn,
      landedColumn,
      edgeTolerance,
      useRowStartLandingOnTarget,
    });
  return {
    pos: targetPos,
    handled: true,
    branch,
    goalColumn: preserveGoalColumn ? effectiveGoalColumn : (landedColumn ?? effectiveGoalColumn),
  };
}

function layoutVerticalMoveRejected(
  layout: HandoffNoteLayoutMap,
  fromWire: number,
  direction: HandoffNoteVerticalArrowDirection
): boolean {
  if (layout.visualRowCount < 2) {
    return false;
  }
  const currentLineIndex = layout.rowIndexForWire(fromWire);
  const targetLineIndex = direction === "up" ? currentLineIndex - 1 : currentLineIndex + 1;
  return currentLineIndex >= 0 && (targetLineIndex < 0 || targetLineIndex >= layout.visualRowCount);
}

/** Bleed when layout has no visual row above/below, or when layout cannot form rows (use horizontal at extremes). */
function shouldApplyVerticalBoundaryBleed(
  layout: HandoffNoteLayoutMap,
  fromWire: number,
  direction: HandoffNoteVerticalArrowDirection
): boolean {
  if (layout.visualRowCount < 2) {
    return true;
  }
  if (!layoutVerticalMoveRejected(layout, fromWire, direction)) {
    return false;
  }
  const currentLineIndex = layout.rowIndexForWire(fromWire);
  if (direction === "up") {
    return currentLineIndex === 0;
  }
  return currentLineIndex >= 0 && currentLineIndex === layout.visualRowCount - 1;
}

export function resolveDomVerticalArrowMove(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  options?: { stickyGoalColumn?: number | null }
): { pos: HandoffNoteDocPos; handled: boolean; goalColumn?: number; branch?: string } {
  const wire = docToWire(doc);
  const fromWire = docPosToWireOffset(doc, focus);
  const layout = buildHandoffNoteLayoutMap(root, doc, focus, { wire });
  const focusCoord = layout.coordsForWire(fromWire);
  const anchorRect = getDocAnchorRect(root, doc, focus);
  const anchorGoal =
    anchorRect && (anchorRect.height > 0 || anchorRect.width > 0) ? anchorRect.left : undefined;
  const measuredGoal = anchorGoal ?? focusCoord?.left ?? 0;
  const goalColumn = options?.stickyGoalColumn ?? measuredGoal;
  const layoutOwesMove = !layoutVerticalMoveRejected(layout, fromWire, direction);

  logVerArrow("resolve.entry", {
    direction,
    fromWire,
    layoutOwesMove,
    visualRowCount: layout.visualRowCount,
  });

  if (layoutOwesMove) {
    const layoutMove = resolveLayoutVerticalArrowMove(
      doc,
      focus,
      direction,
      layout,
      goalColumn,
      root,
      wire
    );
    if (layoutMove.handled) {
      const toWire = docPosToWireOffset(doc, layoutMove.pos);
      const landingGoal = layoutMove.goalColumn ?? layout.coordsForWire(toWire)?.left ?? goalColumn;
      logVerArrow("resolve.land", {
        direction,
        fromWire,
        toWire,
        branch: layoutMove.branch ?? null,
        goalColumnIn: goalColumn,
        goalColumnOut: landingGoal,
        branchGate: "visual-row",
      });
      return {
        pos: layoutMove.pos,
        handled: true,
        goalColumn: landingGoal,
        branch: layoutMove.branch,
      };
    }
  }

  const bleedCurrentLineIndex = layout.rowIndexForWire(fromWire);
  const bleedAllowed = shouldApplyVerticalBoundaryBleed(layout, fromWire, direction);
  logVerArrow("resolve.bleedGate", {
    direction,
    fromWire,
    currentLineIndex: bleedCurrentLineIndex,
    visualRowCount: layout.visualRowCount,
    bleedAllowed,
  });

  if (bleedAllowed) {
    const bleedDirection = direction === "up" ? "left" : "right";
    const bleedMove = resolveDocHorizontalArrowMove(doc, focus, bleedDirection);
    const landingWire = docPosToWireOffset(doc, bleedMove.pos);
    const landingGoal = layout.coordsForWire(landingWire)?.left ?? measuredGoal;
    logVerArrow("resolve.boundaryBleed", {
      direction,
      fromWire,
      toWire: landingWire,
      handled: bleedMove.handled,
      horizontal: bleedDirection,
    });
    return {
      pos: bleedMove.pos,
      handled: bleedMove.handled,
      goalColumn: landingGoal,
      branch: "boundary-bleed",
    };
  }

  logVerArrow("resolve.unhandled", {
    direction,
    fromWire,
    visualRowCount: layout.visualRowCount,
    currentLineIndex: bleedCurrentLineIndex,
  });
  return { pos: focus, handled: false, goalColumn };
}
