import {
  docLength,
  docPosToWireOffset,
  docToWire,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";
import { logVerArrow } from "../handoff-note-debug.js";
import { isHandoffMentionElement } from "./handoff-note-dom.js";
import {
  docPosToRenderedDomChildIndex,
  enrichMeasuredTextLineSamples,
  getDocAnchorRect,
} from "./handoff-note-dom-points.js";

export type MeasuredWireOffset = { wire: number; top: number; left: number };

export type HandoffNoteLayoutRow = {
  top: number;
  minLeft: number;
  maxLeft: number;
  samples: MeasuredWireOffset[];
};

export type HandoffNoteLayoutMap = {
  samples: MeasuredWireOffset[];
  rows: HandoffNoteLayoutRow[];
  lineHeight: number;
  visualRowCount: number;
  rowIndexForWire(wire: number): number;
  coordsForWire(wire: number): MeasuredWireOffset | null;
};

type LayoutCache = {
  wire: string;
  rootWidth: number;
  measured: MeasuredWireOffset[];
};

let layoutCache: LayoutCache | null = null;

export function invalidateHandoffNoteLayoutCache(): void {
  layoutCache = null;
}

export function readHandoffNoteLayoutCacheKey(): {
  wire: string;
  rootWidth: number;
  sampleCount: number;
} | null {
  if (!layoutCache) {
    return null;
  }
  return {
    wire: layoutCache.wire,
    rootWidth: layoutCache.rootWidth,
    sampleCount: layoutCache.measured.length,
  };
}

export function getCachedMeasuredSamples(
  wire: string,
  rootWidth: number
): MeasuredWireOffset[] | null {
  if (layoutCache && layoutCache.wire === wire && layoutCache.rootWidth === rootWidth) {
    return layoutCache.measured;
  }
  return null;
}

export function setMeasuredSamplesCache(
  wire: string,
  rootWidth: number,
  measured: MeasuredWireOffset[]
): void {
  layoutCache = { wire, rootWidth, measured };
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

function mentionPillElement(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number
): HTMLSpanElement | null {
  const renderedIndex = docPosToRenderedDomChildIndex(doc, nodeIndex);
  const child = root.childNodes[renderedIndex];
  if (!child || !isHandoffMentionElement(child)) {
    return null;
  }
  return child;
}

function pillMidY(pill: HTMLSpanElement): number | null {
  const rect = pill.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    return null;
  }
  return rect.top + rect.height / 2;
}

/** Pill bbox for mentions; Range anchor for text. Text before a mention uses that pill's row. */
export function measureWireCoord(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  wire: number
): MeasuredWireOffset | null {
  const pos = wireOffsetToDocPos(doc, wire);
  const node = doc.nodes[pos.nodeIndex];
  if (node?.type === "mention") {
    const pill = mentionPillElement(root, doc, pos.nodeIndex);
    if (pill) {
      const midY = pillMidY(pill);
      if (midY !== null) {
        const rect = pill.getBoundingClientRect();
        const left = pos.nodeOffset <= 0 ? rect.left : rect.right;
        return { wire, top: midY, left };
      }
    }
  }

  const rect = getDocAnchorRect(root, doc, pos);
  if (!rect) {
    return null;
  }

  let top = rect.top + rect.height / 2;
  if (node?.type === "text" && pos.nodeOffset === 0) {
    const next = doc.nodes[pos.nodeIndex + 1];
    if (next?.type === "mention") {
      const pill = mentionPillElement(root, doc, pos.nodeIndex + 1);
      const midY = pill ? pillMidY(pill) : null;
      if (midY !== null) {
        top = midY;
      }
    }
  }

  return { wire, top, left: rect.left };
}

function minimumDistinctTopGap(tops: number[]): number | null {
  const distinct = [...new Set(tops)].sort((left, right) => left - right);
  if (distinct.length < 2) {
    return null;
  }
  let minGap = Infinity;
  for (let index = 1; index < distinct.length; index++) {
    minGap = Math.min(minGap, distinct[index]! - distinct[index - 1]!);
  }
  return Number.isFinite(minGap) ? minGap : null;
}

/** Row split tolerance — never derive from caret/block rect height (that merged ~18px wrap rows). */
function rowClusterTolerance(rowTops: number[], sampleTops: number[]): number {
  const stride = minimumDistinctTopGap(rowTops) ?? minimumDistinctTopGap(sampleTops) ?? null;
  if (stride === null || stride <= 4) {
    return 6;
  }
  return Math.min(Math.max(stride * 0.35, 4), 10);
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
    const pill = mentionPillElement(root, doc, nodeIndex);
    if (!pill) {
      continue;
    }
    const midY = pillMidY(pill);
    if (midY !== null) {
      tops.push(midY);
    }
  }
  return tops;
}

