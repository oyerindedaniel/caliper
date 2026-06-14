import { describe, expect, it, beforeEach } from "vitest";
import {
  applyDocInsertText,
  collapsedSelection,
  docPosToWireOffset,
  docToWire,
  normalizeDocPos,
  resolveDocHorizontalArrowMove,
  resolveHandoffNoteArrowMove,
  wireOffsetToDocPos,
  wireToDoc,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";
import {
  readDocCursor,
  readDocSelection,
  repairDocSelectionIfNeeded,
  resolveDomVerticalArrowMove,
  resolveMeasuredVerticalArrowMove,
} from "./handoff-note-selection.js";
import {
  buildLayoutMapFromSamples,
  invalidateHandoffNoteLayoutCache,
} from "./handoff-note-layout-map.js";
import { renderHandoffNoteDoc } from "./handoff-note-dom.js";
import {
  getAnchorRectAtWire,
  readDomWireCursor,
  readDomWireSelection,
  readHandoffNoteLayoutRowIndexForTests,
  readHandoffNoteLayoutSamplesForTests,
  setSelectionAtWire,
  stubCaretProbeAtDocPos,
  stubHandoffNoteAnchorRectAtWire,
  stubHandoffNoteMentionLayoutCoords,
  stubTextNodeLineRects,
} from "./handoff-note-test-helpers.js";

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

  it("strand-only repair skips authority restore for valid boundary moves", () => {
    setSelectionAtWire(root, doc, NOTE.length);
    const authority = NOTE.length;
    setSelectionAtWire(root, doc, MENTION_START);
    const strandOnly = repairDocSelectionIfNeeded(root, doc, wireOffsetToDocPos(doc, authority), {
      mode: "strand-only",
    });
    expect(docPosToWireOffset(doc, strandOnly)).toBe(MENTION_START);

    const full = repairDocSelectionIfNeeded(root, doc, wireOffsetToDocPos(doc, authority), {
      mode: "full",
    });
    expect(docPosToWireOffset(doc, full)).toBe(authority);
    expect(readDomWireCursor(root, doc)).toBe(authority);
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
    const wire = "query @";
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

    const docMove = resolveDocHorizontalArrowMove(
      gluedDoc,
      wireOffsetToDocPos(gluedDoc, 62),
      "left"
    );
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

  it("vertical arrow up lands on the previous line start, not between adjacent mentions", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `handoff notes @${agentA} \n@${agentA} @${agentB} \n@${agentA} `;
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

  describe("wire newline with soft-wrap vertical navigation", () => {
    const AGENT_A = "caliper-linea01";
    const AGENT_B = "caliper-lineb02";
    const WRAP_ROOT_WIDTH = 310;
    const ROW1_TOP = 141;
    const ROW2_TOP = 177;
    const ROW_START_LEFT = 347;

    function buildMultilineWrapWire(): string {
      return `@${AGENT_A} header\n\n@${AGENT_A} fill@${AGENT_B} tail `;
    }

    function mountMultilineWrapEditor(): {
      root: HTMLDivElement;
      doc: HandoffNoteDoc;
      wire: string;
    } {
      const wire = buildMultilineWrapWire();
      const doc = wireToDoc(wire);
      const surface = document.createElement("div");
      surface.style.width = `${WRAP_ROOT_WIDTH}px`;
      surface.contentEditable = "true";
      document.body.appendChild(surface);
      renderHandoffNoteDoc(surface, doc, {
        colorByAgentId: new Map([
          [AGENT_A, "#06f"],
          [AGENT_B, "#f06"],
        ]),
      });
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: WRAP_ROOT_WIDTH });
      const pillCoords = new Map<number, { top: number; left: number }>();
      let mentionOrdinal = 0;
      for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
        if (doc.nodes[nodeIndex]?.type !== "mention") {
          continue;
        }
        pillCoords.set(nodeIndex, {
          top: mentionOrdinal === 0 ? ROW1_TOP : ROW2_TOP,
          left: ROW_START_LEFT + 40 * mentionOrdinal,
        });
        mentionOrdinal += 1;
      }
      stubHandoffNoteMentionLayoutCoords(surface, pillCoords);
      invalidateHandoffNoteLayoutCache();
      return { root: surface, doc, wire };
    }

    beforeEach(() => {
      invalidateHandoffNoteLayoutCache();
    });

    it("Down from blank wire line crosses to the next wire line start", () => {
      const { root, doc, wire } = mountMultilineWrapEditor();
      const blankLineStart = wire.indexOf("\n") + 1;
      const nextLineStart = blankLineStart + 1;
      setSelectionAtWire(root, doc, blankLineStart);

      const moved = resolveDomVerticalArrowMove(
        root,
        doc,
        wireOffsetToDocPos(doc, blankLineStart),
        "down"
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(nextLineStart);
      root.remove();
    });

    it("Down from last wire line start blocks instead of boundary-bleeding across the line", () => {
      const { root, doc, wire } = mountMultilineWrapEditor();
      const lastLineStart = wire.lastIndexOf("\n") + 1;
      setSelectionAtWire(root, doc, lastLineStart);

      const moved = resolveDomVerticalArrowMove(
        root,
        doc,
        wireOffsetToDocPos(doc, lastLineStart),
        "down"
      );

      expect(moved.handled).toBe(false);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(lastLineStart);
      root.remove();
    });

    it("down from trailing mention-line text enters the first embedded blank below", () => {
      const agentA = "caliper-aaaaaaa";
      const agentB = "caliper-bbbbbbb";
      const wire = `header\n\nrow @${agentA}  @${agentB} tail\n\n\n@${agentA} `;
      const doc = wireToDoc(wire);
      const tailMarker = ` @${agentB} tail`;
      const tailContentWire = wire.indexOf(tailMarker) + tailMarker.length - 1;
      const blankRun: number[] = [];
      for (let index = tailContentWire + 1; index < wire.length && wire[index] === "\n"; index++) {
        blankRun.push(index);
      }
      const surface = document.createElement("div");
      surface.style.width = `${WRAP_ROOT_WIDTH}px`;
      document.body.appendChild(surface);
      renderHandoffNoteDoc(surface, doc, {
        colorByAgentId: new Map([
          [agentA, "#06f"],
          [agentB, "#f06"],
        ]),
      });
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: WRAP_ROOT_WIDTH });
      setSelectionAtWire(surface, doc, tailContentWire);

      const moved = resolveDomVerticalArrowMove(
        surface,
        doc,
        wireOffsetToDocPos(doc, tailContentWire),
        "down"
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(blankRun[0]!);
      surface.remove();
    });

    it("up from first embedded blank below trailing mention-line text lands on content", () => {
      const agentA = "caliper-aaaaaaa";
      const agentB = "caliper-bbbbbbb";
      const wire = `header\n\nrow @${agentA}  @${agentB} tail\n\n\n@${agentA} `;
      const doc = wireToDoc(wire);
      const tailMarker = ` @${agentB} tail`;
      const tailContentWire = wire.indexOf(tailMarker) + tailMarker.length - 1;
      const firstBlank = tailContentWire + 1;
      expect(wire[firstBlank]).toBe("\n");
      const surface = document.createElement("div");
      surface.style.width = `${WRAP_ROOT_WIDTH}px`;
      document.body.appendChild(surface);
      renderHandoffNoteDoc(surface, doc, {
        colorByAgentId: new Map([
          [agentA, "#06f"],
          [agentB, "#f06"],
        ]),
      });
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: WRAP_ROOT_WIDTH });
      setSelectionAtWire(surface, doc, firstBlank);

      const moved = resolveDomVerticalArrowMove(
        surface,
        doc,
        wireOffsetToDocPos(doc, firstBlank),
        "up"
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(tailContentWire);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(0);
      surface.remove();
    });
  });
});

