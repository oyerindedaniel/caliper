/**
 * Integration pipeline for handoff note arrow navigation.
 *
 * Every assertion enters through editor.handleKeyDown:
 * syncSelectionFromDom → resolveDomVerticalArrowMove / resolveDocHorizontalArrowMove
 * → mutateSelection → writeSelection, with authority === live DOM parity where noted.
 *
 * Unit coverage: core doc-pos, doc-edits (Shift+Enter caret), overlay selection/DOM.
 * Contract: handoff-note-arrow-contract.md
 */
import {
  docPosToWireOffset,
  listEmbeddedBlankBandProbeWires,
  resolveDocVerticalArrowMove,
  wireOffsetToDocPos,
  wireToDoc,
} from "@caliper/core";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createHandoffNoteEditor, type HandoffNoteEditor } from "./create-handoff-note-editor.js";
import {
  setMeasuredSamplesCache,
  invalidateHandoffNoteLayoutCache,
} from "./handoff-note-layout-map.js";
import { readDomWireCursor } from "./handoff-note-test-helpers.js";

const AGENT_A = "caliper-aaaaaaa";
const AGENT_B = "caliper-bbbbbbb";
const AGENT_COMPOSITE = "caliper-aaaaaaa";

type ArrowAxis = "vertical" | "horizontal";
type ArrowSign = -1 | 1;

function arrowKeyName(axis: ArrowAxis, sign: ArrowSign): string {
  if (axis === "vertical") {
    return sign === -1 ? "ArrowUp" : "ArrowDown";
  }
  return sign === -1 ? "ArrowLeft" : "ArrowRight";
}

function pressArrow(editor: HandoffNoteEditor, axis: ArrowAxis, sign: ArrowSign): boolean {
  return editor.handleKeyDown(
    new KeyboardEvent("keydown", {
      key: arrowKeyName(axis, sign),
      bubbles: true,
      cancelable: true,
    })
  );
}

function expectCaretParity(
  editor: HandoffNoteEditor,
  root: HTMLElement,
  wire: number,
  label?: string
): void {
  const authority = editor.getCursor();
  const liveDom = readDomWireCursor(root, editor.getDoc());
  expect(authority, label ? `${label} authority` : "authority").toBe(wire);
  expect(liveDom, label ? `${label} live DOM` : "live DOM").toBe(wire);
}

function setDocWithLayout(
  editor: HandoffNoteEditor,
  root: HTMLElement,
  wire: string,
  cursor: number,
  samples: { wire: number; top: number; left: number }[]
): void {
  editor.setDocFromWire(wire, cursor, { resetHistory: true });
  setMeasuredSamplesCache(wire, root.clientWidth, samples);
}

const VISUAL_ROW_TOP = { r1: 100, r2: 136, r3: 172, r4: 208 } as const;

function longTail(repeat = 20): string {
  return `${"tail ".repeat(repeat)}`;
}

function wrappedFirstLineWire(nextLine = "row3"): string {
  return `header @${AGENT_A} ${longTail()}\n${nextLine}`;
}

function landmarksForWrappedFirstLine(wire: string) {
  const line1Start = wire.indexOf("\n") + 1;
  const line0End = line1Start - 1;
  return {
    line1Start,
    line0End,
    wrapRow1Wire: 0,
    wrapRow2InteriorWire: 30,
    wrapRow2TailWire: line0End,
  };
}

function samplesForWrappedFirstLine(wire: string, line1Top = VISUAL_ROW_TOP.r3) {
  const L = landmarksForWrappedFirstLine(wire);
  return [
    { wire: L.wrapRow1Wire, top: VISUAL_ROW_TOP.r1, left: 0 },
    { wire: 10, top: VISUAL_ROW_TOP.r1, left: 200 },
    { wire: L.wrapRow2InteriorWire, top: VISUAL_ROW_TOP.r2, left: 0 },
    { wire: L.wrapRow2TailWire, top: VISUAL_ROW_TOP.r2, left: 400 },
    { wire: L.line1Start, top: line1Top, left: 0 },
    { wire: wire.length - 1, top: line1Top, left: 40 },
  ];
}

function sandwichWire(): string {
  return `top\nheader @${AGENT_A} ${longTail()}\nbottom`;
}

function landmarksForSandwich(wire: string) {
  const topEnd = wire.indexOf("\n");
  const middleStart = topEnd + 1;
  const middleEnd = wire.lastIndexOf("\n") - 1;
  const bottomStart = wire.lastIndexOf("\n") + 1;
  return {
    topEnd,
    middleStart,
    middleEnd,
    bottomStart,
    middleWrapRow1: middleStart,
    middleWrapRow2Interior: middleStart + 26,
    middleWrapRow2Tail: middleEnd,
  };
}

function samplesForSandwich(wire: string) {
  const L = landmarksForSandwich(wire);
  return [
    { wire: 0, top: VISUAL_ROW_TOP.r1, left: 0 },
    { wire: L.topEnd, top: VISUAL_ROW_TOP.r1, left: 40 },
    { wire: L.middleWrapRow1, top: VISUAL_ROW_TOP.r2, left: 0 },
    { wire: L.middleWrapRow1 + 10, top: VISUAL_ROW_TOP.r2, left: 200 },
    { wire: L.middleWrapRow2Interior, top: VISUAL_ROW_TOP.r3, left: 0 },
    { wire: L.middleWrapRow2Tail, top: VISUAL_ROW_TOP.r3, left: 400 },
    { wire: L.bottomStart, top: VISUAL_ROW_TOP.r4, left: 0 },
    { wire: wire.length - 1, top: VISUAL_ROW_TOP.r4, left: 60 },
  ];
}

function buildCompositeBlankBandWire(): string {
  return `prefix @${AGENT_COMPOSITE} \n\n@${AGENT_COMPOSITE} tail\n\n\n\nbottom @${AGENT_COMPOSITE}\n`;
}

