import { describe, expect, it } from "vitest";
import { docToWire, wireToDoc } from "./handoff-note-doc.js";
import { docPosToWireOffset, wireOffsetToDocPos } from "./handoff-note-doc-pos.js";
import {
  docTextNodeHasEmbeddedNewline,
  docPosAtEmbeddedBlankBandProbeAliasLanding,
  docPosAtSandwichedRowMentionGate,
  embeddedBlankBandAtEmptyContentRowEnd,
  embeddedBlankBandContentRowEndBeforeProbe,
  embeddedBlankBandSubstantiveContentAbutsProbe,
  embeddedTextLedLowerRowSpanAfterBlankBand,
  insertDocPosAfterEmbeddedBlankProbe,
  isEmbeddedBlankBandDeleteProbeWire,
  isEmbeddedBlankBandProbeWire,
  isWireOnEmbeddedTextLedLowerRowAfterBlankBand,
  listEmbeddedBlankBandGroups,
  listEmbeddedBlankBandProbeWires,
  listVisualRowAnchorWires,
} from "./handoff-note-embedded-newlines.js";

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

  it("shifts insert doc pos to after the probe newline", () => {
    const doc = wireToDoc("header\n\n\ntail");
    const probe = listEmbeddedBlankBandProbeWires(doc)[1]!;
    const atProbe = { nodeIndex: 0, nodeOffset: probe };
    const insertPos = insertDocPosAfterEmbeddedBlankProbe(doc, atProbe);
    expect(insertPos.nodeOffset).toBe(probe + 1);
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

  it("detects text-led lower row span after embedded blank band", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header @${agent} \n\n\nlower @${agent} `;
    const doc = wireToDoc(wire);
    const lowerStart = wire.indexOf("lower");

    expect(embeddedTextLedLowerRowSpanAfterBlankBand(doc)).toEqual({
      exitNewlineWire: lowerStart - 1,
      lineStartWire: lowerStart,
      lineEndWire: wire.length,
    });
    expect(isWireOnEmbeddedTextLedLowerRowAfterBlankBand(doc, lowerStart - 1)).toBe(true);
    expect(isWireOnEmbeddedTextLedLowerRowAfterBlankBand(doc, lowerStart)).toBe(true);
  });

  it("does not treat mention-led lower row after blank band as text-led span", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header @${agent} \n\n\n@${agent} `;
    const doc = wireToDoc(wire);

    expect(embeddedTextLedLowerRowSpanAfterBlankBand(doc)).toBeNull();
  });

  it("splits probe runs into bands separated by substantive wire rows", () => {
    const wire = `header \n\n\nmiddle\n\n\nlower`;
    const doc = wireToDoc(wire);
    const groups = listEmbeddedBlankBandGroups(doc);
    const probes = listEmbeddedBlankBandProbeWires(doc);
    const middleStart = wire.indexOf("middle");
    const lowerStart = wire.indexOf("lower");

    expect(groups).toHaveLength(2);
    expect(groups[0]!.probes).toEqual(probes.filter((probe) => probe < middleStart));
    expect(groups[1]!.probes).toEqual(
      probes.filter((probe) => probe > middleStart && probe < lowerStart)
    );
  });

  describe("empty content row end", () => {
    it("is true at band head with another blank below when caret semantic or structural match", () => {
      const doc = wireToDoc(`\n\n\ntail`);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, 0)).toBe(true);
      expect(isEmbeddedBlankBandDeleteProbeWire(doc, 0)).toBe(false);
    });

    it("is true for chip landing via caret semantic even on interior probe index", () => {
      const doc = wireToDoc(`header \n\n\nmiddle\n\n\n\n\nlower`);
      const interiorProbe = listEmbeddedBlankBandProbeWires(doc)[4]!;
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, interiorProbe)).toBe(false);
      expect(
        embeddedBlankBandAtEmptyContentRowEnd(doc, interiorProbe, {
          chipBeforeBlankBand: true,
        })
      ).toBe(true);
      expect(
        isEmbeddedBlankBandDeleteProbeWire(doc, interiorProbe, {
          chipBeforeBlankBand: true,
        })
      ).toBe(false);
    });

    it("is true for prefix-only lone leading blank with no substantive tail", () => {
      const doc = wireToDoc(`\n`);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, 0)).toBe(true);
      expect(isEmbeddedBlankBandDeleteProbeWire(doc, 0)).toBe(false);
    });

    it("is true at prefix-only band head when one blank remains before substantive tail", () => {
      const doc = wireToDoc(`\n\ntail`);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, 0)).toBe(true);
      expect(isEmbeddedBlankBandDeleteProbeWire(doc, 0)).toBe(false);
    });

    it("is false on sandwiched blank visual rows without caret semantic", () => {
      const doc = wireToDoc(`header\n\n\ntail`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, probe)).toBe(false);
      expect(isEmbeddedBlankBandDeleteProbeWire(doc, probe)).toBe(true);
    });

    it("is false when substantive row text still abuts the probe on delete infrastructure", () => {
      const doc = wireToDoc(`ab\n\n`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const focus = wireOffsetToDocPos(doc, probe);
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)).toBe(true);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, probe, undefined, focus)).toBe(false);
      expect(isEmbeddedBlankBandDeleteProbeWire(doc, probe, undefined, focus)).toBe(true);
    });
  });

  describe("embeddedBlankBandContentRowEndBeforeProbe", () => {
    it("returns plain text row end unchanged", () => {
      const doc = wireToDoc(`header\n\n\ntail`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(embeddedBlankBandContentRowEndBeforeProbe(doc, probe)).toBe(probe - 1);
    });

    it("sole substantive char lands after the char not visual start", () => {
      const doc = wireToDoc(`d\n\n`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(probe).toBe(1);
      expect(embeddedBlankBandContentRowEndBeforeProbe(doc, probe)).toBe(probe);
    });

    it("snaps mention-interior physical end to mention-end wire", () => {
      const agent = "caliper-aaaaaaa";
      const doc = wireToDoc(`header @${agent}\n\n\n`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const mentionEnd = `header @${agent}`.length;
      expect(probe - 1).toBeLessThan(mentionEnd);
      expect(embeddedBlankBandContentRowEndBeforeProbe(doc, probe)).toBe(mentionEnd);
    });
  });

  describe("probe-alias after whitespace chip", () => {
    const agent = "caliper-abc123";

    function chippedDocAfterSpacer(wireWithSpacer: string) {
      return wireToDoc(wireWithSpacer.replace(/ \n/, "\n"));
    }

    it("prefix + mention row — substantive abuts probe and alias lands content row end", () => {
      const doc = chippedDocAfterSpacer(`header header @${agent} \n\n\n`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)).toBe(true);
      const landing = docPosAtEmbeddedBlankBandProbeAliasLanding(doc, probe)!;
      expect(docPosToWireOffset(doc, landing)).toBe(
        embeddedBlankBandContentRowEndBeforeProbe(doc, probe)
      );
    });

    it("mention-only row — substantive abuts probe and alias lands mention-end", () => {
      const doc = chippedDocAfterSpacer(`@${agent} \n\n\n`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)).toBe(true);
      const landing = docPosAtEmbeddedBlankBandProbeAliasLanding(doc, probe)!;
      expect(docPosToWireOffset(doc, landing)).toBe(`@${agent}`.length);
    });

    it("plain text tail — substantive abuts probe and alias lands row tail", () => {
      const doc = chippedDocAfterSpacer(`tail \n\n\n`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)).toBe(true);
      const landing = docPosAtEmbeddedBlankBandProbeAliasLanding(doc, probe)!;
      expect(docPosToWireOffset(doc, landing)).toBe(`tail`.length - 1);
    });
  });

  describe("sandwiched row mention gate", () => {
    const agentA = "caliper-abc123";

    function sandwichedMentionOnlyRowWire() {
      return `header @${agentA} row\n\n @${agentA} \nlower`;
    }

    function mentionStartOnSandwichedRow(wire: string): number {
      const probes = listEmbeddedBlankBandProbeWires(wireToDoc(wire));
      let rowStart = probes[0]! + 1;
      while (wire[rowStart] === "\n") {
        rowStart += 1;
      }
      return wire.indexOf("@", rowStart);
    }

    it("returns text tail when mention starts sandwiched row below blank band", () => {
      const wire = sandwichedMentionOnlyRowWire().replace(" @", "@");
      const doc = wireToDoc(wire);
      const mentionStart = mentionStartOnSandwichedRow(wire);
      const gate = docPosAtSandwichedRowMentionGate(doc, mentionStart);
      expect(gate).not.toBeNull();
      expect(doc.nodes[gate!.nodeIndex]?.type).toBe("text");
      expect(docPosToWireOffset(doc, gate!)).toBe(mentionStart);
    });

    it("returns null when substantive prefix remains on sandwiched row", () => {
      const wire = `header @${agentA} row\n\n tail @${agentA} \nlower`;
      const doc = wireToDoc(wire);
      const mentionStart = mentionStartOnSandwichedRow(wire);
      expect(docPosAtSandwichedRowMentionGate(doc, mentionStart)).toBeNull();
    });
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
