import { describe, expect, it } from "vitest";
import { applyDocDelete, applyDocInsertText, applyDocLineBreak } from "./handoff-note-doc-edits.js";
import {
  collapsedSelection,
  collapsedSelectionWithIntent,
  docPosToWireOffset,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import { docToWire, wireToDoc } from "./handoff-note-doc.js";
import {
  docTextNodeHasEmbeddedNewline,
  docPosAfterContentRowChipBeforeProbe,
  docPosAtAtomicStartTextAlias,
  embeddedBlankBandAtEmptyContentRowEnd,
  embeddedBlankBandContentRowEndBeforeProbe,
  embeddedBlankBandSubstantiveContentAbutsProbe,
  embeddedBlankBandProbeEmitsBlankAnchor,
  embeddedBlankBandProbePaintsBareWireBreak,
  handoffNoteCaretAtEmptyContentRowEndDock,
  embeddedTextLedLowerRowSpanAfterBlankBand,
  insertDocPosAfterEmbeddedBlankProbe,
  resolveDeleteFromEmptyContentRowEnd,
  isEmbeddedBlankBandCollapseProbeWire,
  isEmbeddedBlankBandProbeWire,
  isTrailingNewlinePastEndWire,
  isWireOnEmbeddedTextLedLowerRowAfterBlankBand,
  listEmbeddedBlankBandGroups,
  listEmbeddedBlankBandProbeWires,
  listBlankVisualLineStartWires,
  listVisualRowAnchorWires,
  resolveEmbeddedBlankBandLineStartCollapse,
  resolveSubstantiveLineBreakJoin,
} from "./handoff-note-embedded-newlines.js";

describe("embedded blank band probes", () => {
  it("blank visual line starts: empty line-start lattice (not probe alias)", () => {
    expect(listBlankVisualLineStartWires(wireToDoc(""))).toEqual([0]);
    expect(listBlankVisualLineStartWires(wireToDoc("\n"))).toEqual([0, 1]);
    expect(listBlankVisualLineStartWires(wireToDoc("\n\n\n\n"))).toEqual([0, 1, 2, 3, 4]);
    // Content then two empty lines: stops at empty line-starts 7 and 8 (not content `\n` at 6).
    expect(listBlankVisualLineStartWires(wireToDoc("header\n\n"))).toEqual([7, 8]);
    expect(listBlankVisualLineStartWires(wireToDoc("\nheader\n"))).toEqual([0, 8]);
    expect(listBlankVisualLineStartWires(wireToDoc("header\n\ntail"))).toEqual([7]);
  });

  it("lists visual row anchors including blank-only document-end stop", () => {
    expect(listVisualRowAnchorWires(wireToDoc("\n\n\n\n"))).toEqual([0, 1, 2, 3, 4]);
  });

  it("lists two probes for two empty segments before substantive tail", () => {
    const doc = wireToDoc("header\n\n\ntail");
    expect(listEmbeddedBlankBandProbeWires(doc)).toEqual([6, 7]);
  });

  it("shifts insert doc pos to after the probe newline", () => {
    const doc = wireToDoc("header\n\n\ntail");
    // First probe dock only — shared stop≡probe wires must not step (see stop insert test below).
    const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
    expect(listBlankVisualLineStartWires(doc).includes(probe)).toBe(false);
    const atProbe = { nodeIndex: 0, nodeOffset: probe };
    const insertPos = insertDocPosAfterEmbeddedBlankProbe(doc, atProbe);
    expect(insertPos.nodeOffset).toBe(probe + 1);
  });

  it("insert at blank visual line-start stop does not step after probe", () => {
    const doc = wireToDoc("header\n\n\ntail");
    const [firstBlankStop] = listBlankVisualLineStartWires(doc);
    expect(listEmbeddedBlankBandProbeWires(doc).includes(firstBlankStop!)).toBe(true);
    const atStop = { nodeIndex: 0, nodeOffset: firstBlankStop! };
    const insertPos = insertDocPosAfterEmbeddedBlankProbe(doc, atStop);
    expect(insertPos.nodeOffset).toBe(firstBlankStop);
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

  it("does not treat whitespace-only segments as blank band probes", () => {
    const doc = wireToDoc("a\n   \nb");
    expect(listEmbeddedBlankBandProbeWires(doc)).toEqual([]);
    expect(isEmbeddedBlankBandProbeWire(doc, 1)).toBe(false);
  });

  it("space-filled blank demotes that probe; empty blank above remains", () => {
    const base = wireToDoc("dh\n\n\nmen");
    expect(listEmbeddedBlankBandProbeWires(base)).toEqual([2, 3]);
    const [, secondBlank] = listBlankVisualLineStartWires(base);
    const filled = applyDocInsertText(
      base,
      collapsedSelection(wireOffsetToDocPos(base, secondBlank!)),
      "      "
    );
    expect(docToWire(filled.doc)).toBe("dh\n\n      \nmen");
    expect(listEmbeddedBlankBandProbeWires(filled.doc)).toEqual([2]);
    // Filled row is not probe storage; remaining empty blank above stays a probe wire.
    expect(isEmbeddedBlankBandProbeWire(filled.doc, 3)).toBe(false);
    expect(isEmbeddedBlankBandProbeWire(filled.doc, 2)).toBe(true);
    // Probe-infra focus at band-head under content is CRE meaning, not delete-probe.
    expect(
      isEmbeddedBlankBandCollapseProbeWire(filled.doc, 2, wireOffsetToDocPos(filled.doc, 2))
    ).toBe(false);
  });

  it("detects embedded newlines in text nodes", () => {
    const doc = wireToDoc(`row @caliper-aaaaaaa \n\n tail`);
    expect(docTextNodeHasEmbeddedNewline(doc, 0)).toBe(false);
    expect(docTextNodeHasEmbeddedNewline(doc, 2)).toBe(true);
  });

  it("lists visual row anchors for header blank tail storage", () => {
    const doc = wireToDoc("header\n\ntail");
    expect(listVisualRowAnchorWires(doc)).toEqual([0, 7, 8]);
  });

  it("lists EOF trailing blank probes for consecutive Shift+Enter suffix", () => {
    const doc = wireToDoc("content\n\n");
    expect(listEmbeddedBlankBandProbeWires(doc)).toEqual([7, 8]);
  });

  it("marks caret at document end after trailing newline", () => {
    expect(isTrailingNewlinePastEndWire("header\n\n", "header\n\n".length)).toBe(true);
    expect(isTrailingNewlinePastEndWire("header", "header".length)).toBe(false);
    expect(isTrailingNewlinePastEndWire("", 0)).toBe(false);
    expect(isTrailingNewlinePastEndWire("header\n\n", 7)).toBe(false);
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
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, 0, wireOffsetToDocPos(doc, 0))).toBe(false);
    });

    it("is true when focus doc pos is cleared content row end before interior probe", () => {
      const wire = `header \n\n\nmiddle\n\n\nd\n\n\nlower`;
      const doc = wireToDoc(wire);
      const dPos = wire.indexOf("\nd\n", wire.indexOf("middle")) + 1;
      const focus = wireOffsetToDocPos(doc, dPos);
      // Visual start (omit): unit behind is the blank above — not sole `d`.
      const nippedBlank = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      expect(docToWire(nippedBlank.doc)).toBe("header \n\n\nmiddle\n\nd\n\n\nlower");
      // CRE (`after`): unit behind is `d` — lands cleared content row end.
      const chipped = applyDocDelete(doc, collapsedSelection(focus, "after"), "backspace")!;
      expect(docToWire(chipped.doc)).toBe("header \n\n\nmiddle\n\n\n\n\n\nlower");
      const clearedRowProbe = listEmbeddedBlankBandProbeWires(chipped.doc).find((blankBandProbe) =>
        handoffNoteCaretAtEmptyContentRowEndDock(
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
        isEmbeddedBlankBandCollapseProbeWire(chipped.doc, clearedRowProbe!, chipped.selection.focus)
      ).toBe(false);
    });

    it("is true for prefix-only lone leading blank with no substantive tail", () => {
      const doc = wireToDoc(`\n`);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, 0)).toBe(true);
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, 0, wireOffsetToDocPos(doc, 0))).toBe(false);
    });

    it("is true at prefix-only band head when one blank remains before substantive tail", () => {
      const doc = wireToDoc(`\n\ntail`);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, 0)).toBe(true);
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, 0, wireOffsetToDocPos(doc, 0))).toBe(false);
    });

    it("band-head probe-infra focus is CRE; interior mid stays delete-probe", () => {
      const doc = wireToDoc(`header\n\n\ntail`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, probe)).toBe(false);
      // Topology alone is not CRE; probe-infra focus at band-head is.
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, probe, wireOffsetToDocPos(doc, probe))).toBe(
        false
      );
      const mid = listEmbeddedBlankBandProbeWires(doc)[1]!;
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, mid, wireOffsetToDocPos(doc, mid))).toBe(
        true
      );
    });

    it("is true on leading blank under content with probe-infra focus (click = chip)", () => {
      const doc = wireToDoc(`header\n\n\ntail`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const focus = wireOffsetToDocPos(doc, probe);
      expect(handoffNoteCaretAtEmptyContentRowEndDock(doc, focus, probe)).toBe(true);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, probe, focus)).toBe(true);
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, probe, focus)).toBe(false);
      const mid = listEmbeddedBlankBandProbeWires(doc)[1]!;
      expect(handoffNoteCaretAtEmptyContentRowEndDock(doc, wireOffsetToDocPos(doc, mid), mid)).toBe(
        false
      );
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, mid, wireOffsetToDocPos(doc, mid))).toBe(
        true
      );
    });

    it("is false on sole-char content row trailing break before substantive content", () => {
      const agent = "agent";
      const wire = `header @${agent} \n\nm\ntail @${agent} `;
      const doc = wireToDoc(wire);
      const breakAfterM = wire.indexOf("m") + 1;
      expect(wire[breakAfterM]).toBe("\n");
      expect(isEmbeddedBlankBandProbeWire(doc, breakAfterM)).toBe(false);
      const focus = wireOffsetToDocPos(doc, breakAfterM);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, breakAfterM, focus)).toBe(false);
    });

    it("leading blank under abutting content is CRE with probe-infra focus", () => {
      const doc = wireToDoc(`ab\n\n`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const focus = wireOffsetToDocPos(doc, probe);
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)).toBe(true);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, probe, focus)).toBe(true);
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, probe, focus)).toBe(false);
    });

    it("is false on interior band tail probe even when focus rests on lineStart alias", () => {
      const agent = "agent";
      const doc = wireToDoc(`header @${agent} \n\n\ntail @${agent} `);
      const tailProbe = listEmbeddedBlankBandProbeWires(doc)[1]!;
      const focus = wireOffsetToDocPos(doc, tailProbe);
      expect(handoffNoteCaretAtEmptyContentRowEndDock(doc, focus, tailProbe)).toBe(false);
      expect(embeddedBlankBandAtEmptyContentRowEnd(doc, tailProbe, focus)).toBe(false);
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, tailProbe, focus)).toBe(true);
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
      expect(handoffNoteCaretAtEmptyContentRowEndDock(doc, focus, tailProbe)).toBe(false);
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, tailProbe, focus)).toBe(true);
    });
  });

  describe("embeddedBlankBandContentRowEndBeforeProbe", () => {
    it("returns plain text row end unchanged", () => {
      const doc = wireToDoc(`header\n\n\ntail`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(embeddedBlankBandContentRowEndBeforeProbe(doc, probe)).toBe(probe - 1);
    });

    it("sole substantive char CRE and chip land stay on the char not the probe", () => {
      const doc = wireToDoc(`d\n\n`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(probe).toBe(1);
      expect(embeddedBlankBandContentRowEndBeforeProbe(doc, probe)).toBe(probe - 1);
      expect(docPosToWireOffset(doc, docPosAfterContentRowChipBeforeProbe(doc, probe))).toBe(
        probe - 1
      );
    });

    it("snaps mention-interior physical end to mention-end wire", () => {
      const agent = "caliper-aaaaaaa";
      const doc = wireToDoc(`header @${agent}\n\n\n`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const mentionEnd = `header @${agent}`.length;
      expect(probe - 1).toBeLessThan(mentionEnd);
      expect(embeddedBlankBandContentRowEndBeforeProbe(doc, probe)).toBe(mentionEnd);
      expect(docPosToWireOffset(doc, docPosAfterContentRowChipBeforeProbe(doc, probe))).toBe(
        mentionEnd
      );
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

  describe("line-start collapse", () => {
    const agent = "caliper-aaaaaaa";

    it("does not match sandwiched geometry when substantive content remains above", () => {
      const wire = `upper @${agent} xx\n\n\nlower @${agent} `;
      const doc = wireToDoc(wire);
      const lineStartBeforeLower = wire.indexOf("lower") - 1;
      const focus = wireOffsetToDocPos(doc, lineStartBeforeLower);
      expect(wire[lineStartBeforeLower]).toBe("\n");
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, lineStartBeforeLower, focus)).toBe(false);
      expect(resolveEmbeddedBlankBandLineStartCollapse(doc, focus)).toBeNull();
    });

    it("matches leading blanks and lands at first substantive visual start", () => {
      const wire = `\n\nlower @${agent} `;
      const doc = wireToDoc(wire);
      const lineStart = wire.indexOf("lower") - 1;
      const collapse = resolveEmbeddedBlankBandLineStartCollapse(
        doc,
        wireOffsetToDocPos(doc, lineStart)
      );
      expect(collapse).not.toBeNull();
      expect(collapse!.branch).toBe("backspace-line-start-collapse");
      expect(collapse!.caretWire).toBe(docToWire(collapse!.doc).indexOf("lower"));
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

  describe("embeddedBlankBandProbePaintsBareWireBreak", () => {
    it("multi-char EOF pad-preceding probe is bare (pad owns trailing stop)", () => {
      const doc = wireToDoc("sh\n");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const focus = wireOffsetToDocPos(doc, probe);
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)).toBe(true);
      expect(embeddedBlankBandProbePaintsBareWireBreak(doc, probe, focus)).toBe(true);
      expect(embeddedBlankBandProbeEmitsBlankAnchor(doc, probe)).toBe(false);
    });

    it("multi-char mid-doc blank probe prefers blank-anchor", () => {
      const doc = wireToDoc("sh\n\ntail");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const focus = wireOffsetToDocPos(doc, probe);
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)).toBe(true);
      expect(embeddedBlankBandProbePaintsBareWireBreak(doc, probe, focus)).toBe(false);
      expect(embeddedBlankBandProbeEmitsBlankAnchor(doc, probe)).toBe(true);
    });

    it("emptied blank-only probes omit blank-anchor emit", () => {
      const doc = wireToDoc("\n\n\n\n");
      for (const probe of listEmbeddedBlankBandProbeWires(doc)) {
        expect(embeddedBlankBandProbeEmitsBlankAnchor(doc, probe)).toBe(false);
        expect(
          embeddedBlankBandProbePaintsBareWireBreak(doc, probe, wireOffsetToDocPos(doc, probe))
        ).toBe(true);
      }
    });

    it("trailing-space EOF pad-preceding probe is bare", () => {
      const doc = wireToDoc("sh \n");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const focus = wireOffsetToDocPos(doc, probe);
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)).toBe(false);
      expect(embeddedBlankBandProbePaintsBareWireBreak(doc, probe, focus)).toBe(true);
      expect(embeddedBlankBandProbeEmitsBlankAnchor(doc, probe)).toBe(false);
    });

    it("trailing-space mid-doc blank probe prefers blank-anchor", () => {
      const doc = wireToDoc("sh \n\ntail");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const focus = wireOffsetToDocPos(doc, probe);
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)).toBe(false);
      expect(embeddedBlankBandProbePaintsBareWireBreak(doc, probe, focus)).toBe(false);
      expect(embeddedBlankBandProbeEmitsBlankAnchor(doc, probe)).toBe(true);
    });

    it("sole-char empty-row CRE dock prefers bare BR", () => {
      const doc = wireToDoc("h\n\n\n");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(probe).toBe(1);
      const focus = wireOffsetToDocPos(doc, probe);
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)).toBe(true);
      expect(embeddedBlankBandProbePaintsBareWireBreak(doc, probe, focus)).toBe(true);
    });

    it("emptied empty CRE with no abutting text prefers bare BR", () => {
      const doc = wireToDoc("m\n\n");
      const rowEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
      const chipped = applyDocDelete(
        doc,
        collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, rowEnd), "content-row-end"),
        "backspace"
      )!;
      expect(docToWire(chipped.doc)).toBe("\n\n");
      const focusWire = docPosToWireOffset(chipped.doc, chipped.selection.focus);
      expect(focusWire).toBe(0);
      expect(
        embeddedBlankBandAtEmptyContentRowEnd(chipped.doc, focusWire, chipped.selection.focus)
      ).toBe(true);
      expect(embeddedBlankBandSubstantiveContentAbutsProbe(chipped.doc, focusWire)).toBe(false);
      expect(
        embeddedBlankBandProbePaintsBareWireBreak(chipped.doc, focusWire, chipped.selection.focus)
      ).toBe(true);
    });

    it("cleared interior empty CRE with no abutting text prefers bare BR", () => {
      const wire = `header \n\n\nmiddle\n\n\nd\n\n\nlower`;
      const doc = wireToDoc(wire);
      const dPos = wire.indexOf("\nd\n", wire.indexOf("middle")) + 1;
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, dPos), "after"),
        "backspace"
      )!;
      const focusWire = docPosToWireOffset(chipped.doc, chipped.selection.focus);
      expect(
        embeddedBlankBandAtEmptyContentRowEnd(chipped.doc, focusWire, chipped.selection.focus)
      ).toBe(true);
      expect(
        embeddedBlankBandProbePaintsBareWireBreak(chipped.doc, focusWire, chipped.selection.focus)
      ).toBe(true);
    });
  });

  describe("empty content-row-end Delete resolution", () => {
    it("blank-probe mid-band collapses (move)", () => {
      const doc = wireToDoc("\n\n\nlower");
      expect(resolveDeleteFromEmptyContentRowEnd(doc, 0, wireOffsetToDocPos(doc, 0)).status).toBe(
        "move"
      );
    });

    it("line-start \\n before content is miss (not a blank probe)", () => {
      const doc = wireToDoc("\nlower");
      expect(resolveDeleteFromEmptyContentRowEnd(doc, 0, wireOffsetToDocPos(doc, 0)).status).toBe(
        "miss"
      );
    });

    it("last trailing blank under content is band-edge noop", () => {
      const doc = wireToDoc("TOP\n");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(
        resolveDeleteFromEmptyContentRowEnd(doc, probe, wireOffsetToDocPos(doc, probe)).status
      ).toBe("noop");
    });

    it("sole leftover prefix blank clears (move)", () => {
      const doc = wireToDoc("\n");
      const resolved = resolveDeleteFromEmptyContentRowEnd(doc, 0, wireOffsetToDocPos(doc, 0));
      expect(resolved.status).toBe("move");
      if (resolved.status === "move") {
        expect(docToWire(resolved.move.doc)).toBe("");
      }
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
