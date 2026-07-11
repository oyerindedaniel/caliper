import {
  collapsedSelection,
  describeHandoffNoteCursorContext,
  docPosEqual,
  docPosToWireOffset,
  docToWire,
  isEmbeddedBlankBandProbeWire,
  isInlineSuffixBlankProbeWire,
  normalizeDocPos,
  normalizeSelection,
  resolveDocHorizontalArrowMove,
  resolveVerticalArrowMinWireLineStart,
  resolveVerticalArrowRowStartLanding,
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
  describeCaretContext,
  domPointToDocPos,
  docPosAtContentWire,
  getDocAnchorRect,
  probeDocPosAtVisualColumn,
  probeViewportCaretHit,
  resolveTargetRowPillWireForGoalColumn,
  type TargetRowMentionPaintSpan,
  resolveDomPointAtDocPos,
  resolveDomReadDocPos,
  resolvePaintDocPos,
} from "./handoff-note-dom-points.js";
import {
  buildHandoffNoteLayoutMap,
  closestLayoutRowIndexForTop,
  layoutContentRowEndWire,
  layoutContentRowContentExtentRight,
  layoutContentRowEdgeScan,
  layoutContentRowStartSample,
  layoutRowForFocus,
  layoutSourceIsAtRowContentEnd,
  isAtLayoutRowStart,
  isSameWireSoftWrapBandCrossing,
  layoutRowTopTolerance,
  layoutVisualRowStartColumn,
  type HandoffNoteLayoutMap,
  type HandoffNoteLayoutRow,
  type MeasuredWireOffset,
} from "./handoff-note-layout-map.js";

function contentRowFromSamples(samples: MeasuredWireOffset[]): HandoffNoteLayoutRow {
  return { kind: "content", top: 0, minLeft: 0, maxLeft: 0, samples };
}

function readRawWireFocus(root: HTMLElement, doc: HandoffNoteDoc): number {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    return 0;
  }
  const range = selection.getRangeAt(0);
  const focus = domPointToDocPos(root, doc, range.endContainer, range.endOffset);
  return docPosToWireOffset(doc, focus);
}