/** Pill midYs alone miss soft-wrapped continuation rows; merge measured tops before clustering. */
function resolveVisualRowSeedTops(pillMidYs: number[], measured: MeasuredWireOffset[]): number[] {
  const measuredTops = measured.map((sample) => sample.top);
  const tolerance = rowClusterTolerance(pillMidYs, measuredTops);
  const seeds = pillMidYs.length > 0 ? [...pillMidYs, ...measuredTops] : measuredTops;
  return clusterTopCenters(seeds, tolerance);
}

function alignTextBeforeMentionRows(doc: HandoffNoteDoc, measured: MeasuredWireOffset[]): void {
  for (const sample of measured) {
    const pos = wireOffsetToDocPos(doc, sample.wire);
    const node = doc.nodes[pos.nodeIndex];
    if (node?.type !== "text" || pos.nodeOffset !== 0) {
      continue;
    }
    const next = doc.nodes[pos.nodeIndex + 1];
    if (next?.type !== "mention") {
      continue;
    }
    const mentionStart = docPosToWireOffset(doc, { nodeIndex: pos.nodeIndex + 1, nodeOffset: 0 });
    const mentionSample = measured.find((entry) => entry.wire === mentionStart);
    if (mentionSample) {
      sample.top = mentionSample.top;
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
  measured: MeasuredWireOffset[]
): void {
  for (const sample of measured) {
    const pos = wireOffsetToDocPos(doc, sample.wire);
    if (doc.nodes[pos.nodeIndex]?.type !== "mention") {
      continue;
    }
    const pill = mentionPillElement(root, doc, pos.nodeIndex);
    const midY = pill ? pillMidY(pill) : null;
    if (midY !== null) {
      sample.top = midY;
    }
  }
}

function resolveRowIndexFromBracketingSamples(
  wire: number,
  measured: MeasuredWireOffset[],
  rowCenters: number[]
): number {
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

  const ratio = (wire - prev.wire) / (next.wire - prev.wire);
  const top = prev.top + ratio * (next.top - prev.top);
  return nearestRowCenterIndex(top, rowCenters);
}

function resolveCoordFromBracketingSamples(
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

/** Column match on a visual row when layout samples omit interior wire offsets. */
export function resolveWireAtColumnOnVisualRow(
  rowSamples: MeasuredWireOffset[],
  goalColumn: number
): number {
  if (rowSamples.length === 0) {
    return 0;
  }
  if (rowSamples.length === 1) {
    return rowSamples[0]!.wire;
  }

  const sorted = [...rowSamples].sort((left, right) => left.wire - right.wire);
  let bestWire = sorted[0]!.wire;
  let bestDistance = Math.abs(sorted[0]!.left - goalColumn);

  for (const sample of sorted) {
    const distance = Math.abs(sample.left - goalColumn);
    if (distance < bestDistance) {
      bestWire = sample.wire;
      bestDistance = distance;
    }
  }

  for (let index = 0; index < sorted.length - 1; index++) {
    const left = sorted[index]!;
    const right = sorted[index + 1]!;
    if (left.left === right.left) {
      continue;
    }
    const minColumn = Math.min(left.left, right.left);
    const maxColumn = Math.max(left.left, right.left);
    if (goalColumn < minColumn || goalColumn > maxColumn) {
      continue;
    }
    const ratio = (goalColumn - left.left) / (right.left - left.left);
    const wire = Math.round(left.wire + ratio * (right.wire - left.wire));
    const clamped = Math.max(left.wire, Math.min(right.wire, wire));
    const interpolatedLeft =
      left.left + ((clamped - left.wire) / (right.wire - left.wire)) * (right.left - left.left);
    const distance = Math.abs(interpolatedLeft - goalColumn);
    if (distance < bestDistance) {
      bestWire = clamped;
      bestDistance = distance;
    }
  }

  return bestWire;
}

function resolveRowIndexForDocWire(
  doc: HandoffNoteDoc,
  root: HTMLElement,
  wire: number,
  rowByWire: Map<number, number>,
  rowCenters: number[]
): number {
  const direct = rowByWire.get(wire);
  if (direct !== undefined) {
    return direct;
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

  const pill = mentionPillElement(root, doc, pos.nodeIndex);
  const midY = pill ? pillMidY(pill) : null;
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

/** Mention end and the text node immediately after it share one visual band top. */
function alignMentionAdjacentMeasuredRows(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[]
): void {
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex];
    if (node?.type !== "mention") {
      continue;
    }
    const postMentionStartWire = docPosToWireOffset(doc, {
      nodeIndex: nodeIndex + 1,
      nodeOffset: 0,
    });
    const mentionEndWire = postMentionStartWire - 1;
    const endSample = measured.find((sample) => sample.wire === mentionEndWire);
    const postSample = measured.find((sample) => sample.wire === postMentionStartWire);
    if (!endSample && !postSample) {
      continue;
    }
    const bandTop = Math.max(endSample?.top ?? -Infinity, postSample?.top ?? -Infinity);
    if (endSample) {
      endSample.top = bandTop;
    }
    if (postSample) {
      postSample.top = bandTop;
    }
    logVerArrow("layout.mentionAdjacentAlign", {
      mentionEndWire,
      postMentionStartWire,
      bandTop,
    });
  }
}

/** Text after a mention on the same pill row inherits that pill's midY. */
function pinAdjacentTextSampleRows(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[]
): void {
  const bandTolerance = rowClusterTolerance(
    [],
    measured.map((sample) => sample.top)
  );
  for (const sample of measured) {
    const pos = wireOffsetToDocPos(doc, sample.wire);
    const node = doc.nodes[pos.nodeIndex];
    if (node?.type !== "text") {
      continue;
    }
    const prev = doc.nodes[pos.nodeIndex - 1];
    if (prev?.type !== "mention") {
      continue;
    }
    const pill = mentionPillElement(root, doc, pos.nodeIndex - 1);
    const midY = pill ? pillMidY(pill) : null;
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
    samples: [],
  }));

  for (const sample of measured) {
    const bestIndex = nearestRowCenterIndex(sample.top, sortedCenters);
    const row = rows[bestIndex]!;
    row.samples.push(sample);
    row.minLeft = Math.min(row.minLeft, sample.left);
    row.maxLeft = Math.max(row.maxLeft, sample.left);
  }

  return rows.filter((row) => row.samples.length > 0);
}

function buildRowIndexLookup(rows: HandoffNoteLayoutRow[]): Map<number, number> {
  const lookup = new Map<number, number>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (const sample of rows[rowIndex]!.samples) {
      lookup.set(sample.wire, rowIndex);
    }
  }
  return lookup;
}

