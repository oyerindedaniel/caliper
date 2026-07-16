import {
  docLength,
  docPosToWireOffset,
  docTextNodeHasEmbeddedNewline,
  docToWire,
  embeddedTextLedLowerRowSpanAfterBlankBand,
  isAtomicNode,
  isEmbeddedBlankBandProbeWire,
  isInlineSuffixBlankProbeWire,
  isWireOnEmbeddedTextLedLowerRowAfterBlankBand,
  listEmbeddedBlankBandProbeWires,
  nodeTokenLength,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";
import { logVerArrow } from "../handoff-note-debug.js";
import {
  atomicElement,
  appendSoftWrapLineSamples,
  getDocAnchorRect,
  isFiniteMeasuredLayoutCoord,
  isUsableMeasuredLayoutCoord,
  measureWireBreakCoord,
  resolvePaintContext,
  resolvePaintContextAtWire,
  resolvePaintDocPos,
} from "./handoff-note-dom-points.js";
import {
  isCrossRowSpacerAndPillDom,
  isDistinctVisualRow,
  MIN_INTER_ROW_GAP_PX,
  pillElementMidY,
  sharesVisualRowBand,
} from "./handoff-note-row-geometry.js";

export type MeasuredWireOffset = {
  wire: number;
  top: number;
  left: number;
  right?: number;
  paintDocPos?: HandoffNoteDocPos;
};

export type WirePaintContext = {
  paintDocPos: HandoffNoteDocPos;
  rowIndex: number;
  top: number;
};

/** Layout map before paint-index attachment (row lookup without paint context accessors). */
export type LayoutMapWithoutPaintIndex = Omit<
  HandoffNoteLayoutMap,
  "paintContextForWire" | "paintContextForDocPos"
>;

/** Attach doc-primary paint index to a sparse layout stub (tests) or rematerialize indexes. */
export function attachPaintIndexToLayoutMap(
  layout: LayoutMapWithoutPaintIndex,
  doc?: HandoffNoteDoc
): HandoffNoteLayoutMap {
  const rowByWire = buildRowIndexLookup(layout.rows);
  const paintIndexes = buildLayoutPaintIndexes(layout.samples, rowByWire, doc);
  return attachLayoutPaintIndex(layout, paintIndexes);
}

type HandoffNoteLayoutMapBase = LayoutMapWithoutPaintIndex;

const MIN_LAYOUT_LINE_HEIGHT_PX = 8;
const MAX_LAYOUT_LINE_HEIGHT_PX = 24;

/**
 * Row-bound extent when `right` was not measured: falls back to `left` (caret anchor),
 * not a painted right edge.
 */
export function measuredSampleRight(sample: MeasuredWireOffset): number {
  return sample.right ?? sample.left;
}

function resolveVisualRowLineHeight(stride: number | null, seedLineHeight: number): number {
  return stride !== null && stride > MIN_INTER_ROW_GAP_PX
    ? stride
    : Math.min(Math.max(seedLineHeight, MIN_LAYOUT_LINE_HEIGHT_PX), MAX_LAYOUT_LINE_HEIGHT_PX);
}

function minSampleField(
  samples: MeasuredWireOffset[],
  pick: (sample: MeasuredWireOffset) => number
): number | null {
  if (samples.length === 0) {
    return null;
  }
  return Math.min(...samples.map(pick));
}

function maxSampleField(
  samples: MeasuredWireOffset[],
  pick: (sample: MeasuredWireOffset) => number
): number | null {
  if (samples.length === 0) {
    return null;
  }
  return Math.max(...samples.map(pick));
}

function minWire(samples: MeasuredWireOffset[]): number | null {
  return minSampleField(samples, (sample) => sample.wire);
}

function maxWire(samples: MeasuredWireOffset[]): number | null {
  return maxSampleField(samples, (sample) => sample.wire);
}

function minLeft(samples: MeasuredWireOffset[]): number | null {
  return minSampleField(samples, (sample) => sample.left);
}

function maxLeft(samples: MeasuredWireOffset[]): number | null {
  return maxSampleField(samples, (sample) => sample.left);
}

export type LayoutContentRowEdgeScan = {
  endWire: number | null;
  endSample: MeasuredWireOffset | null;
  startSample: MeasuredWireOffset | null;
  minLeft: number;
  maxLeft: number;
  stickyColumn: number | null;
  contentExtentRight: number | null;
  fromSample: MeasuredWireOffset | null;
};

export function layoutContentRowEdgeScan(
  row: HandoffNoteLayoutRow,
  wireLength: number,
  options?: { fromWire?: number }
): LayoutContentRowEdgeScan {
  let endWire: number | null = null;
  let endSample: MeasuredWireOffset | null = null;
  let startSample: MeasuredWireOffset | null = null;
  let minLeft = Infinity;
  let maxLeft = -Infinity;
  let stickyColumn: number | null = null;
  let maxExplicitRight: number | null = null;
  let fromSample: MeasuredWireOffset | null = null;

  for (const sample of row.samples) {
    minLeft = Math.min(minLeft, sample.left);
    maxLeft = Math.max(maxLeft, sample.left);
    if (options?.fromWire !== undefined && sample.wire === options.fromWire) {
      fromSample = sample;
    }
    if (sample.wire >= wireLength) {
      continue;
    }
    if (
      startSample === null ||
      sample.left < startSample.left ||
      (sample.left === startSample.left && sample.wire < startSample.wire)
    ) {
      startSample = sample;
    }
    if (endWire === null || sample.wire > endWire) {
      endWire = sample.wire;
      endSample = sample;
    }
    stickyColumn = stickyColumn === null ? sample.left : Math.max(stickyColumn, sample.left);
    if (sample.right !== undefined) {
      maxExplicitRight =
        maxExplicitRight === null ? sample.right : Math.max(maxExplicitRight, sample.right);
    }
  }

  return {
    endWire,
    endSample,
    startSample,
    minLeft: row.samples.length === 0 ? Infinity : minLeft,
    maxLeft: row.samples.length === 0 ? -Infinity : maxLeft,
    stickyColumn,
    contentExtentRight: maxExplicitRight ?? stickyColumn,
    fromSample,
  };
}

export type HandoffNoteLayoutRowKind = "blank" | "content";

export type HandoffNoteLayoutRow = {
  top: number;
  minLeft: number;
  maxLeft: number;
  maxRight?: number;
  samples: MeasuredWireOffset[];
  kind: HandoffNoteLayoutRowKind;
  breakProbeWire?: number;
};

export type ShorterRowStickyGoalInput = {
  fromRowIndex: number;
  targetRowIndex: number;
  targetRow: HandoffNoteLayoutRow;
  effectiveGoalColumn: number;
  landedColumn: number;
  edgeTolerance: number;
  useRowStartLandingOnTarget: boolean;
};

export type HandoffNoteLayoutMap = {
  samples: MeasuredWireOffset[];
  rows: HandoffNoteLayoutRow[];
  lineHeight: number;
  visualRowCount: number;
  rowIndexForWire(wire: number): number;
  coordsForWire(wire: number): MeasuredWireOffset | null;
  paintContextForDocPos(pos: HandoffNoteDocPos): WirePaintContext | null;
  paintContextForWire(wire: number): WirePaintContext | null;
  /** When row-tail wire is a soft-wrap prefix end, first wire on the continuation band. */
  continuationAfterRowEndWire(rowEndWire: number): number | null;
  shouldPreserveGoalColumnOnShorterRowLanding(input: ShorterRowStickyGoalInput): boolean;
};

/** Row-top / column-edge slop for nav, sticky eval, and blank adjacency. Clustering uses half via `rowClusterTolerance`. */
export function layoutRowTopTolerance(lineHeight: number): number {
  return Math.max(2, lineHeight * 0.25);
}

type LayoutCacheEntry = {
  wire: string;
  rootWidth: number;
  measured: MeasuredWireOffset[];
  /** Matched against global bump from `invalidateHandoffNoteLayoutCache()`. */
  generation: number;
};

/** Per editor root — same wire+width on two roots must not share measured geometry. */
const layoutCacheByRoot = new WeakMap<HTMLElement, LayoutCacheEntry>();
let measuredCacheGeneration = 0;

export function invalidateHandoffNoteLayoutCache(root?: HTMLElement): void {
  if (root) {
    layoutCacheByRoot.delete(root);
    return;
  }
  measuredCacheGeneration++;
}

export function readHandoffNoteLayoutCacheKey(root: HTMLElement): {
  wire: string;
  rootWidth: number;
  sampleCount: number;
} | null {
  const entry = layoutCacheByRoot.get(root);
  if (!entry || entry.generation !== measuredCacheGeneration) {
    return null;
  }
  return {
    wire: entry.wire,
    rootWidth: entry.rootWidth,
    sampleCount: entry.measured.length,
  };
}

export function getCachedMeasuredSamples(
  root: HTMLElement,
  wire: string,
  rootWidth: number
): MeasuredWireOffset[] | null {
  const entry = layoutCacheByRoot.get(root);
  if (
    entry &&
    entry.wire === wire &&
    entry.rootWidth === rootWidth &&
    entry.generation === measuredCacheGeneration
  ) {
    return entry.measured;
  }
  return null;
}

export function setMeasuredSamplesCache(
  root: HTMLElement,
  wire: string,
  rootWidth: number,
  measured: MeasuredWireOffset[]
): void {
  layoutCacheByRoot.set(root, {
    wire,
    rootWidth,
    measured: cloneMeasuredSamples(measured),
    generation: measuredCacheGeneration,
  });
  logVerArrow("layout.cacheInject", {
    wireLen: wire.length,
    rootWidth,
    sampleCount: measured.length,
    samples: measured.map((sample) => ({
      wire: sample.wire,
      top: Math.round(sample.top * 100) / 100,
      left: Math.round(sample.left * 100) / 100,
      ...(sample.right !== undefined ? { right: Math.round(sample.right * 100) / 100 } : {}),
    })),
  });
}

function layoutRowsForLog(rows: HandoffNoteLayoutRow[]): Array<Record<string, unknown>> {
  return rows.map((row, index) => ({
    index,
    kind: row.kind,
    top: Math.round(row.top * 100) / 100,
    breakProbeWire: row.breakProbeWire ?? null,
    sampleWires: row.samples.map((sample) => sample.wire),
  }));
}

/** Contract debug: which visual row each wire offset maps to (probes, EOF caret, focus). */
function logLayoutWireRowAssignments(
  layout: HandoffNoteLayoutMap,
  doc: HandoffNoteDoc,
  wires: number[],
  wire = docToWire(doc)
): void {
  const probes = listEmbeddedBlankBandProbeWires(doc);
  const unique = [...new Set(wires.filter((offset) => offset >= 0 && offset <= wire.length))].sort(
    (left, right) => left - right
  );
  logVerArrow("layout.rowAssign", {
    contractProbes: probes,
    eofWire: wire.length,
    assignments: unique.map((offset) => {
      const rowIndex = layout.rowIndexForWire(offset);
      const row = rowIndex >= 0 ? layout.rows[rowIndex] : undefined;
      const char =
        offset < wire.length ? (wire[offset] === "\n" ? "\\n" : wire[offset]) : "(past-end)";
      return {
        wire: offset,
        char,
        rowIndex,
        rowKind: row?.kind ?? null,
        rowTop: row ? Math.round(row.top * 100) / 100 : null,
        breakProbeWire: row?.breakProbeWire ?? null,
        isBlankProbe: probes.includes(offset),
        isEofCaret: offset === wire.length,
      };
    }),
  });
}

function sampleWireOffsets(doc: HandoffNoteDoc): number[] {
  const samples = new Set<number>([0, docLength(doc)]);
  let offset = 0;
  for (const node of doc.nodes) {
    samples.add(offset);
    if (node.type === "text") {
      offset += node.text.length;
    } else {
      offset += 1 + node.agentId.length;
      samples.add(offset);
    }
  }
  return [...samples].sort((left, right) => left - right);
}

function substantiveLineStartFromTrailingMention(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  lineStartWire: number,
  wireIndex: LayoutWireIndex,
  hint: LayoutWireScanHint
): MeasuredWireOffset | null {
  const { wire, nodeStartWires } = wireIndex;
  const nextBreak = wire.indexOf("\n", lineStartWire);
  const lineEndWire = nextBreak === -1 ? wire.length : nextBreak;
  const lineStartPos = resolveWireAtOffset(doc, wireIndex, lineStartWire, hint);
  for (let nodeIndex = lineStartPos.nodeIndex; nodeIndex < doc.nodes.length; nodeIndex++) {
    hint.nodeIndex = nodeIndex;
    const node = doc.nodes[nodeIndex]!;
    const nodeStartWire = nodeStartWires[nodeIndex]!;
    const nodeEndWire = nodeWireEnd(doc, wireIndex, nodeIndex);
    if (nodeEndWire <= lineStartWire) {
      continue;
    }
    if (nodeStartWire >= lineEndWire) {
      break;
    }
    if (isAtomicNode(node) && nodeStartWire > lineStartWire && nodeStartWire < lineEndWire) {
      const atomEl = atomicElement(root, doc, nodeIndex);
      const midY = atomEl ? pillElementMidY(atomEl) : null;
      if (midY !== null) {
        return { wire: lineStartWire, top: midY, left: 0 };
      }
    }
  }
  return null;
}

/** Pre-atomic text-node start: borrow following atom row only when paint bands align. */
function isCrossRowInterAtomicSpacerTextNode(
  doc: HandoffNoteDoc,
  textNodeIndex: number,
  root: HTMLElement | undefined,
  sampleByWire: Map<number, MeasuredWireOffset>,
  wireIndex: LayoutWireIndex
): boolean {
  const textNode = doc.nodes[textNodeIndex];
  if (textNode?.type !== "text" || !/^\s+$/.test(textNode.text) || /[\n\r]/.test(textNode.text)) {
    return false;
  }
  const leading = doc.nodes[textNodeIndex - 1];
  const following = doc.nodes[textNodeIndex + 1];
  if (!isAtomicNode(leading) || !isAtomicNode(following)) {
    return false;
  }
  const textStartWire = wireIndex.nodeStartWires[textNodeIndex]!;
  const followingStartWire = wireIndex.nodeStartWires[textNodeIndex + 1]!;
  const textSample = sampleByWire.get(textStartWire);
  const followingSample = sampleByWire.get(followingStartWire);
  if (textSample && followingSample) {
    return isDistinctVisualRow(textSample.top, followingSample.top);
  }
  if (!root) {
    return false;
  }
  const textRect = getDocAnchorRect(root, doc, { nodeIndex: textNodeIndex, nodeOffset: 0 });
  const followingAtom = atomicElement(root, doc, textNodeIndex + 1);
  if (!textRect || !followingAtom) {
    return false;
  }
  return isCrossRowSpacerAndPillDom(textRect, followingAtom) === true;
}

function tagCrossRowInterAtomicSpacerSamples(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  wireIndex: LayoutWireIndex,
  root?: HTMLElement
): Set<number> {
  const taggedTextNodes = new Set<number>();
  const sampleByWire = new Map<number, MeasuredWireOffset>();
  for (const sample of measured) {
    sampleByWire.set(sample.wire, sample);
  }
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex];
    if (node?.type !== "text") {
      continue;
    }
    if (!isCrossRowInterAtomicSpacerTextNode(doc, nodeIndex, root, sampleByWire, wireIndex)) {
      continue;
    }
    taggedTextNodes.add(nodeIndex);
  }
  return taggedTextNodes;
}