function shouldRestoreAuthorityOverDom(
  doc: HandoffNoteDoc,
  live: HandoffNoteDocPos,
  from: HandoffNoteDocPos
): boolean {
  /** Cross-wire DOM regression only — same-wire alias seams use resolveDomReadDocPos on read. */
  const liveWire = docPosToWireOffset(doc, live);
  const fromWire = docPosToWireOffset(doc, from);
  const fromContext = describeHandoffNoteCursorContext(doc, fromWire);

  if (
    (fromContext.kind === "mention-boundary" && fromContext.edge === "end") ||
    fromContext.kind === "mention-interior"
  ) {
    if (isEmbeddedBlankBandProbeWire(doc, liveWire) && liveWire > fromWire) {
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
  const sameWireAliasRestore =
    docPosToWireOffset(doc, liveFocus) === docPosToWireOffset(doc, priorFocus) &&
    !docPosEqualNormalized(doc, liveFocus, priorFocus);
  if (
    docPosEqualNormalized(doc, resolvedFocus, priorFocus) &&
    !docPosEqualNormalized(doc, liveFocus, priorFocus)
  ) {
    return {
      probeAliasEligible: sameWireAliasRestore,
      repairBranch: "restoreAuthority",
    };
  }
  if (!docPosEqualNormalized(doc, resolvedFocus, liveFocus)) {
    return { probeAliasEligible: sameWireAliasRestore, repairBranch: "normalized" };
  }
  return { probeAliasEligible: false, repairBranch: "acceptedLive" };
}

export function readDocSelection(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  options?: { from?: HandoffNoteDocPos }
): HandoffNoteSelection {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    return normalizeSelection(doc, {
      anchor: { nodeIndex: 0, nodeOffset: 0 },
      focus: { nodeIndex: 0, nodeOffset: 0 },
    });
  }

  const range = selection.getRangeAt(0);
  const fromOpt = options?.from !== undefined ? { from: options.from } : undefined;
  const rawAnchor = domPointToDocPos(root, doc, range.startContainer, range.startOffset);
  const rawFocus = domPointToDocPos(root, doc, range.endContainer, range.endOffset);
  const anchor = options?.from
    ? resolveDomReadDocPos(doc, normalizeDocPos(doc, rawAnchor), options.from)
    : normalizeDocPos(doc, rawAnchor, fromOpt);
  const focus = options?.from
    ? resolveDomReadDocPos(doc, normalizeDocPos(doc, rawFocus), options.from)
    : normalizeDocPos(doc, rawFocus, fromOpt);
  return { anchor, focus };
}

export function readDocCursor(root: HTMLElement, doc: HandoffNoteDoc): HandoffNoteDocPos {
  return readDocSelection(root, doc).focus;
}

export type HandoffNoteClickIngress = {
  clientX: number;
  clientY: number;
};

export type HandoffNoteClickIngressResolution = "nativeSelection" | "viewportCaretHit";

export type HandoffNoteClickIngressResult = {
  focus: HandoffNoteDocPos;
  resolution: HandoffNoteClickIngressResolution;
};

function clickIngressPaintFocus(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  live: HandoffNoteDocPos,
  from?: HandoffNoteDocPos
): HandoffNoteDocPos {
  const liveWire = docPosToWireOffset(doc, live);
  const paintDocPos =
    layout.paintContextForWire(liveWire)?.paintDocPos ?? resolvePaintDocPos(doc, live, { root });
  const fromOpt = from !== undefined ? { from } : undefined;
  const normalized = normalizeDocPos(doc, paintDocPos, fromOpt);
  return from !== undefined ? resolveDomReadDocPos(doc, normalized, from) : normalized;
}

/** Strict click gate: does (clientX, clientY) hit the painted anchor for this doc pos? */
function clickMatchesDocPosPaintAnchor(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  pos: HandoffNoteDocPos,
  click: HandoffNoteClickIngress
): boolean {
  const anchor = getDocAnchorRect(root, doc, pos);
  if (!anchor || (anchor.height <= 0 && anchor.width <= 0)) {
    return false;
  }
  const bandTol = layoutRowTopTolerance(layout.lineHeight);
  const anchorMidY = anchor.top + anchor.height / 2;
  if (Math.abs(anchorMidY - click.clientY) > bandTol) {
    return false;
  }
  return click.clientX >= anchor.left && click.clientX <= anchor.right;
}

function isClickPastLayoutRowContentExtent(
  layout: HandoffNoteLayoutMap,
  doc: HandoffNoteDoc,
  clickRowIndex: number,
  click: HandoffNoteClickIngress
): boolean {
  const contentExtentRight = layoutContentRowContentExtentRight(layout, doc, clickRowIndex);
  return contentExtentRight !== null && click.clientX > contentExtentRight;
}

/** Viewport row-end alias must not displace stale wrap continuation live on the row below the click. */
function viewportAliasesStaleWrapContinuation(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  live: HandoffNoteDocPos,
  viewportPos: HandoffNoteDocPos,
  clickRowIndex: number
): boolean {
  if (layoutRowForFocus(root, doc, layout, live) === clickRowIndex) {
    return false;
  }
  const viewportWire = docPosToWireOffset(doc, viewportPos);
  const rowEndWire = layoutContentRowEndWire(layout, doc, clickRowIndex);
  if (rowEndWire === null) {
    return false;
  }
  const continuationWire = layout.continuationAfterRowEndWire(rowEndWire);
  if (continuationWire === null || docPosToWireOffset(doc, live) !== continuationWire) {
    return false;
  }
  if (describeCaretContext(doc, live, { root }).kind !== "text") {
    return false;
  }
  return viewportWire === rowEndWire;
}

/**
 * Plain soft-wrap continuation: live is the promoted continuation after the clicked
 * row's content end while the click landed on the row above, past that row's content extent.
 */
function isWrapContinuationStartClickInRowAbove(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  pos: HandoffNoteDocPos,
  click: HandoffNoteClickIngress,
  clickRowIndex: number
): boolean {
  const liveRowIndex = layoutRowForFocus(root, doc, layout, pos);
  if (liveRowIndex !== clickRowIndex + 1) {
    return false;
  }
  const rowEndWire = layoutContentRowEndWire(layout, doc, clickRowIndex);
  if (rowEndWire === null) {
    return false;
  }
  const continuationWire = layout.continuationAfterRowEndWire(rowEndWire);
  if (continuationWire === null || docPosToWireOffset(doc, pos) !== continuationWire) {
    return false;
  }
  return isClickPastLayoutRowContentExtent(layout, doc, clickRowIndex, click);
}

function isClickPosStrictlyRepresentable(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  pos: HandoffNoteDocPos,
  click: HandoffNoteClickIngress
): boolean {
  const wire = docPosToWireOffset(doc, pos);
  const context = describeHandoffNoteCursorContext(doc, wire);
  if (context.kind === "mention-interior") {
    return false;
  }
  if (clickMatchesDocPosPaintAnchor(root, doc, layout, pos, click)) {
    return true;
  }
  const clickRowIndex = closestLayoutRowIndexForTop(layout, click.clientY);
  if (clickRowIndex < 0) {
    return true;
  }
  return layoutRowForFocus(root, doc, layout, pos) === clickRowIndex;
}

function isClickLiveRepresentable(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  pos: HandoffNoteDocPos,
  click: HandoffNoteClickIngress
): boolean {
  const clickRowIndex = closestLayoutRowIndexForTop(layout, click.clientY);
  if (isClickPosStrictlyRepresentable(root, doc, layout, pos, click)) {
    return true;
  }
  if (clickRowIndex < 0) {
    return false;
  }
  return isWrapContinuationStartClickInRowAbove(root, doc, layout, pos, click, clickRowIndex);
}

function resolveVerticalLandingDocPos(
  doc: HandoffNoteDoc,
  wire: number,
  options?: {
    layout?: HandoffNoteLayoutMap;
    from?: HandoffNoteDocPos;
  }
): HandoffNoteDocPos {
  const paintCtx = options?.layout?.paintContextForWire(wire);
  const pos = paintCtx?.paintDocPos ?? docPosAtContentWire(doc, wire);
  return options?.from
    ? normalizeDocPos(doc, pos, { from: options.from })
    : normalizeDocPos(doc, pos);
}

export function resolveClickIngressSelection(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  live: HandoffNoteDocPos,
  from: HandoffNoteDocPos | undefined,
  click: HandoffNoteClickIngress
): HandoffNoteClickIngressResult {
  const layout = buildHandoffNoteLayoutMap(root, doc, live);
  const clickRowIndex = closestLayoutRowIndexForTop(layout, click.clientY);
  const fromOpt = from ? { from } : undefined;
  const liveWire = docPosToWireOffset(doc, live);
  const liveAnchor = getDocAnchorRect(root, doc, live);
  const liveAnchorMidY =
    liveAnchor && (liveAnchor.height > 0 || liveAnchor.width > 0)
      ? liveAnchor.top + liveAnchor.height / 2
      : null;

  if (isClickPosStrictlyRepresentable(root, doc, layout, live, click)) {
    logCaretBoundaryTrace("click.ingress", {
      branch: "nativeSelection",
      liveWire,
      clickRowIndex,
      liveAnchorMidY,
      clickX: click.clientX,
      clickY: click.clientY,
    });
    return {
      focus: clickIngressPaintFocus(root, doc, layout, live, from),
      resolution: "nativeSelection",
    };
  }

  const viewport = probeViewportCaretHit(root, doc, click.clientX, click.clientY, fromOpt);
  if (
    viewport.pos &&
    isClickLiveRepresentable(root, doc, layout, viewport.pos, click) &&
    !viewportAliasesStaleWrapContinuation(root, doc, layout, live, viewport.pos, clickRowIndex)
  ) {
    const focus = clickIngressPaintFocus(root, doc, layout, viewport.pos, from);
    const resolvedWire = docPosToWireOffset(doc, focus);
    logCaretBoundaryTrace("click.ingress", {
      branch: "viewportCaretHit",
      liveWire,
      resolvedWire,
      clickRowIndex,
      liveAnchorMidY,
      clickX: click.clientX,
      clickY: click.clientY,
    });
    return {
      focus,
      resolution: "viewportCaretHit",
    };
  }

  logCaretBoundaryTrace("click.ingress", {
    branch: "nativeSelection-fallback",
    liveWire,
    clickRowIndex,
    liveAnchorMidY,
    clickX: click.clientX,
    clickY: click.clientY,
  });
  return {
    focus: clickIngressPaintFocus(root, doc, layout, live, from),
    resolution: "nativeSelection",
  };
}

export function repairDocSelectionIfNeeded(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  from?: HandoffNoteDocPos,
  options?: {
    mode?: "full" | "strand-only";
    click?: HandoffNoteClickIngress;
  }
): HandoffNoteDocPos {
  const skipAuthorityRead = options?.mode === "strand-only" && options?.click !== undefined;
  const live = readDocSelection(root, doc, !skipAuthorityRead && from ? { from } : undefined);
  if (!docPosEqualNormalized(doc, live.anchor, live.focus)) {
    return live.focus;
  }

  const focusWire = readRawWireFocus(root, doc);
  const fromWire = from !== undefined ? docPosToWireOffset(doc, from) : undefined;
  const context = describeHandoffNoteCursorContext(doc, focusWire);

  if (context.kind === "mention-interior" && fromWire !== undefined) {
    if (fromWire <= context.start) {
      const restored = wireOffsetToDocPos(doc, fromWire);
      logCaretBoundaryTrace("repair", {
        branch: "restoreFromOutsideMention.before",
        liveWire: focusWire,
        fromWire,
        resolvedWire: fromWire,
      });
      setDocSelection(root, doc, collapsedSelection(restored), {
        from: restored,
        source: "repair",
      });
      return restored;
    }
    if (fromWire >= context.end) {
      const restored = wireOffsetToDocPos(doc, context.start);
      logCaretBoundaryTrace("repair", {
        branch: "restoreFromOutsideMention.after",
        liveWire: focusWire,
        fromWire,
        resolvedWire: context.start,
      });
      setDocSelection(root, doc, collapsedSelection(restored), {
        from: restored,
        source: "repair",
      });
      return restored;
    }
  }

  if (options?.mode === "strand-only") {
    if (options?.click) {
      const resolved = resolveClickIngressSelection(root, doc, live.focus, from, options.click);
      const liveWire = docPosToWireOffset(doc, live.focus);
      const resolvedWire = docPosToWireOffset(doc, resolved.focus);
      const willPaint = !docPosEqualNormalized(doc, resolved.focus, live.focus);
      logCaretBoundaryTrace("repair.click", {
        resolution: resolved.resolution,
        liveWire,
        resolvedWire,
        fromWire: from !== undefined ? docPosToWireOffset(doc, from) : null,
        willPaint,
      });
      if (willPaint) {
        setDocSelection(root, doc, collapsedSelection(resolved.focus), {
          source: `repair.click.${resolved.resolution}`,
        });
      }
      return resolved.focus;
    }
    const normalized = normalizeDocPos(doc, live.focus, { from });
    logCaretBoundaryTrace("repair.strand", {
      branch: "normalizeLive",
      liveWire: docPosToWireOffset(doc, live.focus),
      fromWire: from !== undefined ? docPosToWireOffset(doc, from) : null,
      resolvedWire: docPosToWireOffset(doc, normalized),
      willPaint: false,
    });
    return normalized;
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
  const fromOpt = options?.from ? { from: options.from } : undefined;
  const docSel = normalizeSelection(doc, selection, fromOpt);
  const docApi = root.ownerDocument;
  const native = docApi.getSelection();
  if (!native) {
    return;
  }

  const paintOpt = { from: options?.from ?? docSel.focus };
  const startPoint = resolveDomPointAtDocPos(root, doc, docSel.anchor, paintOpt);
  const endPoint = resolveDomPointAtDocPos(root, doc, docSel.focus, paintOpt);
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

  const paintFocus = resolvePaintDocPos(doc, docSel.focus, { root });
  const focusWire = docPosToWireOffset(doc, docSel.focus);
  const caretContext = describeCaretContext(doc, docSel.focus, { root });
  logCaretBoundaryTrace(`setDoc>>${source}`, {
    requestedWire: focusWire,
    paintDoc: { nodeIndex: paintFocus.nodeIndex, nodeOffset: paintFocus.nodeOffset },
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

function resolveVisualRowStartLanding(
  doc: HandoffNoteDoc,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  edgeColumn: number,
  edgeTolerance: number,
  wire: string,
  rowStart?: VisualRowStartContext
): HandoffNoteDocPos | null {
  if (targetLine.length === 0) {
    return null;
  }
  const scan = layoutContentRowEdgeScan(contentRowFromSamples(targetLine), wire.length);
  if (edgeColumn > scan.minLeft + edgeTolerance) {
    return null;
  }
  const startSample = scan.startSample;
  let landingWire = startSample?.wire ?? null;
  if (landingWire === null) {
    const minStart = resolveVerticalArrowMinWireLineStart(doc, direction, targetLine);
    landingWire =
      minStart !== null
        ? minStart.offset
        : wire.lastIndexOf("\n", Math.max(0, targetLine[0]!.wire - 1)) + 1;
  }
  const rowStartPos = docPosAtContentWire(doc, landingWire);
  if (doc.nodes[rowStartPos.nodeIndex]?.type !== "text") {
    return null;
  }
  return resolveVerticalLandingDocPos(doc, landingWire, {
    layout: rowStart?.layout,
  });
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
  const startSample = layoutContentRowStartSample(
    contentRowFromSamples(sourceRowSamples),
    wireLength
  );
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
  const pos = docPosAtContentWire(doc, wire);
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
  let hasBracket = false;
  let bestSample = targetLine[0]!;
  let bestDistance = Math.abs(bestSample.left - goalColumn);
  for (const sample of targetLine) {
    if (sample.wire === bracketWire) {
      hasBracket = true;
    }
    const distance = Math.abs(sample.left - goalColumn);
    if (distance < bestDistance) {
      bestSample = sample;
      bestDistance = distance;
    }
  }
  if (hasBracket) {
    return bracketWire;
  }
  return bestSample.wire;
}

type VerticalLanding = {
  pos: HandoffNoteDocPos;
  branch: string;
};

type VisualRowStartContext = {
  root: HTMLElement;
  layout: HandoffNoteLayoutMap;
  targetRowTop: number;
  targetLineIndex: number;
  targetLine: MeasuredWireOffset[];
  rowIndexForWire: (wire: number) => number;
  coordsForWire: (wire: number) => MeasuredWireOffset | null;
  goalColumnTolerance: number;
};

function acceptPillColumnSnapLanding(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  column: number,
  pillWire: number,
  rowStart: VisualRowStartContext,
  branch: string
): VerticalLanding | null {
  const pillRowIndex = rowStart.rowIndexForWire(pillWire);
  if (pillRowIndex !== rowStart.targetLineIndex) {
    return null;
  }
  logVerArrow("resolve.domColumnProbe", {
    direction,
    fromWire: docPosToWireOffset(doc, focus),
    probeColumn: column,
    rowTop: rowStart.targetRowTop,
    resolvedWire: pillWire,
    probeRowIndex: pillRowIndex,
    targetLineIndex: rowStart.targetLineIndex,
    accepted: true,
    branch,
  });
  return {
    pos: resolveVerticalLandingDocPos(doc, pillWire, {
      layout: rowStart.layout,
      from: focus,
    }),
    branch,
  };
}

function probeLandingPaintLeft(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  probed: HandoffNoteDocPos,
  probeCoord: MeasuredWireOffset | null
): number | null {
  const anchorRect = getDocAnchorRect(root, doc, probed);
  if (anchorRect !== null && (anchorRect.height > 0 || anchorRect.width > 0)) {
    return anchorRect.left;
  }
  return probeCoord?.left ?? null;
}

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

  const tolerance = rowStart.goalColumnTolerance;
  const pillWire = resolveTargetRowPillWireForGoalColumn(
    rowStart.root,
    doc,
    column,
    mentionPaintSpansFromTargetLine(doc, rowStart.targetLine),
    tolerance
  );
  if (pillWire !== null) {
    const landed = acceptPillColumnSnapLanding(
      doc,
      focus,
      direction,
      column,
      pillWire,
      rowStart,
      "pill-column-snap"
    );
    if (landed) {
      return landed;
    }
    logVerArrow("resolve.domColumnProbe", {
      direction,
      fromWire: docPosToWireOffset(doc, focus),
      probeColumn: column,
      rowTop: rowStart.targetRowTop,
      resolvedWire: pillWire,
      accepted: false,
      branch: "probe-pill-interior",
    });
    return null;
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

  const resolvedWire = docPosToWireOffset(doc, probed);
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
  logVerArrow("resolve.domColumnProbe", {
    direction,
    fromWire: docPosToWireOffset(doc, focus),
    probeColumn: column,
    rowTop: rowStart.targetRowTop,
    resolvedWire,
    probeRowIndex,
    targetLineIndex: rowStart.targetLineIndex,
    probeLeft:
      probeLandingPaintLeft(rowStart.root, doc, probed, probeCoord) ?? probeCoord?.left ?? null,
    accepted: true,
    branch: "dom-column-probe",
  });
  return {
    pos: resolveVerticalLandingDocPos(doc, resolvedWire, {
      layout: rowStart.layout,
      from: focus,
    }),
    branch: "dom-column-probe",
  };
}

type VerticalContentLandingMode =
  | { kind: "blank-exit-row-start" }
  | { kind: "row-edge-to-row-edge"; edgeColumn: number }
  | { kind: "column-at-goal"; goalColumn: number };

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

type MentionColumnSpan = TargetRowMentionPaintSpan & {
  startLeft: number;
  pillRight: number;
};

function mentionSpanPillRight(
  startSample: MeasuredWireOffset,
  endSample: MeasuredWireOffset
): number {
  return startSample.right ?? endSample.right ?? endSample.left;
}

function mentionPaintSpansFromTargetLine(
  doc: HandoffNoteDoc,
  targetLine: MeasuredWireOffset[]
): TargetRowMentionPaintSpan[] {
  return mentionColumnSpansFromTargetLine(doc, targetLine).map((span) => ({
    mentionNodeIndex: span.mentionNodeIndex,
    startWire: span.startWire,
    endWire: span.endWire,
    layoutLeft: span.startLeft,
    layoutRight: span.pillRight,
  }));
}

function mentionColumnSpansFromTargetLine(
  doc: HandoffNoteDoc,
  targetLine: MeasuredWireOffset[]
): MentionColumnSpan[] {
  const sampleByWire = new Map<number, MeasuredWireOffset>();
  for (const sample of targetLine) {
    sampleByWire.set(sample.wire, sample);
  }
  const spans: MentionColumnSpan[] = [];
  for (const sample of targetLine) {
    const context = describeHandoffNoteCursorContext(doc, sample.wire);
    if (context.kind !== "mention-boundary" || context.edge !== "start") {
      continue;
    }
    const endSample = sampleByWire.get(context.end);
    const startPos = wireOffsetToDocPos(doc, context.start);
    const pillRight = endSample ? mentionSpanPillRight(sample, endSample) : sample.left;
    spans.push({
      mentionNodeIndex: startPos.nodeIndex,
      startWire: context.start,
      endWire: context.end,
      startLeft: sample.left,
      pillRight,
      layoutLeft: sample.left,
      layoutRight: pillRight,
    });
  }
  return spans;
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
  const atomicWire = resolveTargetRowPillWireForGoalColumn(
    rowStart?.root,
    doc,
    effectiveGoalColumn,
    mentionPaintSpansFromTargetLine(doc, targetLine),
    tolerance
  );
  const resolvedWire = atomicWire ?? snapVerticalColumnLandingWire(doc, landingWire, direction);
  const mentionSnapApplied = resolvedWire !== bracketWire;
  let targetPos = resolveVerticalLandingDocPos(doc, resolvedWire, {
    layout: rowStart?.layout,
    from: focus,
  });
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

function classifyVerticalContentLandingMode(
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  fromWire: number,
  goalColumn: number,
  currentLineIndex: number,
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
  const startSample = layoutContentRowStartSample(contentRowFromSamples(targetLine), wireLength);
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

/** Blank-band exit lands at the target content row's painted visual start — not a prefix row above it. */
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
  const targetRow = contentRowFromSamples(targetLine);
  const targetScan = layoutContentRowEdgeScan(targetRow, wireLength);
  const { minLeft, maxLeft } = targetScan;
  const effectiveGoal = clampGoalColumnToRowExtent(goalColumn, minLeft, maxLeft, tolerance);
  const fromWire = docPosToWireOffset(doc, focus);
  const sourceAtRowEnd =
    sourceRowSamples && sourceRowSamples.length > 0
      ? layoutSourceIsAtRowContentEnd(
          doc,
          contentRowFromSamples(sourceRowSamples),
          fromWire,
          goalColumn,
          tolerance
        )
      : false;

  const attempts: Array<{ wire: number; branch: string }> = [];

  if (effectiveGoal <= minLeft + tolerance) {
    if (targetScan.startSample) {
      attempts.push({
        wire: targetScan.startSample.wire,
        branch: "sparse-row-start",
      });
    }
  }

  if (sourceAtRowEnd || fromWire >= wireLength || effectiveGoal >= maxLeft - tolerance) {
    const endSample = targetScan.endSample ?? targetLine[0]!;
    const endWire = snapPastEndUnsampledBracketToLayoutSample(
      targetLine,
      endSample.wire,
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
        wire,
        rowStart
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

  const paintRow = layout.paintContextForWire(fromWire)?.rowIndex;
  let currentLineIndex: number;
  if (root !== undefined) {
    currentLineIndex = layoutRowForFocus(root, doc, layout, focus);
  } else if (paintRow !== undefined && paintRow >= 0) {
    currentLineIndex = paintRow;
  } else {
    currentLineIndex = layout.rowIndexForWire(fromWire);
  }
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
        goalColumn: effectiveGoalColumn,
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
          layout,
          targetRowTop: targetRow.top,
          targetLineIndex,
          targetLine: targetRow.samples,
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
  const outputGoalColumn =
    landingMode.kind === "column-at-goal"
      ? effectiveGoalColumn
      : (layout.coordsForWire(docPosToWireOffset(doc, targetPos))?.left ?? effectiveGoalColumn);
  return {
    pos: targetPos,
    handled: true,
    branch,
    goalColumn: outputGoalColumn,
  };
}

function layoutVerticalMoveRejected(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection
): boolean {
  if (layout.visualRowCount < 2) {
    return false;
  }
  const currentLineIndex = layoutRowForFocus(root, doc, layout, focus);
  const targetLineIndex = direction === "up" ? currentLineIndex - 1 : currentLineIndex + 1;
  return currentLineIndex >= 0 && (targetLineIndex < 0 || targetLineIndex >= layout.visualRowCount);
}

/** Bleed when layout has no visual row above/below, or when layout cannot form rows (use horizontal at extremes). */
function shouldApplyVerticalBoundaryBleed(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection
): boolean {
  if (layout.visualRowCount < 2) {
    return true;
  }
  if (!layoutVerticalMoveRejected(root, doc, layout, focus, direction)) {
    return false;
  }
  const currentLineIndex = layoutRowForFocus(root, doc, layout, focus);
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
  const layoutOwesMove = !layoutVerticalMoveRejected(root, doc, layout, focus, direction);

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

  const bleedCurrentLineIndex = layoutRowForFocus(root, doc, layout, focus);
  const bleedAllowed = shouldApplyVerticalBoundaryBleed(root, doc, layout, focus, direction);
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
