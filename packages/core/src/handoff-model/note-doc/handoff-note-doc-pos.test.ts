/**
 * Generic doc position + wire-line vertical/horizontal arrow behavior.
 * Contract: handoff-note-arrow-contract.md (vertical/horizontal axis, boundary bleed).
 *
 * Wire-line blank runs and column-0 vertical: handoff-note-doc-pos.test.ts, handoff-note-vertical-nav.test.ts.
 * Wire-line fixtures here use `\n` as line breaks between nodes (e.g. `header\\n\\n\\n tail`).
 */
import { describe, expect, it } from "vitest";
import {
  collapsedSelection,
  collapsedSelectionCarryingAffinity,
  collapsedSelectionReconcilingAffinity,
  collapsedSelectionWithIntent,
  docEndPos,
  docPosEqual,
  docPosToWireOffset,
  docSelectionToWireRange,
  focusAffinityIfAmbiguousBreak,
  isCaretOnAmbiguousContentRowEndChar,
  normalizeDocPos,
  normalizeSelection,
  resolveDirectionalUnitFocus,
  resolveDocVerticalArrowMove,
  selectionsEqual,
  wireOffsetToCollapsedSelection,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import { docToWire, describeHandoffNoteCursorContext, wireToDoc } from "./handoff-note-doc.js";
import { listEmbeddedBlankBandProbeWires } from "./handoff-note-embedded-newlines.js";
import { resolveWireLineColumn } from "./handoff-note-wire-lines.js";

describe("HandoffNoteDocPos", () => {
  it("round-trips wire offsets at text, mention boundaries, and doc end", () => {
    const doc = wireToDoc("Hi @caliper-abc123 there");
    const mentionStart = "Hi ".length;
    const mentionEnd = mentionStart + "@caliper-abc123".length;

    for (const offset of [0, 2, mentionStart, mentionEnd, docToWire(doc).length]) {
      const pos = wireOffsetToDocPos(doc, offset);
      expect(docPosToWireOffset(doc, pos)).toBe(offset);
    }
  });

  it("normalizes mention-interior wire offsets to a valid boundary", () => {
    const doc = wireToDoc("Hi @caliper-abc123 there");
    const interior = "Hi @caliper-a".length;
    expect(interior).toBeGreaterThan("Hi ".length);
    expect(interior).toBeLessThan("Hi @caliper-abc123".length);

    const fromBefore = normalizeDocPos(doc, wireOffsetToDocPos(doc, interior), {
      from: wireOffsetToDocPos(doc, 0),
    });
    expect(docPosToWireOffset(doc, fromBefore)).toBe("Hi ".length);

    const fromAfter = normalizeDocPos(doc, wireOffsetToDocPos(doc, interior), {
      from: wireOffsetToDocPos(doc, docToWire(doc).length),
    });
    expect(docPosToWireOffset(doc, fromAfter)).toBe("Hi @caliper-abc123".length);
  });

  it("docEndPos lands after the last node token", () => {
    const doc = wireToDoc("a\nb @caliper-x");
    const end = docEndPos(doc);
    expect(docPosToWireOffset(doc, end)).toBe(docToWire(doc).length);
  });

  it("wireOffsetToCollapsedSelection snaps using boundary affinity", () => {
    const doc = wireToDoc("@caliper-abc123");
    const end = "@caliper-abc123".length;
    const fromStart = wireOffsetToCollapsedSelection(doc, 5, 0);
    expect(docPosToWireOffset(doc, fromStart.focus)).toBe(end);
    const fromEnd = wireOffsetToCollapsedSelection(doc, 5, end);
    expect(docPosToWireOffset(doc, fromEnd.focus)).toBe(0);
  });

  it("selectionsEqual detects anchor/focus changes", () => {
    const doc = wireToDoc("abc");
    const a = collapsedSelection(wireOffsetToDocPos(doc, 1));
    const b = collapsedSelection(wireOffsetToDocPos(doc, 2));
    expect(selectionsEqual(a, b)).toBe(false);
    expect(selectionsEqual(a, a)).toBe(true);
  });

  it("docSelectionToWireRange orders anchor and focus", () => {
    const doc = wireToDoc("abcdef");
    const range = docSelectionToWireRange(doc, {
      anchor: wireOffsetToDocPos(doc, 4),
      focus: wireOffsetToDocPos(doc, 1),
    });
    expect(range).toEqual({ start: 1, end: 4 });
  });

  it("empty doc uses origin position", () => {
    const doc = wireToDoc("");
    const origin = { nodeIndex: 0, nodeOffset: 0 };
    expect(docEndPos(doc)).toEqual(origin);
    expect(normalizeDocPos(doc, { nodeIndex: 99, nodeOffset: 99 })).toEqual(origin);
    expect(docPosEqual(wireOffsetToDocPos(doc, 0), origin)).toBe(true);
  });

  it("normalizeSelection keeps both endpoints valid on multiline notes", () => {
    const doc = wireToDoc("line1\nline2 @caliper-z");
    const mentionInterior = docToWire(doc).indexOf("caliper-z") + 3;
    const sel = normalizeSelection(doc, wireOffsetToCollapsedSelection(doc, mentionInterior, 0));
    expect(docPosToWireOffset(doc, sel.focus)).toBe("line1\nline2 ".length);
  });

  it("canonical normalize doc preserves doc-pos at mention end before spacer", () => {
    const doc = wireToDoc("@caliper-a@caliper-b");
    const mentionEnd = "@caliper-a".length;
    expect(docPosToWireOffset(doc, normalizeDocPos(doc, wireOffsetToDocPos(doc, mentionEnd)))).toBe(
      mentionEnd
    );
    expect(docToWire(doc)).toBe("@caliper-a @caliper-b");
  });

  it("normalizeDocPos preserves mention interior from wire offset", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header @${agent} tail\n\n\n`;
    const doc = wireToDoc(wire);
    const interiorWire = wire.indexOf("aaa") + 2;

    const normalized = normalizeDocPos(doc, wireOffsetToDocPos(doc, interiorWire));

    expect(describeHandoffNoteCursorContext(doc, interiorWire).kind).toBe("mention-interior");
    expect(docPosToWireOffset(doc, normalized)).toBe(interiorWire);
  });

  it("normalizeDocPos with matching from hint preserves mention interior", () => {
    const agent = "caliper-85l0t4y9j";
    const wire = `header @${agent}\n\n\n`;
    const doc = wireToDoc(wire);
    const interiorWire = wire.indexOf("j");
    const pos = wireOffsetToDocPos(doc, interiorWire);

    expect(docPosToWireOffset(doc, normalizeDocPos(doc, pos, { from: { ...pos } }))).toBe(
      interiorWire
    );
  });
});
describe("resolveDocVerticalArrowMove", () => {
  const agentA = "caliper-aaaaaaa";
  const agentB = "caliper-bbbbbbb";

  function line2MentionStart(wire: string) {
    return wire.indexOf("@", wire.indexOf("\n") + 1);
  }

  function assertVertical(
    doc: ReturnType<typeof wireToDoc>,
    from: number,
    sign: -1 | 1,
    expectWire: number,
    notExpectWire?: number
  ) {
    const moved = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, from),
      sign === -1 ? "up" : "down"
    );
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(expectWire);
    if (notExpectWire !== undefined) {
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(notExpectWire);
    }
  }

  function pillRowLine(agent: string, pillCount: number, tail = " end"): string {
    let row = "row";
    for (let index = 0; index < pillCount; index++) {
      row += ` @${agent}`;
    }
    return `${row}${tail}`;
  }

  function blankBandWire(emptyVisualRows: number): {
    wire: string;
    blanks: number[];
    tailStart: number;
  } {
    const header = "header";
    const wire = `${header}${"\n".repeat(emptyVisualRows + 1)} tail`;
    const doc = wireToDoc(wire);
    const blanks = listEmbeddedBlankBandProbeWires(doc);
    return { wire, blanks, tailStart: wire.indexOf("tail") };
  }

  describe("vertical — plain multiline column preserve", () => {
    it("preserves column on mid-line text without snapping to mention", () => {
      const wire = `top\npad @${agentA} tail\nbottom`;
      const doc = wireToDoc(wire);
      const targetLineStart = wire.indexOf("\n") + 1;
      assertVertical(doc, 2, 1, targetLineStart + 2, wire.indexOf("@"));
      assertVertical(
        doc,
        wire.indexOf("bottom"),
        -1,
        targetLineStart + (wire.indexOf("bottom") - (wire.lastIndexOf("\n") + 1)),
        wire.indexOf("@")
      );
    });

    it("preserves column crossing to line above on plain multiline text", () => {
      const wire = "abcdef\nghij";
      const doc = wireToDoc(wire);
      const fromLower = "abcdef\ngh".length;
      assertVertical(doc, fromLower, -1, "ab".length);
      assertVertical(doc, "ab".length, 1, fromLower);
    });

    it("round-trips column on equal-width lines", () => {
      const wire = "abcdef\nghijkl";
      const doc = wireToDoc(wire);
      const from = wire.indexOf("cd");
      const down = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "down");
      const downOffset = docPosToWireOffset(doc, down.pos);
      expect(resolveWireLineColumn(wire, downOffset).column).toBe(
        resolveWireLineColumn(wire, from).column
      );
      assertVertical(doc, downOffset, -1, from);
    });

    it("clamps column when the target line is shorter", () => {
      const wire = "abcdef\nghi";
      const doc = wireToDoc(wire);
      const from = wire.indexOf("ef");
      const down = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "down");
      const downOffset = docPosToWireOffset(doc, down.pos);
      expect(resolveWireLineColumn(wire, downOffset).column).toBe(3);
      expect(downOffset).toBe(wire.length);
    });
  });

  describe("vertical — pill row line crossing", () => {
    const threeLineWire = `handoff notes @${agentA} \n@${agentA} @${agentB} \n@${agentA} `;
    const line2Mention = line2MentionStart(threeLineWire);
    const line2SecondMention = threeLineWire.indexOf(`@${agentB}`);
    const line3Mention = threeLineWire.lastIndexOf("@");

    it("later line pill start crosses to previous line pill start", () => {
      assertVertical(wireToDoc(threeLineWire), line3Mention, -1, line2Mention);
    });

    it("line pill start crosses to next line without same-row step", () => {
      assertVertical(wireToDoc(threeLineWire), line2Mention, 1, line3Mention, line2SecondMention);
    });

    it("second pill on line crosses below next line start", () => {
      const doc = wireToDoc(threeLineWire);
      const moved = resolveDocVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, line2SecondMention),
        "down"
      );
      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBeGreaterThan(line3Mention);
    });

    it("avoids parking between adjacent mentions on target line", () => {
      const wire = `line1\n@${agentA} @${agentB} tail\n@${agentA} `;
      const doc = wireToDoc(wire);
      const moved = resolveDocVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, wire.lastIndexOf("@")),
        "up"
      );
      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(line2MentionStart(wire));
      const focusNode = doc.nodes[moved.pos.nodeIndex];
      expect(focusNode?.type).toBe("mention");
      if (focusNode?.type === "mention") {
        expect(focusNode.agentId).toBe(agentA);
        expect(moved.pos.nodeOffset).toBe(0);
      }
    });

    const pillRowAgent = "caliper-jli3vwpry";
    const pillRowWire = `brief @${pillRowAgent} \n\n\n\n\n@${pillRowAgent} @${pillRowAgent} \n\n\nfollowup`;
    const pillRowSuffix = `@${pillRowAgent} @${pillRowAgent} `;
    const pillRowStart = pillRowWire.indexOf(pillRowSuffix);
    const pillRowSecondPill = pillRowStart + `@${pillRowAgent} `.length;
    const pillRowEndingNewline = pillRowWire.indexOf(pillRowSuffix) + pillRowSuffix.length;
    const pillRowDoc = wireToDoc(pillRowWire);
    const pillRowProbes = listEmbeddedBlankBandProbeWires(pillRowDoc);
    const blanksBelowPillRow = pillRowProbes.filter((wire) => wire >= pillRowEndingNewline);
    const firstBlankBelowPillRow = blanksBelowPillRow[0]!;
    const secondBlankBelowPillRow = blanksBelowPillRow[1]!;
    const blanksAbovePillRow = pillRowProbes.filter((wire) => wire < pillRowStart);
    const emptyLineAbovePillRow = blanksAbovePillRow[blanksAbovePillRow.length - 1]!;

    it("pill row line start enters blank below not same-row pill", () => {
      assertVertical(pillRowDoc, pillRowStart, 1, firstBlankBelowPillRow, pillRowSecondPill);
    });

    it("pill row line start and first blank below round-trip", () => {
      assertVertical(pillRowDoc, pillRowStart, 1, firstBlankBelowPillRow, pillRowSecondPill);
      assertVertical(pillRowDoc, firstBlankBelowPillRow, -1, pillRowStart);
    });

    it("interior near pill row end crosses to blank below", () => {
      assertVertical(
        pillRowDoc,
        pillRowEndingNewline - 1,
        1,
        firstBlankBelowPillRow,
        pillRowEndingNewline - 1
      );
    });

    it("newline immediately above pill row crosses to prior blank probe", () => {
      assertVertical(
        pillRowDoc,
        pillRowStart - 1,
        -1,
        emptyLineAbovePillRow,
        pillRowEndingNewline - 1
      );
    });

    it("blank below pill row steps monotonically without skipping distant block", () => {
      assertVertical(pillRowDoc, secondBlankBelowPillRow, -1, firstBlankBelowPillRow);
      assertVertical(pillRowDoc, firstBlankBelowPillRow, -1, pillRowStart, blanksAbovePillRow[0]!);
    });

    const multiPillAgent = "caliper-ho14ofyh6";
    const multiPillWire = `handoff notes @${multiPillAgent} @${multiPillAgent} review phase\n\n\n\n\n\n@${multiPillAgent} context extra @${multiPillAgent} `;
    const firstPillOnRow = multiPillWire.lastIndexOf(`\n@${multiPillAgent} `) + 1;
    const secondPillOnRow = multiPillWire.lastIndexOf(` @${multiPillAgent} `) + 1;
    const multiPillDoc = wireToDoc(multiPillWire);
    const multiPillProbes = listEmbeddedBlankBandProbeWires(multiPillDoc);
    const blankAboveRow = multiPillProbes.filter((wire) => wire < firstPillOnRow).at(-1)!;

    it("later pill on same row crosses to blank above row", () => {
      assertVertical(multiPillDoc, secondPillOnRow, -1, blankAboveRow, firstPillOnRow);
    });

    it("first pill on same row crosses to blank above row", () => {
      assertVertical(multiPillDoc, firstPillOnRow, -1, blankAboveRow);
    });

    it("earlier pill on same row crosses to blank below not next pill", () => {
      const agent = multiPillAgent;
      const wire = `prefix @${agent} mid @${agent} tail\n\n\n`;
      const doc = wireToDoc(wire);
      const secondPill = wire.indexOf(`@${agent}`, wire.indexOf(`@${agent}`) + 1);
      const firstBlank = listEmbeddedBlankBandProbeWires(doc)[0]!;
      assertVertical(doc, wire.indexOf(`@${agent}`), 1, firstBlank, secondPill);
    });
  });

  describe("vertical — column preserve across two-pill rows", () => {
    function canonicalDoc(input: string) {
      const doc = wireToDoc(input);
      return { doc, wire: docToWire(doc) };
    }

    function buildPlainRowBelow(row1: string, column: number, marker = "mark"): string {
      return `${row1}\n${" ".repeat(column)}${marker}`;
    }

    function interPillGapMid(wire: string, gapText = " mid "): number {
      const gapStart = wire.indexOf(gapText);
      expect(gapStart).toBeGreaterThanOrEqual(0);
      return gapStart + Math.floor(gapText.length / 2);
    }

    function gapBetweenCanonicalPills(wire: string, agentId: string): number {
      const firstPill = wire.indexOf(`@${agentId}`);
      expect(firstPill).toBeGreaterThanOrEqual(0);
      return firstPill + 1 + agentId.length;
    }

    function lineStart(wire: string, lineIndex: number): number {
      const starts = [0];
      for (let index = 0; index < wire.length; index++) {
        if (wire[index] === "\n") {
          starts.push(index + 1);
        }
      }
      return starts[lineIndex]!;
    }

    function assertColumnPreserve(
      doc: ReturnType<typeof wireToDoc>,
      wire: string,
      fromWire: number,
      direction: "up" | "down",
      expectWire: number,
      options?: { notWires?: number[]; preserveColumn?: boolean }
    ) {
      const sourceColumn = resolveWireLineColumn(wire, fromWire).column;
      const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, fromWire), direction);
      expect(moved.handled).toBe(true);
      const landed = docPosToWireOffset(doc, moved.pos);
      expect(landed).toBe(expectWire);
      if (options?.preserveColumn !== false) {
        expect(resolveWireLineColumn(wire, landed).column).toBe(sourceColumn);
      }
      for (const bad of options?.notWires ?? []) {
        expect(landed).not.toBe(bad);
      }
    }

    function assertNotMentionInterior(doc: ReturnType<typeof wireToDoc>, wireOffset: number) {
      const context = describeHandoffNoteCursorContext(doc, wireOffset);
      expect(context.kind).not.toBe("mention-interior");
    }

    it("down from inter-pill gap preserves column on plain row below", () => {
      const row1 = `row @${agentA} mid @${agentB} end`;
      const gapMidOnRow1 = interPillGapMid(row1);
      const column = resolveWireLineColumn(row1, gapMidOnRow1).column;
      const { doc, wire } = canonicalDoc(buildPlainRowBelow(row1, column));
      const gapMid = interPillGapMid(wire);
      const line2Start = lineStart(wire, 1);

      assertColumnPreserve(doc, wire, gapMid, "down", line2Start + column, {
        notWires: [wire.indexOf("@"), line2Start],
      });
    });

    it("up from plain row below inter-pill gap round-trips column", () => {
      const row1 = `row @${agentA} mid @${agentB} end`;
      const gapMidOnRow1 = interPillGapMid(row1);
      const column = resolveWireLineColumn(row1, gapMidOnRow1).column;
      const { doc, wire } = canonicalDoc(buildPlainRowBelow(row1, column));
      const gapMid = interPillGapMid(wire);
      const belowGap = lineStart(wire, 1) + column;

      assertColumnPreserve(doc, wire, belowGap, "up", gapMid, {
        notWires: [wire.indexOf("@"), lineStart(wire, 1)],
      });
    });

    it("down from inter-pill gap clamps when target row is shorter", () => {
      const row1 = `lead @${agentA} mid @${agentB} tail`;
      const gapMidOnRow1 = interPillGapMid(row1);
      const { doc, wire } = canonicalDoc(`${row1}\nhi`);
      const gapMid = interPillGapMid(wire);
      const line2Start = lineStart(wire, 1);
      const row2 = "hi";

      assertColumnPreserve(doc, wire, gapMid, "down", line2Start + row2.length, {
        preserveColumn: false,
      });
      expect(resolveWireLineColumn(wire, line2Start + row2.length).column).toBe(row2.length);
    });

    it("down from canonical gap between tight-ingressed pills preserves column on row below", () => {
      const row1Input = `@${agentA}@${agentB} row1end`;
      const gapOnInput = gapBetweenCanonicalPills(row1Input, agentA);
      const { doc, wire } = canonicalDoc(buildPlainRowBelow(row1Input, gapOnInput, "below"));
      const gapMid = gapBetweenCanonicalPills(wire, agentA);
      const column = resolveWireLineColumn(wire, gapMid).column;
      const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, gapMid), "down");
      expect(moved.handled).toBe(true);
      const landed = docPosToWireOffset(doc, moved.pos);
      expect(resolveWireLineColumn(wire, landed).column).toBe(column);
      assertNotMentionInterior(doc, landed);
    });

    it("up from row below canonical pill gap preserves column on row above", () => {
      const row1Input = `@${agentA}@${agentB} row1end`;
      const gapOnInput = gapBetweenCanonicalPills(row1Input, agentA);
      const column = resolveWireLineColumn(row1Input, gapOnInput).column;
      const { doc, wire } = canonicalDoc(buildPlainRowBelow(row1Input, column, "below"));
      const gapMid = gapBetweenCanonicalPills(wire, agentA);
      const belowGap = lineStart(wire, 1) + column;
      const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, belowGap), "up");
      expect(moved.handled).toBe(true);
      const landed = docPosToWireOffset(doc, moved.pos);
      expect(resolveWireLineColumn(wire, landed).column).toBe(column);
      expect(landed).toBe(gapMid);
      assertNotMentionInterior(doc, landed);
    });

    it("down from inter-pill gap snaps to pill boundary when row below column hits tight pills", () => {
      const row1 = `lead @${agentA} mid @${agentB} tail`;
      const gapMidOnRow1 = interPillGapMid(row1);
      const column = resolveWireLineColumn(row1, gapMidOnRow1).column;
      const { doc, wire } = canonicalDoc(
        `${row1}\n${" ".repeat(column)}@${agentA}@${agentB} lower`
      );
      const gapMid = interPillGapMid(wire);
      const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, gapMid), "down");
      expect(moved.handled).toBe(true);
      const landed = docPosToWireOffset(doc, moved.pos);
      const context = describeHandoffNoteCursorContext(doc, landed);
      expect(context.kind).toBe("mention-boundary");
      assertNotMentionInterior(doc, landed);
    });

    it("up from aligned plain row below spaced pills returns to inter-pill gap at same column", () => {
      const row1 = `lead @${agentA} mid @${agentB} tail`;
      const gapMidOnRow1 = interPillGapMid(row1);
      const column = resolveWireLineColumn(row1, gapMidOnRow1).column;
      const { doc, wire } = canonicalDoc(`${row1}\n${" ".repeat(column)}notes mark`);
      const gapMid = interPillGapMid(wire);
      const belowGap = lineStart(wire, 1) + column;

      assertColumnPreserve(doc, wire, belowGap, "up", gapMid, {
        notWires: [wire.indexOf(`@${agentA}`), lineStart(wire, 1)],
      });
      assertNotMentionInterior(doc, gapMid);
    });

    it("up from padded row below preserves column into row above tail text", () => {
      const row1 = `lead @${agentA} mid @${agentB} tail`;
      const tailMidOnRow1 = row1.indexOf("tail") + 2;
      const column = resolveWireLineColumn(row1, tailMidOnRow1).column;
      const { doc, wire } = canonicalDoc(`${row1}\n${" ".repeat(column)}mark`);
      const tailMid = wire.indexOf("tail") + 2;
      const belowTail = lineStart(wire, 1) + column;

      assertColumnPreserve(doc, wire, belowTail, "up", tailMid);
      assertNotMentionInterior(doc, tailMid);
    });

    it("down from row above tail and up round-trip at same column", () => {
      const row1 = `lead @${agentA} mid @${agentB} tail`;
      const tailMidOnRow1 = row1.indexOf("tail") + 2;
      const column = resolveWireLineColumn(row1, tailMidOnRow1).column;
      const { doc, wire } = canonicalDoc(`${row1}\n${" ".repeat(column)}mark`);
      const tailMid = wire.indexOf("tail") + 2;
      const belowTail = lineStart(wire, 1) + column;

      assertColumnPreserve(doc, wire, tailMid, "down", belowTail);
      assertColumnPreserve(doc, wire, belowTail, "up", tailMid);
    });
  });

  describe("vertical — wire-line blank run stepping", () => {
    const gapWire = "header\n\n\n tail";
    const gapDoc = wireToDoc(gapWire);
    const gapBlanks = listEmbeddedBlankBandProbeWires(gapDoc);

    it("line start and first blank round-trip on header/tail gap", () => {
      const doc = wireToDoc(gapWire);
      assertVertical(doc, 0, 1, gapBlanks[0]!);
      assertVertical(doc, gapBlanks[0]!, -1, 0, "header".length);
    });

    it("steps through consecutive empty visual rows without skipping to line start", () => {
      const doc = wireToDoc(gapWire);
      assertVertical(doc, gapBlanks[1]!, -1, gapBlanks[0]!);
      assertVertical(doc, gapBlanks[0]!, -1, 0, "header".length);
    });

    it("content mid-column enters blank at line start", () => {
      const wire = "header\n\ntail";
      const doc = wireToDoc(wire);
      const blankLine = listEmbeddedBlankBandProbeWires(doc)[0]!;
      assertVertical(doc, 4, 1, blankLine);
      assertVertical(doc, blankLine, -1, 0, "header".length);
    });
  });

  describe("vertical — wire-line column 0 after pill suffix", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agentA} mid @${agentB} \n\ntail @${agentA} `;
    const suffixDoc = wireToDoc(wire);
    const blankLineStart = listEmbeddedBlankBandProbeWires(suffixDoc)[0]!;
    const prefixMentionAt = wire.indexOf("@");
    const lowerMentionEnd = wire.length - 1;

    it("up from blank wire line at column 0 lands on line start above", () => {
      const doc = wireToDoc(wire);
      assertVertical(doc, blankLineStart, -1, 0, prefixMentionAt);
    });

    it("up chain from lower mention end never lands on prefix mention", () => {
      const doc = wireToDoc(wire);
      const firstUp = resolveDocVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, lowerMentionEnd),
        "up"
      );
      expect(firstUp.handled).toBe(true);
      expect(docPosToWireOffset(doc, firstUp.pos)).toBe(blankLineStart);
      expect(docPosToWireOffset(doc, firstUp.pos)).not.toBe(prefixMentionAt);

      const secondUp = resolveDocVerticalArrowMove(doc, firstUp.pos, "up");
      expect(secondUp.handled).toBe(true);
      expect(docPosToWireOffset(doc, secondUp.pos)).toBe(0);
      expect(docPosToWireOffset(doc, secondUp.pos)).not.toBe(prefixMentionAt);
    });

    it("down from line start and up round-trip through blank wire line", () => {
      const doc = wireToDoc(wire);
      assertVertical(doc, 0, 1, blankLineStart);
      assertVertical(doc, blankLineStart, -1, 0, prefixMentionAt);
    });
  });

  describe("vertical — boundary bleed at doc extremes", () => {
    const plainTwoLine = "abcdef\nghij";

    it("first line: up bleeds to previous wire offset", () => {
      const doc = wireToDoc(plainTwoLine);
      const from = 4;
      const up = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "up");
      expect(up.handled).toBe(true);
      expect(docPosToWireOffset(doc, up.pos)).toBe(from - 1);
    });

    it("first line on mention row: up bleeds to previous wire offset", () => {
      const wire = `handoff notes @${agentA} `;
      const doc = wireToDoc(wire);
      const from = wire.indexOf("@") + `@${agentA}`.length;
      const up = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "up");
      expect(up.handled).toBe(true);
      expect(docPosToWireOffset(doc, up.pos)).toBeLessThan(from);
    });

    it("last line: down bleeds to next wire offset", () => {
      const doc = wireToDoc(plainTwoLine);
      const from = plainTwoLine.length - 1;
      const down = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "down");
      expect(down.handled).toBe(true);
      expect(docPosToWireOffset(doc, down.pos)).toBe(plainTwoLine.length);
    });

    it("last line on mention row: down bleeds past pill start", () => {
      const wire = `handoff notes @${agentA} \n@${agentA} @${agentB} `;
      const doc = wireToDoc(wire);
      const fromWire = wire.lastIndexOf(`@${agentB}`);
      const down = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, fromWire), "down");
      expect(down.handled).toBe(true);
      expect(docPosToWireOffset(doc, down.pos)).toBeGreaterThan(fromWire);
    });

    it("doc start and doc end vertical extremes are no-ops", () => {
      const doc = wireToDoc("ab");
      expect(resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, 0), "up").handled).toBe(
        false
      );
      expect(resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, 2), "down").handled).toBe(
        false
      );
    });

    it("single-line vertical extreme bleeds right at core layer", () => {
      assertVertical(wireToDoc("abcdefgh"), 2, 1, 3);
    });
  });

  describe("vertical — mention landing snap", () => {
    it("onto mention-first row lands in tail when column past pill", () => {
      const wire = `notes here keeping it\n@${agentA} tail text`;
      const doc = wireToDoc(wire);
      const from = wire.indexOf("keeping") + "keeping".length;
      const pillEnd = wire.indexOf("@") + `@${agentA}`.length;
      const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "down");
      expect(docPosToWireOffset(doc, moved.pos)).toBeGreaterThanOrEqual(pillEnd);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(wire.indexOf("@"));
    });

    it("onto mention-first row snaps to pill end when column inside pill", () => {
      const wire = `notes here\n@${agentA} tail text`;
      assertVertical(wireToDoc(wire), 5, 1, wire.indexOf("@") + `@${agentA}`.length);
    });

    it("onto mention-first row snaps to pill start when column inside pill", () => {
      const wire = `@${agentA} tail text\nnotes here`;
      assertVertical(wireToDoc(wire), wire.indexOf("notes") + 3, -1, 0);
    });
  });

  describe("vertical — matrix blank run length", () => {
    it("column-0 descent and ascent through two blank wire lines", () => {
      const { wire, blanks } = blankBandWire(2);
      const doc = wireToDoc(wire);
      assertVertical(doc, 0, 1, blanks[0]!);
      assertVertical(doc, blanks[1]!, -1, blanks[0]!);
      assertVertical(doc, blanks[0]!, -1, 0);
    });

    it("column-0 monotonic ascent through three blank wire lines", () => {
      const { wire, blanks } = blankBandWire(3);
      const doc = wireToDoc(wire);
      assertVertical(doc, blanks[2]!, -1, blanks[1]!);
      assertVertical(doc, blanks[1]!, -1, blanks[0]!);
      assertVertical(doc, blanks[0]!, -1, 0);
    });

    it("column-0 monotonic descent through five blank wire lines", () => {
      const { wire, blanks } = blankBandWire(5);
      const doc = wireToDoc(wire);
      assertVertical(doc, 0, 1, blanks[0]!);
      assertVertical(doc, blanks[0]!, 1, blanks[1]!);
      assertVertical(doc, blanks[3]!, 1, blanks[4]!);
    });

    it("column-0 monotonic round-trip through seven blank wire lines", () => {
      const { wire, blanks, tailStart } = blankBandWire(7);
      const doc = wireToDoc(wire);
      assertVertical(doc, 0, 1, blanks[0]!);
      assertVertical(doc, blanks[5]!, 1, blanks[6]!);
      assertVertical(doc, tailStart, -1, blanks[6]!);
      assertVertical(doc, blanks[0]!, -1, 0);
    });
  });

  describe("vertical — matrix pill count on row", () => {
    it("one-pill row line start and first blank below round-trip", () => {
      const row = pillRowLine(agentA, 1);
      const wire = `${row}\n\n\nfollow`;
      const doc = wireToDoc(wire);
      const pillRowStart = 0;
      const firstBlank = listEmbeddedBlankBandProbeWires(doc)[0]!;
      assertVertical(doc, pillRowStart, 1, firstBlank);
      assertVertical(doc, firstBlank, -1, pillRowStart);
    });

    it("three-pill row tail enters blank below not same-row pill", () => {
      const row = pillRowLine(agentA, 3);
      const wire = `${row}\n\n\nfollow`;
      const doc = wireToDoc(wire);
      const rowTail = row.length - 1;
      const firstBlank = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const secondPill = wire.indexOf(`@${agentA}`, wire.indexOf(`@${agentA}`) + 1);
      assertVertical(doc, rowTail, 1, firstBlank, secondPill);
    });

    it("four-pill row line start and first blank below round-trip", () => {
      const row = pillRowLine(agentA, 4);
      const wire = `${row}\n\n\nfollow`;
      const doc = wireToDoc(wire);
      const pillRowStart = 0;
      const firstBlank = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const secondPill = wire.indexOf(`@${agentA}`, wire.indexOf(`@${agentA}`) + 1);
      assertVertical(doc, pillRowStart, 1, firstBlank, secondPill);
      assertVertical(doc, firstBlank, -1, pillRowStart);
    });

    it("five-pill row first pill down enters blank below not next pill", () => {
      const row = pillRowLine(agentA, 5);
      const wire = `${row}\n\n\nfollow`;
      const doc = wireToDoc(wire);
      const firstPill = wire.indexOf(`@${agentA}`);
      const secondPill = wire.indexOf(`@${agentA}`, firstPill + 1);
      const firstBlank = listEmbeddedBlankBandProbeWires(doc)[0]!;
      assertVertical(doc, firstPill, 1, firstBlank, secondPill);
    });
  });

  describe("sole/last-char focusAffinity helpers", () => {
    const wire = "h\n\ntail";
    const cre = () => {
      const doc = wireToDoc(wire);
      return { doc, at: wireOffsetToDocPos(doc, 0) };
    };

    it("focusAffinityIfAmbiguousBreak keeps affinity only on char-before-break", () => {
      const { doc, at } = cre();
      expect(focusAffinityIfAmbiguousBreak(doc, at, "after")).toBe("after");
      expect(
        focusAffinityIfAmbiguousBreak(doc, wireOffsetToDocPos(doc, 1), "after")
      ).toBeUndefined();
    });

    it("collapsedSelectionCarryingAffinity requires same wire", () => {
      const { doc, at } = cre();
      const source = collapsedSelectionWithIntent(doc, at, "content-row-end");
      expect(collapsedSelectionCarryingAffinity(doc, at, source).focusAffinity).toBe("after");
      expect(
        collapsedSelectionCarryingAffinity(doc, wireOffsetToDocPos(doc, 1), source).focusAffinity
      ).toBeUndefined();
    });

    it("collapsedSelectionReconcilingAffinity prefers live then prior on same wire", () => {
      const { doc, at } = cre();
      const live = collapsedSelectionWithIntent(doc, at, "content-row-end");
      const prior = collapsedSelectionWithIntent(doc, at, "deletion-point");
      expect(collapsedSelectionReconcilingAffinity(doc, at, live, prior).focusAffinity).toBe(
        "after"
      );
      expect(
        collapsedSelectionReconcilingAffinity(
          doc,
          at,
          collapsedSelection(wireOffsetToDocPos(doc, 1)),
          prior
        ).focusAffinity
      ).toBe("before");
    });

    it("normalizeSelection drops stale affinity off char-before-break", () => {
      const { doc, at } = cre();
      const stale = {
        ...collapsedSelection(wireOffsetToDocPos(doc, 1)),
        focusAffinity: "after" as const,
      };
      expect(normalizeSelection(doc, stale).focusAffinity).toBeUndefined();
      expect(
        normalizeSelection(doc, collapsedSelectionWithIntent(doc, at, "content-row-end"))
          .focusAffinity
      ).toBe("after");
    });

    it("EOF last content char is ambiguous CRE; content-row-end emits after", () => {
      const doc = wireToDoc("ab ");
      const at = wireOffsetToDocPos(doc, 2);
      expect(isCaretOnAmbiguousContentRowEndChar(doc, at)).toBe(true);
      expect(collapsedSelectionWithIntent(doc, at, "content-row-end").focusAffinity).toBe("after");
      expect(resolveDirectionalUnitFocus(doc, at, "after", "backspace").contentCharUnit).toEqual({
        startWire: 2,
        endWire: 3,
      });
    });
  });
});