type LayoutPaintIndexes = {
  byWire: Map<number, WirePaintContext>;
  byDocPos: Map<string, WirePaintContext>;
};

function docPosLayoutKey(pos: HandoffNoteDocPos): string {
  return `${pos.nodeIndex}:${pos.nodeOffset}`;
}

function buildLayoutPaintIndexes(
  measured: MeasuredWireOffset[],
  rowByWire: Map<number, number>,
  doc?: HandoffNoteDoc
): LayoutPaintIndexes {
  const byWire = new Map<number, WirePaintContext>();
  const byDocPos = new Map<string, WirePaintContext>();
  for (const sample of measured) {
    const paintDocPos =
      sample.paintDocPos ??
      (doc !== undefined ? resolvePaintContextAtWire(doc, sample.wire).paintPos : undefined);
    if (!paintDocPos) {
      continue;
    }
    const rowIndex = rowByWire.get(sample.wire);
    if (rowIndex === undefined) {
      continue;
    }
    const ctx: WirePaintContext = {
      paintDocPos,
      rowIndex,
      top: sample.top,
    };
    byWire.set(sample.wire, ctx);
    byDocPos.set(docPosLayoutKey(paintDocPos), ctx);
  }
  if (doc) {
    stampAtomicInteriorPaintKeys(doc, byDocPos, byWire);
  }
  return { byWire, byDocPos };
}

/**
 * Sparse measure indexes wires, not every atom offset. When atom start was measured,
 * stamp that row onto missing atom paint keys so paintContextForDocPos covers interiors.
 *
 * Seed is only a measured sample at atom start (and never a blank-probe wire). No
 * line-start fallback — soft-wrap can put the atom on a lower visual row than line start.
 * Unsampled atoms rely on rowIndexForWire (content→blank bracket rule) instead.
 */
function stampAtomicInteriorPaintKeys(
  doc: HandoffNoteDoc,
  byDocPos: Map<string, WirePaintContext>,
  byWire: Map<number, WirePaintContext>
): void {
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex];
    if (!isAtomicNode(node)) {
      continue;
    }
    const tokenLength = nodeTokenLength(node);
    const startWire = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
    if (isEmbeddedBlankBandProbeWire(doc, startWire)) {
      continue;
    }
    const seed = byWire.get(startWire);
    if (!seed) {
      continue;
    }
    for (let nodeOffset = 0; nodeOffset <= tokenLength; nodeOffset++) {
      const paintDocPos: HandoffNoteDocPos = { nodeIndex, nodeOffset };
      const key = docPosLayoutKey(paintDocPos);
      if (byDocPos.has(key)) {
        continue;
      }
      byDocPos.set(key, {
        paintDocPos,
        rowIndex: seed.rowIndex,
        top: seed.top,
      });
    }
  }
}

function attachLayoutPaintIndex(
  layout: HandoffNoteLayoutMapBase,
  paintIndexes: LayoutPaintIndexes
): HandoffNoteLayoutMap {
  const { byWire, byDocPos } = paintIndexes;
  return {
    ...layout,
    paintContextForDocPos(pos: HandoffNoteDocPos) {
      return byDocPos.get(docPosLayoutKey(pos)) ?? null;
    },
    paintContextForWire(wireOffset: number) {
      return byWire.get(wireOffset) ?? null;
    },
    rowIndexForWire(wireOffset: number) {
      const paintCtx = byWire.get(wireOffset);
      if (paintCtx && paintCtx.rowIndex >= 0) {
        return paintCtx.rowIndex;
      }
      return layout.rowIndexForWire(wireOffset);
    },
  };
}

/** Measure geometry for a paint doc pos; wire on the sample is export projection only. */
function measureDocPosCoord(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  paintPos: HandoffNoteDocPos
): MeasuredWireOffset | null {
  const wire = docPosToWireOffset(doc, paintPos);
  const paintNode = doc.nodes[paintPos.nodeIndex];

  if (isAtomicNode(paintNode)) {
    const atomEl = atomicElement(root, doc, paintPos.nodeIndex);
    if (atomEl) {
      const midY = pillElementMidY(atomEl);
      if (midY !== null) {
        const rect = atomEl.getBoundingClientRect();
        const left = paintPos.nodeOffset <= 0 ? rect.left : rect.right;
        return { wire, top: midY, left, paintDocPos: paintPos };
      }
    }
  }

  const rect = getDocAnchorRect(root, doc, paintPos);
  if (!rect) {
    return null;
  }

  const textAnchorMidY = rect.top + rect.height / 2;
  let top = textAnchorMidY;
  if (paintNode?.type === "text" && paintPos.nodeOffset === 0) {
    const next = doc.nodes[paintPos.nodeIndex + 1];
    if (isAtomicNode(next)) {
      const atomEl = atomicElement(root, doc, paintPos.nodeIndex + 1);
      const nextAtomMidY = atomEl ? pillElementMidY(atomEl) : null;
      if (nextAtomMidY !== null && sharesVisualRowBand(textAnchorMidY, nextAtomMidY)) {
        top = nextAtomMidY;
      }
    }
  }
  return { wire, top, left: rect.left, paintDocPos: paintPos };
}

/** Pill bbox for mentions; Range text anchor; guarded pill-row borrow at text-node start. */
function measureWireCoord(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  wire: number
): MeasuredWireOffset | null {
  // Acquire measures the structural wire owner, then applies paint-only cross-row alias.
  // Do not use resolvePaintContextAtWire here — stepping canonical focus prefers inter-atomic
  // continuation even when paint alias is off, which drops atom geometry from samples.
  const pos = wireOffsetToDocPos(doc, wire);
  const paintPos = resolvePaintDocPos(doc, pos, { root });
  return measureDocPosCoord(root, doc, paintPos);
}

/** Text anchor first; wire-break `<br>` midY when text measure is missing (post-rebuild substantive rows). */
function measureSubstantiveWireLineStartCoord(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  lineStartWire: number,
  wireIndex: LayoutWireIndex,
  hint: LayoutWireScanHint
): MeasuredWireOffset | null {
  const direct = measureWireCoord(root, doc, lineStartWire);
  if (direct && isUsableMeasuredLayoutCoord(direct)) {
    return direct;
  }

  const fromTrailingMention = substantiveLineStartFromTrailingMention(
    root,
    doc,
    lineStartWire,
    wireIndex,
    hint
  );
  if (fromTrailingMention && isUsableMeasuredLayoutCoord(fromTrailingMention)) {
    return fromTrailingMention;
  }

  const breakWire = lineStartWire - 1;
  const { wire } = wireIndex;
  if (breakWire >= 0 && wire[breakWire] === "\n") {
    const breakCoord = measureWireBreakCoord(root, doc, breakWire);
    if (breakCoord && isUsableMeasuredLayoutCoord(breakCoord)) {
      return { wire: lineStartWire, top: breakCoord.top, left: breakCoord.left };
    }
  }

  return null;
}

function pushAcquiredMeasuredSample(
  measured: MeasuredWireOffset[],
  coord: MeasuredWireOffset | null
): boolean {
  if (!coord || !isUsableMeasuredLayoutCoord(coord)) {
    return false;
  }
  measured.push(coord);
  return true;
}

function upsertMeasuredSample(measured: MeasuredWireOffset[], sample: MeasuredWireOffset): void {
  const index = measured.findIndex((entry) => entry.wire === sample.wire);
  if (index >= 0) {
    measured[index] = sample;
    return;
  }
  measured.push(sample);
}

function cloneMeasuredSamples(samples: MeasuredWireOffset[]): MeasuredWireOffset[] {
  return samples.map((sample) => ({ ...sample }));
}

type LayoutWireIndex = {
  wire: string;
  nodeStartWires: number[];
};

/** Mutated by `resolveWireAtOffset`; monotonic wire queries amortize best — correctness holds out of order. */
type LayoutWireScanHint = {
  nodeIndex: number;
};

function buildLayoutWireIndex(doc: HandoffNoteDoc, wire = docToWire(doc)): LayoutWireIndex {
  const nodeStartWires: number[] = [];
  let offset = 0;
  for (const node of doc.nodes) {
    nodeStartWires.push(offset);
    offset += node.type === "text" ? node.text.length : 1 + node.agentId.length;
  }
  return { wire, nodeStartWires };
}

function nodeWireEnd(doc: HandoffNoteDoc, wireIndex: LayoutWireIndex, nodeIndex: number): number {
  const node = doc.nodes[nodeIndex];
  if (!node) {
    return wireIndex.nodeStartWires[nodeIndex] ?? wireIndex.wire.length;
  }
  const start = wireIndex.nodeStartWires[nodeIndex]!;
  return start + (node.type === "text" ? node.text.length : 1 + node.agentId.length);
}

function resolveWireAtOffset(
  doc: HandoffNoteDoc,
  wireIndex: LayoutWireIndex,
  wireOffset: number,
  hint: LayoutWireScanHint
): HandoffNoteDocPos {
  if (doc.nodes.length === 0) {
    return { nodeIndex: 0, nodeOffset: 0 };
  }

  const starts = wireIndex.nodeStartWires;
  let nodeIndex = Math.min(hint.nodeIndex, doc.nodes.length - 1);
  while (nodeIndex > 0 && starts[nodeIndex]! > wireOffset) {
    nodeIndex--;
  }
  while (nodeIndex < doc.nodes.length - 1 && starts[nodeIndex + 1]! <= wireOffset) {
    nodeIndex++;
  }
  hint.nodeIndex = nodeIndex;

  const nodeStart = starts[nodeIndex]!;
  const node = doc.nodes[nodeIndex]!;
  if (node.type === "text") {
    return {
      nodeIndex,
      nodeOffset: Math.max(0, Math.min(wireOffset - nodeStart, node.text.length)),
    };
  }

  const tokenLength = 1 + node.agentId.length;
  if (wireOffset <= nodeStart) {
    return { nodeIndex, nodeOffset: 0 };
  }
  return { nodeIndex, nodeOffset: Math.min(wireOffset - nodeStart, tokenLength) };
}

function substantiveContentLineStartWires(doc: HandoffNoteDoc, wire = docToWire(doc)): number[] {
  const starts: number[] = [];
  let offset = 0;
  while (offset < wire.length) {
    const breakWire = wire.indexOf("\n", offset);
    const lineEnd = breakWire === -1 ? wire.length : breakWire;
    const segment = wire.slice(offset, lineEnd);
    if (
      segment.length > 0 &&
      !/^\s*$/.test(segment) &&
      !isEmbeddedBlankBandProbeWire(doc, offset)
    ) {
      starts.push(offset);
    }
    offset = breakWire === -1 ? wire.length : breakWire + 1;
  }
  return starts;
}

function structuralTopForContentLineStart(
  contentIndex: number,
  lineStarts: number[],
  probes: number[],
  lineHeight: number
): number {
  const firstTop = lineHeight * 0.5;
  if (contentIndex <= 0) {
    return firstTop;
  }
  const lineStartWire = lineStarts[contentIndex]!;
  const prevContentStart = lineStarts[contentIndex - 1]!;
  const probesBetween = probes.filter(
    (probe) => probe > prevContentStart && probe < lineStartWire
  ).length;
  const prevTop = structuralTopForContentLineStart(
    contentIndex - 1,
    lineStarts,
    probes,
    lineHeight
  );
  return prevTop + lineHeight * (probesBetween + 1);
}

/**
 * Infer authority: every substantive content line start must bracket blank bands.
 * DOM acquire may return no usable content samples (jsdom collapse); structural
 * lattice interleaves content rows with contract probes before blank materialize.
 */
