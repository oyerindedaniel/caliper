import {
  collapsedSelection,
  collapsedSelectionWithIntent,
  describeHandoffNoteCursorContext,
  docPosEqual,
  docPosToWireOffset,
  docToWire,
  isAtomicNode,
  isCaretOnAmbiguousContentRowEndChar,
  isEmbeddedBlankBandProbeWire,
  isInlineSuffixBlankProbeWire,
  nodeTokenLength,
  normalizeDocPos,
  normalizeSelection,
  resolveVerticalArrowMinWireLineStart,
  resolveVerticalArrowRowStartLanding,
  resolveWireLineColumn,
  wireOffsetToDocPos,
  type HandoffNoteCaretAffinity,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
  type HandoffNoteNavDirection,
  type HandoffNoteSelection,
  type HandoffNoteVerticalArrowDirection,
} from "@caliper/core";
import { mentionWireLength } from "./handoff-note-dom.js";
import {
  describeCaretContext,
  domPointToDocPos,
  getDocAnchorRect,
  probeDocPosAtVisualColumn,
  probeViewportCaretHit,
  resolveTargetRowPillWireForGoalColumn,
  type TargetRowAtomPaintSpan,
  resolveDomPointAtDocPos,
  resolveDomReadDocPos,
  resolvePaintContext,
  resolvePaintContextAtWire,
  resolvePaintHorizontalArrowMove,
} from "./handoff-note-dom-points.js";
import {
  buildHandoffNoteLayoutMap,
  closestLayoutRowIndexForTop,
  layoutContentRowEndWire,
  layoutContentRowContentExtentRight,
  layoutContentRowEdgeScan,
  layoutContentRowStartSample,
  layoutRowForFocus,
  layoutRowAtWireFocus,
  isAtLayoutRowStart,
  isSameWireSoftWrapBandCrossing,
  layoutRowTopTolerance,
  layoutVisualRowStartColumn,
  type HandoffNoteLayoutMap,
  type HandoffNoteLayoutRow,
  type MeasuredWireOffset,
} from "./handoff-note-layout-map.js";
import {
  isHandoffNoteDebugEnabled,
  logSelectionMap,
  snapshotDocPosForLog,
} from "../handoff-note-debug.js";

function contentRowFromSamples(samples: MeasuredWireOffset[]): HandoffNoteLayoutRow {
  return { kind: "content", top: 0, minLeft: 0, maxLeft: 0, samples };
}

/**
 * Focus → paint → row. Opt-in via `HANDOFF_NOTE_DEBUG=1`.
 * Filter: `caret>>selection.map`.
 */
export function logDocSelectionLayoutMapping(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  source: string,
  extras?: Record<string, unknown>
): void {
  if (!isHandoffNoteDebugEnabled()) {
    return;
  }
  const layout = buildHandoffNoteLayoutMap(root, doc);
  const { paintPos } = resolvePaintContext(doc, focus, { root });
  const focusWire = docPosToWireOffset(doc, focus);
  const paintWire = docPosToWireOffset(doc, paintPos);
  const rowIndex = layoutRowForFocus(root, doc, layout, focus);
  const row = layout.rows[rowIndex];
  logSelectionMap(source, {
    focusWire,
    focusDoc: snapshotDocPosForLog(doc, focus),
    paintWire,
    paintDoc: snapshotDocPosForLog(doc, paintPos),
    rowIndex,
    rowKind: row?.kind ?? null,
    rowWires: row?.samples.map((sample) => sample.wire) ?? [],
    visualRowCount: layout.visualRowCount,
    ...extras,
  });
}

/** Doc focus rests inside an atomic token (not start/end boundary). */
function isAtomicInteriorDocPos(doc: HandoffNoteDoc, focus: HandoffNoteDocPos): boolean {
  const node = doc.nodes[focus.nodeIndex];
  if (!isAtomicNode(node)) {
    return false;
  }
  const tokenLength = nodeTokenLength(node);
  return focus.nodeOffset > 0 && focus.nodeOffset < tokenLength;
}

function atomicNodeWireBounds(
  doc: HandoffNoteDoc,
  nodeIndex: number
): { start: number; end: number } | null {
  const node = doc.nodes[nodeIndex];
  if (!isAtomicNode(node)) {
    return null;
  }
  return {
    start: docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 }),
    end: docPosToWireOffset(doc, { nodeIndex, nodeOffset: nodeTokenLength(node) }),
  };
}

