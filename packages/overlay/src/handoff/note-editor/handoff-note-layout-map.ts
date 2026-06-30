import {
  docLength,
  docPosToWireOffset,
  docTextNodeHasEmbeddedNewline,
  docToWire,
  embeddedTextLedLowerRowSpanAfterBlankBand,
  isEmbeddedBlankBandProbeWire,
  isInlineSuffixBlankProbeWire,
  isWireOnEmbeddedTextLedLowerRowAfterBlankBand,
  listEmbeddedBlankBandProbeWires,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";
import { logVerArrow } from "../handoff-note-debug.js";
import { isHandoffMentionElement, isHandoffWireBreakElement } from "./handoff-note-dom.js";
import {
  docPosToRenderedDomChildIndex,
  appendSoftWrapLineSamples,
  domRectAnchorMidY,
  getDocAnchorRect,
  hasPositionedDomRect,
  resolveDomPointAtDocPos,
} from "./handoff-note-dom-points.js";

export type MeasuredWireOffset = { wire: number; top: number; left: number };

export type HandoffNoteLayoutRowKind = "blank" | "content";

export type HandoffNoteLayoutRow = {
  top: number;
  minLeft: number;
  maxLeft: number;
  samples: MeasuredWireOffset[];
  kind: HandoffNoteLayoutRowKind;
  breakProbeWire?: number;
};

export type SegmentOffsetLanding = {
  sourceStartWire: number;
  targetStartWire: number;
  targetEndWire: number;
};

type TextRunBounds = {
  startWire: number;
  endWire: number;
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
  shouldPreserveGoalColumnOnShorterRowLanding(input: ShorterRowStickyGoalInput): boolean;
  resolveSegmentOffsetLanding(
    sourceWire: number,
    sourceRowIndex: number,
    targetRowIndex: number
  ): SegmentOffsetLanding | null;
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
  layoutCache = { wire, rootWidth, measured: cloneMeasuredSamples(measured) };
  logVerArrow("layout.cacheInject", {
    wireLen: wire.length,
    rootWidth,
    sampleCount: measured.length,
    samples: measured.map((sample) => ({
      wire: sample.wire,
      top: Math.round(sample.top * 100) / 100,
      left: Math.round(sample.left * 100) / 100,
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
  wires: number[]
): void {
  const wire = docToWire(doc);
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

/** Authoritative geometry for an embedded `\n` rendered as `<br data-handoff-wire-break>`. */
function measureWireBreakCoord(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  wire: number
): MeasuredWireOffset | null {
  const pos = wireOffsetToDocPos(doc, wire);
  const domPoint = resolveDomPointAtDocPos(root, doc, pos);
  if (!domPoint) {
    return null;
  }

  let element: Element | null = null;
  if (domPoint.node === root) {
    const child = root.childNodes[domPoint.offset];
    if (child instanceof HTMLBRElement) {
      element = child;
    }
  } else if (domPoint.node instanceof HTMLBRElement) {
    element = domPoint.node;
  } else if (domPoint.node.parentNode === root) {
    const sibling = root.childNodes[domPoint.offset];
    if (sibling instanceof HTMLBRElement) {
      element = sibling;
    }
  }

  if (element && isHandoffWireBreakElement(element)) {
    const rect = element.getBoundingClientRect();
    if (hasPositionedDomRect(rect)) {
      return { wire, top: domRectAnchorMidY(rect), left: rect.left };
    }
  }

  const rect = getDocAnchorRect(root, doc, pos);
  if (!rect || !hasPositionedDomRect(rect)) {
    return null;
  }
  return { wire, top: domRectAnchorMidY(rect), left: rect.left };
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

function appendEmbeddedNewlineLineSamples(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[]
): void {
  const seen = new Set(measured.map((sample) => sample.wire));
  let wireBase = 0;

  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex];
    if (node?.type !== "text" || !node.text.includes("\n")) {
      if (node?.type === "text") {
        wireBase += node.text.length;
      } else if (node?.type === "mention") {
        wireBase += 1 + node.agentId.length;
      }
      continue;
    }

    let lineStartLocal = 0;
    for (let local = 0; local < node.text.length; local++) {
      if (node.text[local] !== "\n") {
        continue;
      }
      const before = node.text.slice(lineStartLocal, local);
      const afterStart = local + 1;
      const nextBreak = node.text.indexOf("\n", afterStart);
      const after = node.text.slice(afterStart, nextBreak === -1 ? node.text.length : nextBreak);
      lineStartLocal = afterStart;

      if (
        before.length === 0 ||
        /^\s*$/.test(before) ||
        after.length === 0 ||
        /^\s*$/.test(after)
      ) {
        continue;
      }

      const lineStartWire = wireBase + afterStart;
      if (seen.has(lineStartWire) || isEmbeddedBlankBandProbeWire(doc, lineStartWire)) {
        continue;
      }
      const coord = measureWireCoord(root, doc, lineStartWire);
      if (!coord) {
        continue;
      }
      seen.add(lineStartWire);
      measured.push(coord);
    }

    wireBase += node.text.length;
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

/** Blank-band probes must not sort above earlier content on the same wire line. */
function contentBandTopBeforeBlankProbe(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  probeWire: number
): number | null {
  const wire = docToWire(doc);
  const lineStart = wire.lastIndexOf("\n", probeWire - 1) + 1;
  let lineMaxTop = -Infinity;
  let priorMaxTop = -Infinity;
  for (const sample of measured) {
    if (isEmbeddedBlankBandProbeWire(doc, sample.wire)) {
      continue;
    }
    if (sample.wire < probeWire) {
      priorMaxTop = Math.max(priorMaxTop, sample.top);
    }
    if (sample.wire >= lineStart && sample.wire < probeWire) {
      lineMaxTop = Math.max(lineMaxTop, sample.top);
    }
  }
  if (Number.isFinite(lineMaxTop)) {
    return lineMaxTop;
  }
  return Number.isFinite(priorMaxTop) ? priorMaxTop : null;
}

/** Prefix of an embedded-newline text node (before its first `\n`) shares the preceding pill band. */
function pinEmbeddedNewlinePrefixBandTops(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  root?: HTMLElement
): void {
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex];
    if (node?.type !== "text" || !node.text.includes("\n")) {
      continue;
    }
    const prev = doc.nodes[nodeIndex - 1];
    if (prev?.type !== "mention") {
      continue;
    }
    const nodeStartWire = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
    const firstNewlineWire = docPosToWireOffset(doc, {
      nodeIndex,
      nodeOffset: node.text.indexOf("\n"),
    });

    let bandTop: number | null = null;
    if (root) {
      const pill = mentionPillElement(root, doc, nodeIndex - 1);
      bandTop = pill ? pillMidY(pill) : null;
    } else {
      const mentionStartWire = docPosToWireOffset(doc, { nodeIndex: nodeIndex - 1, nodeOffset: 0 });
      const mentionEndWire = nodeStartWire - 1;
      const mentionStartSample = measured.find((sample) => sample.wire === mentionStartWire);
      const mentionEndSample = measured.find((sample) => sample.wire === mentionEndWire);
      const top = Math.max(
        mentionStartSample?.top ?? -Infinity,
        mentionEndSample?.top ?? -Infinity
      );
      bandTop = Number.isFinite(top) ? top : null;
    }
    if (bandTop === null) {
      continue;
    }

    for (const sample of measured) {
      if (isEmbeddedBlankBandProbeWire(doc, sample.wire)) {
        continue;
      }
      if (sample.wire >= nodeStartWire && sample.wire < firstNewlineWire) {
        sample.top = bandTop;
      }
    }
  }
}

function contentBandTopBelowBlankProbe(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  probeWire: number
): number | null {
  let minTop = Infinity;
  for (const sample of measured) {
    if (isEmbeddedBlankBandProbeWire(doc, sample.wire)) {
      continue;
    }
    if (sample.wire > probeWire) {
      minTop = Math.min(minTop, sample.top);
    }
  }
  return Number.isFinite(minTop) ? minTop : null;
}

function blankProbesInSameBand(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  probes: number[],
  probeWire: number
): number[] {
  const floor = contentBandTopBeforeBlankProbe(doc, measured, probeWire);
  const ceiling = contentBandTopBelowBlankProbe(doc, measured, probeWire);
  return probes.filter((wire) => {
    return (
      contentBandTopBeforeBlankProbe(doc, measured, wire) === floor &&
      contentBandTopBelowBlankProbe(doc, measured, wire) === ceiling
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
  measured: MeasuredWireOffset[],
  probeWire: number,
  lineHeight: number,
  probes: number[]
): { top: number; kind: BlankBandPlacementKind } {
  if (isInlineSuffixBlankProbeWire(doc, probeWire)) {
    const floor = contentBandTopBeforeBlankProbe(doc, measured, probeWire);
    return { top: floor ?? 0, kind: "inline" };
  }

  const floor = contentBandTopBeforeBlankProbe(doc, measured, probeWire);
  const ceiling = contentBandTopBelowBlankProbe(doc, measured, probeWire);
  const bandProbes = blankProbesInSameBand(doc, measured, probes, probeWire);
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
  root?: HTMLElement
): HandoffNoteLayoutRow[] {
  const probes = listEmbeddedBlankBandProbeWires(doc);
  const rows: HandoffNoteLayoutRow[] = [];
  /** Frozen for the whole pass — infer mutations and blank upserts must not shift brackets mid-loop. */
  const ladderBasis = contentSamplesForBlankLadder(doc, measured);

  for (const probeWire of probes) {
    const wireBreakCoord = root ? measureWireBreakCoord(root, doc, probeWire) : null;
    const floor = contentBandTopBeforeBlankProbe(doc, ladderBasis, probeWire);
    const ceiling = contentBandTopBelowBlankProbe(doc, ladderBasis, probeWire);
    const bandProbes = blankProbesInSameBand(doc, ladderBasis, probes, probeWire);
    const ladderPlacement = placeBlankProbeOnContentLadder(
      doc,
      ladderBasis,
      probeWire,
      lineHeight,
      probes
    );
    const wireBreakTop =
      wireBreakCoord !== null &&
      Number.isFinite(wireBreakCoord.top) &&
      (wireBreakCoord.top !== 0 || wireBreakCoord.left !== 0)
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
      samples: [sample],
    });

    logVerArrow("layout.blankPlace", {
      probeWire,
      chosen: placementKind,
      inlineSuffix: isInlineSuffixBlankProbeWire(doc, probeWire),
      ladder: {
        floor: floor === null ? null : Math.round(floor * 100) / 100,
        ceiling: ceiling === null ? null : Math.round(ceiling * 100) / 100,
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
    const leftKey = left.breakProbeWire ?? Math.min(...left.samples.map((sample) => sample.wire));
    const rightKey =
      right.breakProbeWire ?? Math.min(...right.samples.map((sample) => sample.wire));
    return leftKey - rightKey;
  });
}

export function isSparseColumnRow(row: HandoffNoteLayoutRow): boolean {
  if (row.samples.length <= 1) {
    return true;
  }
  const distinctLefts = new Set(row.samples.map((sample) => Math.round(sample.left)));
  return distinctLefts.size <= 1;
}

function textNodeWireBounds(doc: HandoffNoteDoc, nodeIndex: number): TextRunBounds | null {
  const node = doc.nodes[nodeIndex];
  if (node?.type !== "text") {
    return null;
  }
  const startWire = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
  return {
    startWire,
    endWire: startWire + node.text.length,
  };
}

function leadingTextRunBounds(
  doc: HandoffNoteDoc,
  row: HandoffNoteLayoutRow
): TextRunBounds | null {
  if (row.samples.length === 0) {
    return null;
  }
  const startWire = Math.min(...row.samples.map((sample) => sample.wire));
  const pos = wireOffsetToDocPos(doc, startWire);
  const bounds = textNodeWireBounds(doc, pos.nodeIndex);
  if (!bounds || startWire < bounds.startWire || startWire > bounds.endWire) {
    return null;
  }
  return {
    startWire,
    endWire: bounds.endWire,
  };
}

function postMentionWrapSourceRun(
  sourceWire: number,
  sourceRow: HandoffNoteLayoutRow,
  wrapSpans: Map<number, PostMentionSoftWrapSpan>
): TextRunBounds | null {
  for (const span of wrapSpans.values()) {
    if (
      sourceWire >= span.continuationStartWire &&
      sourceWire <= span.nodeEndWire &&
      rowTopMatchesContinuationRow(sourceRow, span.continuationTop, 2)
    ) {
      return {
        startWire: span.continuationStartWire,
        endWire: span.nodeEndWire,
      };
    }
  }
  return null;
}

function postMentionWrapRowRun(
  row: HandoffNoteLayoutRow,
  wrapSpans: Map<number, PostMentionSoftWrapSpan>
): TextRunBounds | null {
  for (const span of wrapSpans.values()) {
    if (
      rowTopMatchesContinuationRow(row, span.continuationTop, 2) &&
      row.samples.some(
        (sample) => sample.wire >= span.continuationStartWire && sample.wire <= span.nodeEndWire
      )
    ) {
      return {
        startWire: span.continuationStartWire,
        endWire: span.nodeEndWire,
      };
    }
  }
  return null;
}

function embeddedNewlineSourceRun(doc: HandoffNoteDoc, sourceWire: number): TextRunBounds | null {
  const wire = docToWire(doc);
  const breakWire = wire.lastIndexOf("\n", Math.max(0, sourceWire - 1));
  if (breakWire < 0) {
    return null;
  }
  const startWire = breakWire + 1;
  const nextBreak = wire.indexOf("\n", startWire);
  const endWire = nextBreak === -1 ? wire.length : nextBreak;
  if (sourceWire < startWire || sourceWire > endWire) {
    return null;
  }
  const segment = wire.slice(startWire, endWire);
  if (segment.length === 0 || /^\s*$/.test(segment)) {
    return null;
  }
  return { startWire, endWire };
}

function embeddedNewlineRowRun(
  doc: HandoffNoteDoc,
  row: HandoffNoteLayoutRow
): TextRunBounds | null {
  if (row.samples.length === 0) {
    return null;
  }
  const wire = docToWire(doc);
  const anchorWire = Math.max(...row.samples.map((sample) => sample.wire));
  const breakWire = wire.lastIndexOf("\n", Math.max(0, anchorWire - 1));
  if (breakWire < 0) {
    return null;
  }
  const startWire = breakWire + 1;
  const nextBreak = wire.indexOf("\n", startWire);
  const endWire = nextBreak === -1 ? wire.length : nextBreak;
  if (anchorWire < startWire || anchorWire > endWire) {
    return null;
  }
  const segment = wire.slice(startWire, endWire);
  if (segment.length === 0 || /^\s*$/.test(segment)) {
    return null;
  }
  return { startWire, endWire };
}

function matchingSegmentOffsetLanding(
  doc: HandoffNoteDoc,
  sourceWire: number,
  sourceRun: TextRunBounds | null,
  targetRun: TextRunBounds | null
): SegmentOffsetLanding | null {
  if (!sourceRun || !targetRun) {
    return null;
  }
  const offset = sourceWire - sourceRun.startWire;
  if (offset < 0 || offset > sourceRun.endWire - sourceRun.startWire) {
    return null;
  }
  if (offset > targetRun.endWire - targetRun.startWire) {
    return null;
  }
  const wire = docToWire(doc);
  const sourcePrefix = wire.slice(sourceRun.startWire, sourceRun.startWire + offset);
  const targetPrefix = wire.slice(targetRun.startWire, targetRun.startWire + offset);
  if (sourcePrefix !== targetPrefix) {
    return null;
  }
  return {
    sourceStartWire: sourceRun.startWire,
    targetStartWire: targetRun.startWire,
    targetEndWire: targetRun.endWire,
  };
}

function resolveSegmentOffsetLandingInternal(
  doc: HandoffNoteDoc,
  rows: HandoffNoteLayoutRow[],
  wrapSpans: Map<number, PostMentionSoftWrapSpan>,
  sourceWire: number,
  sourceRowIndex: number,
  targetRowIndex: number
): SegmentOffsetLanding | null {
  if (Math.abs(targetRowIndex - sourceRowIndex) !== 1) {
    return null;
  }
  const sourceRow = rows[sourceRowIndex];
  const targetRow = rows[targetRowIndex];
  if (
    !sourceRow ||
    !targetRow ||
    sourceRow.kind !== "content" ||
    targetRow.kind !== "content" ||
    sourceRow.samples.length === 0 ||
    targetRow.samples.length === 0
  ) {
    return null;
  }
  if (targetRowIndex < sourceRowIndex) {
    return matchingSegmentOffsetLanding(
      doc,
      sourceWire,
      postMentionWrapSourceRun(sourceWire, sourceRow, wrapSpans) ??
        embeddedNewlineSourceRun(doc, sourceWire),
      leadingTextRunBounds(doc, targetRow)
    );
  }
  return matchingSegmentOffsetLanding(
    doc,
    sourceWire,
    leadingTextRunBounds(doc, sourceRow),
    postMentionWrapRowRun(targetRow, wrapSpans) ?? embeddedNewlineRowRun(doc, targetRow)
  );
}

function buildDocOrderedLayoutMap(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  pillMidYs: number[],
  lineHeight: number,
  blankRows: HandoffNoteLayoutRow[],
  wrapSpans: Map<number, PostMentionSoftWrapSpan> = new Map()
): HandoffNoteLayoutMap {
  const probeWires = new Set(blankRows.map((row) => row.breakProbeWire!));
  const contentMeasured = measured.filter((sample) => !probeWires.has(sample.wire));
  const rowSeedTops = resolveVisualRowSeedTops(pillMidYs, contentMeasured);
  const contentLayout = buildMapFromMeasured(contentMeasured, rowSeedTops, lineHeight);
  const contentRows: HandoffNoteLayoutRow[] = contentLayout.rows.map((row) => ({
    ...row,
    kind: "content" as const,
  }));
  const rows = sortLayoutRowsByVisualTop([...contentRows, ...blankRows]);
  const rowByWire = buildRowIndexLookup(rows);
  const rowCenters = rows.map((row) => row.top);
  const stride = minimumDistinctTopGap(rowCenters);
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
      return resolveRowIndexFromBracketingSamples(wireOffset, measured, rowCenters, doc, wrapSpans);
    },
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
    shouldPreserveGoalColumnOnShorterRowLanding(input) {
      return evaluateShorterRowStickyGoalPreservation(
        doc,
        rows,
        wrapSpans,
        resolvedLineHeight,
        input
      );
    },
    resolveSegmentOffsetLanding(sourceWire, sourceRowIndex, targetRowIndex) {
      return resolveSegmentOffsetLandingInternal(
        doc,
        rows,
        wrapSpans,
        sourceWire,
        sourceRowIndex,
        targetRowIndex
      );
    },
  };
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

type PostMentionSoftWrapSpan = {
  postMentionStartWire: number;
  continuationStartWire: number;
  continuationTop: number;
  continuationStartLeft: number;
  nodeEndWire: number;
  lowerAnchorWire: number;
  tailSamples: MeasuredWireOffset[];
};

function rowTopMatchesContinuationRow(
  row: HandoffNoteLayoutRow,
  continuationTop: number,
  tolerance: number
): boolean {
  return Math.abs(row.top - continuationTop) <= tolerance;
}

function isPostMentionWrapContinuationRowIndex(
  rowIndex: number,
  rows: HandoffNoteLayoutRow[],
  wrapSpans: Map<number, PostMentionSoftWrapSpan>,
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

/** Up into the prefix visual row above a same-wire soft-wrap split re-anchors sticky column. */
function isSoftWrapPrefixReAnchorTarget(
  doc: HandoffNoteDoc | undefined,
  fromRowIndex: number,
  targetRowIndex: number,
  rows: HandoffNoteLayoutRow[]
): boolean {
  if (doc === undefined || targetRowIndex !== fromRowIndex - 1) {
    return false;
  }
  const targetRow = rows[targetRowIndex];
  const fromRow = rows[fromRowIndex];
  if (
    !targetRow ||
    !fromRow ||
    targetRow.kind !== "content" ||
    fromRow.kind !== "content" ||
    targetRow.samples.length === 0 ||
    fromRow.samples.length === 0
  ) {
    return false;
  }
  const targetMaxWire = Math.max(...targetRow.samples.map((sample) => sample.wire));
  const fromMinWire = Math.min(...fromRow.samples.map((sample) => sample.wire));
  if (targetMaxWire >= fromMinWire) {
    return false;
  }
  const wire = docToWire(doc);
  for (let offset = targetMaxWire + 1; offset < fromMinWire; offset++) {
    if (wire[offset] === "\n") {
      return false;
    }
  }
  return true;
}

function evaluateShorterRowStickyGoalPreservation(
  doc: HandoffNoteDoc | undefined,
  rows: HandoffNoteLayoutRow[],
  wrapSpans: Map<number, PostMentionSoftWrapSpan>,
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
  if (useRowStartLandingOnTarget) {
    return false;
  }
  const targetRowMaxColumn =
    targetRow.samples.length > 0
      ? Math.max(...targetRow.samples.map((sample) => sample.left))
      : null;
  if (
    targetRowMaxColumn === null ||
    effectiveGoalColumn <= targetRowMaxColumn + edgeTolerance ||
    Math.abs(landedColumn - targetRowMaxColumn) > edgeTolerance
  ) {
    return false;
  }
  const rowTopTolerance = Math.max(2, lineHeight * 0.25);
  if (isPostMentionWrapContinuationRowIndex(targetRowIndex, rows, wrapSpans, rowTopTolerance)) {
    return true;
  }
  if (
    targetRowIndex < fromRowIndex &&
    !isSoftWrapPrefixReAnchorTarget(doc, fromRowIndex, targetRowIndex, rows)
  ) {
    return true;
  }
  return false;
}

function rowIndexForPostMentionSoftWrapContinuation(
  doc: HandoffNoteDoc,
  wire: number,
  rowCenters: number[],
  wrapSpans: Map<number, PostMentionSoftWrapSpan>
): number | null {
  const pos = wireOffsetToDocPos(doc, wire);
  const node = doc.nodes[pos.nodeIndex];
  if (node?.type !== "text" || docTextNodeHasEmbeddedNewline(doc, pos.nodeIndex)) {
    return null;
  }
  if (doc.nodes[pos.nodeIndex - 1]?.type !== "mention") {
    return null;
  }
  const span = wrapSpans.get(pos.nodeIndex);
  if (!span) {
    return null;
  }
  if (wire >= span.continuationStartWire && wire <= span.lowerAnchorWire) {
    return nearestRowCenterIndex(span.continuationTop, rowCenters);
  }
  return null;
}

function resolveRowIndexFromBracketingSamples(
  wire: number,
  measured: MeasuredWireOffset[],
  rowCenters: number[],
  doc?: HandoffNoteDoc,
  wrapSpans?: Map<number, PostMentionSoftWrapSpan>
): number {
  if (doc) {
    const lowerRow = rowIndexForEmbeddedTextLedLowerRowWire(doc, wire, measured, rowCenters);
    if (lowerRow !== null) {
      return lowerRow;
    }
    if (wrapSpans && wrapSpans.size > 0) {
      const wrapContinuation = rowIndexForPostMentionSoftWrapContinuation(
        doc,
        wire,
        rowCenters,
        wrapSpans
      );
      if (wrapContinuation !== null) {
        return wrapContinuation;
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
  wrapSpans?: Map<number, PostMentionSoftWrapSpan>;
};

function resolveCoordFromBracketingSamples(
  wire: number,
  measured: MeasuredWireOffset[],
  context?: CoordBracketContext
): MeasuredWireOffset | null {
  if (context?.doc && context.wrapSpans && context.wrapSpans.size > 0) {
    const pos = wireOffsetToDocPos(context.doc, wire);
    const span = context.wrapSpans.get(pos.nodeIndex);
    if (span && wire >= span.continuationStartWire && wire <= span.lowerAnchorWire) {
      const scoped = [...span.tailSamples].sort((left, right) => left.wire - right.wire);
      const bracketed = resolveCoordFromBracketingSamplesInternal(wire, scoped);
      if (bracketed) {
        return { wire, top: span.continuationTop, left: bracketed.left };
      }
      return { wire, top: span.continuationTop, left: span.continuationStartLeft };
    }
  }

  return resolveCoordFromBracketingSamplesInternal(wire, measured);
}

/** Column match on a visual row when layout samples omit interior wire offsets. */
export function resolveWireAtColumnOnVisualRow(
  rowSamples: MeasuredWireOffset[],
  goalColumn: number,
  sourceWire?: number,
  sourceRowSamples?: MeasuredWireOffset[]
): number {
  if (rowSamples.length === 0) {
    return 0;
  }
  if (rowSamples.length === 1) {
    return rowSamples[0]!.wire;
  }

  const sorted = [...rowSamples].sort((left, right) => left.wire - right.wire);
  const distinctLefts = new Set(sorted.map((sample) => Math.round(sample.left)));
  if (
    distinctLefts.size <= 1 &&
    sourceWire !== undefined &&
    sourceRowSamples &&
    sourceRowSamples.length > 0
  ) {
    const fromStart = Math.min(...sourceRowSamples.map((sample) => sample.wire));
    const columnOffset = sourceWire - fromStart;
    const targetStart = sorted[0]!.wire;
    const targetEnd = sorted[sorted.length - 1]!.wire;
    return Math.max(targetStart, Math.min(targetStart + columnOffset, targetEnd));
  }

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

function postMentionRow0PrefixEndWire(
  doc: HandoffNoteDoc,
  textNodeIndex: number,
  postMentionStartWire: number
): number {
  const node = doc.nodes[textNodeIndex];
  if (node?.type !== "text") {
    return postMentionStartWire - 1;
  }
  let offset = 0;
  while (offset < node.text.length) {
    const char = node.text[offset];
    if (char !== " " && char !== "\t") {
      break;
    }
    offset++;
  }
  if (offset === 0) {
    return postMentionStartWire - 1;
  }
  return postMentionStartWire + offset - 1;
}

function buildPostMentionSoftWrapSpan(
  doc: HandoffNoteDoc,
  textNodeIndex: number,
  postMentionStartWire: number,
  measured: MeasuredWireOffset[],
  sampleByWire: Map<number, MeasuredWireOffset>,
  rowClusterTol: number
): PostMentionSoftWrapSpan | null {
  const node = doc.nodes[textNodeIndex];
  if (node?.type !== "text" || docTextNodeHasEmbeddedNewline(doc, textNodeIndex)) {
    return null;
  }
  const nodeEndWire = docPosToWireOffset(doc, {
    nodeIndex: textNodeIndex,
    nodeOffset: node.text.length,
  });
  const mentionEndWire = postMentionStartWire - 1;
  const mentionBandTop =
    sampleByWire.get(mentionEndWire)?.top ??
    sampleByWire.get(postMentionStartWire)?.top ??
    sampleByWire.get(mentionEndWire - 1)?.top;
  if (mentionBandTop === undefined) {
    return null;
  }

  const continuationStartWire =
    postMentionRow0PrefixEndWire(doc, textNodeIndex, postMentionStartWire) + 1;
  const tailSamples: MeasuredWireOffset[] = [];
  let continuationTop: number | null = null;
  let continuationStartLeft: number | null = null;
  let lowerAnchorWire = continuationStartWire - 1;
  const lowerTopFloor = mentionBandTop + rowClusterTol;

  for (const sample of measured) {
    if (sample.wire < continuationStartWire || sample.wire > nodeEndWire) {
      continue;
    }
    tailSamples.push(sample);
    if (sample.top <= lowerTopFloor) {
      continue;
    }
    if (continuationTop === null || sample.top < continuationTop) {
      continuationTop = sample.top;
    }
    if (continuationStartLeft === null || sample.left < continuationStartLeft) {
      continuationStartLeft = sample.left;
    }
    if (sample.wire > lowerAnchorWire) {
      lowerAnchorWire = sample.wire;
    }
  }

  if (
    continuationTop === null ||
    continuationStartLeft === null ||
    lowerAnchorWire < continuationStartWire
  ) {
    return null;
  }

  return {
    postMentionStartWire,
    continuationStartWire,
    continuationTop,
    continuationStartLeft,
    nodeEndWire,
    lowerAnchorWire,
    tailSamples,
  };
}

/** Mention loop: soft-wrap span detection, mention-adjacent align, tail sample promotion. */
function applyPostMentionStructuralSamplePins(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  rowClusterTol: number
): Map<number, PostMentionSoftWrapSpan> {
  const wrapSpans = new Map<number, PostMentionSoftWrapSpan>();
  const sampleByWire = new Map<number, MeasuredWireOffset>();
  for (const sample of measured) {
    sampleByWire.set(sample.wire, sample);
  }

  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    if (doc.nodes[nodeIndex]?.type !== "mention") {
      continue;
    }
    const textNodeIndex = nodeIndex + 1;
    if (docTextNodeHasEmbeddedNewline(doc, textNodeIndex)) {
      continue;
    }

    const postMentionStartWire = docPosToWireOffset(doc, {
      nodeIndex: textNodeIndex,
      nodeOffset: 0,
    });
    const span = buildPostMentionSoftWrapSpan(
      doc,
      textNodeIndex,
      postMentionStartWire,
      measured,
      sampleByWire,
      rowClusterTol
    );
    if (span) {
      wrapSpans.set(textNodeIndex, span);
    }

    const mentionEndWire = postMentionStartWire - 1;
    const endSample = sampleByWire.get(mentionEndWire);
    const postSample = sampleByWire.get(postMentionStartWire);
    if (!endSample && !postSample) {
      continue;
    }

    const bandTop = Math.max(endSample?.top ?? -Infinity, postSample?.top ?? -Infinity);
    if (endSample) {
      endSample.top = bandTop;
    }

    let wrapTailTop: number | null = null;
    if (postSample && span) {
      if (
        span.continuationStartWire === postMentionStartWire &&
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
        postMentionStartWire,
        continuationStartWire: span.continuationStartWire,
        continuationTop: span.continuationTop,
        continuationStartLeft: span.continuationStartLeft,
      });
    }

    logVerArrow("layout.mentionAdjacentAlign", {
      mentionEndWire,
      postMentionStartWire,
      bandTop,
      wrapTailTop,
    });
  }

  return wrapSpans;
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
    if (docTextNodeHasEmbeddedNewline(doc, pos.nodeIndex)) {
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
    kind: "content" as const,
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
    shouldPreserveGoalColumnOnShorterRowLanding(input) {
      return evaluateShorterRowStickyGoalPreservation(
        undefined,
        rows,
        new Map(),
        resolvedLineHeight,
        input
      );
    },
    resolveSegmentOffsetLanding() {
      return null;
    },
  };
}

function applyDomAcquireSamplePins(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[]
): void {
  alignTextBeforeMentionRows(doc, measured);
  pinMentionSampleRows(root, doc, measured);
  pinAdjacentTextSampleRows(root, doc, measured);
}

function applyStructuralSamplePins(
  doc: HandoffNoteDoc,
  measured: MeasuredWireOffset[],
  root?: HTMLElement
): Map<number, PostMentionSoftWrapSpan> {
  const rowClusterTol = rowClusterTolerance(
    [],
    measured.map((sample) => sample.top)
  );
  const wrapSpans = applyPostMentionStructuralSamplePins(doc, measured, rowClusterTol);
  pinEmbeddedNewlinePrefixBandTops(doc, measured, root);
  return wrapSpans;
}

type InferLayoutFromMeasuredOptions = {
  root?: HTMLElement;
  pillMidYs?: number[];
};

/**
 * Layout inference pipeline (runs on every build):
 * clone DOM cache → structuralPins → blankMaterialize → clusterSort.
 *
 * DOM acquire cache stores content samples only and is immutable. Infer mutates a working
 * copy; blank ladder brackets read a frozen content-only snapshot, never prior blank upserts.
 */
function inferLayoutFromMeasured(
  doc: HandoffNoteDoc | undefined,
  measured: MeasuredWireOffset[],
  lineHeight: number,
  options: InferLayoutFromMeasuredOptions = {}
): HandoffNoteLayoutMap {
  const { root, pillMidYs = [] } = options;
  const working = cloneMeasuredSamples(measured);

  if (doc) {
    const probes = listEmbeddedBlankBandProbeWires(doc);
    logVerArrow("layout.infer", {
      probeCount: probes.length,
      contractProbes: probes,
      sampleCountBefore: working.length,
      hasRoot: root !== undefined,
    });
    const wrapSpans = applyStructuralSamplePins(doc, working, root);

    const blankRows = buildSemanticBlankLayoutRows(doc, working, lineHeight, root);

    logVerArrow("layout.infer.blankRows", {
      materialized: blankRows.length,
      expectedProbes: probes.length,
      breakProbeWires: blankRows.map((row) => row.breakProbeWire),
    });

    if (root || blankRows.length > 0) {
      return buildDocOrderedLayoutMap(doc, working, pillMidYs, lineHeight, blankRows, wrapSpans);
    }
  }

  const rowCenters = clusterTopCenters(
    working.map((sample) => sample.top),
    rowClusterTolerance(
      [],
      working.map((sample) => sample.top)
    )
  );
  return buildMapFromMeasured(working, rowCenters, lineHeight);
}

/**
 * DOM acquire pipeline (cache miss only):
 * measure boundary wires → domAcquirePins → appendSoftWrap → cache immutable snapshot.
 * Returns a working copy; infer never mutates the cached array.
 */
function acquireDomMeasuredSamples(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  wire: string,
  rootWidth: number
): MeasuredWireOffset[] {
  const cached = getCachedMeasuredSamples(wire, rootWidth);
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
    const coord = measureWireCoord(root, doc, sampleWire);
    if (coord) {
      measured.push(coord);
    }
  }
  applyDomAcquireSamplePins(root, doc, measured);
  appendSoftWrapLineSamples(root, doc, measured);
  appendEmbeddedNewlineLineSamples(root, doc, measured);
  setMeasuredSamplesCache(wire, rootWidth, measured);
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

export function buildHandoffNoteLayoutMap(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  focus?: HandoffNoteDocPos
): HandoffNoteLayoutMap {
  const wire = docToWire(doc);
  const rootWidth = root.clientWidth;
  const measured = acquireDomMeasuredSamples(root, doc, wire, rootWidth);

  const pillMidYs = collectMentionMidYs(root, doc);
  const lineHeightSeed =
    minimumDistinctTopGap(pillMidYs) ?? (parseFloat(getComputedStyle(root).lineHeight) || 16);
  const baseLayout = inferLayoutFromMeasured(doc, measured, lineHeightSeed, {
    root,
    pillMidYs,
  });
  const rowCenters = baseLayout.rows.map((row) => row.top);
  const rowByWire = buildRowIndexLookup(baseLayout.rows);

  const layout: HandoffNoteLayoutMap = {
    ...baseLayout,
    rowIndexForWire(wireOffset: number) {
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
  logLayoutWireRowAssignments(layout, doc, [
    ...(focusWire !== null ? [focusWire] : []),
    ...probes,
    wire.length,
  ]);

  return layout;
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
  const rowStartColumn = layoutVisualRowStartColumn(row);
  const columnAtEdge = Math.abs(goalColumn - rowStartColumn) <= edgeTolerance;
  if (!columnAtEdge) {
    return false;
  }
  if (isSparseColumnRow(row)) {
    const anchorWire = Math.max(...row.samples.map((sample) => sample.wire));
    return wire >= anchorWire;
  }
  let rowStartWire = row.samples[0]!.wire;
  for (const sample of row.samples) {
    if (sample.wire < rowStartWire) {
      rowStartWire = sample.wire;
    }
  }
  return wire <= rowStartWire;
}