function ensureSubstantiveContentLineStartSamples(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  root: HTMLElement | undefined,
  lineHeight: number,
  wireIndex: LayoutWireIndex
): void {
  const wireHint: LayoutWireScanHint = { nodeIndex: 0 };
  const probes = listEmbeddedBlankBandProbeWires(doc);
  const lineStarts = substantiveContentLineStartWires(doc, wireIndex.wire);
  const credibleContent = contentSamplesForBlankLadder(doc, measured).filter((sample) =>
    isFiniteMeasuredLayoutCoord(sample)
  );
  const needsStructuralSeed = credibleContent.length === 0 && probes.length > 0;

  for (let index = 0; index < lineStarts.length; index++) {
    const lineStartWire = lineStarts[index]!;
    const existing = measured.find((sample) => sample.wire === lineStartWire);
    if (existing && isFiniteMeasuredLayoutCoord(existing)) {
      continue;
    }

    if (root) {
      const coord = measureSubstantiveWireLineStartCoord(
        root,
        doc,
        lineStartWire,
        wireIndex,
        wireHint
      );
      if (coord && isUsableMeasuredLayoutCoord(coord)) {
        upsertMeasuredSample(measured, coord);
        continue;
      }

      const pos = resolveWireAtOffset(doc, wireIndex, lineStartWire, wireHint);
      const node = doc.nodes[pos.nodeIndex];
      if (node?.type === "text" && pos.nodeOffset === 0) {
        const next = doc.nodes[pos.nodeIndex + 1];
        if (isAtomicNode(next)) {
          const pill = atomicElement(root, doc, pos.nodeIndex + 1);
          const midY = pill ? pillElementMidY(pill) : null;
          if (midY !== null) {
            const rect = getDocAnchorRect(root, doc, pos);
            const textMidY = rect ? rect.top + rect.height / 2 : midY;
            if (sharesVisualRowBand(textMidY, midY)) {
              upsertMeasuredSample(measured, { wire: lineStartWire, top: midY, left: 0 });
              logVerArrow("layout.contentLineStart", {
                lineStartWire,
                action: "atomicBand",
                top: Math.round(midY * 100) / 100,
              });
              continue;
            }
          }
        }
      }
    }

    if (needsStructuralSeed) {
      const top = structuralTopForContentLineStart(index, lineStarts, probes, lineHeight);
      upsertMeasuredSample(measured, { wire: lineStartWire, top, left: 0 });
      logVerArrow("layout.contentLineStart", {
        lineStartWire,
        action: "structural",
        top: Math.round(top * 100) / 100,
      });
    }
  }
}

/** Content geometry only — blank probe wires never bracket the ladder. */
function contentSamplesForBlankLadder(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[]
): MeasuredWireOffset[] {
  const probes = new Set(listEmbeddedBlankBandProbeWires(doc));
  return measured.filter((sample) => !probes.has(sample.wire));
}

type BlankProbeBandBounds = {
  floor: number | null;
  ceiling: number | null;
};

/** Blank-band probes must not sort above earlier content on the same wire line. */
function blankProbeBandBounds(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  probeWire: number,
  wire: string
): BlankProbeBandBounds {
  const lineStart = wire.lastIndexOf("\n", probeWire - 1) + 1;
  let lineMaxTop = -Infinity;
  let priorMaxTop = -Infinity;
  let minTopBelow = Infinity;
  for (const sample of measured) {
    if (isEmbeddedBlankBandProbeWire(doc, sample.wire)) {
      continue;
    }
    if (sample.wire < probeWire) {
      priorMaxTop = Math.max(priorMaxTop, sample.top);
      if (sample.wire >= lineStart) {
        lineMaxTop = Math.max(lineMaxTop, sample.top);
      }
      continue;
    }
    if (sample.wire > probeWire) {
      minTopBelow = Math.min(minTopBelow, sample.top);
    }
  }
  const floor = Number.isFinite(lineMaxTop)
    ? lineMaxTop
    : Number.isFinite(priorMaxTop)
      ? priorMaxTop
      : null;
  const ceiling = Number.isFinite(minTopBelow) ? minTopBelow : null;
  return { floor, ceiling };
}

function buildBlankProbeBandBoundsMap(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  probes: readonly number[],
  wire: string
): Map<number, BlankProbeBandBounds> {
  const boundsByProbe = new Map<number, BlankProbeBandBounds>();
  for (const probeWire of probes) {
    boundsByProbe.set(probeWire, blankProbeBandBounds(doc, measured, probeWire, wire));
  }
  return boundsByProbe;
}

function blankProbesInSameBand(
  probes: readonly number[],
  probeWire: number,
  boundsByProbe: ReadonlyMap<number, BlankProbeBandBounds>
): number[] {
  const target = boundsByProbe.get(probeWire);
  if (!target) {
    return [probeWire];
  }
  return probes.filter((candidate) => {
    const bounds = boundsByProbe.get(candidate);
    return (
      bounds !== undefined && bounds.floor === target.floor && bounds.ceiling === target.ceiling
    );
  });
}

type BlankBandPlacementKind =
  | "inline"
  | "between"
  | "trailing"
  | "leading"
  | "lattice"
  | "wireBreak";

/**
 * Blank row top from DOM wire-break / blank-anchor measure when available.
 * Content-band ladder is fallback only (no root or missing geometry).
 */
function placeBlankProbeOnContentLadder(
  doc: HandoffNoteDoc,
  probeWire: number,
  lineHeight: number,
  bounds: BlankProbeBandBounds,
  bandProbes: readonly number[]
): { top: number; kind: BlankBandPlacementKind } {
  if (isInlineSuffixBlankProbeWire(doc, probeWire)) {
    return { top: bounds.floor ?? 0, kind: "inline" };
  }

  const { floor, ceiling } = bounds;
  const indexInBand = Math.max(0, bandProbes.indexOf(probeWire));
  const slotCount = bandProbes.length + 1;

  if (floor !== null && ceiling !== null && ceiling > floor + lineHeight * 0.5) {
    const step = (ceiling - floor) / slotCount;
    return { top: floor + step * (indexInBand + 1), kind: "between" };
  }

  if (floor !== null && ceiling === null) {
    return { top: floor + lineHeight * (indexInBand + 1), kind: "trailing" };
  }

  if (floor === null && ceiling !== null) {
    const step = ceiling / slotCount;
    return { top: step * (indexInBand + 1), kind: "leading" };
  }

  return { top: lineHeight * (indexInBand + 1), kind: "lattice" };
}

function leftBeforeProbeWire(measured: MeasuredWireOffset[], probeWire: number): number {
  let left = 0;
  for (const sample of measured) {
    if (sample.wire < probeWire) {
      left = sample.left;
    }
  }
  return left;
}

function blankPlacementMetric(coord: MeasuredWireOffset | null): {
  ok: boolean;
  top: number | null;
  left: number | null;
} {
  if (!coord) {
    return { ok: false, top: null, left: null };
  }
  return {
    ok: true,
    top: Math.round(coord.top * 100) / 100,
    left: Math.round(coord.left * 100) / 100,
  };
}

/**
 * Phase 1: one blank row per contract probe (existence from structure).
 * Phase 2: top from wire-break DOM when measured; ladder fallback when not.
 */
function buildSemanticBlankLayoutRows(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  lineHeight: number,
  root: HTMLElement | undefined,
  wire: string
): HandoffNoteLayoutRow[] {
  const probes = listEmbeddedBlankBandProbeWires(doc);
  const rows: HandoffNoteLayoutRow[] = [];
  /** Frozen for the whole pass — infer mutations and blank upserts must not shift brackets mid-loop. */
  const ladderBasis = contentSamplesForBlankLadder(doc, measured);
  const boundsByProbe = buildBlankProbeBandBoundsMap(doc, ladderBasis, probes, wire);

  for (const probeWire of probes) {
    const wireBreakCoord = root ? measureWireBreakCoord(root, doc, probeWire) : null;
    const bounds = boundsByProbe.get(probeWire)!;
    const bandProbes = blankProbesInSameBand(probes, probeWire, boundsByProbe);
    const ladderPlacement = placeBlankProbeOnContentLadder(
      doc,
      probeWire,
      lineHeight,
      bounds,
      bandProbes
    );
    const wireBreakTop =
      wireBreakCoord !== null && isUsableMeasuredLayoutCoord(wireBreakCoord)
        ? wireBreakCoord.top
        : null;
    const top = wireBreakTop ?? ladderPlacement.top;
    const placementKind = wireBreakTop !== null ? "wireBreak" : ladderPlacement.kind;
    const sample: MeasuredWireOffset = {
      wire: probeWire,
      top,
      left: wireBreakCoord?.left ?? leftBeforeProbeWire(ladderBasis, probeWire),
    };
    upsertMeasuredSample(measured, sample);
    rows.push({
      kind: "blank",
      breakProbeWire: probeWire,
      top,
      minLeft: sample.left,
      maxLeft: sample.left,
      maxRight: measuredSampleRight(sample),
      samples: [sample],
    });

    logVerArrow("layout.blankPlace", {
      probeWire,
      chosen: placementKind,
      inlineSuffix: isInlineSuffixBlankProbeWire(doc, probeWire),
      ladder: {
        floor: bounds.floor === null ? null : Math.round(bounds.floor * 100) / 100,
        ceiling: bounds.ceiling === null ? null : Math.round(bounds.ceiling * 100) / 100,
        bandProbes,
        indexInBand: bandProbes.indexOf(probeWire),
        contentSampleCount: ladderBasis.length,
      },
      wireBreak: blankPlacementMetric(wireBreakCoord),
      final: {
        top: Math.round(top * 100) / 100,
        left: Math.round(sample.left * 100) / 100,
      },
    });

    logVerArrow("layout.blankRow", {
      probeWire,
      top: Math.round(top * 100) / 100,
      left: Math.round(sample.left * 100) / 100,
      inlineSuffix: isInlineSuffixBlankProbeWire(doc, probeWire),
      source: placementKind,
    });
  }

  return rows;
}

function sortLayoutRowsByVisualTop(rows: HandoffNoteLayoutRow[]): HandoffNoteLayoutRow[] {
  return [...rows].sort((left, right) => {
    const topDelta = left.top - right.top;
    if (Math.abs(topDelta) > 0.01) {
      return topDelta;
    }
    if (left.kind !== right.kind) {
      return left.kind === "content" ? -1 : 1;
    }
    const leftKey = left.breakProbeWire ?? minWire(left.samples) ?? 0;
    const rightKey = right.breakProbeWire ?? minWire(right.samples) ?? 0;
    return leftKey - rightKey;
  });
}

function isSparseColumnRow(row: HandoffNoteLayoutRow): boolean {
  if (row.samples.length <= 1) {
    return true;
  }
  const distinctLefts = new Set(row.samples.map((sample) => Math.round(sample.left)));
  return distinctLefts.size <= 1;
}

function buildDocOrderedLayoutMap(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  pillMidYs: number[],
  lineHeight: number,
  blankRows: HandoffNoteLayoutRow[],
  wrapSpans: Map<number, TextSoftWrapSpan> = new Map()
): HandoffNoteLayoutMap {
  const probeWires = new Set(blankRows.map((row) => row.breakProbeWire!));
  const contentMeasured = measured.filter((sample) => !probeWires.has(sample.wire));
  const rowSeedTops = resolveVisualRowSeedTops(pillMidYs, contentMeasured, lineHeight);
  const contentLayout = buildMapFromMeasured(contentMeasured, rowSeedTops, lineHeight, doc);
  const contentRows: HandoffNoteLayoutRow[] = contentLayout.rows.map((row) => ({
    ...row,
    kind: "content" as const,
  }));
  const rows = sortLayoutRowsByVisualTop([...contentRows, ...blankRows]);
  const rowByWire = buildRowIndexLookup(rows);
  const rowCenters = rows.map((row) => row.top);
  const stride = minimumDistinctTopGap(rowCenters);
  const resolvedLineHeight = resolveVisualRowLineHeight(stride, lineHeight);
  const wirePaintIndex = buildLayoutPaintIndexes(measured, rowByWire, doc);
  const baseRowIndexForWire = (wireOffset: number) => {
    const direct = rowByWire.get(wireOffset);
    if (direct !== undefined) {
      return direct;
    }
    return resolveRowIndexFromBracketingSamples(wireOffset, measured, rowCenters, doc, wrapSpans);
  };

  return attachLayoutPaintIndex(
    {
      samples: measured,
      rows,
      lineHeight: resolvedLineHeight,
      visualRowCount: rows.length,
      rowIndexForWire: baseRowIndexForWire,
      coordsForWire(wireOffset: number) {
        let rowIndex = rowByWire.get(wireOffset);
        if (rowIndex === undefined) {
          rowIndex = resolveRowIndexFromBracketingSamples(
            wireOffset,
            measured,
            rowCenters,
            doc,
            wrapSpans
          );
        }
        const row = rows[rowIndex];
        if (row && row.kind === "content" && rowIndex > 0 && row.samples.length > 0) {
          const scoped = resolveCoordFromBracketingSamplesInternal(wireOffset, row.samples);
          if (scoped) {
            return { wire: wireOffset, top: row.top, left: scoped.left };
          }
        }
        return resolveCoordFromBracketingSamples(wireOffset, measured, { doc, wrapSpans });
      },
      continuationAfterRowEndWire(rowEndWire: number) {
        return resolveSoftWrapContinuationAfterRowEnd(wrapSpans, rowEndWire, resolvedLineHeight);
      },
      shouldPreserveGoalColumnOnShorterRowLanding(input) {
        return evaluateShorterRowStickyGoalPreservation(rows, wrapSpans, resolvedLineHeight, input);
      },
    },
    wirePaintIndex
  );
}