function compositeWireLandmarks(wire: string) {
  const doc = wireToDoc(wire);
  const middleRowLineStart = wire.indexOf(`@${AGENT_COMPOSITE} tail`);
  const middleRowTailEnd = middleRowLineStart + `@${AGENT_COMPOSITE} tail`.length;
  const bottomLine = `bottom @${AGENT_COMPOSITE}`;
  const bottomLineStart = wire.indexOf(bottomLine);
  const blankRun = listEmbeddedBlankBandProbeWires(doc).filter(
    (probe) => probe >= middleRowTailEnd && probe < bottomLineStart
  );
  const endOfLastMention = bottomLineStart + bottomLine.length - 1;
  return { middleRowLineStart, blankRun, endOfLastMention };
}

function compositeLayoutSamples(wire: string) {
  const landmarks = compositeWireLandmarks(wire);
  const middleTop = 177;
  const samples: { wire: number; top: number; left: number }[] = [
    { wire: 0, top: 141, left: 0 },
    { wire: 5, top: 141, left: 40 },
    { wire: landmarks.middleRowLineStart - 1, top: 141, left: 200 },
    { wire: landmarks.middleRowLineStart, top: middleTop, left: 0 },
    { wire: landmarks.middleRowLineStart + 10, top: middleTop, left: 100 },
    { wire: landmarks.middleRowLineStart + 16, top: middleTop, left: 200 },
  ];
  let blankTop = 214;
  for (let index = 0; index < landmarks.blankRun.length; index++) {
    const blankWire = landmarks.blankRun[index]!;
    if (index === 0) {
      samples.push({ wire: blankWire, top: middleTop, left: 120 });
    } else {
      samples.push({ wire: blankWire, top: blankTop, left: 0 });
      blankTop += 37;
    }
  }
  samples.push(
    { wire: landmarks.endOfLastMention - 1, top: blankTop, left: 160 },
    { wire: landmarks.endOfLastMention, top: blankTop, left: 200 }
  );
  return samples;
}

function mountEditorHost(
  agentIds: string[] = [AGENT_COMPOSITE, AGENT_A, AGENT_B, "caliper-abc123"]
) {
  const root = document.createElement("div");
  root.style.width = "480px";
  document.body.appendChild(root);
  Object.defineProperty(root, "clientWidth", { configurable: true, value: 480 });
  const colorByAgentId = new Map(agentIds.map((id) => [id, "#06f"] as const));
  const editor = createHandoffNoteEditor({
    getColorByAgentId: () => colorByAgentId,
    onWireChange: () => {},
  });
  editor.setRoot(root);
  return { root, editor };
}