function buildMentionTailDoc(
  agent: string,
  tail: string
): { doc: HandoffNoteDoc; focus: HandoffNoteDocPos } {
  const base = `@${agent} @${agent} @${agent} `;
  let doc = wireToDoc(base);
  let focus = wireOffsetToDocPos(doc, docToWire(doc).length);
  for (const char of tail) {
    const result = applyDocInsertText(doc, collapsedSelection(focus), char);
    doc = result.doc;
    focus = result.selection.focus;
  }
  return { doc, focus };
}

/**
 * Oracle: three mentions on one wire line at ~310px — two visual rows (soft wrap).
 * Constants ROW1_TOP / ROW2_TOP are measured Y bands from playground, not contract ordinals.
 */
describe("soft-wrap vertical navigation on a single wire line", () => {
  const AGENT = "caliper-0ik99dso0";
  const TRIPLE_MENTION_WIRE = `@${AGENT} @${AGENT} @${AGENT} `;
  const WRAP_ROW2_PILL_START = 38;
  const WRAP_ROOT_WIDTH = 310;
  const ROW1_TOP = 92.66667175292969;
  const ROW2_TOP = 118.86458587646484;
  const ROW_START_LEFT = 347;
  const TEXT_LINE_HEIGHT = 17.333328247070312;

  const ORACLE_SAMPLES = [
    { wire: 0, top: ROW1_TOP, left: ROW_START_LEFT },
    { wire: 19, top: ROW1_TOP, left: 480 },
    { wire: 37, top: ROW1_TOP, left: 599.875 },
    { wire: 38, top: ROW2_TOP, left: ROW_START_LEFT },
    { wire: 56, top: ROW2_TOP, left: 479.15625 },
    { wire: 57, top: ROW2_TOP, left: 482.7083435058594 },
  ] as const;

  function mountWrapEditor(wireOrDoc: string | HandoffNoteDoc = TRIPLE_MENTION_WIRE): {
    root: HTMLDivElement;
    doc: HandoffNoteDoc;
  } {
    const doc = typeof wireOrDoc === "string" ? wireToDoc(wireOrDoc) : wireOrDoc;
    const surface = document.createElement("div");
    surface.style.width = `${WRAP_ROOT_WIDTH}px`;
    surface.contentEditable = "true";
    document.body.appendChild(surface);
    const colorByAgentId = new Map<string, string>();
    for (const node of doc.nodes) {
      if (node.type === "mention") {
        colorByAgentId.set(node.agentId, "#06f");
      }
    }
    renderHandoffNoteDoc(surface, doc, { colorByAgentId });
    Object.defineProperty(surface, "clientWidth", { configurable: true, value: WRAP_ROOT_WIDTH });
    const pillCoords = new Map<number, { top: number; left: number }>();
    let mentionOrdinal = 0;
    for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
      if (doc.nodes[nodeIndex]?.type !== "mention") {
        continue;
      }
      const onWrappedBand = mentionOrdinal >= 2;
      pillCoords.set(nodeIndex, {
        top: onWrappedBand ? ROW2_TOP : ROW1_TOP,
        left: mentionOrdinal === 0 ? ROW_START_LEFT : mentionOrdinal === 1 ? 480 : ROW_START_LEFT,
      });
      mentionOrdinal += 1;
    }
    stubHandoffNoteMentionLayoutCoords(surface, pillCoords);
    return { root: surface, doc };
  }

  beforeEach(() => {
    invalidateHandoffNoteLayoutCache();
  });

  describe("cross visual row", () => {
    it("preserves goal column on the previous visual row with measured samples", () => {
      const doc = wireToDoc(TRIPLE_MENTION_WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 57),
        "up",
        [...ORACLE_SAMPLES],
        ROW2_TOP,
        600,
        TEXT_LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(37);
    });

    it("Up from wrapped-band visual row start lands on first visual row start instead of wire bleed", () => {
      const { root, doc } = mountWrapEditor();
      setSelectionAtWire(root, doc, WRAP_ROW2_PILL_START);

      const moved = resolveDomVerticalArrowMove(
        root,
        doc,
        wireOffsetToDocPos(doc, WRAP_ROW2_PILL_START),
        "up"
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(0);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(WRAP_ROW2_PILL_START - 1);
      root.remove();
    });

    it("Down from first visual row start enters wrapped-band visual row start", () => {
      const doc = wireToDoc(TRIPLE_MENTION_WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 0),
        "down",
        [...ORACLE_SAMPLES],
        ROW1_TOP,
        ROW_START_LEFT,
        TEXT_LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(WRAP_ROW2_PILL_START);
    });

    it("Down from mention at visual row start lands on wrapped-band left edge when tail sample shares that band", () => {
      const doc = wireToDoc(TRIPLE_MENTION_WIRE);
      const liveLikeSamples = [
        { wire: 0, top: ROW1_TOP, left: ROW_START_LEFT },
        { wire: 19, top: ROW1_TOP, left: 480 },
        { wire: 37, top: ROW2_TOP, left: 600 },
        { wire: 38, top: ROW2_TOP, left: ROW_START_LEFT },
        { wire: 56, top: ROW2_TOP, left: 479 },
        { wire: 57, top: ROW2_TOP, left: 483 },
      ];
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 0),
        "down",
        liveLikeSamples,
        ROW1_TOP,
        ROW_START_LEFT,
        TEXT_LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(WRAP_ROW2_PILL_START);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(37);
    });

    it("Up from wrapped-band start at visual row start lands on doc start, not prior-band tail", () => {
      const agent = "caliper-u40esdyzu";
      const wire = `header @${agent} tail @${agent} `;
      const doc = wireToDoc(wire);
      const wrappedBandStart = wire.indexOf(" tail");
      const firstBandTail = wire.indexOf(`@${agent}`) + `@${agent}`.length;
      const samples = [
        { wire: 0, top: 0, left: 0 },
        { wire: firstBandTail, top: 0, left: 200 },
        { wire: wrappedBandStart, top: 24, left: 0 },
        { wire: wire.length - 1, top: 24, left: 220 },
      ];

      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, wrappedBandStart),
        "up",
        samples,
        24,
        0,
        16
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(0);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(firstBandTail);
    });
  });

  describe("visual boundary bleed", () => {
    it("Up from first visual row bleeds horizontally instead of blocking", () => {
      const { root, doc } = mountWrapEditor();
      setSelectionAtWire(root, doc, 19);

      const moved = resolveDomVerticalArrowMove(root, doc, wireOffsetToDocPos(doc, 19), "up");

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(18);
      root.remove();
    });

    it("Down from last visual row bleeds horizontally instead of blocking", () => {
      const agent = "caliper-aaaaaaa";
      const { doc, focus: tailPos } = buildMentionTailDoc(agent, "tailcontent");
      const tailWire = docPosToWireOffset(doc, tailPos);
      const midTailWire = tailWire - 2;
      const { root } = mountWrapEditor(doc);
      setSelectionAtWire(root, doc, midTailWire);

      const moved = resolveDomVerticalArrowMove(
        root,
        doc,
        wireOffsetToDocPos(doc, midTailWire),
        "down"
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBeGreaterThan(midTailWire);
      root.remove();
    });

    it("bleeds horizontally when layout has only one visual row", () => {
      const wire = "abcdefgh";
      const doc = wireToDoc(wire);
      const surface = document.createElement("div");
      surface.style.width = "320px";
      document.body.appendChild(surface);
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 320 });
      setSelectionAtWire(surface, doc, 4);

      const moved = resolveDomVerticalArrowMove(surface, doc, wireOffsetToDocPos(doc, 4), "down");

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(5);
      surface.remove();
    });
  });

  describe("layout row assignment", () => {
    it("clusters samples into distinct visual rows when pills sit on different Y bands", () => {
      const firstBandTop = 141;
      const wrappedBandTop = 159;
      const samples = [
        { wire: 0, top: firstBandTop, left: 347 },
        { wire: 19, top: firstBandTop, left: 480 },
        { wire: 37, top: firstBandTop, left: 600 },
        { wire: 38, top: firstBandTop, left: 347 },
        { wire: 56, top: wrappedBandTop, left: 479 },
        { wire: 57, top: wrappedBandTop, left: 483 },
      ];

      const layout = buildLayoutMapFromSamples(samples, 18);

      expect(layout.visualRowCount).toBe(2);
      expect(layout.rowIndexForWire(56)).toBe(1);
      expect(layout.rowIndexForWire(0)).toBe(0);
    });

    it("assigns wrapped-band mention start to the continuation visual row index", () => {
      const { root, doc } = mountWrapEditor();
      setSelectionAtWire(root, doc, WRAP_ROW2_PILL_START);

      expect(readHandoffNoteLayoutRowIndexForTests(root, doc, WRAP_ROW2_PILL_START)).toBe(1);
      expect(readHandoffNoteLayoutRowIndexForTests(root, doc, 0)).toBe(0);
      expect(readHandoffNoteLayoutSamplesForTests(root, doc).length).toBeGreaterThan(1);
      root.remove();
    });

    it("assigns trailing text after mention to the same visual row as its preceding pill", () => {
      const agent = "caliper-aaaaaaa";
      const { doc, focus: tailPos } = buildMentionTailDoc(agent, "tailcontent");
      const tailWire = docPosToWireOffset(doc, tailPos);
      const { root } = mountWrapEditor(doc);

      expect(readHandoffNoteLayoutRowIndexForTests(root, doc, tailWire, tailPos)).toBe(1);
      root.remove();
    });
  });

  describe("visual row start landing", () => {
    const MID_WRAP_AGENT = "caliper-midwrap01";

    function buildMidTextWrapDoc(agent: string): {
      doc: HandoffNoteDoc;
      wire: string;
      secondMentionStart: number;
      firstMentionEnd: number;
      middleTextNodeIndex: number;
    } {
      const wire = `lead @${agent} ${"fill ".repeat(6)}tail @${agent} `;
      const doc = wireToDoc(wire);
      const firstMentionPos = wireOffsetToDocPos(doc, wire.indexOf("@"));
      const firstMentionEnd = docPosToWireOffset(doc, {
        nodeIndex: firstMentionPos.nodeIndex,
        nodeOffset: 1 + agent.length,
      });
      return {
        doc,
        wire,
        secondMentionStart: wire.lastIndexOf("@"),
        firstMentionEnd,
        middleTextNodeIndex: firstMentionPos.nodeIndex + 1,
      };
    }

    function mountMidTextWrapEditor(agent = MID_WRAP_AGENT): {
      root: HTMLDivElement;
      doc: HandoffNoteDoc;
      secondMentionStart: number;
      firstMentionEnd: number;
      middleTextNodeIndex: number;
    } {
      const { doc, secondMentionStart, firstMentionEnd, middleTextNodeIndex } =
        buildMidTextWrapDoc(agent);
      const surface = document.createElement("div");
      surface.style.width = `${WRAP_ROOT_WIDTH}px`;
      surface.contentEditable = "true";
      document.body.appendChild(surface);
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[agent, "#06f"]]) });
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: WRAP_ROOT_WIDTH });
      const firstMentionNodeIndex = wireOffsetToDocPos(doc, docToWire(doc).indexOf("@")).nodeIndex;
      const pillCoords = new Map<number, { top: number; left: number }>();
      for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
        if (doc.nodes[nodeIndex]?.type !== "mention") {
          continue;
        }
        const onWrappedBand = nodeIndex > firstMentionNodeIndex;
        pillCoords.set(nodeIndex, {
          top: onWrappedBand ? ROW2_TOP : ROW1_TOP,
          left: onWrappedBand ? 480 : ROW_START_LEFT + 48,
        });
      }
      stubHandoffNoteMentionLayoutCoords(surface, pillCoords);
      stubHandoffNoteAnchorRectAtWire(surface, doc, 0, {
        top: ROW1_TOP,
        left: ROW_START_LEFT,
      });
      return { root: surface, doc, secondMentionStart, firstMentionEnd, middleTextNodeIndex };
    }

    it("Down from doc start lands in wrapped middle text at content column via DOM probe, not next mention", () => {
      const { root, doc, secondMentionStart, firstMentionEnd, middleTextNodeIndex } =
        mountMidTextWrapEditor();
      const middleNode = doc.nodes[middleTextNodeIndex];
      if (middleNode?.type !== "text") {
        throw new Error("expected middle text node");
      }
      const wrapPos: HandoffNoteDocPos = {
        nodeIndex: middleTextNodeIndex,
        nodeOffset: Math.ceil(middleNode.text.length / 2),
      };
      const restoreProbe = stubCaretProbeAtDocPos(root, doc, ROW_START_LEFT, ROW2_TOP, wrapPos);
      const restoreRects = stubTextNodeLineRects(root, doc, middleTextNodeIndex, [
        { top: ROW1_TOP, left: 480, width: 120 },
        { top: ROW2_TOP, left: ROW_START_LEFT, width: 120 },
      ]);
      setSelectionAtWire(root, doc, 0);

      const moved = resolveDomVerticalArrowMove(root, doc, wireOffsetToDocPos(doc, 0), "down");

      restoreProbe();
      restoreRects();
      expect(moved.handled).toBe(true);
      const landed = docPosToWireOffset(doc, moved.pos);
      expect(landed).toBe(docPosToWireOffset(doc, wrapPos));
      expect(landed).not.toBe(secondMentionStart);
      expect(landed).toBeGreaterThan(firstMentionEnd);
      expect(landed).toBeLessThan(secondMentionStart);
      expect(doc.nodes[wireOffsetToDocPos(doc, landed).nodeIndex]?.type).toBe("text");
      root.remove();
    });

    it("layout map assigns wrapped middle-text line fragment to continuation visual row", () => {
      const { root, doc, middleTextNodeIndex } = mountMidTextWrapEditor();
      const middleNode = doc.nodes[middleTextNodeIndex];
      if (middleNode?.type !== "text") {
        throw new Error("expected middle text node");
      }
      const wrapPos: HandoffNoteDocPos = {
        nodeIndex: middleTextNodeIndex,
        nodeOffset: Math.ceil(middleNode.text.length / 2),
      };
      const wrapWire = docPosToWireOffset(doc, wrapPos);
      const restoreRects = stubTextNodeLineRects(root, doc, middleTextNodeIndex, [
        { top: ROW1_TOP, left: 480, width: 120 },
        { top: ROW2_TOP, left: ROW_START_LEFT, width: 120 },
      ]);
      const restoreProbe = stubCaretProbeAtDocPos(root, doc, ROW_START_LEFT, ROW2_TOP, wrapPos);
      invalidateHandoffNoteLayoutCache();

      expect(readHandoffNoteLayoutRowIndexForTests(root, doc, wrapWire, wrapPos)).toBe(1);

      restoreProbe();
      restoreRects();
      root.remove();
    });

    it("rejects row-start probe on wrong visual row and lands via target-row column match", () => {
      const { root, doc, firstMentionEnd, middleTextNodeIndex } = mountMidTextWrapEditor();
      const restoreRects = stubTextNodeLineRects(root, doc, middleTextNodeIndex, [
        { top: ROW1_TOP, left: 480, width: 120 },
        { top: ROW2_TOP, left: ROW_START_LEFT, width: 120 },
      ]);
      const restoreProbe = stubCaretProbeAtDocPos(
        root,
        doc,
        ROW_START_LEFT,
        ROW2_TOP,
        wireOffsetToDocPos(doc, firstMentionEnd)
      );
      setSelectionAtWire(root, doc, 0);

      const moved = resolveDomVerticalArrowMove(root, doc, wireOffsetToDocPos(doc, 0), "down");

      restoreProbe();
      restoreRects();
      expect(moved.handled).toBe(true);
      const landed = docPosToWireOffset(doc, moved.pos);
      expect(landed).not.toBe(firstMentionEnd);
      expect(landed).toBeGreaterThan(firstMentionEnd);
      expect(readHandoffNoteLayoutRowIndexForTests(root, doc, landed)).toBe(1);
      root.remove();
    });
  });

  describe("inline mention on wrapped band", () => {
    const INLINE_AGENT = "caliper-midwrap01";

    function buildInlineMentionMidWrapDoc(agent: string): {
      doc: HandoffNoteDoc;
      inlineMentionNodeIndex: number;
      afterInlinePos: HandoffNoteDocPos;
    } {
      const wire = `lead @${agent} ${"fill ".repeat(6)}x@${agent} tail @${agent} `;
      const doc = wireToDoc(wire);
      const inlineAt = wire.indexOf("x@") + 1;
      const inlineMentionPos = wireOffsetToDocPos(doc, inlineAt);
      const afterInlinePos: HandoffNoteDocPos = {
        nodeIndex: inlineMentionPos.nodeIndex,
        nodeOffset: 1 + agent.length,
      };
      return { doc, inlineMentionNodeIndex: inlineMentionPos.nodeIndex, afterInlinePos };
    }

    function mountInlineMentionMidWrapEditor(): {
      root: HTMLDivElement;
      doc: HandoffNoteDoc;
      afterInlinePos: HandoffNoteDocPos;
    } {
      const { doc, inlineMentionNodeIndex, afterInlinePos } =
        buildInlineMentionMidWrapDoc(INLINE_AGENT);
      const surface = document.createElement("div");
      surface.style.width = `${WRAP_ROOT_WIDTH}px`;
      surface.contentEditable = "true";
      document.body.appendChild(surface);
      renderHandoffNoteDoc(surface, doc, {
        colorByAgentId: new Map([[INLINE_AGENT, "#06f"]]),
      });
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: WRAP_ROOT_WIDTH });
      const pillCoords = new Map<number, { top: number; left: number }>();
      for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
        if (doc.nodes[nodeIndex]?.type !== "mention") {
          continue;
        }
        const onWrappedBand = nodeIndex >= inlineMentionNodeIndex;
        pillCoords.set(nodeIndex, {
          top: onWrappedBand ? ROW2_TOP : ROW1_TOP,
          left: onWrappedBand ? ROW_START_LEFT + 40 : ROW_START_LEFT + 48,
        });
      }
      stubHandoffNoteMentionLayoutCoords(surface, pillCoords);
      const afterInlineWire = docPosToWireOffset(doc, afterInlinePos);
      stubHandoffNoteAnchorRectAtWire(surface, doc, afterInlineWire, {
        top: ROW2_TOP,
        left: ROW_START_LEFT + 80,
      });
      return { root: surface, doc, afterInlinePos };
    }

    it("Up from text after inline mention on wrapped band crosses to previous visual row", () => {
      const { root, doc, afterInlinePos } = mountInlineMentionMidWrapEditor();
      setSelectionAtWire(root, doc, docPosToWireOffset(doc, afterInlinePos));

      const moved = resolveDomVerticalArrowMove(root, doc, afterInlinePos, "up");

      expect(moved.handled).toBe(true);
      expect(
        readHandoffNoteLayoutRowIndexForTests(root, doc, docPosToWireOffset(doc, moved.pos))
      ).toBe(0);
      root.remove();
    });
  });

  describe("unsampled wire navigation", () => {
    it("Up from trailing text on wrapped band crosses to previous visual row", () => {
      const agent = "caliper-aaaaaaa";
      const { doc, focus: tailPos } = buildMentionTailDoc(agent, "tailcontent");
      const { root } = mountWrapEditor(doc);
      setSelectionAtWire(root, doc, docPosToWireOffset(doc, tailPos));

      const moved = resolveDomVerticalArrowMove(root, doc, tailPos, "up");

      expect(moved.handled).toBe(true);
      expect(
        readHandoffNoteLayoutRowIndexForTests(root, doc, docPosToWireOffset(doc, moved.pos))
      ).toBe(0);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(docPosToWireOffset(doc, tailPos));
      root.remove();
    });
  });
});