function minimumDistinctTopGap(tops: number[]): number | null {
  const gaps = distinctTopGaps(tops);
  if (gaps.length === 0) {
    return null;
  }
  return Math.min(...gaps);
}

function distinctTopGaps(tops: number[]): number[] {
  const distinct = [...new Set(tops)].sort((left, right) => left - right);
  if (distinct.length < 2) {
    return [];
  }
  const gaps: number[] = [];
  for (let index = 1; index < distinct.length; index++) {
    gaps.push(distinct[index]! - distinct[index - 1]!);
  }
  return gaps;
}

/** Second-smallest gap above 4px — ignores same-row soft-wrap fragment offsets (~0.4px). */
function robustInterRowStride(tops: number[]): number | null {
  const interRowGaps = distinctTopGaps(tops)
    .filter((gap) => gap > MIN_INTER_ROW_GAP_PX)
    .sort((left, right) => left - right);
  if (interRowGaps.length === 0) {
    return null;
  }
  if (interRowGaps.length === 1) {
    return interRowGaps[0]!;
  }
  return interRowGaps[1]!;
}

/**
 * Y-slop for grouping measured tops into visual rows. Half of `layoutRowTopTolerance`, capped
 * by inter-row stride — not block/caret rect height (that merged distinct soft-wrap rows).
 */
function rowClusterTolerance(rowTops: number[], sampleTops: number[], lineHeight: number): number {
  const stride =
    robustInterRowStride(rowTops) ??
    robustInterRowStride(sampleTops) ??
    minimumDistinctTopGap(rowTops) ??
    minimumDistinctTopGap(sampleTops);
  const navHalf = layoutRowTopTolerance(lineHeight) * 0.5;
  if (stride === null || stride <= MIN_INTER_ROW_GAP_PX) {
    return Math.min(navHalf, 6);
  }
  return Math.min(navHalf, Math.max(stride * 0.35, MIN_INTER_ROW_GAP_PX));
}

function nodeIndexForWire(wireIndex: LayoutWireIndex, wire: number): number {
  const starts = wireIndex.nodeStartWires;
  for (let index = starts.length - 1; index >= 0; index--) {
    if (wire >= starts[index]!) {
      return index;
    }
  }
  return 0;
}

function pickSampleNearestTop(
  samples: MeasuredWireOffset[],
  targetTop: number
): MeasuredWireOffset {
  return samples.reduce((left, right) =>
    Math.abs(left.top - targetTop) <= Math.abs(right.top - targetTop) ? left : right
  );
}

function pickSampleByNodePeerCluster(
  samples: MeasuredWireOffset[],
  measured: MeasuredWireOffset[],
  nodeStartWire: number,
  nodeEndWire: number,
  rowClusterTol: number,
  wire: number
): MeasuredWireOffset {
  let best = samples[0]!;
  let bestPeers = -1;
  for (const candidate of samples) {
    const peers = measured.filter(
      (sample) =>
        sample.wire !== wire &&
        sample.wire >= nodeStartWire &&
        sample.wire <= nodeEndWire &&
        Math.abs(sample.top - candidate.top) <= rowClusterTol
    ).length;
    if (peers > bestPeers) {
      bestPeers = peers;
      best = candidate;
    }
  }
  return best;
}

/** Per-wire DOM paint wins over alias re-samples on a different visual row. */
function pickFarApartDuplicateSample(
  doc: HandoffNoteDoc,
  wireIndex: LayoutWireIndex,
  samples: MeasuredWireOffset[],
  measured: MeasuredWireOffset[],
  rowClusterTol: number
): MeasuredWireOffset {
  const wire = samples[0]!.wire;
  const sampleByWire = new Map<number, MeasuredWireOffset>();
  for (const sample of measured) {
    sampleByWire.set(sample.wire, sample);
  }

  for (let atomicIndex = 0; atomicIndex < doc.nodes.length; atomicIndex++) {
    if (!isAtomicNode(doc.nodes[atomicIndex])) {
      continue;
    }
    const textNodeIndex = atomicIndex + 1;
    const textNode = doc.nodes[textNodeIndex];
    if (textNode?.type !== "text") {
      continue;
    }
    const postAtomicStartWire = wireIndex.nodeStartWires[textNodeIndex]!;
    if (wire !== postAtomicStartWire) {
      continue;
    }
    const nodeEndWire = nodeWireEnd(doc, wireIndex, textNodeIndex);
    const atomicBandTop = atomicBandTopForPostAtomic(
      doc,
      atomicIndex,
      postAtomicStartWire,
      sampleByWire,
      rowClusterTol,
      { nodeEndWire, measured }
    );
    if (atomicBandTop === undefined) {
      break;
    }
    const split = resolveMeasuredSoftWrapSplit(
      postAtomicStartWire,
      nodeEndWire,
      atomicBandTop,
      rowClusterTol,
      measured
    );
    if (split?.continuationStartWire === postAtomicStartWire) {
      return samples.reduce((left, right) => (left.top >= right.top ? left : right));
    }
    return pickSampleNearestTop(samples, atomicBandTop);
  }

  const nodeIndex = nodeIndexForWire(wireIndex, wire);
  const nodeStartWire = wireIndex.nodeStartWires[nodeIndex]!;
  const nodeEndWire = nodeWireEnd(doc, wireIndex, nodeIndex);
  return pickSampleByNodePeerCluster(
    samples,
    measured,
    nodeStartWire,
    nodeEndWire,
    rowClusterTol,
    wire
  );
}

function dedupeMeasuredSamplesForInfer(
  doc: HandoffNoteDoc,
  wireIndex: LayoutWireIndex,
  measured: MeasuredWireOffset[],
  rowClusterTol: number
): MeasuredWireOffset[] {
  const groups = new Map<number, MeasuredWireOffset[]>();
  for (const sample of measured) {
    const list = groups.get(sample.wire) ?? [];
    list.push(sample);
    groups.set(sample.wire, list);
  }
  const deduped: MeasuredWireOffset[] = [];
  for (const samples of groups.values()) {
    if (samples.length === 1) {
      deduped.push(samples[0]!);
      continue;
    }
    const minTop = Math.min(...samples.map((sample) => sample.top));
    const maxTop = Math.max(...samples.map((sample) => sample.top));
    if (maxTop - minTop <= rowClusterTol) {
      deduped.push(samples[0]!);
      continue;
    }
    deduped.push(pickFarApartDuplicateSample(doc, wireIndex, samples, measured, rowClusterTol));
  }
  return deduped.sort((left, right) => left.wire - right.wire);
}

function clusterTopCenters(tops: number[], tolerance: number): number[] {
  if (tops.length === 0) {
    return [];
  }
  const sorted = [...tops].sort((left, right) => left - right);
  const centers: number[] = [];
  let bucket: number[] = [sorted[0]!];
  for (let index = 1; index < sorted.length; index++) {
    const top = sorted[index]!;
    const center = bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
    if (Math.abs(top - center) <= tolerance) {
      bucket.push(top);
    } else {
      centers.push(center);
      bucket = [top];
    }
  }
  centers.push(bucket.reduce((sum, value) => sum + value, 0) / bucket.length);
  return centers;
}

function collectMentionMidYs(root: HTMLElement, doc: HandoffNoteDoc): number[] {
  const tops: number[] = [];
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    if (doc.nodes[nodeIndex]?.type !== "mention") {
      continue;
    }
    const pill = atomicElement(root, doc, nodeIndex);
    if (!pill) {
      continue;
    }
    const midY = pillElementMidY(pill);
    if (midY !== null) {
      tops.push(midY);
    }
  }
  return tops;
}

/** Pill midYs alone miss soft-wrapped continuation rows; merge measured tops before clustering. */
function resolveVisualRowSeedTops(
  pillMidYs: number[],
  measured: MeasuredWireOffset[],
  lineHeight: number
): number[] {
  const measuredTops = measured.map((sample) => sample.top);
  const tolerance = rowClusterTolerance(pillMidYs, measuredTops, lineHeight);
  const seeds = pillMidYs.length > 0 ? [...pillMidYs, ...measuredTops] : measuredTops;
  return clusterTopCenters(seeds, tolerance);
}

/** Text immediately before a same-row atom inherits that atom's measured top. */
function alignTextBeforeAtomicRows(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  wireIndex: LayoutWireIndex,
  hint: LayoutWireScanHint
): void {
  for (const sample of measured) {
    const pos = resolveWireAtOffset(doc, wireIndex, sample.wire, hint);
    const node = doc.nodes[pos.nodeIndex];
    if (node?.type !== "text" || pos.nodeOffset !== 0) {
      continue;
    }
    const next = doc.nodes[pos.nodeIndex + 1];
    if (!isAtomicNode(next)) {
      continue;
    }
    const atomicStart = wireIndex.nodeStartWires[pos.nodeIndex + 1];
    if (atomicStart === undefined) {
      continue;
    }
    const atomicSample = measured.find((entry) => entry.wire === atomicStart);
    if (atomicSample && sharesVisualRowBand(sample.top, atomicSample.top)) {
      sample.top = atomicSample.top;
    }
  }
}

function alignEmbeddedNewlinePrefixAfterAtomicRows(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  wireIndex: LayoutWireIndex
): void {
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex];
    if (node?.type !== "text" || !node.text.includes("\n")) {
      continue;
    }
    const prev = doc.nodes[nodeIndex - 1];
    if (!isAtomicNode(prev)) {
      continue;
    }
    const firstBreak = node.text.indexOf("\n");
    if (firstBreak <= 0) {
      continue;
    }
    const nodeStartWire = wireIndex.nodeStartWires[nodeIndex] ?? 0;
    const prefixEndWire = nodeStartWire + firstBreak;
    const atomEl = atomicElement(root, doc, nodeIndex - 1);
    const midY = atomEl ? pillElementMidY(atomEl) : null;
    if (midY === null) {
      continue;
    }
    for (const sample of measured) {
      if (sample.wire >= nodeStartWire && sample.wire < prefixEndWire) {
        sample.top = midY;
      }
    }
  }
}

