import { describe, expect, it } from "vitest";
import {
  collapsedSelection,
  docEndPos,
  docPosEqual,
  docPosToWireOffset,
  docSelectionToWireRange,
  normalizeDocPos,
  normalizeSelection,
  resolveDocHorizontalArrowMove,
  resolveDocVerticalArrowMove,
  selectionsEqual,
  wireOffsetToCollapsedSelection,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import { docToWire, wireToDoc } from "./handoff-note-doc.js";
import { resolveWireLineColumn } from "./handoff-note-vertical-nav.js";

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

  it("resolveDocHorizontalArrowMove steps adjacent plain text with handled true", () => {
    const doc = wireToDoc("abcdef");
    const right = resolveDocHorizontalArrowMove(doc, wireOffsetToDocPos(doc, 3), "right");
    expect(right.handled).toBe(true);
    expect(docPosToWireOffset(doc, right.pos)).toBe(4);

    const left = resolveDocHorizontalArrowMove(doc, wireOffsetToDocPos(doc, 4), "left");
    expect(left.handled).toBe(true);
    expect(docPosToWireOffset(doc, left.pos)).toBe(3);
  });

  it("first-line Up bleed and Left resolve to the same wire offset", () => {
    const doc = wireToDoc("abcdef\nghij");
    const from = 4;
    const up = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "up");
    const left = resolveDocHorizontalArrowMove(doc, wireOffsetToDocPos(doc, from), "left");
    expect(up.handled).toBe(true);
    expect(left.handled).toBe(true);
    expect(docPosToWireOffset(doc, up.pos)).toBe(from - 1);
    expect(docPosToWireOffset(doc, left.pos)).toBe(from - 1);
  });

  it("resolveDocHorizontalArrowMove jumps over a mention from its start", () => {
    const doc = wireToDoc("Hi @caliper-abc123 there");
    const start = wireOffsetToDocPos(doc, "Hi ".length);
    const moved = resolveDocHorizontalArrowMove(doc, start, "right");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe("Hi @caliper-abc123".length);
  });

  it("resolveDocHorizontalArrowMove steps through adjacent mentions separated by canonical space", () => {
    const doc = wireToDoc("@caliper-a@caliper-b");
    const firstEnd = docPosToWireOffset(doc, docEndPos({ nodes: [doc.nodes[0]!] }));
    const atFirstEnd = wireOffsetToDocPos(doc, "@caliper-a".length);
    const moved = resolveDocHorizontalArrowMove(doc, atFirstEnd, "right");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBeGreaterThan(firstEnd);
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
});