describe("handoff note arrow integration (handleKeyDown pipeline)", () => {
  let host: ReturnType<typeof mountEditorHost>;

  beforeEach(() => {
    host = mountEditorHost();
  });

  afterEach(() => {
    invalidateHandoffNoteLayoutCache();
    host.root.remove();
  });

  describe("control — plain multiline four-axis table", () => {
    const wire = "abcdef\nghij";

    it.each([
      {
        from: 4,
        axis: "vertical" as const,
        sign: -1 as const,
        expectWire: 3,
        note: "first-line vertical bleed → horizontal back",
      },
      {
        from: wire.length - 1,
        axis: "vertical" as const,
        sign: 1 as const,
        expectWire: wire.length,
        note: "last-line vertical bleed → horizontal forward",
      },
      {
        from: 3,
        axis: "horizontal" as const,
        sign: 1 as const,
        expectWire: 4,
        note: "horizontal forward",
      },
      {
        from: 4,
        axis: "horizontal" as const,
        sign: -1 as const,
        expectWire: 3,
        note: "horizontal back",
      },
    ])("$note", ({ from, axis, sign, expectWire }) => {
      host.editor.setDocFromWire(wire, from, { resetHistory: true });
      expect(pressArrow(host.editor, axis, sign)).toBe(true);
      expectCaretParity(host.editor, host.root, expectWire);
    });
  });

  describe("horizontal — mention jump and plain text", () => {
    it("jumps over a mention atom then returns", () => {
      const mentionStart = "Hi ".length;
      const mentionEnd = mentionStart + "@caliper-abc123".length;
      host.editor.setDocFromWire("Hi @caliper-abc123 there", mentionStart, { resetHistory: true });

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, mentionEnd);

      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, mentionStart);
    });

    it("steps plain text without delegating to the browser", () => {
      host.editor.setDocFromWire("abcdef", 3, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, 4);
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, 3);
    });
  });

  describe("vertical — boundary bleed with layout", () => {
    const bleedWire = `header \n\n\n@${AGENT_A} tail\n\n@${AGENT_A} end`;
    const firstLineExtreme = 4;
    const firstLineBleedWire = firstLineExtreme - 1;
    const lastMentionAt = bleedWire.lastIndexOf("@");
    const lastLineExtremeEnd = lastMentionAt + `@${AGENT_A}`.length;
    const layoutSamples = [
      { wire: 0, top: 100, left: 0 },
      { wire: firstLineExtreme, top: 100, left: 80 },
      { wire: 7, top: 112, left: 0 },
      { wire: 8, top: 124, left: 0 },
      { wire: 26, top: 100, left: 250 },
      { wire: 31, top: 130, left: 0 },
      { wire: lastMentionAt, top: 136, left: 0 },
      { wire: lastLineExtremeEnd, top: 136, left: 120 },
      { wire: bleedWire.length, top: 136, left: 160 },
    ];

    it("first line: up and left resolve to the same wire offset", () => {
      host.editor.setDocFromWire(bleedWire, firstLineExtreme, { resetHistory: true });
      setMeasuredSamplesCache(bleedWire, host.root.clientWidth, layoutSamples);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstLineBleedWire, "vertical −1");

      host.editor.setDocFromWire(bleedWire, firstLineExtreme, { resetHistory: true });
      setMeasuredSamplesCache(bleedWire, host.root.clientWidth, layoutSamples);
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstLineBleedWire, "horizontal −1");
    });

    it("last line: down and right resolve to the same wire offset", () => {
      host.editor.setDocFromWire(bleedWire, lastMentionAt, { resetHistory: true });
      setMeasuredSamplesCache(bleedWire, host.root.clientWidth, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastLineExtremeEnd, "vertical +1");

      host.editor.setDocFromWire(bleedWire, lastMentionAt, { resetHistory: true });
      setMeasuredSamplesCache(bleedWire, host.root.clientWidth, layoutSamples);
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastLineExtremeEnd, "horizontal +1");
    });
  });

  describe("vertical — multiline pill rows", () => {
    const threeLineWire = `handoff notes @${AGENT_A} \n@${AGENT_A} @${AGENT_B} \n@${AGENT_A} `;
    const line2Mention = threeLineWire.indexOf("@", threeLineWire.indexOf("\n") + 1);
    const line2SecondMention = threeLineWire.indexOf(`@${AGENT_B}`);
    const line3Mention = threeLineWire.lastIndexOf("@");

    it.each([
      {
        note: "later line pill start crosses to previous line pill start",
        wire: threeLineWire,
        from: line3Mention,
        sign: -1 as const,
        expectWire: line2Mention,
      },
      {
        note: "line pill start crosses to next line without same-row step",
        wire: threeLineWire,
        from: line2Mention,
        sign: 1 as const,
        expectWire: line3Mention,
        notExpectWire: line2SecondMention,
      },
    ])("$note", ({ wire, from, sign, expectWire, notExpectWire }) => {
      host.editor.setDocFromWire(wire, from, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", sign)).toBe(true);
      expect(host.editor.getCursor()).toBe(expectWire);
      if (notExpectWire !== undefined) {
        expect(host.editor.getCursor()).not.toBe(notExpectWire);
      }
      expectCaretParity(host.editor, host.root, expectWire);
    });

    const multiPillAgent = "caliper-ho14ofyh6";
    const multiPillWire = `handoff notes @${multiPillAgent} @${multiPillAgent} review phase\n\n\n\n\n\n@${multiPillAgent} context extra @${multiPillAgent} `;
    const firstPillOnRow = multiPillWire.lastIndexOf(`\n@${multiPillAgent} `) + 1;
    const secondPillOnRow = multiPillWire.lastIndexOf(` @${multiPillAgent} `) + 1;
    const multiPillDoc = wireToDoc(multiPillWire);
    const blankAboveRow = listEmbeddedBlankBandProbeWires(multiPillDoc)
      .filter((wire) => wire < firstPillOnRow)
      .at(-1)!;

    it("later pill on same row crosses to blank line above", () => {
      host.editor.setDocFromWire(multiPillWire, secondPillOnRow, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(blankAboveRow);
      expect(host.editor.getCursor()).not.toBe(firstPillOnRow);
      expectCaretParity(host.editor, host.root, blankAboveRow);
    });

    it("first pill on same row crosses to blank line above", () => {
      host.editor.setDocFromWire(multiPillWire, firstPillOnRow, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(blankAboveRow);
      expectCaretParity(host.editor, host.root, blankAboveRow);
    });

    const pillRowAgent = "caliper-jli3vwpry";
    const pillRowWire = `brief @${pillRowAgent} \n\n\n\n\n@${pillRowAgent} @${pillRowAgent} \n\n\nfollowup`;
    const pillRowSuffix = `@${pillRowAgent} @${pillRowAgent} `;
    const pillRowStart = pillRowWire.indexOf(pillRowSuffix);
    const pillRowEndingNewline = pillRowWire.indexOf(pillRowSuffix) + pillRowSuffix.length;
    const pillRowSecondPill = pillRowStart + `@${pillRowAgent} `.length;
    const pillRowDoc = wireToDoc(pillRowWire);
    const pillRowProbes = listEmbeddedBlankBandProbeWires(pillRowDoc);
    const firstBlankBelowPillRow = pillRowProbes.filter((wire) => wire >= pillRowEndingNewline)[0]!;
    const blanksAbovePillRow = pillRowProbes.filter((wire) => wire < pillRowStart);
    const emptyLineAbovePillRow = blanksAbovePillRow[blanksAbovePillRow.length - 2]!;

    it.each([
      {
        note: "pill row line start enters blank below not same-row pill",
        wire: pillRowWire,
        from: pillRowStart,
        sign: 1 as const,
        expectWire: firstBlankBelowPillRow,
        notExpectWire: pillRowSecondPill,
      },
      {
        note: "newline immediately above pill row crosses to prior blank probe",
        wire: pillRowWire,
        from: pillRowStart - 1,
        sign: -1 as const,
        expectWire: emptyLineAbovePillRow,
        notExpectWire: pillRowEndingNewline - 1,
      },
    ])("$note", ({ wire, from, sign, expectWire, notExpectWire }) => {
      host.editor.setDocFromWire(wire, from, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", sign)).toBe(true);
      expect(host.editor.getCursor()).toBe(expectWire);
      expect(host.editor.getCursor()).not.toBe(notExpectWire);
      expectCaretParity(host.editor, host.root, expectWire);
    });
  });

  describe("vertical — wire-line blank runs", () => {
    const gapWire = "header\n\n\n tail";
    const gapBlanks = listEmbeddedBlankBandProbeWires(wireToDoc(gapWire));

    it("header/tail gap: line start and first blank round-trip", () => {
      host.editor.setDocFromWire(gapWire, 0, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, gapBlanks[0]!);

      host.editor.setDocFromWire(gapWire, gapBlanks[0]!, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(0);
      expect(host.editor.getCursor()).not.toBe("header".length);
      expectCaretParity(host.editor, host.root, 0);
    });

    it("monotonic through EOF-only blank band reaches content line start", () => {
      const content = "header ";
      const wire = `${content}\n\n\n`;
      const blanks = listEmbeddedBlankBandProbeWires(wireToDoc(wire));
      const lastBlank = wire.length;
      host.editor.setDocFromWire(wire, lastBlank, { resetHistory: true });

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[2]!);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[1]!);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[0]!);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, 0);
    });

    it("monotonic ascent from doc start through EOF-only blank band", () => {
      const content = "header ";
      const wire = `${content}\n\n\n`;
      const blanks = listEmbeddedBlankBandProbeWires(wireToDoc(wire));
      const lastBlank = wire.length;
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[0]!);

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[1]!);

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[2]!);

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastBlank);
    });
  });

  describe("vertical — wire-line column 0 after pill suffix", () => {
    const shiftEnterPairWire = `row @${AGENT_A} mid @${AGENT_B} \n\ntail @${AGENT_A} `;
    const blankLineStart = listEmbeddedBlankBandProbeWires(wireToDoc(shiftEnterPairWire))[0]!;
    const prefixMentionAt = shiftEnterPairWire.indexOf("@");
    const lowerMentionEnd = shiftEnterPairWire.length - 1;

    it("up from blank wire line at column 0 with editor parity", () => {
      host.editor.setDocFromWire(shiftEnterPairWire, blankLineStart, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(0);
      expect(host.editor.getCursor()).not.toBe(prefixMentionAt);
      expectCaretParity(host.editor, host.root, 0, "up from blank wire line");
    });

    it("vertical chain from lower mention never lands on prefix mention with editor parity", () => {
      host.editor.setDocFromWire(shiftEnterPairWire, lowerMentionEnd, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(blankLineStart);
      expect(host.editor.getCursor()).not.toBe(prefixMentionAt);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(0);
      expect(host.editor.getCursor()).not.toBe(prefixMentionAt);
      expectCaretParity(host.editor, host.root, 0, "vertical chain to line start");
    });

    const longBeforeMentionWire = `header\n\nrow @${AGENT_A}  @${AGENT_B} tail\n\n\n@${AGENT_A} `;
    const tailMarker = ` @${AGENT_B} tail`;
    const tailContent = longBeforeMentionWire.indexOf(tailMarker) + tailMarker.length - 1;
    const tailRowEnd = longBeforeMentionWire.indexOf(tailMarker) + tailMarker.length;
    const blanksBelowTail = listEmbeddedBlankBandProbeWires(
      wireToDoc(longBeforeMentionWire)
    ).filter((wire) => wire >= tailRowEnd);
    const blankAboveContentRow = blanksBelowTail[0]!;
    const bottomBlankBelowTail = blanksBelowTail.at(-1)!;
    const rowLineStart = longBeforeMentionWire.indexOf("row");

    it("long tail line: blank below tail and up round-trip with editor parity", () => {
      host.editor.setDocFromWire(longBeforeMentionWire, blankAboveContentRow, {
        resetHistory: true,
      });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(rowLineStart);
      expect(host.editor.getCursor()).not.toBe(0);
      expectCaretParity(host.editor, host.root, rowLineStart, "up from blank below tail");

      host.editor.setDocFromWire(longBeforeMentionWire, tailContent, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, bottomBlankBelowTail, "down to blank below tail");
    });
  });

  describe("vertical — column preserve two-pill row to plain row", () => {
    const row1 = `row @${AGENT_A} mid @${AGENT_B} end`;
    const gapMid = row1.indexOf(" mid ") + 3;
    const column = gapMid;
    const wire = `${row1}\n${" ".repeat(column)}mark`;

    it("inter-pill gap and aligned row below round-trip with editor parity", () => {
      host.editor.setDocFromWire(wire, gapMid, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      const belowGap = row1.length + 1 + column;
      expect(host.editor.getCursor()).toBe(belowGap);
      expectCaretParity(host.editor, host.root, belowGap, "down from inter-pill gap");

      host.editor.setDocFromWire(wire, belowGap, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(gapMid);
      expect(host.editor.getCursor()).not.toBe(row1.indexOf("@"));
      expectCaretParity(host.editor, host.root, gapMid, "up to inter-pill gap");
    });
  });

  describe("vertical — wire newline with layout", () => {
    const wrapAgentA = "caliper-linea01";
    const wrapAgentB = "caliper-lineb02";
    const wrapWire = `@${wrapAgentA} header\n\n@${wrapAgentA} fill@${wrapAgentB} tail `;
    const wrapBlankProbe = listEmbeddedBlankBandProbeWires(wireToDoc(wrapWire))[0]!;
    const wrapNextLineStart = wrapWire.indexOf("@", wrapWire.indexOf("\n"));
    const wrapRow1Top = 141;
    const wrapRowBlankTop = 159;
    const wrapRow2Top = 177;
    const wrapStartLeft = 347;

    function mountWrapLayoutSamples(fromWire: number, expectWire: number) {
      return [
        { wire: 0, top: wrapRow1Top, left: wrapStartLeft },
        { wire: wrapBlankProbe, top: wrapRowBlankTop, left: wrapStartLeft },
        { wire: wrapNextLineStart, top: wrapRow2Top, left: wrapStartLeft },
        { wire: fromWire, top: wrapRow2Top, left: wrapStartLeft },
        { wire: expectWire, top: wrapRow2Top, left: wrapStartLeft + 80 },
        { wire: wrapWire.length, top: wrapRow2Top, left: wrapStartLeft + 120 },
      ];
    }

    it("empty wire line and next line start round-trip", () => {
      host.editor.setDocFromWire(wrapWire, wrapBlankProbe, { resetHistory: true });
      setMeasuredSamplesCache(
        wrapWire,
        host.root.clientWidth,
        mountWrapLayoutSamples(wrapBlankProbe, wrapNextLineStart)
      );
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, wrapNextLineStart);

      host.editor.setDocFromWire(wrapWire, wrapNextLineStart, { resetHistory: true });
      setMeasuredSamplesCache(
        wrapWire,
        host.root.clientWidth,
        mountWrapLayoutSamples(wrapNextLineStart, wrapBlankProbe)
      );
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, wrapBlankProbe);
    });

    it("last wire line start boundary-bleeds to mention end", () => {
      const lastLineStart = wrapWire.lastIndexOf("\n") + 1;
      const lastLineMentionEnd = lastLineStart + `@${wrapAgentA}`.length;
      host.editor.setDocFromWire(wrapWire, lastLineStart, { resetHistory: true });
      setMeasuredSamplesCache(
        wrapWire,
        host.root.clientWidth,
        mountWrapLayoutSamples(lastLineStart, lastLineMentionEnd)
      );
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastLineMentionEnd);
    });
  });

  describe("vertical — suffix blank band above lower row", () => {
    const wire = `header @${AGENT_A} \n\n@${AGENT_A} `;
    const suffixDoc = wireToDoc(wire);
    const emptyRowWire = listEmbeddedBlankBandProbeWires(suffixDoc)[0]!;
    const lowerPillStartWire = wire.indexOf("@", emptyRowWire + 1);
    const postMentionSpaceWire = lowerPillStartWire + `@${AGENT_A}`.length;

    function suffixBlankAbovePillLayoutSamples() {
      const row0Top = 100;
      const row1Top = 136;
      const row2Top = 172;
      return [
        { wire: 0, top: row0Top, left: 0 },
        { wire: 4, top: row0Top, left: 40 },
        { wire: emptyRowWire - 1, top: row0Top, left: 200 },
        { wire: emptyRowWire, top: row1Top, left: 0 },
        { wire: lowerPillStartWire, top: row2Top, left: 0 },
        { wire: postMentionSpaceWire, top: row2Top, left: 200 },
        { wire: wire.length - 1, top: row2Top, left: 220 },
      ];
    }

    it("core wire-cross down from empty suffix row lands lower pill start", () => {
      const doc = wireToDoc(wire);
      const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, emptyRowWire), "down");
      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(lowerPillStartWire);
    });

    it("down from empty suffix row lands lower pill start with editor/DOM parity", () => {
      host.editor.setDocFromWire(wire, emptyRowWire, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, suffixBlankAbovePillLayoutSamples());
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        lowerPillStartWire,
        "empty suffix row to lower pill line start"
      );
    });

    it("down from empty suffix row lands on mention atom start not trailing text node", () => {
      host.editor.setDocFromWire(wire, emptyRowWire, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, suffixBlankAbovePillLayoutSamples());
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(lowerPillStartWire);
      const focus = host.editor.getSelectionState().focus;
      expect(host.editor.getDoc().nodes[focus.nodeIndex]?.type).toBe("mention");
      expect(focus.nodeOffset).toBe(0);
    });

    it("down from lower pill line start boundary-bleeds to post-mention space", () => {
      host.editor.setDocFromWire(wire, lowerPillStartWire, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, suffixBlankAbovePillLayoutSamples());
      const focus = host.editor.getSelectionState().focus;
      expect(host.editor.getDoc().nodes[focus.nodeIndex]?.type).toBe("mention");
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        postMentionSpaceWire,
        "last wire line start bleeds right to post-mention space"
      );
    });

    it("empty suffix row then lower pill start bleeds on second down", () => {
      host.editor.setDocFromWire(wire, emptyRowWire, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, suffixBlankAbovePillLayoutSamples());
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      const focus = host.editor.getSelectionState().focus;
      expect(host.editor.getDoc().nodes[focus.nodeIndex]?.type).toBe("mention");
      expect(host.editor.getCursor()).toBe(lowerPillStartWire);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, postMentionSpaceWire, "second down bleeds right");
    });

    it("round-trip — up from post-mention then down chain restores lower pill start", () => {
      host.editor.setDocFromWire(wire, postMentionSpaceWire - 1, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, suffixBlankAbovePillLayoutSamples());
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, emptyRowWire, "up to empty suffix row");
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, 0, "up to row 1 start");
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, emptyRowWire, "down to empty suffix row");
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        lowerPillStartWire,
        "down to lower pill start after round-trip"
      );
    });

    describe("two pills on upper row", () => {
      const twoPillWire = `row @${AGENT_A} @${AGENT_A} \n\n@${AGENT_A} `;
      const twoPillDoc = wireToDoc(twoPillWire);
      const postFirstPillWire =
        docPosToWireOffset(twoPillDoc, { nodeIndex: 1, nodeOffset: AGENT_A.length }) + 1;
      const firstSuffixBlankWire = listEmbeddedBlankBandProbeWires(twoPillDoc)[0]!;
      const lowerPillStartWire = docPosToWireOffset(twoPillDoc, { nodeIndex: 5, nodeOffset: 0 });

      function twoPillSuffixBlankLayoutSamples() {
        const postSecondPillWire =
          docPosToWireOffset(twoPillDoc, { nodeIndex: 3, nodeOffset: AGENT_A.length }) + 1;
        return [
          { wire: 0, top: VISUAL_ROW_TOP.r1, left: 0 },
          { wire: postFirstPillWire, top: VISUAL_ROW_TOP.r1, left: 200 },
          { wire: postSecondPillWire, top: VISUAL_ROW_TOP.r1, left: 400 },
          { wire: firstSuffixBlankWire, top: VISUAL_ROW_TOP.r2, left: 0 },
          { wire: lowerPillStartWire, top: VISUAL_ROW_TOP.r3, left: 0 },
          { wire: twoPillWire.length - 1, top: VISUAL_ROW_TOP.r3, left: 200 },
        ];
      }

      it("up from lower pill lands suffix blank not upper row post-pill", () => {
        setDocWithLayout(
          host.editor,
          host.root,
          twoPillWire,
          lowerPillStartWire,
          twoPillSuffixBlankLayoutSamples()
        );
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expectCaretParity(host.editor, host.root, firstSuffixBlankWire, "up to suffix blank");
        expect(host.editor.getCursor()).not.toBe(postFirstPillWire);
      });

      it("round-trip — lower pill and suffix blank with measured layout", () => {
        setDocWithLayout(
          host.editor,
          host.root,
          twoPillWire,
          lowerPillStartWire,
          twoPillSuffixBlankLayoutSamples()
        );
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expectCaretParity(host.editor, host.root, firstSuffixBlankWire);
        expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
        expectCaretParity(host.editor, host.root, lowerPillStartWire);
      });

      it("up from lower pill reaches suffix blank with editor/DOM parity", () => {
        host.editor.setDocFromWire(twoPillWire, lowerPillStartWire, { resetHistory: true });
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor()).toBe(firstSuffixBlankWire);
        expect(host.editor.getCursor()).not.toBe(postFirstPillWire);
        expectCaretParity(host.editor, host.root, firstSuffixBlankWire);
      });

      it("down from suffix blank returns to lower pill with editor/DOM parity", () => {
        host.editor.setDocFromWire(twoPillWire, firstSuffixBlankWire, { resetHistory: true });
        expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
        expectCaretParity(host.editor, host.root, lowerPillStartWire);
      });
    });
  });

  describe("vertical — composite layout with authority/DOM parity", () => {
    let wire: string;
    let endOfLastMention: number;
    let thirdBlankAboveBottom: number;
    let secondBlankAboveBottom: number;
    let middleRowLineStart: number;

    let firstBlankAboveBottom: number;

    beforeEach(() => {
      wire = buildCompositeBlankBandWire();
      const landmarks = compositeWireLandmarks(wire);
      middleRowLineStart = landmarks.middleRowLineStart;
      endOfLastMention = landmarks.endOfLastMention;
      thirdBlankAboveBottom = landmarks.blankRun.at(-2)!;
      secondBlankAboveBottom = landmarks.blankRun.at(-3)!;
      firstBlankAboveBottom = landmarks.blankRun[0]!;
      expect(landmarks.blankRun.length).toBeGreaterThanOrEqual(3);

      host.editor.setDocFromWire(wire, endOfLastMention, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, compositeLayoutSamples(wire));
    });

    it("vertical chain through blank band to middle row with editor/DOM parity", () => {
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        thirdBlankAboveBottom,
        "first step off bottom mention"
      );

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        secondBlankAboveBottom,
        "second step into blank band"
      );

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        middleRowLineStart,
        "third step exits blank band to middle row visual start"
      );

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        firstBlankAboveBottom,
        "round-trip into blank band"
      );
    });

    it("no freeze stepping from blank band through middle row", () => {
      host.editor.setDocFromWire(wire, secondBlankAboveBottom, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, compositeLayoutSamples(wire));

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(middleRowLineStart);
      expectCaretParity(host.editor, host.root, middleRowLineStart, "blank band to middle row");

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).not.toBe(middleRowLineStart);
      expectCaretParity(
        host.editor,
        host.root,
        host.editor.getCursor(),
        "continues without DOM snap-back"
      );
    });

    it("middle row descends back into blank band with parity", () => {
      host.editor.setDocFromWire(wire, middleRowLineStart, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, compositeLayoutSamples(wire));

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        firstBlankAboveBottom,
        "middle row into blank band"
      );
    });
  });

  describe("horizontal — middle-row tail", () => {
    it("steps forward and back along middle-row tail text", () => {
      const wire = buildCompositeBlankBandWire();
      const tailStart = wire.indexOf(" tail") + 1;
      const tailInterior = tailStart + 2;

      host.editor.setDocFromWire(wire, tailInterior, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, compositeLayoutSamples(wire));

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, tailInterior + 1);

      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, tailInterior);
    });
  });

  describe("horizontal — prefix gap before mention after blank run", () => {
    it("steps into prefix gap and returns to mention start", () => {
      const multilineWire = `header \n\n\n\n\n@${AGENT_A} `;
      const mentionStart = multilineWire.indexOf("@");

      host.editor.setDocFromWire(multilineWire, mentionStart, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, mentionStart - 1);

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, mentionStart);
    });
  });

  describe("horizontal — matrix suffix doc positions", () => {
    const suffixWire = `row @${AGENT_A} mid @${AGENT_B} tail\n\n\nlower @${AGENT_A} `;
    const rowTail = suffixWire.indexOf("tail") + 2;
    const suffixBlank = listEmbeddedBlankBandProbeWires(wireToDoc(suffixWire))[0]!;
    const lowerMention = suffixWire.lastIndexOf("@");

    it("row tail and suffix blank round-trip horizontally with editor parity", () => {
      host.editor.setDocFromWire(suffixWire, rowTail, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, rowTail + 1);
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, rowTail);

      host.editor.setDocFromWire(suffixWire, suffixBlank, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, suffixBlank + 1);
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, suffixBlank);
    });

    it("lower mention horizontal round-trip with editor parity", () => {
      const mentionEnd = lowerMention + `@${AGENT_A}`.length;
      host.editor.setDocFromWire(suffixWire, lowerMention, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, mentionEnd);
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, lowerMention);
    });
  });

  describe("vertical — matrix pill count and blank run", () => {
    it("three-pill row tail enters blank below with editor parity", () => {
      const row = `row @${AGENT_A} @${AGENT_A} @${AGENT_A} end`;
      const wire = `${row}\n\n\nfollow`;
      const rowTail = row.length - 1;
      const blanksBelowRow = listEmbeddedBlankBandProbeWires(wireToDoc(wire)).filter(
        (probe) => probe > rowTail
      );
      const firstBlankBelowRow = blanksBelowRow.at(-1)!;
      host.editor.setDocFromWire(wire, rowTail, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(firstBlankBelowRow);
      expectCaretParity(host.editor, host.root, firstBlankBelowRow);
    });

    it("five-blank wire band column-0 round-trip with editor parity", () => {
      const header = "header";
      const wire = `${header}${"\n".repeat(6)}tail`;
      const blanks = listEmbeddedBlankBandProbeWires(wireToDoc(wire));
      expect(blanks).toHaveLength(5);
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[0]!);
      host.editor.setDocFromWire(wire, blanks[0]!, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, 0);
    });

    it("four-pill row line start and first blank below round-trip with editor parity", () => {
      const row = `row @${AGENT_A} @${AGENT_A} @${AGENT_A} @${AGENT_A} end`;
      const wire = `${row}\n\n\nfollow`;
      const pillRowStart = 0;
      const firstBlank = listEmbeddedBlankBandProbeWires(wireToDoc(wire))[0]!;
      const secondPill = wire.indexOf(`@${AGENT_A}`, wire.indexOf(`@${AGENT_A}`) + 1);
      host.editor.setDocFromWire(wire, pillRowStart, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(firstBlank);
      expect(host.editor.getCursor()).not.toBe(secondPill);
      expectCaretParity(host.editor, host.root, firstBlank);
      host.editor.setDocFromWire(wire, firstBlank, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, pillRowStart);
    });

    it("seven-blank wire band column-0 round-trip with editor parity", () => {
      const wire = `header${"\n".repeat(8)} tail`;
      const blanks = listEmbeddedBlankBandProbeWires(wireToDoc(wire));
      const tailStart = wire.indexOf("tail");
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[0]!);
      host.editor.setDocFromWire(wire, tailStart, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[6]!);
      host.editor.setDocFromWire(wire, blanks[0]!, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, 0);
    });
  });

  describe("vertical — unsampled interior on soft-wrapped wire line", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `prefix @${agent}  tail @${agent} `;
    const row1Top = 141.09897422790527;
    const row2Top = 159.29689598083496;
    const rowStartLeft = 347;
    const prefixMidWire = 2;
    const wrappedInteriorWire = 29;
    const layoutSamples = [
      { wire: 0, top: row1Top, left: rowStartLeft },
      { wire: 5, top: row1Top, left: 400 },
      { wire: 24, top: row1Top, left: 480 },
      { wire: 23, top: row2Top, left: 350 },
      { wire: 28, top: row2Top, left: 362 },
      { wire: 46, top: row2Top, left: 479 },
      { wire: 47, top: row2Top, left: 483 },
    ];

    it("prefix interior and wrapped interior round-trip with editor parity", () => {
      host.editor.setDocFromWire(wire, prefixMidWire, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(wrappedInteriorWire);
      expectCaretParity(host.editor, host.root, wrappedInteriorWire);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(prefixMidWire);
      expectCaretParity(host.editor, host.root, prefixMidWire);
    });
  });

  describe("vertical — mention end and post-mention text on soft-wrapped wire line", () => {
    const agent = "caliper-aaaaaaaaaaa";
    const wire = `header @${agent} tail @${agent} `;
    const doc = wireToDoc(wire);
    const secondMentionEnd = wire.length - 1;
    const firstMentionStart = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: 0 });
    const firstMentionEnd = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: agent.length });
    const postMentionStart = firstMentionEnd + 1;
    const gapMidWire = postMentionStart + 3;
    const secondMentionMid = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 4 });
    const row1Top = 141.09897422790527;
    const row2Top = 159.29689598083496;
    const layoutSamples = [
      { wire: 0, top: row1Top, left: 347 },
      { wire: firstMentionStart, top: row1Top, left: 360 },
      { wire: postMentionStart, top: row1Top, left: 480 },
      { wire: firstMentionEnd, top: row2Top, left: 505.38543701171875 },
      { wire: gapMidWire, top: row2Top, left: 362 },
      { wire: secondMentionMid, top: row2Top, left: 470 },
      { wire: secondMentionEnd, top: row2Top, left: 482.7083435058594 },
    ];

    it("second mention end and upper row round-trip with editor parity", () => {
      host.editor.setDocFromWire(wire, secondMentionEnd, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, layoutSamples);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstMentionStart, "up to upper row");

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, gapMidWire, "down restores lower row column");
    });
  });

  describe("vertical — multiline wire line with same-wire soft wrap", () => {
    const wire = wrappedFirstLineWire();
    const L = landmarksForWrappedFirstLine(wire);
    const layoutSamples = samplesForWrappedFirstLine(wire);

    it("down from wrap row 1 stays on interior visual row", () => {
      setDocWithLayout(host.editor, host.root, wire, L.wrapRow1Wire, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.wrapRow2InteriorWire, "wrap row 2 interior");
      expect(host.editor.getCursor()).not.toBe(L.line1Start);
    });

    it("down from wrap row 2 interior crosses to visual row below at row start", () => {
      setDocWithLayout(host.editor, host.root, wire, L.wrapRow2InteriorWire, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.line1Start, "visual row below");
    });

    it("round-trip — wrap interior down then up restores interior", () => {
      setDocWithLayout(host.editor, host.root, wire, L.wrapRow2InteriorWire, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.line1Start);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.wrapRow2InteriorWire);
    });

    it("two-step down from wrap row 1 visits wrap row 2 before row below", () => {
      setDocWithLayout(host.editor, host.root, wire, L.wrapRow1Wire, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(L.wrapRow2InteriorWire);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.line1Start);
    });
  });

  describe("vertical — middle wire line soft wrap between neighbours", () => {
    const wire = sandwichWire();
    const L = landmarksForSandwich(wire);
    const layoutSamples = samplesForSandwich(wire);

    it("down from middle wrap row 1 stays on middle wire line", () => {
      setDocWithLayout(host.editor, host.root, wire, L.middleWrapRow1, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.middleWrapRow2Interior, "middle wrap row 2");
      expect(host.editor.getCursor()).not.toBe(L.bottomStart);
    });

    it("down from middle wrap row 2 interior crosses to bottom visual row", () => {
      setDocWithLayout(host.editor, host.root, wire, L.middleWrapRow2Interior, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.bottomStart);
    });

    it("up from middle wrap row 2 interior lands on middle wrap row 1", () => {
      setDocWithLayout(host.editor, host.root, wire, L.middleWrapRow2Interior, layoutSamples);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.middleWrapRow1);
    });

    it("down from top visual row crosses to middle wrap row 1", () => {
      setDocWithLayout(host.editor, host.root, wire, 0, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.middleWrapRow1, "short top to middle");
    });
  });

  describe("vertical — empty row below wrapped line", () => {
    const wire = `${wrappedFirstLineWire().replace(/\nrow3$/, "")}\n\nbelow`;
    const emptyLineWire = wire.indexOf("\n") + 1;
    const belowStart = wire.lastIndexOf("\n") + 1;

    function samples() {
      const base = samplesForWrappedFirstLine(
        wire.replace(/\n\nbelow$/, "\nrow3"),
        VISUAL_ROW_TOP.r3
      );
      return [
        ...base.filter((sample) => sample.wire < emptyLineWire),
        { wire: emptyLineWire, top: VISUAL_ROW_TOP.r3, left: 0 },
        { wire: belowStart, top: VISUAL_ROW_TOP.r4, left: 0 },
        { wire: wire.length - 1, top: VISUAL_ROW_TOP.r4, left: 40 },
      ];
    }

    it("down from wrap row 2 tail lands on empty row not row below", () => {
      const wrapTail = emptyLineWire - 1;
      setDocWithLayout(host.editor, host.root, wire, wrapTail, samples());
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, emptyLineWire, "empty row");
      expect(host.editor.getCursor()).not.toBe(belowStart);
    });

    it("down from empty row crosses to row below", () => {
      setDocWithLayout(host.editor, host.root, wire, emptyLineWire, samples());
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, belowStart);
    });
  });

  describe("vertical — multiple visual rows below wrapped first line", () => {
    const wire = `header @${AGENT_A} ${longTail()}\nline1\nline2`;
    const L = landmarksForWrappedFirstLine(wire.replace(/\nline1\nline2$/, "\nrow3"));
    const line1Start = wire.indexOf("\n") + 1;
    const line2Start = wire.lastIndexOf("\n") + 1;

    function samples() {
      const base = samplesForWrappedFirstLine(
        wire.replace(/\nline1\nline2$/, "\nrow3"),
        VISUAL_ROW_TOP.r3
      );
      return [
        ...base.slice(0, -2),
        { wire: line1Start, top: VISUAL_ROW_TOP.r3, left: 0 },
        { wire: line1Start + 4, top: VISUAL_ROW_TOP.r3, left: 40 },
        { wire: line2Start, top: VISUAL_ROW_TOP.r4, left: 0 },
        { wire: wire.length - 1, top: VISUAL_ROW_TOP.r4, left: 40 },
      ];
    }

    it("down from wrap row 1 does not skip to lower rows", () => {
      setDocWithLayout(host.editor, host.root, wire, L.wrapRow1Wire, samples());
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(L.wrapRow2InteriorWire);
      expect(host.editor.getCursor()).not.toBe(line1Start);
      expect(host.editor.getCursor()).not.toBe(line2Start);
    });

    it("down from wrap row 2 interior crosses to first row below wrap", () => {
      setDocWithLayout(host.editor, host.root, wire, L.wrapRow2InteriorWire, samples());
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, line1Start);
      expect(host.editor.getCursor()).not.toBe(line2Start);
    });
  });

  describe("vertical — wrapped line then Shift+Enter row below", () => {
    const wire = `header @${AGENT_A} ${longTail(12)}\nrow3`;
    const L = landmarksForWrappedFirstLine(wire);

    it("down chain visits wrap row 2 then visual row below", () => {
      setDocWithLayout(
        host.editor,
        host.root,
        wire,
        L.wrapRow1Wire,
        samplesForWrappedFirstLine(wire)
      );
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(L.wrapRow2InteriorWire);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.line1Start);
    });
  });

  describe("vertical — wrapped suffix after mention row", () => {
    const agent = "caliper-aaaaaaaaaaa";
    const wire = `header @${agent} @${agent} ${"tail ".repeat(24)}`;
    const doc = wireToDoc(wire);
    const tailWire = wire.length - 1;
    const prefixStart = docPosToWireOffset(doc, { nodeIndex: 0, nodeOffset: 0 });
    const firstMentionEnd = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: agent.length });
    const postMentionStart = firstMentionEnd + 1;
    const secondMentionEnd = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: agent.length });
    const secondPostStart = secondMentionEnd + 1;
    const row1Top = 141.09897422790527;
    const row2Top = 159.29689598083496;

    it("up from wrapped suffix tail uses vertical layout not horizontal bleed", () => {
      host.editor.setDocFromWire(wire, tailWire, { resetHistory: true });
      setMeasuredSamplesCache(wire, host.root.clientWidth, [
        { wire: prefixStart, top: row1Top, left: 0 },
        { wire: postMentionStart, top: row1Top, left: 200 },
        { wire: firstMentionEnd, top: row1Top, left: 220 },
        { wire: secondPostStart, top: row1Top, left: 400 },
        { wire: secondMentionEnd, top: row1Top, left: 420 },
        { wire: tailWire, top: row2Top, left: 520 },
      ]);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).not.toBe(tailWire - 1);
      expect(host.editor.getCursor()).toBeLessThan(tailWire - 5);
      expectCaretParity(host.editor, host.root, host.editor.getCursor(), "vertical up from tail");
    });
  });
});
