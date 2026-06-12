import { describe, expect, it } from "vitest";
import {
  collapsedSelection,
  docEndPos,
  docPosEqual,
  docPosToWireOffset,
  docSelectionToWireRange,
  normalizeDocPos,
  normalizeSelection,
  resolveDocArrowMove,
  resolveDocVerticalArrowMove,
  selectionsEqual,
  wireOffsetToCollapsedSelection,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import { docToWire, wireToDoc } from "./handoff-note-doc.js";

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

  it("resolveDocArrowMove jumps over a mention from its start", () => {
    const doc = wireToDoc("Hi @caliper-abc123 there");
    const start = wireOffsetToDocPos(doc, "Hi ".length);
    const moved = resolveDocArrowMove(doc, start, "right");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe("Hi @caliper-abc123".length);
  });

  it("resolveDocArrowMove steps through adjacent mentions separated by canonical space", () => {
    const doc = wireToDoc("@caliper-a@caliper-b");
    const firstEnd = docPosToWireOffset(doc, docEndPos({ nodes: [doc.nodes[0]!] }));
    const atFirstEnd = wireOffsetToDocPos(doc, "@caliper-a".length);
    const moved = resolveDocArrowMove(doc, atFirstEnd, "right");
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
    const wire = `dhhdhd @${agentA} \n@${agentA} @${agentB} \n@${agentA} `;
    const doc = wireToDoc(wire);
    const line3Mention = wire.lastIndexOf("@");
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, line3Mention), "up");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(line2MentionStart(wire));
  });

  it("arrow down from a line pill start lands on the next line pill start", () => {
    const wire = `dhhdhd @${agentA} \n@${agentA} @${agentB} \n@${agentA} `;
    const doc = wireToDoc(wire);
    const line2Mention = line2MentionStart(wire);
    const line3Mention = wire.lastIndexOf("@");
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, line2Mention), "down");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(line3Mention);
  });

  it("arrow up steps through consecutive empty lines without skipping to line start", () => {
    const wire = "dggdg\n\n\n tail";
    const doc = wireToDoc(wire);
    const firstBlankLine = "dggdg\n".length;
    const secondBlankLine = "dggdg\n\n".length;
    const thirdBlankLine = "dggdg\n\n\n".length;
    const lineEndAboveBlanks = "dggdg".length;

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
    expect(docPosToWireOffset(doc, fromFirstBlank.pos)).toBe(lineEndAboveBlanks);
    expect(docPosToWireOffset(doc, fromFirstBlank.pos)).not.toBe(0);
  });

  it("arrow down from text enters the first empty line below", () => {
    const wire = "dggdg\n\n\n tail";
    const doc = wireToDoc(wire);
    const firstBlankLine = "dggdg\n".length;

    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, 0), "down");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(firstBlankLine);
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
    const wire = `dhhd @${agent} \n\n\n\n\n@${agent} @${agent} \n\n\nddnnd`;
    const doc = wireToDoc(wire);
    const pillRowSuffix = `@${agent} @${agent} `;
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
    expect(docPosToWireOffset(doc, fromFirstBlank.pos)).toBe(pillRowEndingNewline);
    expect(docPosToWireOffset(doc, fromFirstBlank.pos)).not.toBe(wire.indexOf("\n\n\n\n\n") + 4);
  });

  it("control: arrow down from plain text line start enters the blank below", () => {
    const wire = "dggdg\n\n\n tail";
    const doc = wireToDoc(wire);
    const firstBlankLine = "dggdg\n".length;

    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, 0), "down");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(firstBlankLine);
  });

  it("arrow down from a pill row line start enters the row instead of jumping to blanks below", () => {
    const agent = "caliper-jli3vwpry";
    const wire = `dhhd @${agent} \n\n\n\n\n@${agent} @${agent} \n\n\nddnnd`;
    const doc = wireToDoc(wire);
    const pillRowSuffix = `@${agent} @${agent} `;
    const pillRowStart = wire.indexOf(pillRowSuffix);
    const firstBlankBelowPillRow = wire.indexOf(pillRowSuffix) + pillRowSuffix.length + 1;
    const firstMentionEnd = pillRowStart + `@${agent}`.length;

    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, pillRowStart), "down");
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(firstMentionEnd);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(firstBlankBelowPillRow);
  });

  it("arrow down from interior near a pill row end steps forward before entering blanks below", () => {
    const agent = "caliper-jli3vwpry";
    const wire = `dhhd @${agent} \n\n\n\n\n@${agent} @${agent} \n\n\nddnnd`;
    const doc = wireToDoc(wire);
    const pillRowSuffix = `@${agent} @${agent} `;
    const pillRowEndingNewline = wire.indexOf(pillRowSuffix) + pillRowSuffix.length;

    const moved = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, pillRowEndingNewline - 1),
      "down"
    );
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(pillRowEndingNewline);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(pillRowEndingNewline + 1);
  });

  it("arrow up from the newline ending a pill row steps back on the same line", () => {
    const agent = "caliper-jli3vwpry";
    const wire = `dhhd @${agent} \n\n\n\n\n@${agent} @${agent} \n\n\nddnnd`;
    const doc = wireToDoc(wire);
    const pillRowSuffix = `@${agent} @${agent} `;
    const pillRowEndingNewline = wire.indexOf(pillRowSuffix) + pillRowSuffix.length;

    const moved = resolveDocVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, pillRowEndingNewline),
      "up"
    );
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(doc, moved.pos)).toBe(pillRowEndingNewline - 1);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(wire.indexOf("\n\n\n\n\n") + 4);
  });
});