function nearestRowCenterIndex(top: number, rowCenters: number[]): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < rowCenters.length; index++) {
    const distance = Math.abs(top - rowCenters[index]!);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Mention boundary samples use pill midY so interior/bad Range Y cannot pull rows apart. */
function pinMentionSampleRows(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  wireIndex: LayoutWireIndex,
  hint: LayoutWireScanHint
): void {
  for (const sample of measured) {
    if (sample.paintDocPos && doc.nodes[sample.paintDocPos.nodeIndex]?.type === "text") {
      continue;
    }
    const pos = resolveWireAtOffset(doc, wireIndex, sample.wire, hint);
    if (doc.nodes[pos.nodeIndex]?.type !== "mention") {
      continue;
    }
    const pill = atomicElement(root, doc, pos.nodeIndex);
    if (!pill) {
      continue;
    }
    const midY = pillElementMidY(pill);
    if (midY !== null) {
      sample.top = midY;
    }
    const rect = pill.getBoundingClientRect();
    if (Number.isFinite(rect.left) && Number.isFinite(rect.right)) {
      sample.left = rect.left;
      sample.right = rect.right;
    }
  }
}

function rowIndexForEmbeddedTextLedLowerRowWire(
  doc: HandoffNoteDoc,
  wire: number,
  measured: MeasuredWireOffset[],
  rowCenters: number[]
): number | null {
  if (!isWireOnEmbeddedTextLedLowerRowAfterBlankBand(doc, wire)) {
    return null;
  }
  const span = embeddedTextLedLowerRowSpanAfterBlankBand(doc);
  if (!span) {
    return null;
  }
  const sorted = [...measured].sort((left, right) => left.wire - right.wire);
  const anchor = sorted.find((sample) => sample.wire >= span.lineStartWire);
  if (!anchor || rowCenters.length === 0) {
    return null;
  }
  return nearestRowCenterIndex(anchor.top, rowCenters);
}

type TextSoftWrapVisualBand = {
  startWire: number;
  endWire: number;
  top: number;
  startLeft: number;
};

type TextSoftWrapSpan = {
  nodeStartWire: number;
  prefixEndWire: number;
  prefixTop: number;
  continuationStartWire: number;
  continuationTop: number;
  continuationStartLeft: number;
  nodeEndWire: number;
  lowerAnchorWire: number;
  tailSamples: MeasuredWireOffset[];
  visualBands: TextSoftWrapVisualBand[];
};

function rowTopMatchesContinuationRow(
  row: HandoffNoteLayoutRow,
  continuationTop: number,
  tolerance: number
): boolean {
  return Math.abs(row.top - continuationTop) <= tolerance;
}

function resolveSoftWrapContinuationAfterRowEnd(
  wrapSpans: Map<number, TextSoftWrapSpan>,
  rowEndWire: number,
  lineHeight: number
): number | null {
  const tol = layoutRowTopTolerance(lineHeight);
  for (const span of wrapSpans.values()) {
    if (span.continuationTop <= span.prefixTop + tol) {
      continue;
    }
    const tailWire = span.prefixEndWire;
    if (rowEndWire !== tailWire && rowEndWire !== span.continuationStartWire - 1) {
      continue;
    }
    if (span.continuationStartWire > rowEndWire) {
      return span.continuationStartWire;
    }
  }
  return null;
}

function isPostAtomicWrapContinuationRowIndex(
  rowIndex: number,
  rows: HandoffNoteLayoutRow[],
  wrapSpans: Map<number, TextSoftWrapSpan>,
  rowTopTolerance: number
): boolean {
  const row = rows[rowIndex];
  if (!row || row.kind !== "content") {
    return false;
  }
  for (const span of wrapSpans.values()) {
    if (!rowTopMatchesContinuationRow(row, span.continuationTop, rowTopTolerance)) {
      continue;
    }
    if (row.samples.some((sample) => sample.wire >= span.continuationStartWire)) {
      return true;
    }
  }
  return false;
}

/** Adjacent content rows on the same wire line split by soft wrap only (no embedded `\n` between bands). */
export function isSameWireSoftWrapBandCrossing(
  doc: HandoffNoteDoc,
  fromRowIndex: number,
  targetRowIndex: number,
  rows: HandoffNoteLayoutRow[]
): boolean {
  if (Math.abs(fromRowIndex - targetRowIndex) !== 1) {
    return false;
  }
  const upperIndex = Math.min(fromRowIndex, targetRowIndex);
  const lowerIndex = Math.max(fromRowIndex, targetRowIndex);
  const upperRow = rows[upperIndex];
  const lowerRow = rows[lowerIndex];
  if (
    !upperRow ||
    !lowerRow ||
    upperRow.kind !== "content" ||
    lowerRow.kind !== "content" ||
    upperRow.samples.length === 0 ||
    lowerRow.samples.length === 0
  ) {
    return false;
  }
  const upperMaxWire = maxWire(upperRow.samples);
  const lowerMinWire = minWire(lowerRow.samples);
  if (upperMaxWire === null || lowerMinWire === null) {
    return false;
  }
  if (upperMaxWire >= lowerMinWire) {
    return false;
  }
  const wire = docToWire(doc);
  // Include upperMaxWire: mention-end / row-tail samples often sit on the wire `\n`.
  for (let offset = upperMaxWire; offset < lowerMinWire; offset++) {
    if (wire[offset] === "\n") {
      return false;
    }
  }
  return true;
}

function evaluateShorterRowStickyGoalPreservation(
  rows: HandoffNoteLayoutRow[],
  wrapSpans: Map<number, TextSoftWrapSpan>,
  lineHeight: number,
  input: ShorterRowStickyGoalInput
): boolean {
  const {
    fromRowIndex,
    targetRowIndex,
    targetRow,
    effectiveGoalColumn,
    landedColumn,
    edgeTolerance,
    useRowStartLandingOnTarget,
  } = input;
  // Row-start landing (row-edge / blank-exit): Down keeps the target row's painted start;
  // re-sticking a wide pre-clamp goal would defeat that. Up into a shorter row may still preserve.
  if (useRowStartLandingOnTarget && targetRowIndex > fromRowIndex) {
    return false;
  }
  const rowTopTolerance = layoutRowTopTolerance(lineHeight);
  const wrapContinuationTarget = isPostAtomicWrapContinuationRowIndex(
    targetRowIndex,
    rows,
    wrapSpans,
    rowTopTolerance
  );
  const targetRowMinColumn = minLeft(targetRow.samples);
  const targetRowMaxColumn = maxLeft(targetRow.samples);
  if (
    wrapContinuationTarget &&
    fromRowIndex < targetRowIndex &&
    targetRowMinColumn !== null &&
    effectiveGoalColumn < targetRowMinColumn - edgeTolerance &&
    landedColumn <= targetRowMinColumn + edgeTolerance
  ) {
    return true;
  }
  if (
    targetRowMaxColumn === null ||
    effectiveGoalColumn <= targetRowMaxColumn + edgeTolerance ||
    Math.abs(landedColumn - targetRowMaxColumn) > edgeTolerance
  ) {
    return false;
  }
  if (wrapContinuationTarget) {
    return true;
  }
  if (targetRowIndex < fromRowIndex) {
    return true;
  }
  return false;
}

function visualBandForWire(span: TextSoftWrapSpan, wire: number): TextSoftWrapVisualBand | null {
  for (const band of span.visualBands) {
    if (wire >= band.startWire && wire <= band.endWire) {
      return band;
    }
  }
  return null;
}

function rowIndexForTextSoftWrapWire(
  doc: HandoffNoteDoc,
  wire: number,
  rowCenters: number[],
  wrapSpans: Map<number, TextSoftWrapSpan>
): number | null {
  const pos = wireOffsetToDocPos(doc, wire);
  const node = doc.nodes[pos.nodeIndex];
  if (node?.type !== "text" || docTextNodeHasEmbeddedNewline(doc, pos.nodeIndex)) {
    return null;
  }
  const span = wrapSpans.get(pos.nodeIndex);
  if (!span) {
    return null;
  }
  const band = visualBandForWire(span, wire);
  return band ? nearestRowCenterIndex(band.top, rowCenters) : null;
}

function resolveRowIndexFromBracketingSamples(
  wire: number,
  measured: MeasuredWireOffset[],
  rowCenters: number[],
  doc?: HandoffNoteDoc,
  wrapSpans?: Map<number, TextSoftWrapSpan>
): number {
  if (doc) {
    const lowerRow = rowIndexForEmbeddedTextLedLowerRowWire(doc, wire, measured, rowCenters);
    if (lowerRow !== null) {
      return lowerRow;
    }
    if (wrapSpans && wrapSpans.size > 0) {
      const wrapRow = rowIndexForTextSoftWrapWire(doc, wire, rowCenters, wrapSpans);
      if (wrapRow !== null) {
        return wrapRow;
      }
    }
  }

  if (measured.length === 0 || rowCenters.length === 0) {
    return -1;
  }

  const sorted = [...measured].sort((left, right) => left.wire - right.wire);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  if (wire <= first.wire) {
    return nearestRowCenterIndex(first.top, rowCenters);
  }
  if (wire >= last.wire) {
    return nearestRowCenterIndex(last.top, rowCenters);
  }

  let prev = first;
  let next = last;
  for (let index = 0; index < sorted.length - 1; index++) {
    const left = sorted[index]!;
    const right = sorted[index + 1]!;
    if (left.wire <= wire && wire <= right.wire) {
      prev = left;
      next = right;
      break;
    }
  }

  if (prev.wire === next.wire || prev.top === next.top) {
    return nearestRowCenterIndex(prev.top, rowCenters);
  }

  // Blank-probe samples start a blank visual row. Unsampled wires before that probe stay on
  // the preceding content sample — never interpolate across the content→blank boundary.
  // (Atom end often aliases the probe wire; non-probe wires on the content line must not.)
  if (
    doc &&
    isEmbeddedBlankBandProbeWire(doc, next.wire) &&
    !isEmbeddedBlankBandProbeWire(doc, wire)
  ) {
    return nearestRowCenterIndex(prev.top, rowCenters);
  }

  if (doc && wrapSpans && wrapSpans.size > 0 && prev.top !== next.top) {
    const wrapRow = rowIndexForTextSoftWrapWire(doc, wire, rowCenters, wrapSpans);
    if (wrapRow !== null) {
      return wrapRow;
    }
  }

  const ratio = (wire - prev.wire) / (next.wire - prev.wire);
  const top = prev.top + ratio * (next.top - prev.top);
  return nearestRowCenterIndex(top, rowCenters);
}

function resolveCoordFromBracketingSamplesInternal(
  wire: number,
  measured: MeasuredWireOffset[]
): MeasuredWireOffset | null {
  if (measured.length === 0) {
    return null;
  }

  const direct = measured.find((sample) => sample.wire === wire);
  if (direct) {
    return direct;
  }

  const sorted = [...measured].sort((left, right) => left.wire - right.wire);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  if (wire <= first.wire) {
    return first;
  }
  if (wire >= last.wire) {
    return last;
  }

  let prev = first;
  let next = last;
  for (let index = 0; index < sorted.length - 1; index++) {
    const left = sorted[index]!;
    const right = sorted[index + 1]!;
    if (left.wire <= wire && wire <= right.wire) {
      prev = left;
      next = right;
      break;
    }
  }

  if (prev.wire === next.wire) {
    return prev;
  }

  const ratio = (wire - prev.wire) / (next.wire - prev.wire);
  return {
    wire,
    top: prev.top + ratio * (next.top - prev.top),
    left: prev.left + ratio * (next.left - prev.left),
  };
}

type CoordBracketContext = {
  doc?: HandoffNoteDoc;
  wrapSpans?: Map<number, TextSoftWrapSpan>;
};

function resolveCoordFromBracketingSamples(
  wire: number,
  measured: MeasuredWireOffset[],
  context?: CoordBracketContext
): MeasuredWireOffset | null {
  if (context?.doc && context.wrapSpans && context.wrapSpans.size > 0) {
    const pos = wireOffsetToDocPos(context.doc, wire);
    const span = context.wrapSpans.get(pos.nodeIndex);
    if (span) {
      const band = visualBandForWire(span, wire);
      if (band) {
        const scoped = span.tailSamples
          .filter((sample) => sample.wire >= band.startWire && sample.wire <= band.endWire)
          .sort((left, right) => left.wire - right.wire);
        const bracketed = resolveCoordFromBracketingSamplesInternal(wire, scoped);
        if (bracketed) {
          return { wire, top: band.top, left: bracketed.left };
        }
        return { wire, top: band.top, left: band.startLeft };
      }
    }
  }

  return resolveCoordFromBracketingSamplesInternal(wire, measured);
}

function resolveRowIndexForDocWire(
  doc: HandoffNoteDoc,
  root: HTMLElement,
  wire: number,
  rowByWire: Map<number, number>,
  rowCenters: number[],
  measured: MeasuredWireOffset[]
): number {
  const direct = rowByWire.get(wire);
  if (direct !== undefined) {
    return direct;
  }

  const lowerRow = rowIndexForEmbeddedTextLedLowerRowWire(doc, wire, measured, rowCenters);
  if (lowerRow !== null) {
    logVerArrow("resolve.rowAssign", {
      wire,
      branch: "embedded-text-led-lower-row",
      rowIndex: lowerRow,
    });
    return lowerRow;
  }

  const pos = wireOffsetToDocPos(doc, wire);
  const node = doc.nodes[pos.nodeIndex];
  if (node?.type === "text") {
    const coord = measureWireCoord(root, doc, wire);
    if (coord !== null && rowCenters.length > 0) {
      const rowIndex = nearestRowCenterIndex(coord.top, rowCenters);
      logVerArrow("resolve.rowAssign", {
        wire,
        branch: "text-measure-coord",
        top: coord.top,
        rowIndex,
      });
      return rowIndex;
    }
    return -1;
  }

  if (node?.type !== "mention") {
    return -1;
  }

  const pill = atomicElement(root, doc, pos.nodeIndex);
  const midY = pill ? pillElementMidY(pill) : null;
  if (midY !== null && rowCenters.length > 0) {
    return nearestRowCenterIndex(midY, rowCenters);
  }

  const startWire = docPosToWireOffset(doc, { nodeIndex: pos.nodeIndex, nodeOffset: 0 });
  const endWire = docPosToWireOffset(doc, {
    nodeIndex: pos.nodeIndex,
    nodeOffset: 1 + node.agentId.length,
  });
  return rowByWire.get(startWire) ?? rowByWire.get(endWire) ?? -1;
}

function replaceInferWorkingSamples(
  measured: MeasuredWireOffset[],
  next: MeasuredWireOffset[]
): void {
  measured.length = 0;
  measured.push(...next);
}

function atomicBandTopForPostAtomic(
  doc: HandoffNoteDoc,
  atomicNodeIndex: number,
  postAtomicStartWire: number,
  sampleByWire: Map<number, MeasuredWireOffset>,
  rowClusterTol: number,
  textNodePaint: { nodeEndWire: number; measured: MeasuredWireOffset[] }
): number | undefined {
  const { nodeEndWire, measured } = textNodePaint;
  const atomicStartWire = docPosToWireOffset(doc, {
    nodeIndex: atomicNodeIndex,
    nodeOffset: 0,
  });
  const atomicEndWire = postAtomicStartWire - 1;
  const atomicStartTop = sampleByWire.get(atomicStartWire)?.top;
  const atomicEndTop = sampleByWire.get(atomicEndWire)?.top;
  const postTop = sampleByWire.get(postAtomicStartWire)?.top;

  if (atomicStartTop !== undefined) {
    return atomicStartTop;
  }

  let interiorTop: number | undefined;
  const interiorSamples = measured.filter(
    (sample) => sample.wire >= postAtomicStartWire && sample.wire < nodeEndWire
  );
  if (interiorSamples.length > 0) {
    interiorTop = minSampleField(interiorSamples, (sample) => sample.top) ?? undefined;
  }

  if (interiorTop !== undefined) {
    if (atomicEndTop !== undefined && Math.abs(atomicEndTop - interiorTop) > rowClusterTol) {
      return interiorTop;
    }
    if (postTop !== undefined && Math.abs(postTop - interiorTop) > rowClusterTol) {
      return interiorTop;
    }
  }

  if (atomicEndTop !== undefined && postTop !== undefined) {
    if (Math.abs(atomicEndTop - postTop) > rowClusterTol) {
      return postTop;
    }
  }
  return atomicEndTop ?? sampleByWire.get(atomicEndWire - 1)?.top ?? postTop;
}

type MeasuredSoftWrapSplit = {
  prefixEndWire: number;
  continuationStartWire: number;
  continuationTop: number;
  continuationStartLeft: number;
};

/** Prefix vs continuation wires from measured Y bands. */
function resolveMeasuredSoftWrapSplit(
  nodeStartWire: number,
  nodeEndWire: number,
  prefixBandTop: number,
  rowClusterTol: number,
  measured: MeasuredWireOffset[]
): MeasuredSoftWrapSplit | null {
  const interiorSamples = measured.filter(
    (sample) => sample.wire >= nodeStartWire && sample.wire < nodeEndWire
  );
  const pastEndSample = measured.find((sample) => sample.wire === nodeEndWire);
  const nodeSamples =
    pastEndSample !== undefined ? [...interiorSamples, pastEndSample] : interiorSamples;
  if (nodeSamples.length === 0) {
    return null;
  }

  const lowerTopFloor = prefixBandTop + rowClusterTol;
  const prefixInteriorPastStart = interiorSamples.filter(
    (sample) => sample.top <= lowerTopFloor && sample.wire > nodeStartWire
  );
  /** Post-start on a lower band while prefix interior still paints above — alias, not wrap start. */
  const postStartSampleContradictsPrefixInteriorPaint = (sample: MeasuredWireOffset): boolean =>
    sample.wire === nodeStartWire && prefixInteriorPastStart.length > 0;
  const lowerSamples = nodeSamples.filter((sample) => {
    if (sample.top <= lowerTopFloor) {
      return false;
    }
    if (postStartSampleContradictsPrefixInteriorPaint(sample)) {
      return false;
    }
    return true;
  });
  if (lowerSamples.length === 0) {
    return null;
  }

  const continuationTop = minSampleField(lowerSamples, (sample) => sample.top)!;
  const continuationBandSamples = nodeSamples.filter(
    (sample) =>
      !postStartSampleContradictsPrefixInteriorPaint(sample) &&
      (Math.abs(sample.top - continuationTop) <= rowClusterTol || sample.top > lowerTopFloor)
  );

  const interiorForTrailing = pastEndSample !== undefined ? interiorSamples : nodeSamples;
  const trailingMaxLeft =
    interiorForTrailing.length > 0 ? maxLeft(interiorForTrailing) : maxLeft(nodeSamples);
  if (trailingMaxLeft === null) {
    return null;
  }
  const trailingColumnSamples = interiorForTrailing.filter(
    (sample) => sample.left >= trailingMaxLeft - rowClusterTol
  );

  const trailingPrefixEnd = minWire(trailingColumnSamples);
  const lowerLeftStarts = continuationBandSamples.filter(
    (sample) =>
      !postStartSampleContradictsPrefixInteriorPaint(sample) &&
      sample.wire >= nodeStartWire &&
      sample.wire < nodeEndWire &&
      sample.left < trailingMaxLeft - rowClusterTol
  );
  const lowerLeftContinuationStart = minWire(lowerLeftStarts);

  let prefixEndWire = nodeStartWire - 1;
  let continuationStartWire = prefixEndWire + 1;
  if (
    trailingPrefixEnd !== null &&
    lowerLeftContinuationStart !== null &&
    lowerLeftContinuationStart > trailingPrefixEnd
  ) {
    prefixEndWire = trailingPrefixEnd;
    continuationStartWire = lowerLeftContinuationStart;
  } else if (lowerLeftContinuationStart !== null) {
    continuationStartWire = lowerLeftContinuationStart;
    prefixEndWire = Math.max(nodeStartWire - 1, continuationStartWire - 1);
  } else if (trailingPrefixEnd !== null) {
    prefixEndWire = trailingPrefixEnd;
    continuationStartWire = prefixEndWire + 1;
  }
  if (continuationStartWire <= prefixEndWire) {
    continuationStartWire = prefixEndWire + 1;
  }

  const continuationRowLeftSamples = measured.filter(
    (sample) =>
      sample.wire > prefixEndWire &&
      Math.abs(sample.top - continuationTop) <= rowClusterTol &&
      sample.left < trailingMaxLeft - rowClusterTol
  );
  const continuationStartLeft =
    minLeft(continuationRowLeftSamples) ?? minLeft(continuationBandSamples);
  if (continuationStartLeft === null) {
    return null;
  }

  return {
    prefixEndWire,
    continuationStartWire,
    continuationTop,
    continuationStartLeft,
  };
}

function buildVisualBandsFromMeasured(
  nodeStartWire: number,
  nodeEndWire: number,
  measured: MeasuredWireOffset[],
  rowClusterTol: number
): TextSoftWrapVisualBand[] {
  const nodeSamples = measured
    .filter((sample) => sample.wire >= nodeStartWire && sample.wire <= nodeEndWire)
    .sort((left, right) => left.wire - right.wire);
  if (nodeSamples.length === 0) {
    return [];
  }

  const bands: TextSoftWrapVisualBand[] = [];
  let bandTop = nodeSamples[0]!.top;
  let bandStart = nodeStartWire;

  const startLeftForBand = (startWire: number, endWire: number, top: number): number => {
    const onBand = nodeSamples.filter(
      (sample) =>
        sample.wire >= startWire &&
        sample.wire <= endWire &&
        Math.abs(sample.top - top) <= rowClusterTol
    );
    if (onBand.length === 0) {
      return nodeSamples[0]!.left;
    }
    const bandMaxLeft = maxLeft(nodeSamples);
    if (bandMaxLeft === null) {
      return nodeSamples[0]!.left;
    }
    const rowStarts = onBand.filter((sample) => sample.left < bandMaxLeft - rowClusterTol);
    if (rowStarts.length > 0) {
      return minLeft(rowStarts) ?? nodeSamples[0]!.left;
    }
    return minLeft(onBand) ?? nodeSamples[0]!.left;
  };

  for (const sample of nodeSamples) {
    if (Math.abs(sample.top - bandTop) <= rowClusterTol) {
      continue;
    }
    bands.push({
      startWire: bandStart,
      endWire: sample.wire - 1,
      top: bandTop,
      startLeft: startLeftForBand(bandStart, sample.wire - 1, bandTop),
    });
    bandStart = sample.wire;
    bandTop = sample.top;
  }

  bands.push({
    startWire: bandStart,
    endWire: nodeEndWire,
    top: bandTop,
    startLeft: startLeftForBand(bandStart, nodeEndWire, bandTop),
  });

  if (bands.length < 2) {
    return [];
  }
  const minTop = Math.min(...bands.map((band) => band.top));
  const maxTop = Math.max(...bands.map((band) => band.top));
  if (maxTop - minTop <= rowClusterTol) {
    return [];
  }
  return bands;
}

/** Two-band contract from split metadata when post-promote samples lack Y clusters. */
function synthesizeSpanVisualBands(
  span: TextSoftWrapSpan,
  measured: MeasuredWireOffset[]
): TextSoftWrapVisualBand[] {
  const prefixSamples = measured.filter(
    (sample) => sample.wire >= span.nodeStartWire && sample.wire <= span.prefixEndWire
  );
  const prefixStartLeft = minLeft(prefixSamples) ?? span.continuationStartLeft;
  return [
    {
      startWire: span.nodeStartWire,
      endWire: span.prefixEndWire,
      top: span.prefixTop,
      startLeft: prefixStartLeft,
    },
    {
      startWire: span.continuationStartWire,
      endWire: span.nodeEndWire,
      top: span.continuationTop,
      startLeft: span.continuationStartLeft,
    },
  ];
}

function assembleTextSoftWrapSpan(
  nodeStartWire: number,
  nodeEndWire: number,
  prefixBandTop: number,
  measured: MeasuredWireOffset[],
  rowClusterTol: number
): TextSoftWrapSpan | null {
  const split = resolveMeasuredSoftWrapSplit(
    nodeStartWire,
    nodeEndWire,
    prefixBandTop,
    rowClusterTol,
    measured
  );
  if (!split) {
    return null;
  }

  const { prefixEndWire, continuationStartWire, continuationTop, continuationStartLeft } = split;
  const tailSamples: MeasuredWireOffset[] = [];
  let lowerAnchorWire = continuationStartWire - 1;

  for (const sample of measured) {
    if (sample.wire < continuationStartWire) {
      continue;
    }
    if (sample.wire > nodeEndWire) {
      continue;
    }
    tailSamples.push(sample);
    if (sample.wire > lowerAnchorWire) {
      lowerAnchorWire = sample.wire;
    }
  }

  if (lowerAnchorWire < continuationStartWire) {
    return null;
  }

  return {
    nodeStartWire,
    prefixEndWire,
    prefixTop: prefixBandTop,
    continuationStartWire,
    continuationTop,
    continuationStartLeft,
    nodeEndWire,
    lowerAnchorWire,
    tailSamples,
    visualBands: [],
  };
}

function finalizeWrapSpanVisualBands(
  wrapSpans: Map<number, TextSoftWrapSpan>,
  measured: MeasuredWireOffset[],
  rowClusterTol: number
): void {
  for (const span of wrapSpans.values()) {
    const measuredBands = buildVisualBandsFromMeasured(
      span.nodeStartWire,
      span.nodeEndWire,
      measured,
      rowClusterTol
    );
    span.visualBands =
      measuredBands.length > 0 ? measuredBands : synthesizeSpanVisualBands(span, measured);
  }
}

function resolvePrefixBandTopForTextNode(
  nodeStartWire: number,
  nodeEndWire: number,
  measured: MeasuredWireOffset[],
  rowClusterTol: number
): number | null {
  const nodeSamples = measured.filter(
    (sample) => sample.wire >= nodeStartWire && sample.wire < nodeEndWire
  );
  if (nodeSamples.length === 0) {
    return null;
  }
  const minTop = minSampleField(nodeSamples, (sample) => sample.top);
  const maxTop = maxSampleField(nodeSamples, (sample) => sample.top);
  if (minTop === null || maxTop === null || maxTop - minTop <= rowClusterTol) {
    return null;
  }
  const lowerTopFloor = minTop + rowClusterTol;
  const prefixSamples = nodeSamples.filter((sample) => sample.top <= lowerTopFloor);
  if (prefixSamples.length === 0) {
    return minTop;
  }
  return minSampleField(prefixSamples, (sample) => sample.top) ?? minTop;
}

function buildPostAtomicSoftWrapSpan(
  doc: HandoffNoteDoc,
  atomicNodeIndex: number,
  textNodeIndex: number,
  postAtomicStartWire: number,
  measured: MeasuredWireOffset[],
  sampleByWire: Map<number, MeasuredWireOffset>,
  rowClusterTol: number
): TextSoftWrapSpan | null {
  const node = doc.nodes[textNodeIndex];
  if (node?.type !== "text" || docTextNodeHasEmbeddedNewline(doc, textNodeIndex)) {
    return null;
  }
  if (/^\s+$/.test(node.text)) {
    return null;
  }
  const nodeEndWire = docPosToWireOffset(doc, {
    nodeIndex: textNodeIndex,
    nodeOffset: node.text.length,
  });
  const atomicBandTop = atomicBandTopForPostAtomic(
    doc,
    atomicNodeIndex,
    postAtomicStartWire,
    sampleByWire,
    rowClusterTol,
    { nodeEndWire, measured }
  );
  if (atomicBandTop === undefined) {
    return null;
  }

  return assembleTextSoftWrapSpan(
    postAtomicStartWire,
    nodeEndWire,
    atomicBandTop,
    measured,
    rowClusterTol
  );
}

/** Atomic loop: soft-wrap span detection, atom-adjacent align, tail sample promotion. */
function applyPostAtomicStructuralSamplePins(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  rowClusterTol: number,
  wireIndex: LayoutWireIndex,
  crossRowInterAtomicSpacers: Set<number> = new Set()
): Map<number, TextSoftWrapSpan> {
  const wrapSpans = new Map<number, TextSoftWrapSpan>();
  const sampleByWire = new Map<number, MeasuredWireOffset>();
  for (const sample of measured) {
    sampleByWire.set(sample.wire, sample);
  }

  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    if (!isAtomicNode(doc.nodes[nodeIndex])) {
      continue;
    }
    const textNodeIndex = nodeIndex + 1;
    const textNode = doc.nodes[textNodeIndex];
    if (textNode?.type !== "text" || docTextNodeHasEmbeddedNewline(doc, textNodeIndex)) {
      continue;
    }
    if (crossRowInterAtomicSpacers.has(textNodeIndex)) {
      continue;
    }

    const postAtomicStartWire = wireIndex.nodeStartWires[textNodeIndex]!;
    const span = buildPostAtomicSoftWrapSpan(
      doc,
      nodeIndex,
      textNodeIndex,
      postAtomicStartWire,
      measured,
      sampleByWire,
      rowClusterTol
    );
    if (span) {
      wrapSpans.set(textNodeIndex, span);
    }

    const atomicEndWire = postAtomicStartWire - 1;
    const endSample = sampleByWire.get(atomicEndWire);
    const postSample = sampleByWire.get(postAtomicStartWire);
    if (!endSample && !postSample) {
      continue;
    }

    const nodeEndWire = nodeWireEnd(doc, wireIndex, textNodeIndex);
    const bandTop =
      atomicBandTopForPostAtomic(doc, nodeIndex, postAtomicStartWire, sampleByWire, rowClusterTol, {
        nodeEndWire,
        measured,
      }) ?? Math.max(endSample?.top ?? -Infinity, postSample?.top ?? -Infinity);
    if (endSample) {
      endSample.top = bandTop;
    }

    if (!span) {
      for (const sample of measured) {
        if (
          sample.wire >= postAtomicStartWire &&
          sample.wire < nodeEndWire &&
          sample.top < bandTop &&
          bandTop - sample.top <= rowClusterTol
        ) {
          sample.top = bandTop;
        }
      }
    }

    let wrapTailTop: number | null = null;
    if (postSample && span) {
      if (
        span.continuationStartWire === span.nodeStartWire &&
        span.continuationTop > bandTop + rowClusterTol
      ) {
        wrapTailTop = span.continuationTop;
      }
      postSample.top = wrapTailTop ?? bandTop;
    } else if (postSample) {
      postSample.top = bandTop;
    }

    if (span) {
      for (const sample of span.tailSamples) {
        sample.top = span.continuationTop;
        if (Math.abs(sample.left - span.continuationStartLeft) > rowClusterTol) {
          sample.left = span.continuationStartLeft;
        }
      }
      logVerArrow("layout.softWrapTailPromote", {
        postAtomicStartWire,
        continuationStartWire: span.continuationStartWire,
        continuationTop: span.continuationTop,
        continuationStartLeft: span.continuationStartLeft,
      });
    }

    logVerArrow("layout.atomicAdjacentAlign", {
      atomicEndWire,
      postAtomicStartWire,
      bandTop,
      wrapTailTop,
    });
  }

  return wrapSpans;
}