describe("resolveDocVerticalArrowMove", () => {
  const agentA = "caliper-aaaaaaa";
  const agentB = "caliper-bbbbbbb";

  function line2MentionStart(wire: string) {
    return wire.indexOf("@", wire.indexOf("\n") + 1);
  }

  it("control: arrow up on plain multiline text preserves column", () => {
    const doc = wireToDoc("abcdef\nghij");
    const focus = wireOffsetToDocPos(doc, "abcdef\ngh".length);
    const moved = resolveDocVerticalArrowMove(doc, focus, "up");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe("ab".length);
  });

  it("arrow up from a later line pill start lands on the previous line pill start", () => {
    const wire = `handoff notes @${agentA} \n@${agentA} @${agentB} \n@${agentA} `;
    const doc = wireToDoc(wire);
    const line3Mention = wire.lastIndexOf("@");
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, line3Mention), "up");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(line2MentionStart(wire));
  });

  it("arrow down from a line pill start lands on the next line pill start", () => {
    const wire = `handoff notes @${agentA} \n@${agentA} @${agentB} \n@${agentA} `;
    const doc = wireToDoc(wire);
    const line2Mention = line2MentionStart(wire);
    const line2SecondMention = wire.indexOf(`@${agentB}`);
    const line3Mention = wire.lastIndexOf("@");

    const fromFirstOnLine2 = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, line2Mention),
      "down"
    );
    expect(fromFirstOnLine2.handled).toBe(true);
    expect(docPosToWireOffset(doc, fromFirstOnLine2.pos)).toBe(line3Mention);
    expect(docPosToWireOffset(doc, fromFirstOnLine2.pos)).not.toBe(line2SecondMention);

    const fromSecondOnLine2 = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, line2SecondMention),
      "down"
    );
    expect(fromSecondOnLine2.handled).toBe(true);
    expect(docPosToWireOffset(doc, fromSecondOnLine2.pos)).toBeGreaterThan(line3Mention);
  });

  it("arrow up steps through consecutive empty lines without skipping to line start", () => {
    const wire = "header\n\n\n tail";
    const doc = wireToDoc(wire);
    const firstBlankLine = "header\n".length;
    const secondBlankLine = "header\n\n".length;
    const thirdBlankLine = "header\n\n\n".length;
    const lineEndAboveBlanks = "header".length;

    const fromThirdBlank = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, thirdBlankLine),
      "up"
    );
    expect(fromThirdBlank.handled).toBe(true);
    expect(docPosToWireOffset(doc, fromThirdBlank.pos)).toBe(secondBlankLine);

    const fromSecondBlank = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, secondBlankLine),
      "up"
    );
    expect(fromSecondBlank.handled).toBe(true);
    expect(docPosToWireOffset(doc, fromSecondBlank.pos)).toBe(firstBlankLine);

    const fromFirstBlank = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, firstBlankLine),
      "up"
    );
    expect(fromFirstBlank.handled).toBe(true);
    expect(docPosToWireOffset(doc, fromFirstBlank.pos)).toBe(0);
    expect(docPosToWireOffset(doc, fromFirstBlank.pos)).not.toBe(lineEndAboveBlanks);
  });

  it("arrow down from text enters the first empty line below", () => {
    const wire = "header\n\n\n tail";
    const doc = wireToDoc(wire);
    const firstBlankLine = "header\n".length;

    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, 0), "down");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(firstBlankLine);
  });

  it("down preserves column on mid-line text; does not snap forward to @", () => {
    const wire = `top\npad @${agentA} tail\nbottom`;
    const doc = wireToDoc(wire);
    const from = 2;
    const targetLineStart = wire.indexOf("\n") + 1;
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "down");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(targetLineStart + 2);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(wire.indexOf("@"));
  });

  it("up preserves column on mid-line text; does not snap backward to @", () => {
    const wire = `top\npad @${agentA} tail\nbottom`;
    const doc = wireToDoc(wire);
    const from = wire.indexOf("bottom");
    const targetLineStart = wire.indexOf("\n") + 1;
    const column = from - (wire.lastIndexOf("\n") + 1);
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "up");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(targetLineStart + column);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(wire.indexOf("@"));
  });

  it("arrow up avoids parking between adjacent mentions on the target line", () => {
    const wire = `line1\n@${agentA} @${agentB} tail\n@${agentA} `;
    const doc = wireToDoc(wire);
    const line3Mention = wire.lastIndexOf("@");
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, line3Mention), "up");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(line2MentionStart(wire));
    const focusNode = doc.nodes[moved.pos.nodeIndex];
    expect(focusNode?.type).toBe("mention");
    if (focusNode?.type === "mention") {
      expect(focusNode.agentId).toBe(agentA);
      expect(moved.pos.nodeOffset).toBe(0);
    }
  });

  it("arrow up from a blank below a pill row does not skip to a distant blank block", () => {
    const agent = "caliper-jli3vwpry";
    const wire = `brief @${agent} \n\n\n\n\n@${agent} @${agent} \n\n\nfollowup`;
    const doc = wireToDoc(wire);
    const pillRowSuffix = `@${agent} @${agent} `;
    const pillRowStart = wire.indexOf(pillRowSuffix);
    const pillRowEndingNewline = wire.indexOf(pillRowSuffix) + pillRowSuffix.length;
    const firstBlankBelowPillRow = pillRowEndingNewline + 1;
    const secondBlankBelowPillRow = pillRowEndingNewline + 2;

    const fromSecondBlank = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, secondBlankBelowPillRow),
      "up"
    );
    expect(fromSecondBlank.handled).toBe(true);
    expect(docPosToWireOffset(doc, fromSecondBlank.pos)).toBe(firstBlankBelowPillRow);

    const fromFirstBlank = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, firstBlankBelowPillRow),
      "up"
    );
    expect(fromFirstBlank.handled).toBe(true);
    expect(docPosToWireOffset(doc, fromFirstBlank.pos)).toBe(pillRowStart);
    expect(docPosToWireOffset(doc, fromFirstBlank.pos)).not.toBe(wire.indexOf("\n\n\n\n\n") + 4);
  });

  it("control: arrow down from plain text line start enters the blank below", () => {
    const wire = "header\n\n\n tail";
    const doc = wireToDoc(wire);
    const firstBlankLine = "header\n".length;

    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, 0), "down");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(firstBlankLine);
  });

  it("arrow down from a pill row line start enters the blank below instead of stepping along the row", () => {
    const agent = "caliper-jli3vwpry";
    const wire = `brief @${agent} \n\n\n\n\n@${agent} @${agent} \n\n\nfollowup`;
    const doc = wireToDoc(wire);
    const pillRowSuffix = `@${agent} @${agent} `;
    const pillRowStart = wire.indexOf(pillRowSuffix);
    const secondPillOnRow = pillRowStart + `@${agent} `.length;
    const firstBlankBelowPillRow = wire.indexOf(pillRowSuffix) + pillRowSuffix.length + 1;

    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, pillRowStart), "down");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(firstBlankBelowPillRow);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(secondPillOnRow);
  });

  it("arrow down from interior near a pill row end crosses to the blank below", () => {
    const agent = "caliper-jli3vwpry";
    const wire = `brief @${agent} \n\n\n\n\n@${agent} @${agent} \n\n\nfollowup`;
    const doc = wireToDoc(wire);
    const pillRowSuffix = `@${agent} @${agent} `;
    const pillRowEndingNewline = wire.indexOf(pillRowSuffix) + pillRowSuffix.length;
    const firstBlankBelowPillRow = pillRowEndingNewline + 1;

    const moved = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, pillRowEndingNewline - 1),
      "down"
    );
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(firstBlankBelowPillRow);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(pillRowEndingNewline);
  });

  it("arrow up from the newline ending a pill row crosses to the line above", () => {
    const agent = "caliper-jli3vwpry";
    const wire = `brief @${agent} \n\n\n\n\n@${agent} @${agent} \n\n\nfollowup`;
    const doc = wireToDoc(wire);
    const pillRowSuffix = `@${agent} @${agent} `;
    const pillRowEndingNewline = wire.indexOf(pillRowSuffix) + pillRowSuffix.length;
    const { lineIndex } = resolveWireLineColumn(wire, pillRowEndingNewline);
    const lineStarts = [0];
    for (let index = 0; index < wire.length; index++) {
      if (wire[index] === "\n") {
        lineStarts.push(index + 1);
      }
    }
    const emptyLineAbovePillRow = lineStarts[lineIndex - 1]!;

    const moved = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, pillRowEndingNewline),
      "up"
    );
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(emptyLineAbovePillRow);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(pillRowEndingNewline - 1);
  });

  it("arrow up from a later pill on the same row crosses to the line above", () => {
    const agent = "caliper-ho14ofyh6";
    const wire = `handoff notes @${agent} @${agent} review phase\n\n\n\n\n\n@${agent} context extra @${agent} `;
    const doc = wireToDoc(wire);
    const firstPillOnRow = wire.lastIndexOf(`\n@${agent} `) + 1;
    const secondPillOnRow = wire.lastIndexOf(` @${agent} `) + 1;
    const blankAboveRow = firstPillOnRow - 1;

    const fromSecondPill = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, secondPillOnRow),
      "up"
    );
    expect(fromSecondPill.handled).toBe(true);
    expect(docPosToWireOffset(doc, fromSecondPill.pos)).toBe(blankAboveRow);
    expect(docPosToWireOffset(doc, fromSecondPill.pos)).not.toBe(firstPillOnRow);

    const fromFirstPill = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, firstPillOnRow),
      "up"
    );
    expect(fromFirstPill.handled).toBe(true);
    expect(docPosToWireOffset(doc, fromFirstPill.pos)).toBe(blankAboveRow);
  });

  it("arrow down from an earlier pill on the same row crosses to the line below", () => {
    const agent = "caliper-ho14ofyh6";
    const wire = `prefix @${agent} mid @${agent} tail\n\n\n`;
    const doc = wireToDoc(wire);
    const firstPill = wire.indexOf(`@${agent}`);
    const secondPill = wire.indexOf(`@${agent}`, firstPill + 1);
    const firstBlankBelow = wire.indexOf("\n") + 1;

    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, firstPill), "down");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(firstBlankBelow);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(secondPill);
  });

  it("first line up bleeds left when no line above", () => {
    const wire = "abcdef\nghij";
    const doc = wireToDoc(wire);
    const fromWire = 4;

    const up = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, fromWire), "up");
    expect(up.handled).toBe(true);
    expect(docPosToWireOffset(doc, up.pos)).toBe(fromWire - 1);
  });

  it("last line down bleeds right when no line below", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `handoff notes @${agentA} \n@${agentA} @${agentB} `;
    const doc = wireToDoc(wire);
    const fromWire = wire.lastIndexOf(`@${agentB}`);
    const right = resolveDocHorizontalArrowMove(doc, wireOffsetToDocPos(doc, fromWire), "right");
    const down = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, fromWire), "down");

    expect(right.handled).toBe(true);
    expect(down.handled).toBe(true);
    expect(docPosToWireOffset(doc, down.pos)).toBe(docPosToWireOffset(doc, right.pos));
  });

  it("down onto mention-first row lands in tail when column is past the pill", () => {
    const wire = `notes here keeping it\n@${agentA} tail text`;
    const doc = wireToDoc(wire);
    const from = wire.indexOf("keeping") + "keeping".length;
    const pillEnd = wire.indexOf("@") + `@${agentA}`.length;
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "down");
    expect(docPosToWireOffset(doc, moved.pos)).toBeGreaterThanOrEqual(pillEnd);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(wire.indexOf("@"));
  });

  it("down onto mention-first row snaps to pill end when column falls inside the pill", () => {
    const wire = `notes here\n@${agentA} tail text`;
    const doc = wireToDoc(wire);
    const from = 5;
    const pillEnd = wire.indexOf("@") + `@${agentA}`.length;
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "down");
    expect(docPosToWireOffset(doc, moved.pos)).toBe(pillEnd);
  });

  it("up onto mention-first row snaps to pill start when column falls inside the pill", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `@${agent} tail text\nnotes here`;
    const doc = wireToDoc(wire);
    const from = wire.indexOf("notes") + 3;
    const pillStart = 0;
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, from), "up");
    expect(docPosToWireOffset(doc, moved.pos)).toBe(pillStart);
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
    const up = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, downOffset), "up");
    expect(docPosToWireOffset(doc, up.pos)).toBe(from);
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

  it("down from content mid-column enters blank at line start", () => {
    const wire = "header\n\ntail";
    const doc = wireToDoc(wire);
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, 4), "down");
    expect(docPosToWireOffset(doc, moved.pos)).toBe(wire.indexOf("\n") + 1);
  });

  it("doc start Up and doc end Down are no-ops", () => {
    const doc = wireToDoc("ab");
    expect(resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, 0), "up").handled).toBe(false);
    expect(resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, 2), "down").handled).toBe(
      false
    );
  });

  it("single-line Down bleeds right at core layer", () => {
    const doc = wireToDoc("abcdefgh");
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, 2), "down");
    expect(docPosToWireOffset(doc, moved.pos)).toBe(3);
  });
});
