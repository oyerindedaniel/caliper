import { describe, expect, it, beforeEach } from "vitest";
import {
  docPosToWireOffset,
  normalizeDocPos,
  resolveDocArrowMove,
  resolveHandoffNoteArrowMove,
  wireOffsetToDocPos,
  wireToDoc,
  type HandoffNoteDoc,
} from "@caliper/core";
import {
  resolveDomVerticalArrowMove,
  resolveMeasuredVerticalArrowMove,
} from "./handoff-note-selection.js";
import { renderHandoffNoteDoc } from "./handoff-note-dom.js";
import {
  getAnchorRectAtWire,
  readDomWireCursor,
  readDomWireSelection,
  setSelectionAtWire,
} from "./handoff-note-test-helpers.js";
import {
  readDocCursor,
  readDocSelection,
  repairDocSelectionIfNeeded,
} from "./handoff-note-selection.js";

const NOTE = "Hi @caliper-abc123 there";
const MENTION_START = "Hi ".length;
const MENTION_END = MENTION_START + "@caliper-abc123".length;

function mountEditor(wire: string): { root: HTMLDivElement; doc: HandoffNoteDoc } {
  const doc = wireToDoc(wire);
  const root = document.createElement("div");
  document.body.appendChild(root);
  renderHandoffNoteDoc(root, doc, {
    colorByAgentId: new Map([["caliper-abc123", "#f00"]]),
  });
  return { root, doc };
}