/** Max midY delta for text fragment vs pill on one painted row (half line box). */
function samePaintBandMidYSlop(lineHeight: number, rowClusterTol: number): number {
  return Math.max(rowClusterTol * 2, lineHeight * 0.45);
}

/**
 * When wrapped text continuation and the immediately following mention paint on one
 * visual row, pill band midY is row authority — fragment midY can sit ~half a line lower.
 */
function alignContinuationBandToFollowingMention(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  wrapSpans: Map<number, TextSoftWrapSpan>,
  wireIndex: LayoutWireIndex,
  rowClusterTol: number,
  lineHeight: number,
  crossRowInterAtomicSpacers: Set<number> = new Set()
): void {
  const coBandSlop = samePaintBandMidYSlop(lineHeight, rowClusterTol);
  const hint: LayoutWireScanHint = { nodeIndex: 0 };
  const sampleByWire = new Map<number, MeasuredWireOffset>();
  const samplesByTextNode = new Map<number, MeasuredWireOffset[]>();
  for (const sample of measured) {
    sampleByWire.set(sample.wire, sample);
    const pos = resolveWireAtOffset(doc, wireIndex, sample.wire, hint);
    if (doc.nodes[pos.nodeIndex]?.type !== "text") {
      continue;
    }
    const bucket = samplesByTextNode.get(pos.nodeIndex);
    if (bucket) {
      bucket.push(sample);
    } else {
      samplesByTextNode.set(pos.nodeIndex, [sample]);
    }
  }

  for (const [textNodeIndex, span] of wrapSpans) {
    if (crossRowInterAtomicSpacers.has(textNodeIndex)) {
      continue;
    }
    const nextNode = doc.nodes[textNodeIndex + 1];
    if (nextNode?.type !== "mention") {
      continue;
    }
    const mentionStartWire = wireIndex.nodeStartWires[textNodeIndex + 1]!;
    const mentionSample = sampleByWire.get(mentionStartWire);
    if (!mentionSample) {
      continue;
    }
    if (mentionSample.top <= span.prefixTop + rowClusterTol) {
      continue;
    }
    if (Math.abs(mentionSample.top - span.continuationTop) > coBandSlop) {
      continue;
    }
    const bandTop = mentionSample.top;
    span.continuationTop = bandTop;
    const nodeSamples = samplesByTextNode.get(textNodeIndex);
    if (!nodeSamples) {
      continue;
    }
    for (const sample of nodeSamples) {
      if (sample.wire >= mentionStartWire) {
        continue;
      }
      if (sample.top <= span.prefixTop + rowClusterTol) {
        continue;
      }
      sample.top = bandTop;
    }
    logVerArrow("layout.continuationMentionCoBand", {
      textNodeIndex,
      mentionStartWire,
      bandTop: Math.round(bandTop * 100) / 100,
      continuationStartWire: span.continuationStartWire,
    });
  }
}

