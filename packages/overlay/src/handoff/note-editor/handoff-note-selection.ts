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
  resolveVerticalArrowVisualLanding,
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
  resolveDomPointAtDocPos,
} from "./handoff-note-dom-points.js";
import {
  buildHandoffNoteLayoutMap,
  buildLayoutMapFromSamples,
  resolveWireAtColumnOnVisualRow,
  isAtLayoutRowStart,
  layoutVisualRowStartColumn,
  type HandoffNoteLayoutMap,
  type HandoffNoteLayoutRow,
  type SegmentOffsetLanding,
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

function pickClosestOnLine(line: MeasuredWireOffset[], targetLeft: number): MeasuredWireOffset {
  let best = line[0]!;
  for (const sample of line) {
    if (Math.abs(sample.left - targetLeft) < Math.abs(best.left - targetLeft)) {
      best = sample;
    }
  }
  return best;
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

function resolveVisualRowStartLanding(
  doc: HandoffNoteDoc,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  edgeColumn: number,
  edgeTolerance: number
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
  const wire = docToWire(doc);
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
  sourceRowSamples?: MeasuredWireOffset[]
): boolean {
  if (!sourceRowSamples || sourceRowSamples.length === 0) {
    return true;
  }
  const wire = docToWire(doc);
  const startSample = pickConcreteRowStartSample(sourceRowSamples, wire.length);
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

function pickTargetRowTextSamplePos(
  doc: HandoffNoteDoc,
  targetLine: MeasuredWireOffset[],
  goalColumn: number,
  rowStart?: VisualRowStartContext
): HandoffNoteDocPos | null {
  let best: { sample: MeasuredWireOffset; pos: HandoffNoteDocPos } | null = null;
  for (const sample of targetLine) {
    const pos = targetRowTextPosForWire(doc, sample.wire, rowStart);
    if (!pos) {
      continue;
    }
    if (!best || Math.abs(sample.left - goalColumn) < Math.abs(best.sample.left - goalColumn)) {
      best = { sample, pos };
    }
  }
  return best?.pos ?? null;
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

function isMentionAtomStart(doc: HandoffNoteDoc, pos: HandoffNoteDocPos): boolean {
  const node = doc.nodes[pos.nodeIndex];
  return node?.type === "mention" && pos.nodeOffset === 0;
}

type VisualRowStartContext = {
  root: HTMLElement;
  targetRowTop: number;
  targetLineIndex: number;
  rowIndexForWire: (wire: number) => number;
  coordsForWire: (wire: number) => MeasuredWireOffset | null;
  goalColumnTolerance: number;
};

function pickVerticalLandingOnLine(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  goalColumn: number,
  liveColumn: number,
  useRowStartLanding: boolean,
  leavingBlankForContent: boolean,
  sourceRowSamples?: MeasuredWireOffset[],
  rowStart?: VisualRowStartContext,
  segmentLanding?: SegmentOffsetLanding | null
): { pos: HandoffNoteDocPos; branch: string } {
  const fromWire = docPosToWireOffset(doc, focus);
  const fromMentionStart = isMentionAtomStart(doc, focus);
  const edgeColumn = liveColumn;
  if (useRowStartLanding && targetLine.length > 0) {
    if (rowStart) {
      const probeColumn = edgeColumn;
      const probed = probeDocPosAtVisualColumn(
        rowStart.root,
        doc,
        rowStart.targetRowTop,
        probeColumn
      );
      if (probed) {
        const landing = snapVerticalArrowLanding(doc, probed, direction);
        const resolvedWire = docPosToWireOffset(doc, landing);
        const probeRowIndex = rowStart.rowIndexForWire(resolvedWire);
        const probeCoord = rowStart.coordsForWire(resolvedWire);
        const columnMatches =
          probeCoord !== null &&
          Math.abs(probeCoord.left - edgeColumn) <= rowStart.goalColumnTolerance;
        if (probeRowIndex === rowStart.targetLineIndex && columnMatches) {
          logVerArrow("resolve.rowStartProbe", {
            direction,
            fromWire: docPosToWireOffset(doc, focus),
            goalColumn,
            probeColumn,
            rowTop: rowStart.targetRowTop,
            resolvedWire,
            probeRowIndex,
            targetLineIndex: rowStart.targetLineIndex,
            probeLeft: probeCoord.left,
            accepted: true,
            branch: "dom-row-start-probe",
          });
          return {
            pos: normalizeDocPos(doc, landing, { from: focus }),
            branch: "dom-row-start-probe",
          };
        }
        logVerArrow("resolve.rowStartProbe", {
          direction,
          fromWire: docPosToWireOffset(doc, focus),
          goalColumn,
          probeColumn,
          rowTop: rowStart.targetRowTop,
          resolvedWire,
          probeRowIndex,
          targetLineIndex: rowStart.targetLineIndex,
          probeLeft: probeCoord?.left ?? null,
          columnMatches,
          accepted: false,
          branch: "probe-wrong-row",
        });
      } else {
        logVerArrow("resolve.rowStartProbe", {
          direction,
          fromWire: docPosToWireOffset(doc, focus),
          goalColumn,
          probeColumn,
          rowTop: rowStart.targetRowTop,
          branch: "probe-miss",
        });
      }
    }

    const sourceAtVisualStart = sourceIsAtConcreteVisualStart(
      doc,
      fromWire,
      edgeColumn,
      sourceRowSamples
    );
    const rowStartLanding = leavingBlankForContent
      ? resolveVerticalArrowMinWireLineStart(doc, direction, targetLine)
      : null;
    if (rowStartLanding) {
      const pos = normalizeDocPos(doc, wireOffsetToDocPos(doc, rowStartLanding.offset), {
        from: focus,
      });
      logVerArrow("resolve.rowStartProbe", {
        direction,
        fromWire: docPosToWireOffset(doc, focus),
        goalColumn,
        resolvedWire: docPosToWireOffset(doc, pos),
        branch: rowStartLanding.branch,
      });
      return { pos, branch: rowStartLanding.branch };
    }
    const visualStartLanding = sourceAtVisualStart
      ? resolveVisualRowStartLanding(
          doc,
          direction,
          targetLine,
          edgeColumn,
          rowStart?.goalColumnTolerance ?? 2
        )
      : null;
    if (visualStartLanding) {
      logVerArrow("resolve.rowStartProbe", {
        direction,
        fromWire: docPosToWireOffset(doc, focus),
        goalColumn,
        resolvedWire: docPosToWireOffset(doc, visualStartLanding),
        branch: "visual-row-start",
      });
      return { pos: visualStartLanding, branch: "visual-row-start" };
    }
    const fallbackRowStartLanding = resolveVerticalArrowRowStartLanding(
      doc,
      direction,
      targetLine,
      edgeColumn
    );
    if (fallbackRowStartLanding) {
      const pos = normalizeDocPos(doc, wireOffsetToDocPos(doc, fallbackRowStartLanding.offset), {
        from: focus,
      });
      logVerArrow("resolve.rowStartProbe", {
        direction,
        fromWire: docPosToWireOffset(doc, focus),
        goalColumn,
        resolvedWire: docPosToWireOffset(doc, pos),
        branch: fallbackRowStartLanding.branch,
      });
      return { pos, branch: fallbackRowStartLanding.branch };
    }
  }

  if (fromMentionStart && (direction === "up" || useRowStartLanding)) {
    const landing = resolveVerticalArrowVisualLanding(doc, direction, targetLine, edgeColumn, {
      fromMentionStart,
    });
    if (landing === null) {
      const picked = pickClosestOnLine(targetLine, goalColumn);
      return {
        pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, picked.wire), { from: focus }),
        branch: "dom-column",
      };
    }
    const targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, landing.offset), {
      from: focus,
    });
    return { pos: targetPos, branch: landing.branch };
  }

  if (segmentLanding) {
    const offset = fromWire - segmentLanding.sourceStartWire;
    const landingWire = Math.max(
      segmentLanding.targetStartWire,
      Math.min(segmentLanding.targetStartWire + offset, segmentLanding.targetEndWire)
    );
    let targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, landingWire), { from: focus });
    const snapped = snapVerticalArrowLanding(doc, targetPos, direction);
    if (landedOutsideTargetRow(doc, snapped, rowStart)) {
      const rowContained =
        targetRowTextPosForWire(doc, landingWire, rowStart) ??
        pickTargetRowTextSamplePos(doc, targetLine, goalColumn, rowStart);
      if (rowContained) {
        return { pos: rowContained, branch: "segment-offset-target-row" };
      }
    }
    if (!docPosEqual(targetPos, snapped)) {
      return { pos: snapped, branch: "segment-offset-snap" };
    }
    return { pos: targetPos, branch: "segment-offset" };
  }

  const bracketWire = resolveWireAtColumnOnVisualRow(
    targetLine,
    goalColumn,
    docPosToWireOffset(doc, focus),
    sourceRowSamples
  );
  let targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, bracketWire), { from: focus });
  const snapped = snapVerticalArrowLanding(doc, targetPos, direction);
  if (landedOutsideTargetRow(doc, snapped, rowStart)) {
    const rowContained =
      targetRowTextPosForWire(doc, bracketWire, rowStart) ??
      pickTargetRowTextSamplePos(doc, targetLine, goalColumn, rowStart);
    if (rowContained) {
      return { pos: rowContained, branch: "dom-column-bracket-target-row" };
    }
  }
  if (!docPosEqual(targetPos, snapped)) {
    return { pos: snapped, branch: "dom-column-bracket-snap" };
  }
  return { pos: targetPos, branch: "dom-column-bracket" };
}

