import {
  docToWire,
  offsetAtDocPosition,
  spliceDocWireRange,
  type HandoffNoteDoc,
  type HandoffNoteEdit,
} from "./handoff-note-doc.js";

export type EmbeddedBlankBandDeleteBranch =
  | "backspace-content-above"
  | "backspace-blank-above"
  | "backspace-collapse-empty-above"
  | "backspace-line-start-collapse"
  | "delete-blank-below"
  | "delete-lower-row";

export type EmbeddedBlankBandDeleteMove = {
  doc: HandoffNoteDoc;
  caretWire: number;
  branch: EmbeddedBlankBandDeleteBranch;
};

function wireLineStartOffsets(wire: string): number[] {
  const starts = [0];
  for (let index = 0; index < wire.length; index++) {
    if (wire[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function isBlankBandSegment(segment: string): boolean {
  return segment.length === 0 || /^\s*$/.test(segment);
}

/** True when substantive content sits on the row immediately above `probeWire`. */
export function embeddedBlankBandHasSubstantiveRowAbove(wire: string, probeWire: number): boolean {
  if (probeWire <= 0) {
    return false;
  }
  const lineStart = wire.lastIndexOf("\n", probeWire - 1) + 1;
  const segment = wire.slice(lineStart, probeWire);
  return segment.length > 0 && /\S/.test(segment);
}

/** True when the blank band has a filled content row above its first probe (header row). */
export function embeddedBlankBandHasSubstantiveContentAboveBand(
  wire: string,
  probes: number[]
): boolean {
  const firstProbe = probes[0];
  if (firstProbe === undefined) {
    return false;
  }
  return embeddedBlankBandHasSubstantiveRowAbove(wire, firstProbe);
}

/** First wire offset of substantive content (skips leading `\n` run and whitespace-only segments). */
export function embeddedBlankBandSubstantiveContentStartWire(doc: HandoffNoteDoc): number {
  const wire = docToWire(doc);
  const lineStarts = wireLineStartOffsets(wire);
  for (const start of lineStarts) {
    const lineEnd = wire.indexOf("\n", start);
    const segment = wire.slice(start, lineEnd === -1 ? wire.length : lineEnd);
    if (segment.length > 0 && /\S/.test(segment)) {
      return start;
    }
  }
  return wire.length;
}

function collapseBlankBandBackspaceLanding(nextDoc: HandoffNoteDoc, probeIndex: number): number {
  const remaining = listEmbeddedBlankBandProbeWires(nextDoc);
  if (probeIndex > 0) {
    return remaining[probeIndex - 1]!;
  }
  if (remaining.length > 0) {
    return remaining[0]!;
  }
  return embeddedBlankBandSubstantiveContentStartWire(nextDoc);
}

function collapseBlankBandDeleteLanding(nextDoc: HandoffNoteDoc, probeIndex: number): number {
  const remaining = listEmbeddedBlankBandProbeWires(nextDoc);
  if (probeIndex < remaining.length) {
    return remaining[probeIndex]!;
  }
  const wire = docToWire(nextDoc);
  const substantiveStart = embeddedBlankBandSubstantiveContentStartWire(nextDoc);
  if (substantiveStart > 0 && wire[0] === "\n") {
    return 0;
  }
  return substantiveStart;
}

function isSubstantiveLineStart(wire: string, start: number): boolean {
  const lineEnd = wire.indexOf("\n", start);
  const segment = wire.slice(start, lineEnd === -1 ? wire.length : lineEnd);
  return segment.length > 0 && /\S/.test(segment);
}

/** Visual row anchors: line starts plus one probe wire per empty visual row. */
export function listVisualRowAnchorWires(doc: HandoffNoteDoc): number[] {
  const wire = docToWire(doc);
  const probeList = listEmbeddedBlankBandProbeWires(doc);
  if (probeList.length === 0) {
    return wireLineStartOffsets(wire);
  }
  const probes = new Set(probeList);
  const anchors: number[] = [0];
  for (const probe of probeList) {
    anchors.push(probe);
  }
  for (const start of wireLineStartOffsets(wire)) {
    if (start === 0 || probes.has(start)) {
      continue;
    }
    if (!isSubstantiveLineStart(wire, start)) {
      continue;
    }
    if (!anchors.includes(start)) {
      anchors.push(start);
    }
  }
  return anchors.sort((left, right) => left - right);
}

/** Blank probe on the same paint band as content above — storage `\n` before the next substantive row. */
export function isInlineSuffixBlankProbeWire(doc: HandoffNoteDoc, probeWire: number): boolean {
  const wire = docToWire(doc);
  const lineStart = wire.lastIndexOf("\n", probeWire - 1) + 1;
  const beforeBreak = wire.slice(lineStart, probeWire);
  if (beforeBreak.length === 0 || /^\s*$/.test(beforeBreak)) {
    return false;
  }
  const afterBreak = wire.slice(probeWire + 1);
  const nextNewline = afterBreak.indexOf("\n");
  const nextSegment = nextNewline === -1 ? afterBreak : afterBreak.slice(0, nextNewline);
  return nextSegment.length > 0 && /\S/.test(nextSegment);
}

/** Wire offsets where the caret rests on an embedded `\n` blank band. */
export function listEmbeddedBlankBandProbeWires(doc: HandoffNoteDoc): number[] {
  const wire = docToWire(doc);
  const parts = wire.split("\n");
  const probes: number[] = [];
  let wireOffset = 0;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index]!;
    const nextPart = parts[index + 1]!;
    const newlineOffset = wireOffset + part.length;
    wireOffset = newlineOffset + 1;
    if (isBlankBandSegment(nextPart)) {
      probes.push(newlineOffset);
    }
  }
  return probes;
}

export function docTextNodeHasEmbeddedNewline(doc: HandoffNoteDoc, nodeIndex: number): boolean {
  const node = doc.nodes[nodeIndex];
  return node?.type === "text" && node.text.includes("\n");
}

export function isEmbeddedBlankBandProbeWire(doc: HandoffNoteDoc, wire: number): boolean {
  return listEmbeddedBlankBandProbeWires(doc).includes(wire);
}

/** Typing at a blank-band probe wire rests on the `\n`; insert after it, not before. */
export function insertDocPosAfterEmbeddedBlankProbe(
  doc: HandoffNoteDoc,
  pos: { nodeIndex: number; nodeOffset: number }
): { nodeIndex: number; nodeOffset: number } {
  const wire = offsetAtDocPosition(doc, pos.nodeIndex, pos.nodeOffset);
  if (!isEmbeddedBlankBandProbeWire(doc, wire)) {
    return pos;
  }
  const node = doc.nodes[pos.nodeIndex];
  if (node?.type !== "text") {
    return pos;
  }
  return {
    nodeIndex: pos.nodeIndex,
    nodeOffset: Math.min(pos.nodeOffset + 1, node.text.length),
  };
}

/** Text-led lower visual row after an embedded blank band (exit `\n` through line end). */
export type EmbeddedTextLedLowerRowSpan = {
  exitNewlineWire: number;
  lineStartWire: number;
  lineEndWire: number;
};

export function embeddedTextLedLowerRowSpanAfterBlankBand(
  doc: HandoffNoteDoc
): EmbeddedTextLedLowerRowSpan | null {
  const text = docToWire(doc);
  const probes = listEmbeddedBlankBandProbeWires(doc);
  if (probes.length === 0) {
    return null;
  }

  const searchFrom = probes[probes.length - 1]! + 1;
  for (let wire = searchFrom; wire < text.length; wire++) {
    if (text[wire] !== "\n") {
      continue;
    }
    if (isEmbeddedBlankBandProbeWire(doc, wire)) {
      continue;
    }
    const lineEnd = text.indexOf("\n", wire + 1);
    const segment = text.slice(wire + 1, lineEnd === -1 ? text.length : lineEnd);
    if (segment.length === 0 || !/\S/.test(segment) || segment[0] === "@") {
      continue;
    }
    return {
      exitNewlineWire: wire,
      lineStartWire: wire + 1,
      lineEndWire: lineEnd === -1 ? text.length : lineEnd,
    };
  }
  return null;
}

export function isWireOnEmbeddedTextLedLowerRowAfterBlankBand(
  doc: HandoffNoteDoc,
  wire: number
): boolean {
  const span = embeddedTextLedLowerRowSpanAfterBlankBand(doc);
  if (!span) {
    return false;
  }
  return wire >= span.exitNewlineWire && wire < span.lineEndWire;
}

/** Backspace/delete at blank-band probe wires — caret policy plus wire splice. */
export function resolveEmbeddedBlankBandDelete(
  doc: HandoffNoteDoc,
  focusWire: number,
  direction: HandoffNoteEdit
): EmbeddedBlankBandDeleteMove | null {
  if (!isEmbeddedBlankBandProbeWire(doc, focusWire)) {
    return null;
  }

  const probes = listEmbeddedBlankBandProbeWires(doc);
  const probeIndex = probes.indexOf(focusWire);
  if (probeIndex < 0) {
    return null;
  }

  const wire = docToWire(doc);

  if (direction === "backspace") {
    if (probeIndex === 0 && embeddedBlankBandHasSubstantiveContentAboveBand(wire, probes)) {
      const rowEnd = focusWire - 1;
      return { doc, caretWire: rowEnd, branch: "backspace-content-above" };
    }

    const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
    return {
      doc: nextDoc,
      caretWire: collapseBlankBandBackspaceLanding(nextDoc, probeIndex),
      branch: probeIndex === 0 ? "backspace-collapse-empty-above" : "backspace-blank-above",
    };
  }

  if (focusWire + 1 >= wire.length) {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  if (probeIndex < probes.length - 1) {
    return {
      doc: nextDoc,
      caretWire: collapseBlankBandDeleteLanding(nextDoc, probeIndex),
      branch: "delete-blank-below",
    };
  }

  if (!embeddedBlankBandHasSubstantiveContentAboveBand(wire, probes)) {
    return {
      doc: nextDoc,
      caretWire: collapseBlankBandDeleteLanding(nextDoc, probeIndex),
      branch: "delete-lower-row",
    };
  }

  const span = embeddedTextLedLowerRowSpanAfterBlankBand(nextDoc);
  const caretWire = span?.lineStartWire ?? embeddedBlankBandSubstantiveContentStartWire(nextDoc);

  return {
    doc: nextDoc,
    caretWire,
    branch: "delete-lower-row",
  };
}

/** Backspace on trailing row content immediately before a blank-band probe. */
export function resolveBackspaceBeforeEmbeddedBlankProbe(
  doc: HandoffNoteDoc,
  focusWire: number
): EmbeddedBlankBandDeleteMove | null {
  const wire = docToWire(doc);
  if (focusWire < 0 || focusWire + 1 >= wire.length) {
    return null;
  }
  if (!isEmbeddedBlankBandProbeWire(doc, focusWire + 1)) {
    return null;
  }
  if (wire[focusWire] === "\n") {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  return {
    doc: nextDoc,
    caretWire: Math.max(0, focusWire - 1),
    branch: "backspace-content-above",
  };
}

/**
 * Backspace on a line-start `\n` before substantive content when every segment above is empty.
 * Not a blank-band probe — same collapse landing as blank-band ladder exhaustion.
 */
export function resolveEmbeddedBlankBandLineStartCollapse(
  doc: HandoffNoteDoc,
  focusWire: number
): EmbeddedBlankBandDeleteMove | null {
  if (isEmbeddedBlankBandProbeWire(doc, focusWire)) {
    return null;
  }
  const wire = docToWire(doc);
  if (focusWire < 0 || focusWire >= wire.length || wire[focusWire] !== "\n") {
    return null;
  }
  const lineStart = focusWire <= 0 ? 0 : wire.lastIndexOf("\n", focusWire - 1) + 1;
  const segmentAbove = wire.slice(lineStart, focusWire);
  if (segmentAbove.length > 0 && /\S/.test(segmentAbove)) {
    return null;
  }
  const afterBreak = wire.slice(focusWire + 1);
  const nextLineEnd = afterBreak.indexOf("\n");
  const nextSegment = nextLineEnd === -1 ? afterBreak : afterBreak.slice(0, nextLineEnd);
  if (nextSegment.length === 0 || !/\S/.test(nextSegment)) {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  return {
    doc: nextDoc,
    caretWire: embeddedBlankBandSubstantiveContentStartWire(nextDoc),
    branch: "backspace-line-start-collapse",
  };
}