function applyPlainTextSoftWrapSpans(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  rowClusterTol: number,
  wireIndex: LayoutWireIndex,
  wrapSpans: Map<number, TextSoftWrapSpan>
): void {
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    if (doc.nodes[nodeIndex]?.type !== "text" || docTextNodeHasEmbeddedNewline(doc, nodeIndex)) {
      continue;
    }
    if (wrapSpans.has(nodeIndex)) {
      continue;
    }
    const nodeStartWire = wireIndex.nodeStartWires[nodeIndex]!;
    const nodeEndWire = nodeWireEnd(doc, wireIndex, nodeIndex);
    const prefixBandTop = resolvePrefixBandTopForTextNode(
      nodeStartWire,
      nodeEndWire,
      measured,
      rowClusterTol
    );
    if (prefixBandTop === null) {
      continue;
    }
    const span = assembleTextSoftWrapSpan(
      nodeStartWire,
      nodeEndWire,
      prefixBandTop,
      measured,
      rowClusterTol
    );
    if (span) {
      wrapSpans.set(nodeIndex, span);
      logVerArrow("layout.textSoftWrapSpan", {
        textNodeIndex: nodeIndex,
        nodeStartWire,
        prefixEndWire: span.prefixEndWire,
        continuationStartWire: span.continuationStartWire,
        prefixTop: span.prefixTop,
        continuationTop: span.continuationTop,
      });
    }
  }
}

/** Text after an atom on the same visual row inherits that atom's midY. */
function pinAdjacentTextSampleRows(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  wireIndex: LayoutWireIndex,
  hint: LayoutWireScanHint,
  lineHeight: number
): void {
  const bandTolerance = rowClusterTolerance(
    [],
    measured.map((sample) => sample.top),
    lineHeight
  );
  for (const sample of measured) {
    const pos = resolveWireAtOffset(doc, wireIndex, sample.wire, hint);
    const node = doc.nodes[pos.nodeIndex];
    if (node?.type !== "text") {
      continue;
    }
    if (docTextNodeHasEmbeddedNewline(doc, pos.nodeIndex)) {
      continue;
    }
    const prev = doc.nodes[pos.nodeIndex - 1];
    if (!isAtomicNode(prev)) {
      continue;
    }
    const following = doc.nodes[pos.nodeIndex + 1];
    if (isAtomicNode(following) && /^\s+$/.test(node.text) && !/[\n\r]/.test(node.text)) {
      const followingAtom = atomicElement(root, doc, pos.nodeIndex + 1);
      const followingMidY = followingAtom ? pillElementMidY(followingAtom) : null;
      if (followingMidY !== null && sample.top + MIN_INTER_ROW_GAP_PX < followingMidY) {
        continue;
      }
    }
    const atomEl = atomicElement(root, doc, pos.nodeIndex - 1);
    const midY = atomEl ? pillElementMidY(atomEl) : null;
    if (midY !== null && sample.top <= midY + bandTolerance) {
      sample.top = midY;
    }
  }
}

function assignRows(measured: MeasuredWireOffset[], rowCenters: number[]): HandoffNoteLayoutRow[] {
  if (measured.length === 0 || rowCenters.length === 0) {
    return [];
  }
  const sortedCenters = [...rowCenters].sort((left, right) => left - right);
  const rows: HandoffNoteLayoutRow[] = sortedCenters.map((top) => ({
    top,
    minLeft: Infinity,
    maxLeft: -Infinity,
    maxRight: -Infinity,
    samples: [],
    kind: "content" as const,
  }));

  for (const sample of measured) {
    const bestIndex = nearestRowCenterIndex(sample.top, sortedCenters);
    const row = rows[bestIndex]!;
    row.samples.push(sample);
    row.minLeft = Math.min(row.minLeft, sample.left);
    row.maxLeft = Math.max(row.maxLeft, sample.left);
    row.maxRight = Math.max(row.maxRight ?? -Infinity, measuredSampleRight(sample));
  }

  return rows.filter((row) => row.samples.length > 0);
}

function buildRowIndexLookup(rows: HandoffNoteLayoutRow[]): Map<number, number> {
  const lookup = new Map<number, number>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    if (row.breakProbeWire !== undefined) {
      lookup.set(row.breakProbeWire, rowIndex);
    }
    for (const sample of row.samples) {
      lookup.set(sample.wire, rowIndex);
    }
  }
  return lookup;
}

function buildMapFromMeasured(
  measured: MeasuredWireOffset[],
  rowCenters: number[],
  lineHeight: number,
  doc?: HandoffNoteDoc
): HandoffNoteLayoutMap {
  const tolerance = rowClusterTolerance(
    rowCenters,
    measured.map((sample) => sample.top),
    lineHeight
  );
  const centers = clusterTopCenters(rowCenters, tolerance);
  const rows = assignRows(measured, centers);
  const rowByWire = buildRowIndexLookup(rows);
  const stride = minimumDistinctTopGap(centers);
  const resolvedLineHeight = resolveVisualRowLineHeight(stride, lineHeight);
  const wirePaintIndex = buildLayoutPaintIndexes(measured, rowByWire, doc);
  const baseRowIndexForWire = (wireOffset: number) => {
    const direct = rowByWire.get(wireOffset);
    if (direct !== undefined) {
      return direct;
    }
    return resolveRowIndexFromBracketingSamples(wireOffset, measured, centers, doc);
  };

  return attachLayoutPaintIndex(
    {
      samples: measured,
      rows,
      lineHeight: resolvedLineHeight,
      visualRowCount: rows.length,
      rowIndexForWire: baseRowIndexForWire,
      coordsForWire(wireOffset: number) {
        return resolveCoordFromBracketingSamples(wireOffset, measured);
      },
      continuationAfterRowEndWire() {
        return null;
      },
      shouldPreserveGoalColumnOnShorterRowLanding(input) {
        return evaluateShorterRowStickyGoalPreservation(rows, new Map(), resolvedLineHeight, input);
      },
    },
    wirePaintIndex
  );
}

function applyDomAcquireSamplePins(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  wireIndex: LayoutWireIndex
): void {
  const lineHeight = parseFloat(getComputedStyle(root).lineHeight) || 16;
  const hint: LayoutWireScanHint = { nodeIndex: 0 };
  alignTextBeforeAtomicRows(doc, measured, wireIndex, hint);
  pinMentionSampleRows(root, doc, measured, wireIndex, hint);
  pinAdjacentTextSampleRows(root, doc, measured, wireIndex, hint, lineHeight);
}

/** EOF caret on a trailing-only blank band sits on the visual row below the last probe. */
function isEofOnlyTrailingBlankBand(doc: HandoffNoteDoc, wire: string): boolean {
  const probes = listEmbeddedBlankBandProbeWires(doc);
  if (probes.length === 0) {
    return false;
  }
  const lastProbe = probes[probes.length - 1]!;
  return !substantiveContentLineStartWires(doc, wire).some((lineStart) => lineStart > lastProbe);
}

function materializeEofTrailingCaretSample(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  blankRows: HandoffNoteLayoutRow[],
  lineHeight: number,
  wire: string
): void {
  if (!isEofOnlyTrailingBlankBand(doc, wire)) {
    return;
  }
  const eofWire = wire.length;
  const lastBlankRow = blankRows[blankRows.length - 1];
  if (!lastBlankRow) {
    return;
  }
  const top = lastBlankRow.top + lineHeight;
  upsertMeasuredSample(measured, { wire: eofWire, top, left: 0 });
  logVerArrow("layout.eofTrailingCaret", {
    eofWire,
    top: Math.round(top * 100) / 100,
    lastProbeWire: lastBlankRow.breakProbeWire ?? null,
  });
}

function applyStructuralSamplePins(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  root: HTMLElement | undefined,
  lineHeight: number,
  wireIndex: LayoutWireIndex
): Map<number, TextSoftWrapSpan> {
  ensureSubstantiveContentLineStartSamples(doc, measured, root, lineHeight, wireIndex);
  const rowClusterTol = rowClusterTolerance(
    [],
    measured.map((sample) => sample.top),
    lineHeight
  );
  replaceInferWorkingSamples(
    measured,
    dedupeMeasuredSamplesForInfer(doc, wireIndex, measured, rowClusterTol)
  );
  const crossRowInterAtomicSpacers = tagCrossRowInterAtomicSpacerSamples(
    doc,
    measured,
    wireIndex,
    root
  );
  const wrapSpans = applyPostAtomicStructuralSamplePins(
    doc,
    measured,
    rowClusterTol,
    wireIndex,
    crossRowInterAtomicSpacers
  );
  applyPlainTextSoftWrapSpans(doc, measured, rowClusterTol, wireIndex, wrapSpans);
  alignContinuationBandToFollowingMention(
    doc,
    measured,
    wrapSpans,
    wireIndex,
    rowClusterTol,
    lineHeight,
    crossRowInterAtomicSpacers
  );
  finalizeWrapSpanVisualBands(wrapSpans, measured, rowClusterTol);
  return wrapSpans;
}

type InferLayoutFromMeasuredOptions = {
  root?: HTMLElement;
  pillMidYs?: number[];
  wireIndex?: LayoutWireIndex;
};

/**
 * Layout inference pipeline (runs on every build):
 * 1. clone DOM cache → working copy (infer never mutates cached snapshot)
 * 2. structuralPins (dedupe → post-atomic spans → plain-text spans → visual bands)
 * 3. blankMaterialize → clusterSort → row lookup
 *
 * Blank ladder brackets read a frozen content-only snapshot, never prior blank upserts.
 */