function layoutRowTopTolerance(layout: HandoffNoteLayoutMap): number {
  return Math.max(2, layout.lineHeight * 0.25);
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

  const tolerance = layoutRowTopTolerance(layout);

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

/** Visual start column for a blank row — align with nearest content row in the band. */
function blankBandVisualStartColumn(layout: HandoffNoteLayoutMap, blankLineIndex: number): number {
  for (let index = blankLineIndex - 1; index >= 0; index--) {
    const row = layout.rows[index];
    if (row?.kind === "content") {
      return layoutVisualRowStartColumn(row);
    }
  }
  for (let index = blankLineIndex + 1; index < layout.rows.length; index++) {
    const row = layout.rows[index];
    if (row?.kind === "content") {
      return layoutVisualRowStartColumn(row);
    }
  }
  const blankRow = layout.rows[blankLineIndex];
  return blankRow ? layoutVisualRowStartColumn(blankRow) : 0;
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

function resolveLayoutVerticalArrowMove(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  layout: HandoffNoteLayoutMap,
  goalColumn: number,
  root?: HTMLElement
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
  const liveColumn = layout.coordsForWire(fromWire)?.left ?? effectiveGoalColumn;
  const edgeTolerance = Math.max(2, layout.lineHeight * 0.25);
  const atRowEdge = isAtLayoutRowStart(layout, fromWire, effectiveGoalColumn);
  const leavingBlankForContent = currentRowKind === "blank" && targetRow.kind === "content";
  const useRowStartLanding = atRowEdge || leavingBlankForContent;
  const targetIsBlank = targetRow.kind === "blank";
  const useRowStartLandingOnTarget = useRowStartLanding && !targetIsBlank;
  const landingEdgeColumn = useRowStartLanding ? effectiveGoalColumn : liveColumn;
  logVerArrow("resolve.layout", {
    direction,
    fromWire,
    goalColumn,
    effectiveGoalColumn,
    liveColumn,
    landingEdgeColumn,
    currentLineIndex,
    targetLineIndex,
    atRowEdge,
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

  const { pos: targetPos, branch } = pickVerticalLandingOnLine(
    doc,
    focus,
    direction,
    targetRow.samples,
    effectiveGoalColumn,
    landingEdgeColumn,
    useRowStartLandingOnTarget,
    leavingBlankForContent,
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
    layout.resolveSegmentOffsetLanding(fromWire, currentLineIndex, targetLineIndex)
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

export function resolveMeasuredVerticalArrowMove(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  measured: MeasuredWireOffset[],
  currentLeft: number,
  lineHeight: number
): { pos: HandoffNoteDocPos; handled: boolean; branch?: string } {
  if (measured.length < 2) {
    return { pos: focus, handled: false };
  }
  const layout = buildLayoutMapFromSamples(measured, lineHeight, doc);
  return resolveLayoutVerticalArrowMove(doc, focus, direction, layout, currentLeft);
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
): { pos: HandoffNoteDocPos; handled: boolean; goalColumn?: number } {
  const fromWire = docPosToWireOffset(doc, focus);
  const layout = buildHandoffNoteLayoutMap(root, doc, focus);
  const focusCoord = layout.coordsForWire(fromWire);
  const anchorRect = getDocAnchorRect(root, doc, focus);
  const measuredGoal = focusCoord?.left ?? anchorRect?.left ?? 0;
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
      root
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
      return { pos: layoutMove.pos, handled: true, goalColumn: landingGoal };
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
    return { pos: bleedMove.pos, handled: bleedMove.handled, goalColumn: landingGoal };
  }

  logVerArrow("resolve.unhandled", {
    direction,
    fromWire,
    visualRowCount: layout.visualRowCount,
    currentLineIndex: bleedCurrentLineIndex,
  });
  return { pos: focus, handled: false, goalColumn };
}