function buildMapFromMeasured(
  measured: MeasuredWireOffset[],
  rowCenters: number[],
  lineHeight: number
): HandoffNoteLayoutMap {
  const tolerance = rowClusterTolerance(
    rowCenters,
    measured.map((sample) => sample.top)
  );
  const centers = clusterTopCenters(rowCenters, tolerance);
  const rows = assignRows(measured, centers);
  const rowByWire = buildRowIndexLookup(rows);
  const stride = minimumDistinctTopGap(centers);
  const resolvedLineHeight =
    stride !== null && stride > 4 ? stride : Math.min(Math.max(lineHeight, 8), 24);

  return {
    samples: measured,
    rows,
    lineHeight: resolvedLineHeight,
    visualRowCount: rows.length,
    rowIndexForWire(wireOffset: number) {
      const direct = rowByWire.get(wireOffset);
      if (direct !== undefined) {
        return direct;
      }
      return resolveRowIndexFromBracketingSamples(wireOffset, measured, centers);
    },
    coordsForWire(wireOffset: number) {
      return resolveCoordFromBracketingSamples(wireOffset, measured);
    },
  };
}

export function buildLayoutMapFromSamples(
  input: MeasuredWireOffset[],
  lineHeight: number,
  doc?: HandoffNoteDoc
): HandoffNoteLayoutMap {
  const measured = [...input];
  if (doc) {
    alignMentionAdjacentMeasuredRows(doc, measured);
  }
  const rowCenters = clusterTopCenters(
    measured.map((sample) => sample.top),
    rowClusterTolerance(
      [],
      measured.map((sample) => sample.top)
    )
  );
  return buildMapFromMeasured(measured, rowCenters, lineHeight);
}

