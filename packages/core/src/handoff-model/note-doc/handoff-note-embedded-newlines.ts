import { docToWire, type HandoffNoteDoc } from "./handoff-note-doc.js";

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

function isSubstantiveWireLineSegmentAt(wire: string, lineStart: number): boolean {
  if (lineStart >= wire.length) {
    return false;
  }
  const lineEnd = wire.indexOf("\n", lineStart);
  const segment = wire.slice(lineStart, lineEnd === -1 ? wire.length : lineEnd);
  return segment.length > 0 && /\S/.test(segment);
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

export function isEmbeddedNewlineProbeWire(doc: HandoffNoteDoc, wire: number): boolean {
  const docWire = docToWire(doc);
  return wire >= 0 && wire < docWire.length && docWire[wire] === "\n";
}

export function isEmbeddedBlankBandProbeWire(doc: HandoffNoteDoc, wire: number): boolean {
  return listEmbeddedBlankBandProbeWires(doc).includes(wire);
}
