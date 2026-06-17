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

type VerticalSign = -1 | 1;

function assertVerticalMove(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  fromWire: number,
  sign: VerticalSign,
  expectWire: number,
  notExpectWire?: number
): void {
  setSelectionAtWire(root, doc, fromWire);
  const moved = resolveDomVerticalArrowMove(
    root,
    doc,
    wireOffsetToDocPos(doc, fromWire),
    sign === -1 ? "up" : "down"
  );
  expect(moved.handled).toBe(true);
  expect(docPosToWireOffset(doc, moved.pos)).toBe(expectWire);
  if (notExpectWire !== undefined) {
    expect(docPosToWireOffset(doc, moved.pos)).not.toBe(notExpectWire);
  }
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

  describe("vertical — cross visual row on soft-wrapped wire line", () => {
    it("preserves goal column on adjacent visual rows with measured samples", () => {
      const doc = wireToDoc(TRIPLE_MENTION_WIRE);
      const movedUp = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 57),
        "up",
        [...ORACLE_SAMPLES],
        ROW2_TOP,
        600,
        TEXT_LINE_HEIGHT
      );

      expect(movedUp.handled).toBe(true);
      expect(docPosToWireOffset(doc, movedUp.pos)).toBe(37);

      const movedDown = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 37),
        "down",
        [...ORACLE_SAMPLES],
        ROW1_TOP,
        600,
        TEXT_LINE_HEIGHT
      );

      expect(movedDown.handled).toBe(true);
      expect(docPosToWireOffset(doc, movedDown.pos)).toBe(57);
    });

    it("wrapped-band start and doc start cross on TRIPLE_MENTION wire", () => {
      const { root, doc } = mountWrapEditor();
      assertVerticalMove(root, doc, WRAP_ROW2_PILL_START, -1, 0, WRAP_ROW2_PILL_START - 1);
      assertVerticalMove(root, doc, 0, 1, WRAP_ROW2_PILL_START);
      root.remove();
    });

    it("wrapped-band left edge when tail sample shares continuation band", () => {
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

    it("wrapped-band start and doc start round-trip on header tail wire", () => {
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

      const movedUp = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, wrappedBandStart),
        "up",
        samples,
        24,
        0,
        16
      );

      expect(movedUp.handled).toBe(true);
      expect(docPosToWireOffset(doc, movedUp.pos)).toBe(0);
      expect(docPosToWireOffset(doc, movedUp.pos)).not.toBe(firstBandTail);

      const movedDown = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 0),
        "down",
        samples,
        0,
        0,
        16
      );

      expect(movedDown.handled).toBe(true);
      expect(docPosToWireOffset(doc, movedDown.pos)).toBe(wrappedBandStart);
    });
  });

  describe("vertical — visual boundary bleed on soft-wrapped wire line", () => {
    it("first visual row extreme bleeds horizontally on TRIPLE_MENTION wire", () => {
      const { root, doc } = mountWrapEditor();
      assertVerticalMove(root, doc, 19, -1, 18);
      root.remove();
    });

    it("last visual row extreme bleeds horizontally on TRIPLE_MENTION wire", () => {
      const { root, doc } = mountWrapEditor();
      const lastRowExtreme = TRIPLE_MENTION_WIRE.length - 1;
      assertVerticalMove(root, doc, lastRowExtreme, 1, TRIPLE_MENTION_WIRE.length);
      root.remove();
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

    it("assigns suffix blank band below two-pill row to its own visual row", () => {
      const agent = "caliper-aaaaaaa";
      const wire = `row @${agent} @${agent} \n\n@${agent} `;
      const doc = wireToDoc(wire);
      const firstSuffixBlankWire = wire.indexOf("\n") + 1;
      const lowerPillStartWire = docPosToWireOffset(doc, { nodeIndex: 5, nodeOffset: 0 });
      const postSecondPillWire =
        docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: agent.length }) + 1;
      const layout = buildLayoutMapFromSamples(
        [
          { wire: 0, top: 100, left: 0 },
          { wire: postSecondPillWire, top: 100, left: 400 },
          { wire: firstSuffixBlankWire, top: 136, left: 0 },
          { wire: lowerPillStartWire, top: 172, left: 0 },
        ],
        36,
        doc
      );

      expect(layout.visualRowCount).toBeGreaterThanOrEqual(3);
      expect(layout.rowIndexForWire(lowerPillStartWire)).toBeGreaterThan(
        layout.rowIndexForWire(firstSuffixBlankWire)
      );
      expect(layout.rowIndexForWire(firstSuffixBlankWire)).toBeGreaterThan(0);
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

    it("doc start lands in wrapped middle text via DOM probe, not next mention", () => {
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

  describe("vertical — crosses previous visual row from inline mention on wrapped band", () => {
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

    it("text after inline mention lands on previous visual row", () => {
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

  describe("vertical — crosses previous visual row from unsampled tail", () => {
    it("trailing text on wrapped band without full samples", () => {
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

  describe("vertical — unsampled interior on soft-wrapped wire line", () => {
    const AGENT = "caliper-aaaaaaa";
    const WIRE = `prefix @${AGENT}  tail @${AGENT} `;
    const ROW1_TOP = 141.09897422790527;
    const ROW2_TOP = 159.29689598083496;
    const ROW_START_LEFT = 347;
    const LINE_HEIGHT = 18.197921752929688;
    const PREFIX_MID_WIRE = 2;
    /** Column-preserved landing on wrapped row 2 for goalColumn below (bracket between samples 28 and 46). */
    const WRAPPED_INTERIOR_WIRE = 29;
    const PREFIX_GOAL_LEFT = ROW_START_LEFT + 20;

    const WRAP_SAMPLES = [
      { wire: 0, top: ROW1_TOP, left: ROW_START_LEFT },
      { wire: 5, top: ROW1_TOP, left: 400 },
      { wire: 24, top: ROW1_TOP, left: 480 },
      { wire: 23, top: ROW2_TOP, left: 350 },
      { wire: 28, top: ROW2_TOP, left: 362 },
      { wire: 46, top: ROW2_TOP, left: 479 },
      { wire: 47, top: ROW2_TOP, left: 483 },
    ] as const;

    it("control: down from sampled row start crosses to wrapped row start", () => {
      const doc = wireToDoc(WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 0),
        "down",
        [...WRAP_SAMPLES],
        ROW1_TOP,
        ROW_START_LEFT,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(23);
    });

    it("down from unsampled prefix interior lands at preserved column on wrapped row", () => {
      const doc = wireToDoc(WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, PREFIX_MID_WIRE),
        "down",
        [...WRAP_SAMPLES],
        ROW1_TOP,
        PREFIX_GOAL_LEFT,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(WRAPPED_INTERIOR_WIRE);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(PREFIX_MID_WIRE + 1);
    });

    it("up from unsampled wrapped interior returns to prefix column", () => {
      const doc = wireToDoc(WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, WRAPPED_INTERIOR_WIRE),
        "up",
        [...WRAP_SAMPLES],
        ROW2_TOP,
        PREFIX_GOAL_LEFT,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(PREFIX_MID_WIRE);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(0);
    });

    it("prefix interior and wrapped interior round-trip at goal column", () => {
      const doc = wireToDoc(WIRE);
      const down = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, PREFIX_MID_WIRE),
        "down",
        [...WRAP_SAMPLES],
        ROW1_TOP,
        PREFIX_GOAL_LEFT,
        LINE_HEIGHT
      );
      expect(docPosToWireOffset(doc, down.pos)).toBe(WRAPPED_INTERIOR_WIRE);

      const up = resolveMeasuredVerticalArrowMove(
        doc,
        down.pos,
        "up",
        [...WRAP_SAMPLES],
        ROW2_TOP,
        PREFIX_GOAL_LEFT,
        LINE_HEIGHT
      );
      expect(docPosToWireOffset(doc, up.pos)).toBe(PREFIX_MID_WIRE);
    });
  });

  describe("vertical — unsampled interior on plain soft-wrapped text", () => {
    const WIRE = `${"abcdefgh ".repeat(12)}end`;
    const ROW1_TOP = 100;
    const ROW2_TOP = 118;
    const LINE_HEIGHT = 18;
    const FROM_WIRE = 10;
    const GOAL_LEFT = 55;
    const CONTINUATION_WIRE = 89;

    const WRAP_SAMPLES = [
      { wire: 0, top: ROW1_TOP, left: 0 },
      { wire: 40, top: ROW1_TOP, left: 220 },
      { wire: 80, top: ROW2_TOP, left: 0 },
      { wire: WIRE.length - 1, top: ROW2_TOP, left: 180 },
    ] as const;

    it("down from unsampled mid-line interior lands at preserved column on continuation row", () => {
      const doc = wireToDoc(WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, FROM_WIRE),
        "down",
        [...WRAP_SAMPLES],
        ROW1_TOP,
        GOAL_LEFT,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(CONTINUATION_WIRE);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(FROM_WIRE + 1);
    });

    it("up from unsampled continuation interior returns to mid-line column", () => {
      const doc = wireToDoc(WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, CONTINUATION_WIRE),
        "up",
        [...WRAP_SAMPLES],
        ROW2_TOP,
        GOAL_LEFT,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(FROM_WIRE);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(0);
    });
  });

  describe("vertical — mention end and post-mention text on soft-wrapped wire line", () => {
    const AGENT = "caliper-aaaaaaaaaaa";
    const WIRE = `header @${AGENT} tail @${AGENT} `;
    const doc = wireToDoc(WIRE);
    const ROW1_TOP = 141.09897422790527;
    const ROW2_TOP = 159.29689598083496;
    const LINE_HEIGHT = 18.197921752929688;
    const firstMentionStart = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: 0 });
    const firstMentionEnd = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: AGENT.length });
    const postMentionStart = firstMentionEnd + 1;
    const gapMidWire = postMentionStart + 3;
    const secondMentionMid = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 4 });
    const secondMentionEnd = WIRE.length - 1;
    const GOAL_COLUMN = 482.7083435058594;

    const layoutSamples = [
      { wire: 0, top: ROW1_TOP, left: 347 },
      { wire: firstMentionStart, top: ROW1_TOP, left: 360 },
      { wire: postMentionStart, top: ROW1_TOP, left: 480 },
      { wire: firstMentionEnd, top: ROW2_TOP, left: 505.38543701171875 },
      { wire: gapMidWire, top: ROW2_TOP, left: 362 },
      { wire: secondMentionMid, top: ROW2_TOP, left: 470 },
      { wire: secondMentionEnd, top: ROW2_TOP, left: GOAL_COLUMN },
    ] as const;

    it("control: prefix and second mention end occupy distinct visual rows", () => {
      const layout = buildLayoutMapFromSamples([...layoutSamples], LINE_HEIGHT, doc);
      expect(layout.rowIndexForWire(0)).toBe(0);
      expect(layout.rowIndexForWire(secondMentionEnd)).toBe(1);
    });

    it("mention end and immediately following text share one visual row", () => {
      const layout = buildLayoutMapFromSamples([...layoutSamples], LINE_HEIGHT, doc);
      expect(layout.rowIndexForWire(firstMentionEnd)).toBe(
        layout.rowIndexForWire(postMentionStart)
      );
    });

    it("up from second mention end lands on upper visual row at preserved column", () => {
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, secondMentionEnd),
        "up",
        [...layoutSamples],
        ROW2_TOP,
        GOAL_COLUMN,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(firstMentionStart);
      expect(
        buildLayoutMapFromSamples([...layoutSamples], LINE_HEIGHT, doc).rowIndexForWire(
          docPosToWireOffset(doc, moved.pos)
        )
      ).toBe(0);
    });

    it("down after up from second mention end returns to lower row without ping-pong", () => {
      const up = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, secondMentionEnd),
        "up",
        [...layoutSamples],
        ROW2_TOP,
        GOAL_COLUMN,
        LINE_HEIGHT
      );
      expect(docPosToWireOffset(doc, up.pos)).toBe(firstMentionStart);

      const down = resolveMeasuredVerticalArrowMove(
        doc,
        up.pos,
        "down",
        [...layoutSamples],
        ROW1_TOP,
        GOAL_COLUMN,
        LINE_HEIGHT
      );

      expect(down.handled).toBe(true);
      expect(docPosToWireOffset(doc, down.pos)).toBe(secondMentionEnd);
      expect(docPosToWireOffset(doc, down.pos)).not.toBe(postMentionStart);

      const downAgain = resolveMeasuredVerticalArrowMove(
        doc,
        down.pos,
        "down",
        [...layoutSamples],
        ROW2_TOP,
        GOAL_COLUMN,
        LINE_HEIGHT
      );
      expect(downAgain.handled).toBe(false);
    });
  });
});