export function buildHandoffNoteLayoutMap(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  focus?: HandoffNoteDocPos
): HandoffNoteLayoutMap {
  const wire = docToWire(doc);
  const rootWidth = root.clientWidth;
  let measured = getCachedMeasuredSamples(wire, rootWidth);
  if (!measured) {
    measured = [];
    for (const sampleWire of sampleWireOffsets(doc)) {
      const coord = measureWireCoord(root, doc, sampleWire);
      if (coord) {
        measured.push(coord);
      }
    }
    alignTextBeforeMentionRows(doc, measured);
    pinMentionSampleRows(root, doc, measured);
    pinAdjacentTextSampleRows(root, doc, measured);
    enrichMeasuredTextLineSamples(root, doc, measured);
    setMeasuredSamplesCache(wire, rootWidth, measured);
  }

  alignMentionAdjacentMeasuredRows(doc, measured);

  const pillMidYs = collectMentionMidYs(root, doc);
  const rowSeedTops = resolveVisualRowSeedTops(pillMidYs, measured);
  const lineHeight =
    minimumDistinctTopGap(rowSeedTops) ?? (parseFloat(getComputedStyle(root).lineHeight) || 16);

  const baseLayout = buildMapFromMeasured(measured, rowSeedTops, lineHeight);
  const rowCenters = baseLayout.rows.map((row) => row.top);
  const rowByWire = buildRowIndexLookup(baseLayout.rows);

  const layout: HandoffNoteLayoutMap = {
    ...baseLayout,
    rowIndexForWire(wireOffset: number) {
      const direct = baseLayout.rowIndexForWire(wireOffset);
      if (direct >= 0) {
        return direct;
      }
      return resolveRowIndexForDocWire(doc, root, wireOffset, rowByWire, rowCenters);
    },
    coordsForWire(wireOffset: number) {
      return baseLayout.coordsForWire(wireOffset) ?? measureWireCoord(root, doc, wireOffset);
    },
  };

  logVerArrow("layout.build", {
    sampleCount: measured.length,
    visualRowCount: layout.visualRowCount,
    lineHeight: layout.lineHeight,
    focusWire: focus !== undefined ? docPosToWireOffset(doc, focus) : null,
    rowTops: layout.rows.map((row) => row.top),
    rowWires: layout.rows.map((row) => row.samples.map((sample) => sample.wire)),
  });

  return layout;
}

function visualRowStartColumn(row: HandoffNoteLayoutRow): number {
  let start = row.samples[0]!;
  for (const sample of row.samples) {
    if (sample.wire < start.wire) {
      start = sample;
    }
  }
  return start.left;
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
  const edgeTolerance = Math.max(2, layout.lineHeight * 0.25);
  const rowStartColumn = visualRowStartColumn(row);
  return Math.abs(goalColumn - rowStartColumn) <= edgeTolerance;
}
