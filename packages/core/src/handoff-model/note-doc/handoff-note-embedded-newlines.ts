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
    if (probeIndex === 0) {
      const rowEnd = focusWire - 1;
      if (rowEnd < 0) {
        return null;
      }
      return { doc, caretWire: rowEnd, branch: "backspace-content-above" };
    }

    const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
    const remaining = listEmbeddedBlankBandProbeWires(nextDoc);
    return {
      doc: nextDoc,
      caretWire: remaining[probeIndex - 1]!,
      branch: "backspace-blank-above",
    };
  }

  if (focusWire + 1 >= wire.length) {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  if (probeIndex < probes.length - 1) {
    const remaining = listEmbeddedBlankBandProbeWires(nextDoc);
    return {
      doc: nextDoc,
      caretWire: remaining[probeIndex]!,
      branch: "delete-blank-below",
    };
  }

  const resultWire = docToWire(nextDoc);
  const span = embeddedTextLedLowerRowSpanAfterBlankBand(nextDoc);
  let caretWire = span?.lineStartWire ?? focusWire;
  if (!span) {
    while (caretWire < resultWire.length && resultWire[caretWire] === "\n") {
      caretWire += 1;
    }
  }

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