function inferLayoutFromMeasured(
  doc: HandoffNoteDoc | undefined,
  measured: MeasuredWireOffset[],
  lineHeight: number,
  options: InferLayoutFromMeasuredOptions = {}
): HandoffNoteLayoutMap {
  const { root, pillMidYs = [], wireIndex: wireIndexOption } = options;
  const working = cloneMeasuredSamples(measured);

  if (doc) {
    const wireIndex = wireIndexOption ?? buildLayoutWireIndex(doc);
    const probes = listEmbeddedBlankBandProbeWires(doc);
    logVerArrow("layout.infer", {
      probeCount: probes.length,
      contractProbes: probes,
      sampleCountBefore: working.length,
      hasRoot: root !== undefined,
    });
    const wrapSpans = applyStructuralSamplePins(doc, working, root, lineHeight, wireIndex);

    const blankRows = buildSemanticBlankLayoutRows(doc, working, lineHeight, root, wireIndex.wire);

    logVerArrow("layout.infer.blankRows", {
      materialized: blankRows.length,
      expectedProbes: probes.length,
      breakProbeWires: blankRows.map((row) => row.breakProbeWire),
    });

    materializeEofTrailingCaretSample(doc, working, blankRows, lineHeight, wireIndex.wire);

    if (root || blankRows.length > 0) {
      return buildDocOrderedLayoutMap(doc, working, pillMidYs, lineHeight, blankRows, wrapSpans);
    }
  }

  const rowCenters = clusterTopCenters(
    working.map((sample) => sample.top),
    rowClusterTolerance(
      [],
      working.map((sample) => sample.top),
      lineHeight
    )
  );
  return buildMapFromMeasured(working, rowCenters, lineHeight, doc);
}

/**
 * DOM acquire pipeline (cache miss only):
 * measure boundary wires → domAcquirePins → appendSoftWrap → cache immutable snapshot.
 * Returns a working copy; infer never mutates the cached array.
 */
function acquireDomMeasuredSamples(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  wireIndex: LayoutWireIndex,
  rootWidth: number
): MeasuredWireOffset[] {
  const wire = wireIndex.wire;
  const cached = getCachedMeasuredSamples(root, wire, rootWidth);
  if (cached) {
    logVerArrow("layout.acquire", {
      source: "cache",
      wireLen: wire.length,
      rootWidth,
      sampleCount: cached.length,
    });
    return cloneMeasuredSamples(cached);
  }

  const measured: MeasuredWireOffset[] = [];
  for (const sampleWire of sampleWireOffsets(doc)) {
    pushAcquiredMeasuredSample(measured, measureWireCoord(root, doc, sampleWire));
  }
  applyDomAcquireSamplePins(root, doc, measured, wireIndex);
  appendSoftWrapLineSamples(root, doc, measured);
  alignEmbeddedNewlinePrefixAfterAtomicRows(root, doc, measured, wireIndex);
  setMeasuredSamplesCache(root, wire, rootWidth, measured);
  logVerArrow("layout.acquire", {
    source: "dom",
    wireLen: wire.length,
    rootWidth,
    sampleCount: measured.length,
    samples: measured.map((sample) => ({
      wire: sample.wire,
      top: Math.round(sample.top * 100) / 100,
      left: Math.round(sample.left * 100) / 100,
    })),
  });
  return cloneMeasuredSamples(measured);
}

export function buildLayoutMapFromSamples(
  input: MeasuredWireOffset[],
  lineHeight: number,
  doc?: HandoffNoteDoc
): HandoffNoteLayoutMap {
  return inferLayoutFromMeasured(doc, cloneMeasuredSamples(input), lineHeight);
}

function withDomRowResolutionOverrides(
  baseLayout: HandoffNoteLayoutMap,
  doc: HandoffNoteDoc,
  root: HTMLElement,
  measured: MeasuredWireOffset[],
  rowCenters: number[],
  rowByWire: Map<number, number>
): HandoffNoteLayoutMap {
  /** Wire shim → paint doc pos → paint index (alias seams must not trust raw wire alone). */
  const paintContextForWire = (wireOffset: number) => {
    const paintPos = resolvePaintContextAtWire(doc, wireOffset, { root }).paintPos;
    return baseLayout.paintContextForDocPos(paintPos);
  };
  return {
    ...baseLayout,
    paintContextForWire,
    rowIndexForWire(wireOffset: number) {
      const paintCtx = paintContextForWire(wireOffset);
      if (paintCtx && paintCtx.rowIndex >= 0) {
        return paintCtx.rowIndex;
      }
      const lowerRow = rowIndexForEmbeddedTextLedLowerRowWire(
        doc,
        wireOffset,
        measured,
        rowCenters
      );
      if (lowerRow !== null) {
        return lowerRow;
      }
      const direct = baseLayout.rowIndexForWire(wireOffset);
      if (direct >= 0) {
        return direct;
      }
      return resolveRowIndexForDocWire(doc, root, wireOffset, rowByWire, rowCenters, measured);
    },
    coordsForWire(wireOffset: number) {
      return baseLayout.coordsForWire(wireOffset) ?? measureWireCoord(root, doc, wireOffset);
    },
  };
}

export function buildHandoffNoteLayoutMap(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  focus?: HandoffNoteDocPos,
  options?: { wire?: string }
): HandoffNoteLayoutMap {
  const wire = options?.wire ?? docToWire(doc);
  const wireIndex = buildLayoutWireIndex(doc, wire);
  const rootWidth = root.clientWidth;
  const measured = acquireDomMeasuredSamples(root, doc, wireIndex, rootWidth);

  const pillMidYs = collectMentionMidYs(root, doc);
  const lineHeightSeed =
    minimumDistinctTopGap(pillMidYs) ?? (parseFloat(getComputedStyle(root).lineHeight) || 16);
  const baseLayout = inferLayoutFromMeasured(doc, measured, lineHeightSeed, {
    root,
    pillMidYs,
    wireIndex,
  });
  const rowCenters = baseLayout.rows.map((row) => row.top);
  const rowByWire = buildRowIndexLookup(baseLayout.rows);

  const layout = withDomRowResolutionOverrides(
    baseLayout,
    doc,
    root,
    measured,
    rowCenters,
    rowByWire
  );

  const focusWire = focus !== undefined ? docPosToWireOffset(doc, focus) : null;
  const probes = listEmbeddedBlankBandProbeWires(doc);
  logVerArrow("layout.build", {
    sampleCount: measured.length,
    visualRowCount: layout.visualRowCount,
    lineHeight: layout.lineHeight,
    focusWire,
    contractProbes: probes,
    eofWire: wire.length,
    rowTops: layout.rows.map((row) => Math.round(row.top * 100) / 100),
    rows: layoutRowsForLog(layout.rows),
  });
  logLayoutWireRowAssignments(
    layout,
    doc,
    [...(focusWire !== null ? [focusWire] : []), ...probes, wire.length],
    wire
  );

  return layout;
}

export function closestLayoutRowIndexForTop(layout: HandoffNoteLayoutMap, top: number): number {
  if (layout.rows.length === 0) {
    return -1;
  }
  const centers = layout.rows.map((row) => row.top);
  return nearestRowCenterIndex(top, centers);
}

/**
 * Row from paint doc pos via paint index. Cross-row inter-atomic spacer text keeps
 * measured text paint when it sits above the following atom.
 */
export function layoutRowIndexForDocPos(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  pos: HandoffNoteDocPos
): number {
  const { paintPos } = resolvePaintContext(doc, pos, { root });
  const paintCtx = layout.paintContextForDocPos(paintPos);
  if (paintCtx && paintCtx.rowIndex >= 0) {
    return paintCtx.rowIndex;
  }
  const paintWire = docPosToWireOffset(doc, paintPos);
  const directRow = layout.rowIndexForWire(paintWire);
  const node = doc.nodes[paintPos.nodeIndex];
  if (node?.type !== "text" || !/^\s+$/.test(node.text) || directRow < 0) {
    return directRow;
  }
  const next = doc.nodes[paintPos.nodeIndex + 1];
  if (!isAtomicNode(next)) {
    return layout.rowIndexForWire(paintWire);
  }
  const nodeStartWire = docPosToWireOffset(doc, { nodeIndex: paintPos.nodeIndex, nodeOffset: 0 });
  const coord = layout.coordsForWire(nodeStartWire) ?? measureWireCoord(root, doc, nodeStartWire);
  const atomEl = atomicElement(root, doc, paintPos.nodeIndex + 1);
  const atomY = atomEl ? pillElementMidY(atomEl) : null;
  if (
    coord &&
    atomY !== null &&
    Math.abs(coord.top - atomY) > MIN_INTER_ROW_GAP_PX &&
    layout.rows.length > 0
  ) {
    return nearestRowCenterIndex(
      coord.top,
      layout.rows.map((row) => row.top)
    );
  }
  return directRow;
}

/** Canonical row lookup from focus doc pos — paint authority via `paintContextForDocPos`. */
export function layoutRowForFocus(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  layout: HandoffNoteLayoutMap,
  focus: HandoffNoteDocPos
): number {
  return layoutRowIndexForDocPos(root, doc, layout, focus);
}

export function layoutVisualRowStartColumn(row: HandoffNoteLayoutRow): number {
  let start = row.samples[0]!;
  for (const sample of row.samples) {
    if (sample.wire < start.wire) {
      start = sample;
    }
  }
  return start.left;
}

export function layoutContentRowStartSample(
  row: HandoffNoteLayoutRow,
  wireLength: number
): MeasuredWireOffset | null {
  return layoutContentRowEdgeScan(row, wireLength).startSample;
}

export function layoutRowSampleColumnExtent(row: HandoffNoteLayoutRow): {
  minLeft: number;
  maxLeft: number;
} {
  const scan = layoutContentRowEdgeScan(row, Number.POSITIVE_INFINITY);
  return { minLeft: scan.minLeft, maxLeft: scan.maxLeft };
}

/** Source at row content end: tail wire + sticky goal matches measured column — not wire pick alone. */
export function layoutSourceIsAtRowContentEnd(
  doc: HandoffNoteDoc,
  row: HandoffNoteLayoutRow,
  fromWire: number,
  goalColumn: number,
  tolerance: number
): boolean {
  const wireLength = docToWire(doc).length;
  if (fromWire >= wireLength) {
    return true;
  }
  const scan = layoutContentRowEdgeScan(row, wireLength, { fromWire });
  if (scan.endWire === null || scan.stickyColumn === null) {
    return false;
  }
  if (fromWire < scan.endWire) {
    return false;
  }
  if (scan.fromSample) {
    return Math.abs(goalColumn - scan.fromSample.left) <= tolerance;
  }
  return goalColumn >= scan.stickyColumn - tolerance;
}

/** Highest doc-order layout sample on a visual row — shared row-tail wire for click and vertical nav. */
export function layoutRowEndWireFromSamples(
  samples: MeasuredWireOffset[],
  wireLen: number
): number | null {
  if (samples.length === 0) {
    return null;
  }
  return layoutContentRowEdgeScan(
    { kind: "content", top: 0, minLeft: 0, maxLeft: 0, samples },
    wireLen
  ).endWire;
}

/** Last measured wire on a visual content row (highest doc-order layout sample), not interior bracket extent. */
export function layoutContentRowEndWire(
  layout: HandoffNoteLayoutMap,
  doc: HandoffNoteDoc,
  rowIndex: number
): number | null {
  if (rowIndex < 0 || rowIndex >= layout.rows.length) {
    return null;
  }
  const row = layout.rows[rowIndex];
  if (!row || row.samples.length === 0) {
    return null;
  }
  return layoutRowEndWireFromSamples(row.samples, docToWire(doc).length);
}

export function layoutContentRowStickyColumn(
  layout: HandoffNoteLayoutMap,
  doc: HandoffNoteDoc,
  rowIndex: number
): number | null {
  const row = layout.rows[rowIndex];
  if (!row || row.samples.length === 0) {
    return null;
  }
  return layoutContentRowEdgeScan(row, docToWire(doc).length).stickyColumn;
}

export function layoutContentRowContentExtentRight(
  layout: HandoffNoteLayoutMap,
  doc: HandoffNoteDoc,
  rowIndex: number
): number | null {
  const row = layout.rows[rowIndex];
  if (!row || row.samples.length === 0) {
    return null;
  }
  return layoutContentRowEdgeScan(row, docToWire(doc).length).contentExtentRight;
}

export function layoutContentRowEndSampleForRow(
  row: HandoffNoteLayoutRow,
  wireLength: number
): MeasuredWireOffset | null {
  return layoutContentRowEdgeScan(row, wireLength).endSample;
}

export function layoutContentRowEndSample(
  layout: HandoffNoteLayoutMap,
  doc: HandoffNoteDoc,
  rowIndex: number
): MeasuredWireOffset | null {
  const row = layout.rows[rowIndex];
  if (!row) {
    return null;
  }
  return layoutContentRowEndSampleForRow(row, docToWire(doc).length);
}

export function isAtLayoutRowStart(
  layout: HandoffNoteLayoutMap,
  wire: number,
  goalColumn: number
): boolean {
  const rowIndex = layout.rowIndexForWire(wire);
  if (rowIndex < 0) {
    return false;
  }
  const row = layout.rows[rowIndex];
  if (!row) {
    return false;
  }
  const edgeTolerance = layoutRowTopTolerance(layout.lineHeight);
  const rowStartColumn = layoutVisualRowStartColumn(row);
  const columnAtEdge = Math.abs(goalColumn - rowStartColumn) <= edgeTolerance;
  if (!columnAtEdge) {
    return false;
  }
  if (isSparseColumnRow(row)) {
    const anchorWire = maxWire(row.samples);
    return anchorWire !== null && wire >= anchorWire;
  }
  let rowStartWire = row.samples[0]!.wire;
  for (const sample of row.samples) {
    if (sample.wire < rowStartWire) {
      rowStartWire = sample.wire;
    }
  }
  return wire <= rowStartWire;
}
