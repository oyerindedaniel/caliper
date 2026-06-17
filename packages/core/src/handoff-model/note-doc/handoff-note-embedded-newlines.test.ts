import { describe, expect, it } from "vitest";
import {
  docTextNodeHasEmbeddedNewline,
  isEmbeddedBlankBandProbeWire,
  listEmbeddedBlankBandProbeWires,
  listVisualRowAnchorWires,
} from "./handoff-note-embedded-newlines.js";
import { docToWire, wireToDoc } from "./handoff-note-doc.js";

describe("embedded blank band probes", () => {
  it("lists one probe for header blank tail storage (header\\n\\ntail)", () => {
    const doc = wireToDoc("header\n\ntail");
    expect(listEmbeddedBlankBandProbeWires(doc)).toEqual([6]);
    expect(isEmbeddedBlankBandProbeWire(doc, 7)).toBe(false);
  });

  it("lists two probes for two empty segments before substantive tail", () => {
    const doc = wireToDoc("header\n\n\ntail");
    expect(listEmbeddedBlankBandProbeWires(doc)).toEqual([6, 7]);
  });

  it("lists mention-adjacent suffix blank probes for one empty segment", () => {
    const doc = wireToDoc(`row @caliper-aaaaaaa \n\n tail`);
    const probes = listEmbeddedBlankBandProbeWires(doc);
    expect(probes).toEqual([docToWire(doc).indexOf("\n")]);
    expect(probes.every((wire) => isEmbeddedBlankBandProbeWire(doc, wire))).toBe(true);
  });

  it("does not treat substantive wire-line breaks as blank band probes", () => {
    const doc = wireToDoc("header tail\nline1\nline2");
    const newlineWires = [...docToWireIndices(doc, "\n")];
    expect(newlineWires.length).toBe(2);
    for (const wire of newlineWires) {
      expect(isEmbeddedBlankBandProbeWire(doc, wire)).toBe(false);
    }
    expect(listEmbeddedBlankBandProbeWires(doc)).toEqual([]);
  });

  it("detects embedded newlines in text nodes", () => {
    const doc = wireToDoc(`row @caliper-aaaaaaa \n\n tail`);
    expect(docTextNodeHasEmbeddedNewline(doc, 0)).toBe(false);
    expect(docTextNodeHasEmbeddedNewline(doc, 2)).toBe(true);
  });

  it("lists visual row anchors for header blank tail storage", () => {
    const doc = wireToDoc("header\n\ntail");
    expect(listVisualRowAnchorWires(doc)).toEqual([0, 6, 8]);
  });

  it("lists EOF trailing blank probes for consecutive Shift+Enter suffix", () => {
    const doc = wireToDoc("content\n\n");
    expect(listEmbeddedBlankBandProbeWires(doc)).toEqual([7, 8]);
  });
});

function docToWireIndices(doc: ReturnType<typeof wireToDoc>, char: string): number[] {
  const wire = docToWire(doc);
  const indices: number[] = [];
  for (let index = 0; index < wire.length; index++) {
    if (wire[index] === char) {
      indices.push(index);
    }
  }
  return indices;
}