describe("handoff-note-selection", () => {
  let root: HTMLDivElement;
  let doc: HandoffNoteDoc;

  beforeEach(() => {
    ({ root, doc } = mountEditor(NOTE));
  });

  it("maps cursor positions in plain text from DOM", () => {
    const textNode = root.firstChild as Text;
    const selection = root.ownerDocument.getSelection()!;
    const range = root.ownerDocument.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(docPosToWireOffset(doc, readDocCursor(root, doc))).toBe(2);
  });

  it("maps mention pill edges to wire token boundaries", () => {
    const pill = root.querySelector("span[data-handoff-mention]")!;
    setSelectionAtWire(root, doc, MENTION_START);
    expect(readDomWireCursor(root, doc)).toBe(MENTION_START);
    setSelectionAtWire(root, doc, MENTION_END);
    expect(readDomWireCursor(root, doc)).toBe(MENTION_END);
    expect(pill.contains(root.ownerDocument.getSelection()?.anchorNode ?? null)).toBe(false);
  });

  it("normalizes a native caret parked inside a mention pill", () => {
    const pill = root.querySelector("span[data-handoff-mention]")!;
    const pillText = pill.firstChild as Text;
    const selection = root.ownerDocument.getSelection()!;
    const range = root.ownerDocument.createRange();
    range.setStart(pillText, 3);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const live = readDocCursor(root, doc);
    expect(docPosToWireOffset(doc, live)).toBe(MENTION_START);
    const repaired = repairDocSelectionIfNeeded(root, doc, wireOffsetToDocPos(doc, MENTION_END));
    expect(docPosToWireOffset(doc, repaired)).toBe(MENTION_START);
    expect(readDomWireCursor(root, doc)).toBe(MENTION_START);
  });

  it("restores mention start when stranded in pill after arrowing to the boundary", () => {
    const pill = root.querySelector("span[data-handoff-mention]")!;
    const pillText = pill.firstChild as Text;
    setSelectionAtWire(root, doc, MENTION_START, MENTION_START);

    const selection = root.ownerDocument.getSelection()!;
    const range = root.ownerDocument.createRange();
    range.setStart(pillText, 2);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const repaired = repairDocSelectionIfNeeded(root, doc, wireOffsetToDocPos(doc, MENTION_START));
    expect(docPosToWireOffset(doc, repaired)).toBe(MENTION_START);
    expect(readDomWireCursor(root, doc)).toBe(MENTION_START);
    expect(pill.contains(selection.anchorNode)).toBe(false);
  });

  it("restores the prior offset when the browser parks left of a mention", () => {
    const pill = root.querySelector("span[data-handoff-mention]")!;
    const pillText = pill.firstChild as Text;
    const selection = root.ownerDocument.getSelection()!;
    const range = root.ownerDocument.createRange();
    range.setStart(pillText, 2);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const leftOfMention = MENTION_START - 1;
    const repaired = repairDocSelectionIfNeeded(root, doc, wireOffsetToDocPos(doc, leftOfMention));
    expect(docPosToWireOffset(doc, repaired)).toBe(leftOfMention);
    expect(readDomWireCursor(root, doc)).toBe(leftOfMention);
  });

  it("sets and reads wire cursor at text and mention boundaries", () => {
    setSelectionAtWire(root, doc, MENTION_START);
    expect(readDomWireCursor(root, doc)).toBe(MENTION_START);

    setSelectionAtWire(root, doc, MENTION_END);
    expect(readDomWireCursor(root, doc)).toBe(MENTION_END);

    setSelectionAtWire(root, doc, NOTE.length);
    expect(readDomWireCursor(root, doc)).toBe(NOTE.length);
  });

  it("snaps interior wire offsets when setting selection", () => {
    setSelectionAtWire(root, doc, MENTION_START + 5);
    expect(readDomWireCursor(root, doc)).toBe(MENTION_START);

    setSelectionAtWire(root, doc, MENTION_START + 5, MENTION_START + 5, {
      fromOffset: MENTION_START,
    });
    expect(readDomWireCursor(root, doc)).toBe(MENTION_END);
  });

  it("reads a collapsed selection in plain text", () => {
    setSelectionAtWire(root, doc, 2, 2);
    expect(readDomWireSelection(root, doc)).toEqual({ start: 2, end: 2 });
  });

  it("measures anchor rect without moving the caret", () => {
    const wire = "dhhdd @";
    const { root: mentionRoot, doc: mentionDoc } = mountEditor(wire);
    setSelectionAtWire(mentionRoot, mentionDoc, wire.length, wire.length);
    expect(readDomWireCursor(mentionRoot, mentionDoc)).toBe(wire.length);

    getAnchorRectAtWire(mentionRoot, mentionDoc, wire.length - 1);

    expect(readDomWireCursor(mentionRoot, mentionDoc)).toBe(wire.length);
  });

  it("round-trips wire offsets on the boundary between adjacent mention pills", () => {
    const wire = "@caliper-a@caliper-b";
    const canonical = wireToDoc(wire);
    const boundary = "@caliper-a ".length;
    const adjacent = document.createElement("div");
    document.body.appendChild(adjacent);
    renderHandoffNoteDoc(adjacent, canonical, {
      colorByAgentId: new Map([
        ["caliper-a", "#1"],
        ["caliper-b", "#2"],
      ]),
    });
    setSelectionAtWire(adjacent, canonical, boundary);
    expect(readDomWireCursor(adjacent, canonical)).toBe(boundary);
  });

  it("arrow-left from after glued mentions lands on the shared pill boundary", () => {
    const agentA = "caliper-6y5tbq86c";
    const agentB = "caliper-rbb0xtc9e";
    const wire = `hhd @${agentA}\n\n\n\n@${agentA}@${agentB} @${agentB} `;
    const gluedDoc = wireToDoc(wire);
    const glued = document.createElement("div");
    document.body.appendChild(glued);
    renderHandoffNoteDoc(glued, gluedDoc, {
      colorByAgentId: new Map([
        [agentA, "#06f"],
        [agentB, "#f06"],
      ]),
    });

    const move = resolveHandoffNoteArrowMove(gluedDoc, 62, "left");
    expect(move).toEqual({ cursor: 45, handled: true });

    const docMove = resolveDocArrowMove(gluedDoc, wireOffsetToDocPos(gluedDoc, 62), "left");
    expect(docPosToWireOffset(gluedDoc, docMove.pos)).toBe(45);

    setSelectionAtWire(glued, gluedDoc, move.cursor, move.cursor, {
      fromOffset: 62,
      source: "arrowKey",
    });
    expect(readDomWireCursor(glued, gluedDoc)).toBe(45);
  });

  it("handles empty editor", () => {
    const emptyDoc = wireToDoc("");
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    renderHandoffNoteDoc(empty, emptyDoc, { colorByAgentId: new Map() });
    setSelectionAtWire(empty, emptyDoc, 0);
    expect(readDomWireCursor(empty, emptyDoc)).toBe(0);
  });

  it("doc selection stays valid after clicking between two atomic pills (Slack-style boundary)", () => {
    const docTwo = wireToDoc("@caliper-a @caliper-b");
    const rootTwo = document.createElement("div");
    document.body.appendChild(rootTwo);
    renderHandoffNoteDoc(rootTwo, docTwo, {
      colorByAgentId: new Map([
        ["caliper-a", "#1"],
        ["caliper-b", "#2"],
      ]),
    });
    const between = "@caliper-a ".length;
    setSelectionAtWire(rootTwo, docTwo, between);
    const focus = readDocCursor(rootTwo, docTwo);
    expect(normalizeDocPos(docTwo, focus)).toEqual(focus);
    expect(docPosToWireOffset(docTwo, focus)).toBe(between);
  });

  it("restores from authority when DOM caret regressed to an earlier atomic boundary", () => {
    const wire = "ab @caliper-abc123 cd";
    const docWithMention = wireToDoc(wire);
    const surface = document.createElement("div");
    document.body.appendChild(surface);
    renderHandoffNoteDoc(surface, docWithMention, {
      colorByAgentId: new Map([["caliper-abc123", "#f00"]]),
    });

    const authority = wireOffsetToDocPos(docWithMention, wire.length);
    const earlierBoundary = "ab ".length;
    setSelectionAtWire(surface, docWithMention, earlierBoundary);

    const repaired = repairDocSelectionIfNeeded(surface, docWithMention, authority);
    expect(docPosToWireOffset(docWithMention, repaired)).toBe(wire.length);
    expect(readDomWireCursor(surface, docWithMention)).toBe(wire.length);
  });

  it("restores from authority when DOM caret regressed to an earlier text trailing edge", () => {
    const wire = "left @caliper-abc123 right";
    const docWithMention = wireToDoc(wire);
    const surface = document.createElement("div");
    document.body.appendChild(surface);
    renderHandoffNoteDoc(surface, docWithMention, {
      colorByAgentId: new Map([["caliper-abc123", "#f00"]]),
    });

    const authority = wireOffsetToDocPos(docWithMention, wire.length);
    const trailingEdge = "left ".length;
    setSelectionAtWire(surface, docWithMention, trailingEdge);

    const repaired = repairDocSelectionIfNeeded(surface, docWithMention, authority);
    expect(docPosToWireOffset(docWithMention, repaired)).toBe(wire.length);
    expect(readDomWireCursor(surface, docWithMention)).toBe(wire.length);
  });

  it("readDocSelection returns normalized anchor and focus", () => {
    setSelectionAtWire(root, doc, 2);
    const live = readDocSelection(root, doc);
    expect(live.anchor).toEqual(live.focus);
    expect(docPosToWireOffset(doc, live.focus)).toBe(2);
  });

  it("vertical arrow up from a soft-wrapped pill start lands on the previous visual line start", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `dhhdd @${agentA} @${agentB} wjjw @${agentA} `;
    const line2Mention = wire.indexOf("@", 1);
    const line3Mention = wire.lastIndexOf("@");
    const wjjwStart = wire.indexOf("wjjw");
    const doc = wireToDoc(wire);
    const measured = [
      { wire: 0, top: 0, left: 0 },
      { wire: line2Mention, top: 24, left: 0 },
      { wire: wjjwStart, top: 24, left: 120 },
      { wire: line3Mention, top: 48, left: 120 },
    ];

    const moved = resolveMeasuredVerticalArrowMove(
      doc,
      wireOffsetToDocPos(doc, line3Mention),
      "up",
      measured,
      48,
      120,
      16
    );

    expect(moved.handled).toBe(true);
    expect(moved.branch).toBe("dom-lineStart-fromMention");
    expect(docPosToWireOffset(doc, moved.pos)).toBe(line2Mention);
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(wjjwStart);
  });

  it("vertical arrow up lands on the previous line start, not between adjacent mentions", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `dhhdhd @${agentA} \n@${agentA} @${agentB} \n@${agentA} `;
    const line2Mention = wire.indexOf("@", wire.indexOf("\n") + 1);
    const line3Mention = wire.lastIndexOf("@");
    const multilineDoc = wireToDoc(wire);
    const surface = document.createElement("div");
    document.body.appendChild(surface);
    renderHandoffNoteDoc(surface, multilineDoc, {
      colorByAgentId: new Map([
        [agentA, "#06f"],
        [agentB, "#f06"],
      ]),
    });

    setSelectionAtWire(surface, multilineDoc, line3Mention);
    const moved = resolveDomVerticalArrowMove(
      surface,
      multilineDoc,
      wireOffsetToDocPos(multilineDoc, line3Mention),
      "up"
    );
    expect(moved.handled).toBe(true);
    expect(docPosToWireOffset(multilineDoc, moved.pos)).toBe(line2Mention);
    setSelectionAtWire(surface, multilineDoc, docPosToWireOffset(multilineDoc, moved.pos));
    expect(readDomWireCursor(surface, multilineDoc)).toBe(line2Mention);
  });
});
