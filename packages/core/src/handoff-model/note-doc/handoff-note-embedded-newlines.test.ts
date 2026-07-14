import { describe, expect, it } from "vitest";
import { applyDocDelete, applyDocLineBreak } from "./handoff-note-doc-edits.js";
import {
  collapsedSelection,
  docPosToWireOffset,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import { docToWire, wireToDoc } from "./handoff-note-doc.js";
import {
  docTextNodeHasEmbeddedNewline,
  docPosAtEmbeddedBlankBandProbeAliasLanding,
  docPosAtAtomicStartTextAlias,
  mentionStartGluedToPrefixInWire,
  embeddedBlankBandAtEmptyContentRowEnd,
  embeddedBlankBandContentRowEndBeforeProbe,
  embeddedBlankBandSubstantiveContentAbutsProbe,
  handoffNoteCaretAtClearedContentRowEndBeforeProbe,
  embeddedTextLedLowerRowSpanAfterBlankBand,
  insertDocPosAfterEmbeddedBlankProbe,
  isEmbeddedBlankBandDeleteProbeWire,
  isEmbeddedBlankBandProbeWire,
  isWireOnEmbeddedTextLedLowerRowAfterBlankBand,
  listEmbeddedBlankBandGroups,
  listEmbeddedBlankBandProbeWires,
  listVisualRowAnchorWires,
  resolveSubstantiveLineBreakJoin,
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

    it("is true when focus doc pos is cleared content row end before interior probe", () => {
      const wire = `header \n\n\nmiddle\n\n\nd\n\n\nlower`;
      const doc = wireToDoc(wire);
      const dPos = wire.indexOf("\nd\n", wire.indexOf("middle")) + 1;
      const focus = wireOffsetToDocPos(doc, dPos);
      const chipped = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      const clearedRowProbe = listEmbeddedBlankBandProbeWires(chipped.doc).find((blankBandProbe) =>
        handoffNoteCaretAtClearedContentRowEndBeforeProbe(
          chipped.doc,
          chipped.selection.focus,
          blankBandProbe
        )
      );
      expect(clearedRowProbe).toBeDefined();
      expect(
        embeddedBlankBandAtEmptyContentRowEnd(
          chipped.doc,
          clearedRowProbe!,
          chipped.selection.focus
        )
      ).toBe(true);
      expect(
        isEmbeddedBlankBandDeleteProbeWire(chipped.doc, clearedRowProbe!, chipped.selection.focus)
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
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, probe, focus)).toBe(false);
      expect(isEmbeddedBlankBandDeleteProbeWire(doc, probe, focus)).toBe(true);
    });

    it("is false on interior band tail probe even when focus rests on lineStart alias", () => {
      const agent = "agent";
      const doc = wireToDoc(`header @${agent} \n\n\ntail @${agent} `);
      const tailProbe = listEmbeddedBlankBandProbeWires(doc)[1]!;
      const focus = wireOffsetToDocPos(doc, tailProbe);
      expect(handoffNoteCaretAtClearedContentRowEndBeforeProbe(doc, focus, tailProbe)).toBe(false);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, tailProbe, focus)).toBe(false);
      expect(isEmbeddedBlankBandDeleteProbeWire(doc, tailProbe, focus)).toBe(true);
    });

    it("is false on EOF trailing band tail probe with focus at lineStart", () => {
      let doc = wireToDoc("header");
      let selection = collapsedSelection(wireOffsetToDocPos(doc, "header".length));
      for (let i = 0; i < 2; i++) {
        const next = applyDocLineBreak(doc, selection);
        doc = next.doc;
        selection = next.selection;
      }
      const tailProbe = listEmbeddedBlankBandProbeWires(doc)[1]!;
      const focus = wireOffsetToDocPos(doc, tailProbe);
      expect(handoffNoteCaretAtClearedContentRowEndBeforeProbe(doc, focus, tailProbe)).toBe(false);
      expect(isEmbeddedBlankBandDeleteProbeWire(doc, tailProbe, focus)).toBe(true);
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

  describe("mention start text alias", () => {
    const agent = "caliper-abc123";

    function mentionStartOnSandwichedRow(wire: string) {
      const probes = listEmbeddedBlankBandProbeWires(wireToDoc(wire));
      let rowStart = probes[0]! + 1;
      while (wire[rowStart] === "\n") {
        rowStart += 1;
      }
      return wire.indexOf("@", rowStart);
    }

    function sandwichedMentionOnlyRowWire() {
      return `header @${agent} row\n\n @${agent} \nlower`;
    }

    it("returns text tail for prefix row below blank band", () => {
      const doc = wireToDoc(`head\n\nte @${agent} tail`);
      const mentionAt = docToWire(doc).indexOf("@");
      const alias = docPosAtAtomicStartTextAlias(doc, mentionAt);
      expect(alias).not.toBeNull();
      expect(doc.nodes[alias!.nodeIndex]?.type).toBe("text");
      expect(docPosToWireOffset(doc, alias!)).toBe(mentionAt);
    });

    it("returns text tail when mention-only row starts below blank band", () => {
      const wire = sandwichedMentionOnlyRowWire().replace(" @", "@");
      const doc = wireToDoc(wire);
      const mentionStart = mentionStartOnSandwichedRow(wire);
      const alias = docPosAtAtomicStartTextAlias(doc, mentionStart);
      expect(alias).not.toBeNull();
      expect(doc.nodes[alias!.nodeIndex]?.type).toBe("text");
      expect(docPosToWireOffset(doc, alias!)).toBe(mentionStart);
    });

    it("returns text tail when sandwiched row has substantive prefix before mention", () => {
      const wire = `header @${agent} row\n\n tail @${agent} \nlower`;
      const doc = wireToDoc(wire);
      const mentionStart = mentionStartOnSandwichedRow(wire);
      const alias = docPosAtAtomicStartTextAlias(doc, mentionStart);
      expect(alias).not.toBeNull();
      expect(doc.nodes[alias!.nodeIndex]?.type).toBe("text");
      expect(docPosToWireOffset(doc, alias!)).toBe(mentionStart);
    });
  });

  describe("mentionStartGluedToPrefixInWire", () => {
    const agent = "caliper-abc123";

    it("is true when chip ladder consumed the pre-mention spacer", () => {
      const doc = wireToDoc(`head\n\nte@${agent} `);
      const mentionAt = docToWire(doc).indexOf("@", docToWire(doc).indexOf("\n\n") + 2);
      expect(mentionStartGluedToPrefixInWire(doc, mentionAt)).toBe(true);
    });

    it("is false when pre-mention spacer remains before atomic remove", () => {
      const doc = wireToDoc(`header @${agent} \n\n\n`);
      const mentionAt = docToWire(doc).indexOf("@");
      expect(mentionStartGluedToPrefixInWire(doc, mentionAt)).toBe(false);
    });
  });

  describe("substantive line-break join", () => {
    it("delete on break wire merges populated rows", () => {
      const doc = wireToDoc("upper\nx");
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, "upper".length)),
        "delete"
      )!;

      expect(docToWire(result.doc)).toBe("upperx");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe("upper".length);
    });

    it("backspace at lower row visual start merges populated rows", () => {
      const doc = wireToDoc("upper\nx");
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, "upper\n".length)),
        "backspace"
      )!;

      expect(docToWire(result.doc)).toBe("upperx");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe("upper".length);
    });

    it("does not treat blank-band break as substantive join", () => {
      const doc = wireToDoc("upper\n\nx");
      expect(resolveSubstantiveLineBreakJoin(doc, "upper\n".length + 1, "backspace")).toBeNull();
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