function shouldRestoreAuthorityOverDom(
  doc: HandoffNoteDoc,
  live: HandoffNoteDocPos,
  from: HandoffNoteDocPos
): boolean {
  /** Cross-wire DOM regression only — same-wire alias seams use resolveDomReadDocPos on read. */
  const liveWire = docPosToWireOffset(doc, live);
  const fromWire = docPosToWireOffset(doc, from);
  const fromCaret = describeCaretContext(doc, from);

  if (
    (fromCaret.kind === "mention-boundary" && fromCaret.edge === "end") ||
    fromCaret.kind === "mention-interior"
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

  const liveCaret = describeCaretContext(doc, live);
  if (
    liveCaret.kind === "mention-boundary" &&
    liveCaret.edge === "start" &&
    fromWire > liveCaret.end
  ) {
    return true;
  }

  return false;
}

/**
 * Rule 4 collapses text-tail and last-char focus to the same doc wire. Recover
 * `before` (visual start / deletion point) vs `after` (content-row-end) from the
 * native DOM offset for **click / selectionchange ingress** when affinity is
 * unknown. Intentional navigation/edit writes that already carry omit / before /
 * after keep authority in writeSelection — this helper must not override them.
 */
function focusAffinityFromNativeDomPoint(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  container: Node,
  offset: number
): HandoffNoteCaretAffinity | undefined {
  if (!isCaretOnAmbiguousContentRowEndChar(doc, focus)) {
    return undefined;
  }
  if (container.nodeType !== Node.TEXT_NODE) {
    return undefined;
  }
  const text = container.textContent ?? "";
  if (text.length > 0 && offset >= text.length) {
    return "after";
  }
  return "before";
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
  // Affinity from native text-tail for ingress; collapsed CRE past-end → last+after
  // is owned by normalizeSelection (ranges keep past-end). Raw domPointToDocPos stays physical.
  const focusAffinity = focusAffinityFromNativeDomPoint(
    doc,
    focus,
    range.endContainer,
    range.endOffset
  );
  const assembled: HandoffNoteSelection =
    focusAffinity === undefined ? { anchor, focus } : { anchor, focus, focusAffinity };
  return normalizeSelection(doc, assembled, fromOpt);
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
  live: HandoffNoteDocPos,
  from?: HandoffNoteDocPos
): HandoffNoteDocPos {
  // Paint seams (incl. atomic end ↔ post-text) owned by resolvePaintContext — click only consumes paintPos.
  const { paintPos } = resolvePaintContext(doc, live, { root, from });
  const fromOpt = from !== undefined ? { from } : undefined;
  const normalized = normalizeDocPos(doc, paintPos, fromOpt);
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
  if (isAtomicInteriorDocPos(doc, pos)) {
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
    root?: HTMLElement;
    from?: HandoffNoteDocPos;
  }
): HandoffNoteDocPos {
  const paintPos = resolvePaintContextAtWire(doc, wire, {
    root: options?.root,
    from: options?.from,
  }).paintPos;
  return options?.from
    ? normalizeDocPos(doc, paintPos, { from: options.from })
    : normalizeDocPos(doc, paintPos);
}

export function resolveClickIngressSelection(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  live: HandoffNoteDocPos,
  from: HandoffNoteDocPos | undefined,
  click: HandoffNoteClickIngress
): HandoffNoteClickIngressResult {
  const layout = buildHandoffNoteLayoutMap(root, doc);
  const clickRowIndex = closestLayoutRowIndexForTop(layout, click.clientY);
  const fromOpt = from ? { from } : undefined;

  if (isClickPosStrictlyRepresentable(root, doc, layout, live, click)) {
    return {
      focus: clickIngressPaintFocus(root, doc, live, from),
      resolution: "nativeSelection",
    };
  }

  const viewport = probeViewportCaretHit(root, doc, click.clientX, click.clientY, fromOpt);
  if (
    viewport.pos &&
    isClickLiveRepresentable(root, doc, layout, viewport.pos, click) &&
    !viewportAliasesStaleWrapContinuation(root, doc, layout, live, viewport.pos, clickRowIndex)
  ) {
    return {
      focus: clickIngressPaintFocus(root, doc, viewport.pos, from),
      resolution: "viewportCaretHit",
    };
  }

  return {
    focus: clickIngressPaintFocus(root, doc, live, from),
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
  const liveRaw = readDocSelection(root, doc);
  const live = readDocSelection(root, doc, !skipAuthorityRead && from ? { from } : undefined);
  if (!docPosEqualNormalized(doc, live.anchor, live.focus)) {
    return live.focus;
  }

  const fromWire = from !== undefined ? docPosToWireOffset(doc, from) : undefined;
  // Raw DOM focus — authority read can collapse same-atom interior onto from (no paint write).
  const strandedInterior = isAtomicInteriorDocPos(doc, liveRaw.focus)
    ? liveRaw.focus
    : isAtomicInteriorDocPos(doc, live.focus)
      ? live.focus
      : null;

  if (strandedInterior && fromWire !== undefined) {
    const bounds = atomicNodeWireBounds(doc, strandedInterior.nodeIndex);
    if (bounds && fromWire <= bounds.start) {
      const restored = resolvePaintContext(doc, from!).focusPos;
      setDocSelection(root, doc, collapsedSelection(restored), {
        from: restored,
      });
      return restored;
    }
    if (bounds && fromWire >= bounds.end) {
      const restored = resolvePaintContextAtWire(doc, bounds.start).focusPos;
      setDocSelection(root, doc, collapsedSelection(restored), {
        from: restored,
      });
      return restored;
    }
  }

  if (options?.mode === "strand-only") {
    if (options?.click) {
      const resolved = resolveClickIngressSelection(root, doc, live.focus, from, options.click);
      if (!docPosEqualNormalized(doc, resolved.focus, live.focus)) {
        setDocSelection(root, doc, collapsedSelection(resolved.focus));
      }
      return resolved.focus;
    }
    return normalizeDocPos(doc, live.focus, { from });
  }

  if (from !== undefined && shouldRestoreAuthorityOverDom(doc, live.focus, from)) {
    setDocSelection(root, doc, collapsedSelection(from), { from });
    return from;
  }

  const normalized = normalizeDocPos(doc, live.focus, { from });
  if (docPosEqualNormalized(doc, normalized, live.focus)) {
    return normalized;
  }

  setDocSelection(root, doc, collapsedSelection(normalized), { from });
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
  }
): void {
  const fromOpt = options?.from ? { from: options.from } : undefined;
  const docSel = normalizeSelection(doc, selection, fromOpt);
  const docApi = root.ownerDocument;
  const native = docApi.getSelection();
  if (!native) {
    return;
  }

  const paintOpt = {
    from: options?.from ?? docSel.focus,
    focusAffinity: docSel.focusAffinity,
  };
  const startPoint = resolveDomPointAtDocPos(root, doc, docSel.anchor, paintOpt);
  const endPoint = resolveDomPointAtDocPos(root, doc, docSel.focus, paintOpt);

  if (!startPoint || !endPoint) {
    return;
  }

  const range = docApi.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  native.removeAllRanges();
  native.addRange(range);
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
  const focusPos = resolvePaintContextAtWire(doc, landingWire, {
    root: rowStart?.root,
  }).focusPos;
  if (doc.nodes[focusPos.nodeIndex]?.type !== "text") {
    return null;
  }
  return resolveVerticalLandingDocPos(doc, landingWire, {
    root: rowStart?.root,
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

type VerticalCaretSlot = "on-char" | "content-row-end";

type VerticalLanding = {
  pos: HandoffNoteDocPos;
  branch: string;
  /** DOM column probe: nearer caret slot beside the hit (CRE char only). */
  caretSlot?: VerticalCaretSlot;
};

type VisualRowStartContext = {
  root: HTMLElement;
  doc: HandoffNoteDoc;
  layout: HandoffNoteLayoutMap;
  targetRowTop: number;
  targetLineIndex: number;
  targetLine: MeasuredWireOffset[];
  coordsForWire: (wire: number) => MeasuredWireOffset | null;
  goalColumnTolerance: number;
};

function layoutRowForLandingWire(
  rowStart: VisualRowStartContext,
  wire: number,
  from?: HandoffNoteDocPos
): number {
  const focus = resolvePaintContextAtWire(rowStart.doc, wire, {
    root: rowStart.root,
    from,
  }).focusPos;
  return layoutRowForFocus(rowStart.root, rowStart.doc, rowStart.layout, focus);
}

function acceptPillColumnSnapLanding(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  pillWire: number,
  rowStart: VisualRowStartContext,
  branch: string
): VerticalLanding | null {
  const pillRowIndex = layoutRowForLandingWire(rowStart, pillWire, focus);
  if (pillRowIndex !== rowStart.targetLineIndex) {
    return null;
  }
  return {
    pos: resolveVerticalLandingDocPos(doc, pillWire, {
      root: rowStart.root,
      from: focus,
    }),
    branch,
  };
}

/**
 * Ambiguous last content char: two caret paints (on-char vs after-glyph). Pick nearer to sticky.
 */
function caretSlotBesideColumnProbeHit(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  landPos: HandoffNoteDocPos,
  column: number
): VerticalCaretSlot | null {
  if (!isCaretOnAmbiguousContentRowEndChar(doc, landPos)) {
    return null;
  }
  const onChar = getDocAnchorRect(root, doc, landPos);
  const afterChar = getDocAnchorRect(root, doc, landPos, { focusAffinity: "after" });
  if (!onChar || !afterChar) {
    return null;
  }
  if (Math.abs(afterChar.left - column) < Math.abs(onChar.left - column)) {
    return "content-row-end";
  }
  return "on-char";
}

function probeTargetRowAtColumn(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
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
    atomPaintSpansFromTargetLine(doc, rowStart.targetLine),
    tolerance
  );
  if (pillWire !== null) {
    const landed = acceptPillColumnSnapLanding(doc, focus, pillWire, rowStart, "pill-column-snap");
    if (landed) {
      return landed;
    }
    return null;
  }

  const probed = probeDocPosAtVisualColumn(rowStart.root, doc, rowStart.targetRowTop, column);
  if (!probed) {
    return null;
  }

  const probeRowIndex = layoutRowForFocus(rowStart.root, doc, rowStart.layout, probed);
  if (probeRowIndex !== rowStart.targetLineIndex) {
    return null;
  }

  const { paintPos } = resolvePaintContext(doc, probed, { root: rowStart.root });
  const pos = normalizeDocPos(doc, paintPos, { from: focus });
  const caretSlot = caretSlotBesideColumnProbeHit(rowStart.root, doc, pos, column);
  return caretSlot
    ? { pos, branch: "dom-column-probe", caretSlot }
    : { pos, branch: "dom-column-probe" };
}

type VerticalContentLandingMode =
  | { kind: "blank-exit-row-start" }
  | { kind: "row-edge-to-row-edge"; edgeColumn: number }
  | { kind: "column-at-goal"; goalColumn: number };

type AtomColumnSpan = TargetRowAtomPaintSpan & {
  startLeft: number;
  atomRight: number;
};

function atomSpanRight(startSample: MeasuredWireOffset, endSample: MeasuredWireOffset): number {
  return startSample.right ?? endSample.right ?? endSample.left;
}

function atomPaintSpansFromTargetLine(
  doc: HandoffNoteDoc,
  targetLine: MeasuredWireOffset[]
): TargetRowAtomPaintSpan[] {
  return atomColumnSpansFromTargetLine(doc, targetLine).map((span) => ({
    atomNodeIndex: span.atomNodeIndex,
    startWire: span.startWire,
    endWire: span.endWire,
    layoutLeft: span.startLeft,
    layoutRight: span.atomRight,
  }));
}

function atomColumnSpansFromTargetLine(
  doc: HandoffNoteDoc,
  targetLine: MeasuredWireOffset[]
): AtomColumnSpan[] {
  const sampleByWire = new Map<number, MeasuredWireOffset>();
  for (const sample of targetLine) {
    sampleByWire.set(sample.wire, sample);
  }
  const spans: AtomColumnSpan[] = [];
  for (const sample of targetLine) {
    const context = describeHandoffNoteCursorContext(doc, sample.wire);
    if (context.kind !== "mention-boundary" || context.edge !== "start") {
      continue;
    }
    const endSample = sampleByWire.get(context.end);
    // Atom bbox uses boundary atom owner — not paint-alias doc pos (inter-atomic spacer shares wire).
    const atomNodeIndex = wireOffsetToDocPos(doc, context.start).nodeIndex;
    const atomRight = endSample ? atomSpanRight(sample, endSample) : sample.left;
    spans.push({
      atomNodeIndex,
      startWire: context.start,
      endWire: context.end,
      startLeft: sample.left,
      atomRight,
      layoutLeft: sample.left,
      layoutRight: atomRight,
    });
  }
  return spans;
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
  if (!isAtLayoutRowStart(layout, doc, wireOffsetToDocPos(doc, wire), goalColumn)) {
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
  const atRowEdge = isAtLayoutRowStart(layout, doc, wireOffsetToDocPos(doc, fromWire), goalColumn);
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
  wireLength: number,
  options?: { layout?: HandoffNoteLayoutMap; root?: HTMLElement }
): VerticalLanding | null {
  const wireLineLanding = resolveBlankExitContentRowStart(doc, direction, targetLine, wireLength);
  if (!wireLineLanding) {
    return null;
  }
  return {
    pos: resolveVerticalLandingDocPos(doc, wireLineLanding.offset, {
      root: options?.root,
      from: focus,
    }),
    branch: "blank-exit-visual-row-start",
  };
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
  const domRowStart = probeTargetRowAtColumn(doc, focus, edgeColumn, rowStart);
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
      pos: resolveVerticalLandingDocPos(doc, fallbackRowStartLanding.offset, {
        root: rowStart?.root,
        from: focus,
      }),
      branch: fallbackRowStartLanding.branch,
    };
  }
  return null;
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

  const landed = probeTargetRowAtColumn(doc, focus, mode.goalColumn, rowStart);
  if (landed) {
    return landed;
  }
  return { pos: focus, branch: "dom-column-reject" };
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
  caretSlot?: VerticalCaretSlot;
};

function resolveBlankBandVerticalLanding(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  layout: HandoffNoteLayoutMap,
  targetRow: HandoffNoteLayoutRow,
  targetLineIndex: number,
  root?: HTMLElement
): LayoutVerticalMove {
  const visualStartColumn = blankBandVisualStartColumn(layout, targetLineIndex);
  const landWire = targetRow.samples[0]?.wire;

  if (landWire === undefined) {
    return { pos: focus, handled: false };
  }
  const pos = resolveVerticalLandingDocPos(doc, landWire, {
    root,
    from: focus,
  });
  const fromWire = docPosToWireOffset(doc, focus);
  const toWire = docPosToWireOffset(doc, pos);
  return {
    pos,
    handled: toWire !== fromWire || !docPosEqual(pos, focus),
    branch: "blank-line-slot",
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

  const { paintPos } = resolvePaintContext(doc, focus, { root });
  let currentLineIndex: number;
  if (root !== undefined) {
    currentLineIndex = layoutRowForFocus(root, doc, layout, focus);
  } else {
    const paintRow = layout.paintContextForDocPos(paintPos)?.rowIndex;
    currentLineIndex =
      paintRow !== undefined && paintRow >= 0
        ? paintRow
        : layoutRowAtWireFocus(doc, layout, fromWire);
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

  let move: LayoutVerticalMove;
  if (targetRow.kind === "blank") {
    move = resolveBlankBandVerticalLanding(doc, focus, layout, targetRow, targetLineIndex, root);
  } else if (leavingBlankForContent) {
    const blankExit = resolveBlankExitVisualRowStart(
      doc,
      focus,
      direction,
      targetRow.samples,
      wire.length,
      { layout, root }
    );
    if (blankExit && !docPosEqual(blankExit.pos, focus)) {
      move = {
        pos: blankExit.pos,
        handled: true,
        branch: blankExit.branch,
        goalColumn: effectiveGoalColumn,
      };
    } else {
      move = { pos: focus, handled: false };
    }
  } else {
    const {
      pos: targetPos,
      branch,
      caretSlot,
    } = resolveVerticalContentLanding(
      doc,
      focus,
      direction,
      targetRow.samples,
      landingMode,
      currentLineIndex >= 0 ? layout.rows[currentLineIndex]!.samples : undefined,
      root
        ? {
            root,
            doc,
            layout,
            targetRowTop: targetRow.top,
            targetLineIndex,
            targetLine: targetRow.samples,
            coordsForWire: layout.coordsForWire.bind(layout),
            goalColumnTolerance: edgeTolerance,
          }
        : undefined,
      wire
    );

    if (docPosEqual(targetPos, focus)) {
      move = { pos: focus, handled: false };
    } else {
      const outputGoalColumn =
        landingMode.kind === "column-at-goal"
          ? effectiveGoalColumn
          : (layout.coordsForWire(docPosToWireOffset(doc, targetPos))?.left ?? effectiveGoalColumn);
      move = {
        pos: targetPos,
        handled: true,
        branch,
        goalColumn: outputGoalColumn,
        ...(caretSlot ? { caretSlot } : {}),
      };
    }
  }

  return move;
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

/**
 * Vertical measured start X (sticky unset): live caret X from getDocAnchorRect owns the
 * start column; layout focus sample is fallback when DOM is unavailable. Soft-wrap
 * multi-rect preference lives in getDocAnchorRect — selection must not re-arbitrate rows.
 */
function measuredVerticalStartColumnOnFocusRow(
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  focus: HandoffNoteDocPos,
  anchorRect: DOMRect | null
): number {
  const fromWire = docPosToWireOffset(doc, focus);
  const focusCoord = layout.coordsForWire(fromWire);
  const anchorGoal =
    anchorRect && (anchorRect.height > 0 || anchorRect.width > 0) ? anchorRect.left : undefined;
  return anchorGoal ?? focusCoord?.left ?? 0;
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

/**
 * Vertical land selection from an explicit caret slot only — no blind CRE stamp.
 * DOM column probe sets `caretSlot`; everything else stays omit.
 */
function collapsedSelectionForVerticalCaretSlot(
  doc: HandoffNoteDoc,
  landPos: HandoffNoteDocPos,
  caretSlot: VerticalCaretSlot | undefined
): HandoffNoteSelection {
  if (caretSlot === "content-row-end") {
    return collapsedSelectionWithIntent(doc, landPos, "content-row-end");
  }
  return collapsedSelection(landPos);
}

export function resolveDomVerticalArrowMove(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  options?: {
    stickyGoalColumn?: number | null;
    focusAffinity?: HandoffNoteCaretAffinity;
  }
): {
  pos: HandoffNoteDocPos;
  selection: HandoffNoteSelection;
  handled: boolean;
  goalColumn?: number;
  branch?: string;
} {
  const wire = docToWire(doc);
  const layout = buildHandoffNoteLayoutMap(root, doc, { wire });
  const anchorRect = getDocAnchorRect(root, doc, focus, {
    focusAffinity: options?.focusAffinity,
  });
  const measuredGoal = measuredVerticalStartColumnOnFocusRow(doc, layout, focus, anchorRect);
  const goalColumn = options?.stickyGoalColumn ?? measuredGoal;
  const layoutOwesMove = !layoutVerticalMoveRejected(root, doc, layout, focus, direction);

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
      const { paintPos } = resolvePaintContext(doc, layoutMove.pos, {
        root,
        from: layoutMove.pos,
      });
      const selectionLandPos = normalizeDocPos(doc, paintPos, { from: paintPos });
      const selection = collapsedSelectionForVerticalCaretSlot(
        doc,
        selectionLandPos,
        layoutMove.caretSlot
      );
      const toWire = docPosToWireOffset(doc, selection.focus);
      const landingGoal = layoutMove.goalColumn ?? layout.coordsForWire(toWire)?.left ?? goalColumn;
      return {
        pos: selection.focus,
        selection,
        handled: true,
        goalColumn: landingGoal,
        branch: layoutMove.branch,
      };
    }
  }

  const bleedAllowed = shouldApplyVerticalBoundaryBleed(root, doc, layout, focus, direction);

  if (bleedAllowed) {
    const bleedDirection = direction === "up" ? "left" : "right";
    const bleedMove = resolvePaintHorizontalArrowMove(doc, focus, bleedDirection, {
      root,
      focusAffinity: options?.focusAffinity,
    });
    const landingWire = docPosToWireOffset(doc, bleedMove.pos);
    const landingGoal = layout.coordsForWire(landingWire)?.left ?? measuredGoal;
    return {
      pos: bleedMove.pos,
      selection: bleedMove.selection,
      handled: bleedMove.handled,
      goalColumn: landingGoal,
      branch: "boundary-bleed",
    };
  }

  return {
    pos: focus,
    selection: collapsedSelection(focus, options?.focusAffinity),
    handled: false,
    goalColumn,
  };
}

/** Exit a selected mention via arrow — horizontal to pill end, vertical to that row's start. */
export function resolveSelectedMentionArrowExit(
  doc: HandoffNoteDoc,
  nodeIndex: number,
  direction: HandoffNoteNavDirection
): HandoffNoteDocPos | null {
  const node = doc.nodes[nodeIndex];
  if (node?.type !== "mention") {
    return null;
  }

  if (direction === "left" || direction === "right") {
    return { nodeIndex, nodeOffset: mentionWireLength(node.agentId) };
  }

  const wire = docToWire(doc);
  const mentionStart = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
  const { lineStart } = resolveWireLineColumn(wire, mentionStart);
  return resolvePaintContextAtWire(doc, lineStart).paintPos;
}
