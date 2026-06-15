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
import { docPosToWireOffset, wireToDoc } from "@caliper/core";
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

function buildCompositeBlankBandWire(): string {
  return `prefix @${AGENT_COMPOSITE} \n\n@${AGENT_COMPOSITE} tail\n\n\nbottom @${AGENT_COMPOSITE}\n`;
}

function compositeWireLandmarks(wire: string) {
  const middleRowLineStart = wire.indexOf(`@${AGENT_COMPOSITE} tail`);
  const middleRowTailEnd = middleRowLineStart + `@${AGENT_COMPOSITE} tail`.length;
  const blankRun: number[] = [];
  for (let index = middleRowTailEnd; index < wire.length && wire[index] === "\n"; index++) {
    blankRun.push(index);
  }
  const bottomLine = `bottom @${AGENT_COMPOSITE}`;
  const bottomLineStart = wire.indexOf(bottomLine);
  const endOfLastMention = bottomLineStart + bottomLine.length;
  return { middleRowLineStart, blankRun, endOfLastMention };
}

function compositeLayoutSamples(wire: string) {
  const landmarks = compositeWireLandmarks(wire);
  return [
    { wire: 0, top: 141, left: 0 },
    { wire: 5, top: 141, left: 40 },
    { wire: landmarks.middleRowLineStart - 1, top: 141, left: 200 },
    { wire: landmarks.middleRowLineStart, top: 177, left: 0 },
    { wire: landmarks.middleRowLineStart + 10, top: 177, left: 100 },
    { wire: landmarks.blankRun[0] ?? 0, top: 214, left: 0 },
    { wire: landmarks.blankRun.at(-1) ?? 0, top: 214, left: 120 },
    { wire: landmarks.endOfLastMention - 1, top: 214, left: 160 },
    { wire: landmarks.endOfLastMention, top: 214, left: 200 },
  ];
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
      { wire: 26, top: 100, left: 250 },
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
    const blankAboveRow = firstPillOnRow - 1;

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
    const firstBlankBelowPillRow = pillRowWire.indexOf(pillRowSuffix) + pillRowSuffix.length + 1;
    const lineStarts = [0];
    for (let index = 0; index < pillRowWire.length; index++) {
      if (pillRowWire[index] === "\n") {
        lineStarts.push(index + 1);
      }
    }
    const pillRowLineIndex = lineStarts.findIndex(
      (start) => start === pillRowWire.indexOf(pillRowSuffix)
    );
    const emptyLineAbovePillRow = lineStarts[pillRowLineIndex - 1]!;

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
        note: "newline ending pill row crosses to empty line above",
        wire: pillRowWire,
        from: pillRowEndingNewline,
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
    const firstBlankLine = "header\n".length;

    it("header/tail gap: line start and first blank round-trip", () => {
      host.editor.setDocFromWire(gapWire, 0, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstBlankLine);

      host.editor.setDocFromWire(gapWire, firstBlankLine, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(0);
      expect(host.editor.getCursor()).not.toBe("header".length);
      expectCaretParity(host.editor, host.root, 0);
    });

    it("monotonic through EOF-only blank band reaches content line start", () => {
      const content = "header ";
      const wire = `${content}\n\n\n`;
      const firstBlank = content.length + 1;
      const lastBlank = wire.length;
      host.editor.setDocFromWire(wire, lastBlank, { resetHistory: true });

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstBlank + 1);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstBlank);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, 0);
    });

    it("monotonic ascent from doc start through EOF-only blank band", () => {
      const content = "header ";
      const wire = `${content}\n\n\n`;
      const firstBlank = content.length + 1;
      const secondBlank = firstBlank + 1;
      const lastBlank = wire.length;
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstBlank);

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, secondBlank);

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastBlank);
    });
  });

  describe("vertical — wire-line column 0 after pill suffix", () => {
    const shiftEnterPairWire = `row @${AGENT_A} mid @${AGENT_B} \n\ntail @${AGENT_A} `;
    const blankLineStart = shiftEnterPairWire.indexOf("\n\n") + 1;
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
    const blankLineBelowTail = tailContent + 2;
    const rowLineStart = longBeforeMentionWire.indexOf("row");

    it("long tail line: blank below tail and up round-trip with editor parity", () => {
      host.editor.setDocFromWire(longBeforeMentionWire, blankLineBelowTail, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(rowLineStart);
      expect(host.editor.getCursor()).not.toBe(0);
      expectCaretParity(host.editor, host.root, rowLineStart, "up from blank below tail");

      host.editor.setDocFromWire(longBeforeMentionWire, tailContent, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blankLineBelowTail, "down to blank below tail");
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
    const wrapRow1Top = 141;
    const wrapRow2Top = 177;
    const wrapStartLeft = 347;

    function mountWrapLayoutSamples(fromWire: number, expectWire: number) {
      return [
        { wire: 0, top: wrapRow1Top, left: wrapStartLeft },
        { wire: wrapWire.indexOf("\n") + 1, top: wrapRow1Top, left: wrapStartLeft + 40 },
        { wire: wrapWire.indexOf("\n") + 2, top: wrapRow2Top, left: wrapStartLeft },
        { wire: fromWire, top: wrapRow2Top, left: wrapStartLeft },
        { wire: expectWire, top: wrapRow2Top, left: wrapStartLeft + 80 },
        { wire: wrapWire.length, top: wrapRow2Top, left: wrapStartLeft + 120 },
      ];
    }

    it("empty wire line and next line start round-trip", () => {
      const blankLineStart = wrapWire.indexOf("\n") + 1;
      const nextLineStart = blankLineStart + 1;
      host.editor.setDocFromWire(wrapWire, blankLineStart, { resetHistory: true });
      setMeasuredSamplesCache(
        wrapWire,
        host.root.clientWidth,
        mountWrapLayoutSamples(blankLineStart, nextLineStart)
      );
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, nextLineStart);

      host.editor.setDocFromWire(wrapWire, nextLineStart, { resetHistory: true });
      setMeasuredSamplesCache(
        wrapWire,
        host.root.clientWidth,
        mountWrapLayoutSamples(nextLineStart, blankLineStart)
      );
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, blankLineStart);
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

  describe("vertical — composite layout with authority/DOM parity", () => {
    let wire: string;
    let endOfLastMention: number;
    let thirdBlankAboveBottom: number;
    let secondBlankAboveBottom: number;
    let middleRowLineStart: number;

    beforeEach(() => {
      wire = buildCompositeBlankBandWire();
      const landmarks = compositeWireLandmarks(wire);
      middleRowLineStart = landmarks.middleRowLineStart;
      endOfLastMention = landmarks.endOfLastMention;
      thirdBlankAboveBottom = landmarks.blankRun.at(-1)!;
      secondBlankAboveBottom = landmarks.blankRun.at(-2)!;
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
        "column-0 blank lands on line above start"
      );

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        secondBlankAboveBottom,
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
        secondBlankAboveBottom,
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
    const suffixBlank = suffixWire.indexOf("\n\n") + 1;
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
      const firstBlank = row.length + 1;
      host.editor.setDocFromWire(wire, rowTail, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(firstBlank);
      expectCaretParity(host.editor, host.root, firstBlank);
    });

    it("five-blank wire band column-0 round-trip with editor parity", () => {
      const wire = `header\n\n\n\n\n\ntail`;
      const firstBlank = "header\n".length;
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstBlank);
      host.editor.setDocFromWire(wire, firstBlank, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, 0);
    });

    it("four-pill row line start and first blank below round-trip with editor parity", () => {
      const row = `row @${AGENT_A} @${AGENT_A} @${AGENT_A} @${AGENT_A} end`;
      const wire = `${row}\n\n\nfollow`;
      const pillRowStart = 0;
      const firstBlank = row.length + 1;
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
      const wire = `header\n\n\n\n\n\n\n tail`;
      const firstBlank = "header\n".length;
      const lastBlank = "header\n\n\n\n\n\n".length;
      const tailStart = wire.indexOf("tail");
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstBlank);
      host.editor.setDocFromWire(wire, tailStart, { resetHistory: true });
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastBlank);
      host.editor.setDocFromWire(wire, firstBlank, { resetHistory: true });
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
      expectCaretParity(host.editor, host.root, secondMentionEnd, "down restores lower row");
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
