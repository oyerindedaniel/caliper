import { describe, expect, it, beforeEach } from "vitest";
import {
  applyDocDelete,
  applyDocInsertText,
  collapsedSelection,
  describeHandoffNoteCursorContext,
  docPosToWireOffset,
  docToWire,
  listEmbeddedBlankBandProbeWires,
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
  resolveClickIngressSelection,
  resolveDomVerticalArrowMove,
  resolveLayoutVerticalArrowMove,
  resolveVerticalTargetLineIndex,
  setDocSelection,
} from "./handoff-note-selection.js";
import {
  buildHandoffNoteLayoutMap,
  buildLayoutMapFromSamples,
  invalidateHandoffNoteLayoutCache,
  layoutContentRowEndSample,
  layoutContentRowEndWire,
  layoutContentRowStickyColumn,
  layoutContentRowContentExtentRight,
  layoutRowForFocus,
  setMeasuredSamplesCache,
  type HandoffNoteLayoutMap,
  type HandoffNoteLayoutRow,
} from "./handoff-note-layout-map.js";
import { renderHandoffNoteDoc } from "./handoff-note-dom.js";
import {
  getAnchorRectAtWire,
  readDomWireCursor,
  readDomWireSelection,
  readHandoffNoteLayoutRowIndexForTests,
  readHandoffNoteLayoutSamplesForTests,
  resolveMeasuredVerticalArrowMoveForTests as resolveMeasuredVerticalArrowMove,
  setDomCaretAtTextEnd,
  setSelectionAtDocPos,
  setSelectionAtWire,
  prepareVerticalColumnProbe,
  mountMultiMentionSoftWrapFixture,
  mountThreeRowMentionSoftWrapFixture,
  MULTI_MENTION_SOFT_WRAP_AGENT,
  reapplyThreeRowMentionSoftWrapStubs,
  applyThreeRowSpacerBrowserParityLayoutStubs,
  stubCaretProbeAtDocPos,
  stubCaretProbeHits,
  stubHandoffNoteAnchorRectAtWire,
  stubHandoffNoteMentionLayoutCoords,
  seedMonotonicMeasuredLayout,
  stubTextNodeLineRects,
} from "./handoff-note-test-helpers.js";
import { domPointInMentionPill } from "../handoff-note-debug.js";
import {
  docPosAtContentWire,
  domPointToDocPos,
  resolveDomPointAtDocPos,
} from "./handoff-note-dom-points.js";

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

  it("reads mention-interior DOM caret faithfully and repair restores outside authority", () => {
    const pill = root.querySelector("span[data-handoff-mention]")!;
    const pillText = pill.firstChild as Text;
    const selection = root.ownerDocument.getSelection()!;
    const range = root.ownerDocument.createRange();
    range.setStart(pillText, 3);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const live = readDocCursor(root, doc);
    expect(docPosToWireOffset(doc, live)).toBe(MENTION_START + 4);
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

  it("restores mention interior authority when DOM reads blank probe after blank-band step", () => {
    const suffixWire = `header @caliper-aaaaaaa tail\n\n\n`;
    const suffixDoc = wireToDoc(suffixWire);
    const probes = listEmbeddedBlankBandProbeWires(suffixDoc);
    const mentionIdx = suffixDoc.nodes.findIndex((node) => node.type === "mention");
    const mentionLastInterior = {
      nodeIndex: mentionIdx,
      nodeOffset: 1 + "caliper-aaaaaaa".length - 1,
    };
    const authorityWire = docPosToWireOffset(suffixDoc, mentionLastInterior);
    const { root: bandRoot, doc: bandDoc } = mountEditor(suffixWire);

    setDocSelection(bandRoot, bandDoc, collapsedSelection(mentionLastInterior), {
      source: "test.authority",
    });

    setSelectionAtWire(bandRoot, bandDoc, probes[0]!, probes[0]!);
    expect(readDomWireCursor(bandRoot, bandDoc)).toBe(probes[0]!);

    const repaired = repairDocSelectionIfNeeded(bandRoot, bandDoc, mentionLastInterior, {
      mode: "full",
    });
    expect(docPosToWireOffset(bandDoc, repaired)).toBe(authorityWire);
    expect(readDomWireCursor(bandRoot, bandDoc)).toBe(authorityWire);
  });

  it("full repair keeps mention interior when authority and live agree at same wire", () => {
    const agent = "caliper-85l0t4y9j";
    const wire = `header @${agent}\n\n\n`;
    const doc = wireToDoc(wire);
    const interiorWire = wire.indexOf("j");
    const mentionIdx = doc.nodes.findIndex((node) => node.type === "mention");
    const interior = wireOffsetToDocPos(doc, interiorWire);
    const { root } = mountEditor(wire);

    setDocSelection(root, doc, collapsedSelection(interior), { source: "test.authority" });
    expect(readDomWireCursor(root, doc)).toBe(interiorWire);

    const repaired = repairDocSelectionIfNeeded(root, doc, interior, { mode: "full" });
    expect(docPosToWireOffset(doc, repaired)).toBe(interiorWire);
    expect(docPosToWireOffset(doc, repaired)).not.toBe(listEmbeddedBlankBandProbeWires(doc)[0]);
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

  it("accepts valid DOM text without probe snap when prior was on row interior", () => {
    const suffixWire = `header @caliper-aaaaaaa row\n\n\nlower `;
    const suffixDoc = wireToDoc(suffixWire);
    const probes = listEmbeddedBlankBandProbeWires(suffixDoc);
    const headerEnd = probes[0]! - 1;
    const [firstProbe] = probes;
    const { root: bandRoot, doc: bandDoc } = mountEditor(suffixWire);

    setSelectionAtWire(bandRoot, bandDoc, firstProbe!, firstProbe!);
    const repaired = repairDocSelectionIfNeeded(bandRoot, bandDoc, wireOffsetToDocPos(bandDoc, 0), {
      mode: "strand-only",
    });
    expect(docPosToWireOffset(bandDoc, repaired)).toBe(firstProbe);
    expect(docPosToWireOffset(bandDoc, repaired)).not.toBe(headerEnd);
    expect(readDomWireCursor(bandRoot, bandDoc)).toBe(firstProbe);
  });

  it("accepts content text-node tail as content row end on strand-only ingress", () => {
    const plainWire = `hello\n\n\nlower `;
    const plainDoc = wireToDoc(plainWire);
    const probes = listEmbeddedBlankBandProbeWires(plainDoc);
    const headerEnd = probes[0]! - 1;
    const { root: bandRoot, doc: bandDoc } = mountEditor(plainWire);
    const firstText = bandRoot.childNodes[0];
    expect(firstText?.nodeType).toBe(Node.TEXT_NODE);

    setDomCaretAtTextEnd(bandRoot, firstText as Text);
    const repaired = repairDocSelectionIfNeeded(bandRoot, bandDoc, wireOffsetToDocPos(bandDoc, 0), {
      mode: "strand-only",
    });
    expect(docPosToWireOffset(bandDoc, repaired)).toBe(headerEnd);
    expect(readDomWireCursor(bandRoot, bandDoc)).toBe(headerEnd);
  });

  it("keeps blank probe when prior authority was already at content row end", () => {
    const suffixWire = `header @caliper-aaaaaaa row\n\n\nlower `;
    const suffixDoc = wireToDoc(suffixWire);
    const probes = listEmbeddedBlankBandProbeWires(suffixDoc);
    const headerEnd = probes[0]! - 1;
    const [firstProbe] = probes;
    const { root: bandRoot, doc: bandDoc } = mountEditor(suffixWire);

    setSelectionAtWire(bandRoot, bandDoc, firstProbe!, firstProbe!);
    const repaired = repairDocSelectionIfNeeded(
      bandRoot,
      bandDoc,
      wireOffsetToDocPos(bandDoc, headerEnd),
      { mode: "strand-only" }
    );
    expect(docPosToWireOffset(bandDoc, repaired)).toBe(firstProbe);
    expect(readDomWireCursor(bandRoot, bandDoc)).toBe(firstProbe);
  });

  it("full repair restores mention node end over text-node probe alias at same wire", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header @${agent} \n\n\n`;
    const doc = wireToDoc(wire);
    const spacerWire = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
    const chipped = applyDocDelete(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, spacerWire)),
      "backspace"
    )!;
    const authority = chipped.selection.focus;
    const probeWire = listEmbeddedBlankBandProbeWires(chipped.doc)[0]!;
    const { root: bandRoot, doc: bandDoc } = mountEditor(docToWire(chipped.doc));

    setDocSelection(bandRoot, bandDoc, collapsedSelection(authority), { source: "test.authority" });
    setSelectionAtWire(bandRoot, bandDoc, probeWire, probeWire);

    const repaired = repairDocSelectionIfNeeded(bandRoot, bandDoc, authority, { mode: "full" });
    expect(bandDoc.nodes[repaired.nodeIndex]?.type).toBe("mention");
    expect(docPosToWireOffset(bandDoc, repaired)).toBe(probeWire);
  });

  it("strand-only repair restores mention node end over text-node probe alias at same wire", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header @${agent} \n\n\n`;
    const doc = wireToDoc(wire);
    const spacerWire = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
    const chipped = applyDocDelete(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, spacerWire)),
      "backspace"
    )!;
    const authority = chipped.selection.focus;
    const probeWire = listEmbeddedBlankBandProbeWires(chipped.doc)[0]!;
    const { root: bandRoot, doc: bandDoc } = mountEditor(docToWire(chipped.doc));

    setDocSelection(bandRoot, bandDoc, collapsedSelection(authority), { source: "test.authority" });
    setSelectionAtWire(bandRoot, bandDoc, probeWire, probeWire);

    const repaired = repairDocSelectionIfNeeded(bandRoot, bandDoc, authority, {
      mode: "strand-only",
    });
    expect(bandDoc.nodes[repaired.nodeIndex]?.type).toBe("mention");
    expect(docPosToWireOffset(bandDoc, repaired)).toBe(probeWire);
  });

  it("sets and reads wire cursor at text and mention boundaries", () => {
    setSelectionAtWire(root, doc, MENTION_START);
    expect(readDomWireCursor(root, doc)).toBe(MENTION_START);

    setSelectionAtWire(root, doc, MENTION_END);
    expect(readDomWireCursor(root, doc)).toBe(MENTION_END);

    setSelectionAtWire(root, doc, NOTE.length);
    expect(readDomWireCursor(root, doc)).toBe(NOTE.length);
  });

  it("round-trips mention-interior wire offsets and snaps with boundary from hints", () => {
    const interior = MENTION_START + 5;
    setSelectionAtWire(root, doc, interior);
    expect(readDomWireCursor(root, doc)).toBe(interior);

    setSelectionAtWire(root, doc, interior, interior, {
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
 * Constants ROW1_TOP / ROW2_TOP are measured layout Y bands, not row ordinals.
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
    it("measured-only interior up/down is no-op", () => {
      const wire = "abcdef\nghijkl";
      const doc = wireToDoc(wire);
      const line2Start = wire.indexOf("\n") + 1;
      const sourceWire = line2Start + 2;
      const samples = [
        { wire: 0, top: ROW1_TOP, left: 0 },
        { wire: 3, top: ROW1_TOP, left: 30 },
        { wire: 5, top: ROW1_TOP, left: 55 },
        { wire: line2Start, top: ROW2_TOP, left: 10 },
        { wire: sourceWire, top: ROW2_TOP, left: 40 },
        { wire: line2Start + 5, top: ROW2_TOP, left: 70 },
      ] as const;
      const goalColumn = 40;
      const movedUp = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, sourceWire),
        "up",
        [...samples],
        goalColumn,
        TEXT_LINE_HEIGHT
      );

      expect(movedUp.handled).toBe(false);
      expect(docPosToWireOffset(doc, movedUp.pos)).toBe(sourceWire);

      const movedDown = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 3),
        "down",
        [...samples],
        goalColumn,
        TEXT_LINE_HEIGHT
      );

      expect(movedDown.handled).toBe(false);
      expect(docPosToWireOffset(doc, movedDown.pos)).toBe(3);
    });

    it("wrapped-band start and doc start cross on TRIPLE_MENTION wire", () => {
      const { root, doc } = mountWrapEditor();
      setMeasuredSamplesCache(root, TRIPLE_MENTION_WIRE, WRAP_ROOT_WIDTH, [...ORACLE_SAMPLES]);
      const restoreUpAnchor = stubHandoffNoteAnchorRectAtWire(root, doc, WRAP_ROW2_PILL_START, {
        top: ROW2_TOP,
        left: ROW_START_LEFT,
      });
      const restoreUpProbe = stubCaretProbeAtDocPos(
        root,
        doc,
        ROW_START_LEFT,
        ROW1_TOP,
        wireOffsetToDocPos(doc, 0)
      );
      try {
        assertVerticalMove(root, doc, WRAP_ROW2_PILL_START, -1, 0, WRAP_ROW2_PILL_START - 1);
        restoreUpProbe();
        const restoreDownProbe = stubCaretProbeAtDocPos(
          root,
          doc,
          ROW_START_LEFT,
          ROW2_TOP,
          wireOffsetToDocPos(doc, WRAP_ROW2_PILL_START)
        );
        assertVerticalMove(root, doc, 0, 1, WRAP_ROW2_PILL_START);
        restoreDownProbe();
      } finally {
        restoreUpAnchor();
        root.remove();
      }
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
      setMeasuredSamplesCache(root, TRIPLE_MENTION_WIRE, WRAP_ROOT_WIDTH, [...ORACLE_SAMPLES]);
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
      setMeasuredSamplesCache(root, docToWire(doc), WRAP_ROOT_WIDTH, [
        ...ORACLE_SAMPLES,
        { wire: tailWire, top: ROW2_TOP, left: 520 },
      ]);

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
        ROW_START_LEFT,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      // Wire 23 sample is a stale post-start alias on row 2; prefix interior wire 24 on row 1
      // makes continuation authority wire 28 (left-column wrap start), not 23.
      expect(docPosToWireOffset(doc, moved.pos)).toBe(28);
    });

    it("measured-only: down from prefix interior is no-op", () => {
      const doc = wireToDoc(WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, PREFIX_MID_WIRE),
        "down",
        [...WRAP_SAMPLES],
        PREFIX_GOAL_LEFT,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(false);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(PREFIX_MID_WIRE);
    });

    it("measured-only: up from wrapped interior is no-op", () => {
      const doc = wireToDoc(WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, WRAPPED_INTERIOR_WIRE),
        "up",
        [...WRAP_SAMPLES],
        PREFIX_GOAL_LEFT,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(false);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(WRAPPED_INTERIOR_WIRE);
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

    it("measured-only: down from mid-line interior is no-op", () => {
      const doc = wireToDoc(WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, FROM_WIRE),
        "down",
        [...WRAP_SAMPLES],
        GOAL_LEFT,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(false);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(FROM_WIRE);
    });

    it("measured-only: up from continuation interior is no-op", () => {
      const doc = wireToDoc(WIRE);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, CONTINUATION_WIRE),
        "up",
        [...WRAP_SAMPLES],
        GOAL_LEFT,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(false);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(CONTINUATION_WIRE);
    });
  });

  describe("vertical — pill half-split on DOM column landings", () => {
    const AGENT = "caliper-aaaaaaa";
    const ROW1_TOP = 100;
    const ROW2_TOP = 136;

    it("up into pill left half lands at pill start", () => {
      const wire = `hi @${AGENT}\nwide content here`;
      const doc = wireToDoc(wire);
      const root = document.createElement("div");
      document.body.appendChild(root);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      const mentionStart = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: 0 });
      const mentionEnd = docPosToWireOffset(doc, {
        nodeIndex: 1,
        nodeOffset: 1 + AGENT.length,
      });
      const lowerStart = wire.indexOf("\n") + 1;
      const lowerMid = lowerStart + 5;
      const goalColumn = 80;
      const samples = [
        { wire: 0, top: ROW1_TOP, left: 0 },
        { wire: mentionStart, top: ROW1_TOP, left: 30 },
        { wire: mentionEnd, top: ROW1_TOP, left: 150 },
        { wire: lowerStart, top: ROW2_TOP, left: 0 },
        { wire: lowerMid, top: ROW2_TOP, left: goalColumn },
        { wire: wire.length, top: ROW2_TOP, left: 240 },
      ];
      setSelectionAtWire(root, doc, lowerMid);
      const probe = prepareVerticalColumnProbe({
        root,
        doc,
        wire,
        fromWire: lowerMid,
        goalColumn,
        probeTargetWire: mentionStart,
        samples,
        rootWidth: 310,
        mentionCoords: new Map([[1, { top: ROW1_TOP, left: 30 }]]),
        expectMinVisualRows: 2,
      });
      try {
        const moved = resolveDomVerticalArrowMove(
          root,
          doc,
          wireOffsetToDocPos(doc, lowerMid),
          "up"
        );
        expect(moved.handled).toBe(true);
        expect(moved.branch).toBe("pill-column-snap");
        expect(docPosToWireOffset(doc, moved.pos)).toBe(mentionStart);
        expect(docPosToWireOffset(doc, moved.pos)).not.toBe(mentionEnd);
      } finally {
        probe.restore();
        root.remove();
      }
    });

    it("down into pill right half lands at pill end", () => {
      const wire = `wide source\nhi @${AGENT}`;
      const doc = wireToDoc(wire);
      const root = document.createElement("div");
      document.body.appendChild(root);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      const sourceMid = 4;
      const lowerStart = wire.indexOf("\n") + 1;
      const mentionStart = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: 0 });
      const mentionEnd = docPosToWireOffset(doc, {
        nodeIndex: 1,
        nodeOffset: 1 + AGENT.length,
      });
      const goalColumn = 100;
      const samples = [
        { wire: 0, top: ROW1_TOP, left: 0 },
        { wire: sourceMid, top: ROW1_TOP, left: goalColumn },
        { wire: lowerStart - 1, top: ROW1_TOP, left: 160 },
        { wire: lowerStart, top: ROW2_TOP, left: 0 },
        { wire: mentionStart, top: ROW2_TOP, left: 30 },
        { wire: mentionEnd, top: ROW2_TOP, left: 150 },
      ];
      setSelectionAtWire(root, doc, sourceMid);
      const probe = prepareVerticalColumnProbe({
        root,
        doc,
        wire,
        fromWire: sourceMid,
        goalColumn,
        probeTargetWire: mentionEnd,
        samples,
        rootWidth: 310,
        mentionCoords: new Map([[1, { top: ROW2_TOP, left: 30 }]]),
        expectMinVisualRows: 2,
      });
      try {
        const moved = resolveDomVerticalArrowMove(
          root,
          doc,
          wireOffsetToDocPos(doc, sourceMid),
          "down"
        );
        expect(moved.handled).toBe(true);
        expect(moved.branch).toBe("pill-column-snap");
        expect(docPosToWireOffset(doc, moved.pos)).toBe(mentionEnd);
        expect(docPosToWireOffset(doc, moved.pos)).not.toBe(mentionStart);
      } finally {
        probe.restore();
        root.remove();
      }
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

    it("up from second mention end lands on upper row tail at clamped column", () => {
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, secondMentionEnd),
        "up",
        [...layoutSamples],
        GOAL_COLUMN,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(postMentionStart);
      expect(doc.nodes[moved.pos.nodeIndex]?.type).toBe("text");
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
        GOAL_COLUMN,
        LINE_HEIGHT
      );
      expect(docPosToWireOffset(doc, up.pos)).toBe(postMentionStart);

      const down = resolveMeasuredVerticalArrowMove(
        doc,
        up.pos,
        "down",
        [...layoutSamples],
        GOAL_COLUMN,
        LINE_HEIGHT
      );

      expect(down.handled).toBe(true);
      expect(docPosToWireOffset(doc, down.pos)).toBe(secondMentionEnd);

      const downAgain = resolveMeasuredVerticalArrowMove(
        doc,
        down.pos,
        "down",
        [...layoutSamples],
        GOAL_COLUMN,
        LINE_HEIGHT
      );
      expect(downAgain.handled).toBe(false);
    });
  });

  describe("vertical — post-mention spacer at soft-wrap boundary", () => {
    const AGENT = "caliper-nnz77a8nq";
    const WIRE = `pre @${AGENT} x @${AGENT} line @${AGENT} @${AGENT} `;
    const doc = wireToDoc(WIRE);
    const ROW1_TOP = 141.1;
    const ROW2_TOP = 159.3;
    const LINE_HEIGHT = 18.197921752929688;
    const secondMentionStart = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 });
    const secondPostStart = docPosToWireOffset(doc, { nodeIndex: 4, nodeOffset: 0 });
    const secondTextStart = secondPostStart + 1;
    const EOF_WIRE = WIRE.length;
    const RIGHT_EDGE_COLUMN = 624.52;

    const samples = [
      { wire: 0, top: ROW1_TOP, left: 347.5 },
      { wire: 4, top: ROW1_TOP, left: 374.73 },
      {
        wire: docPosToWireOffset(doc, { nodeIndex: 2, nodeOffset: 0 }),
        top: ROW1_TOP,
        left: 491.89,
      },
      { wire: secondMentionStart, top: ROW1_TOP, left: 507.67 },
      { wire: secondPostStart, top: ROW2_TOP, left: 624.82 },
      {
        wire: docPosToWireOffset(doc, { nodeIndex: 5, nodeOffset: 0 }),
        top: ROW2_TOP,
        left: 382.09,
      },
      {
        wire: docPosToWireOffset(doc, { nodeIndex: 5, nodeOffset: AGENT.length }),
        top: ROW2_TOP,
        left: 499.25,
      },
      {
        wire: docPosToWireOffset(doc, { nodeIndex: 6, nodeOffset: 0 }),
        top: ROW2_TOP,
        left: 503.81,
      },
      {
        wire: docPosToWireOffset(doc, { nodeIndex: 7, nodeOffset: AGENT.length }),
        top: ROW2_TOP,
        left: 620.97,
      },
      { wire: EOF_WIRE, top: ROW2_TOP, left: RIGHT_EDGE_COLUMN },
      {
        wire: docPosToWireOffset(doc, { nodeIndex: 2, nodeOffset: 0 }) + 1,
        top: ROW1_TOP - 0.43,
        left: 491.89,
      },
      { wire: secondTextStart, top: ROW1_TOP - 0.43, left: 624.82 },
    ] as const;

    it("up from lower row end lands at the upper row end, not the second pill start", () => {
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, EOF_WIRE),
        "up",
        [...samples],
        RIGHT_EDGE_COLUMN,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(secondPostStart);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(secondMentionStart);
      expect(doc.nodes[moved.pos.nodeIndex]?.type).toBe("text");
    });

    it("down from upper row end moves to lower row end, not row start", () => {
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, secondPostStart),
        "down",
        [...samples],
        624.82,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(WIRE.length - 1);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(secondTextStart);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(EOF_WIRE);
    });

    it("measured-only up is no-op when segment text does not match", () => {
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, secondTextStart + 1),
        "up",
        [...samples],
        382.09,
        LINE_HEIGHT
      );

      expect(moved.handled).toBe(false);
      expect(moved.branch).toBeUndefined();
      expect(docPosToWireOffset(doc, moved.pos)).toBe(secondTextStart + 1);
    });

    it("DOM probe up from lower row interior lands row-0 tail with text-node authority", () => {
      const root = document.createElement("div");
      document.body.appendChild(root);
      renderHandoffNoteDoc(root, doc, {
        colorByAgentId: new Map([[AGENT, "#06f"]]),
      });

      const fromWire = secondTextStart + 1;
      const { restore } = prepareVerticalColumnProbe({
        root,
        doc,
        wire: WIRE,
        fromWire,
        goalColumn: RIGHT_EDGE_COLUMN,
        probeTargetWire: secondPostStart,
        samples: [...samples],
        rootWidth: 310,
        expectMinVisualRows: 2,
      });
      setSelectionAtWire(root, doc, fromWire);

      try {
        const moved = resolveDomVerticalArrowMove(
          root,
          doc,
          wireOffsetToDocPos(doc, fromWire),
          "up"
        );

        expect(moved.handled).toBe(true);
        expect(moved.branch).toBe("dom-column-probe");
        expect(docPosToWireOffset(doc, moved.pos)).toBe(secondPostStart);
        expect(doc.nodes[moved.pos.nodeIndex]?.type).toBe("text");
      } finally {
        restore();
        root.remove();
      }
    });

    it("DOM probe lands matching prefix column on target row", () => {
      const root = document.createElement("div");
      document.body.appendChild(root);
      Object.defineProperty(root, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(root, doc, {
        colorByAgentId: new Map([[AGENT, "#06f"]]),
      });
      setSelectionAtWire(root, doc, secondTextStart + 1);

      const targetColumn = 491.89;
      const restoreSourceAnchor = stubHandoffNoteAnchorRectAtWire(root, doc, secondTextStart + 1, {
        top: ROW2_TOP,
        left: targetColumn,
      });
      const targetPostMentionText = docPosToWireOffset(doc, { nodeIndex: 2, nodeOffset: 1 });
      const restoreTargetProbe = stubCaretProbeAtDocPos(
        root,
        doc,
        targetColumn,
        ROW1_TOP,
        wireOffsetToDocPos(doc, targetPostMentionText)
      );
      setMeasuredSamplesCache(root, WIRE, root.clientWidth, [...samples]);

      try {
        const moved = resolveDomVerticalArrowMove(
          root,
          doc,
          wireOffsetToDocPos(doc, secondTextStart + 1),
          "up"
        );

        expect(moved.handled).toBe(true);
        expect(moved.branch).toBe("dom-column-probe");
        expect(docPosToWireOffset(doc, moved.pos)).toBe(targetPostMentionText);
        expect(docPosToWireOffset(doc, moved.pos)).not.toBe(4);
      } finally {
        restoreTargetProbe();
        restoreSourceAnchor();
        root.remove();
      }
    });

    it("DOM probe accepts landing when layout sample left drifts", () => {
      const wrapRowWire = `pre @${AGENT} x @${AGENT} post @${AGENT} @${AGENT} `;
      const wrapRowDoc = wireToDoc(wrapRowWire);
      const prefixInterior = 2;
      const tailStart = wrapRowWire.indexOf("post");
      const tailInterior = tailStart + 2;
      const goalColumn = 361.11;
      const spacerWire = tailStart - 1;
      const secondMentionStart = docPosToWireOffset(wrapRowDoc, { nodeIndex: 3, nodeOffset: 0 });
      const wrapRowSamples = [
        { wire: 0, top: ROW1_TOP, left: 347.5 },
        { wire: 4, top: ROW1_TOP, left: 374.73 },
        {
          wire: docPosToWireOffset(wrapRowDoc, { nodeIndex: 2, nodeOffset: 1 }),
          top: ROW1_TOP,
          left: 491.89,
        },
        { wire: secondMentionStart, top: ROW1_TOP, left: 507.67 },
        { wire: spacerWire, top: ROW1_TOP, left: 624.82 },
        { wire: wrapRowWire.length, top: ROW2_TOP, left: 377.81 },
        { wire: tailStart, top: ROW2_TOP, left: 377.8125 },
        { wire: tailInterior, top: ROW2_TOP, left: 394 },
        {
          wire: docPosToWireOffset(wrapRowDoc, { nodeIndex: 2, nodeOffset: 1 }),
          top: ROW1_TOP - 0.43,
          left: 491.89,
        },
        { wire: tailStart, top: ROW1_TOP - 0.43, left: 624.82 },
      ];

      const root = document.createElement("div");
      document.body.appendChild(root);
      Object.defineProperty(root, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(root, wrapRowDoc, {
        colorByAgentId: new Map([[AGENT, "#06f"]]),
      });
      setSelectionAtWire(root, wrapRowDoc, prefixInterior);

      const restoreSourceAnchor = stubHandoffNoteAnchorRectAtWire(
        root,
        wrapRowDoc,
        prefixInterior,
        {
          top: ROW1_TOP,
          left: goalColumn,
        }
      );
      const restoreTargetAnchor = stubHandoffNoteAnchorRectAtWire(root, wrapRowDoc, tailInterior, {
        top: ROW2_TOP,
        left: goalColumn,
      });
      const restoreTargetProbe = stubCaretProbeAtDocPos(
        root,
        wrapRowDoc,
        goalColumn,
        ROW2_TOP,
        wireOffsetToDocPos(wrapRowDoc, tailInterior)
      );
      setMeasuredSamplesCache(root, wrapRowWire, root.clientWidth, wrapRowSamples);

      try {
        const moved = resolveDomVerticalArrowMove(
          root,
          wrapRowDoc,
          wireOffsetToDocPos(wrapRowDoc, prefixInterior),
          "down"
        );

        expect(moved.handled).toBe(true);
        expect(moved.branch).toBe("dom-column-probe");
        expect(docPosToWireOffset(wrapRowDoc, moved.pos)).toBe(tailInterior);
        expect(moved.goalColumn).toBeCloseTo(goalColumn, 1);
      } finally {
        restoreTargetProbe();
        restoreTargetAnchor();
        restoreSourceAnchor();
        root.remove();
      }
    });
  });

  describe("click ingress — soft-wrap row restore", () => {
    it("post-mention spacer wire aliases mention-boundary end at same offset", () => {
      const fx = mountMultiMentionSoftWrapFixture();
      expect(describeHandoffNoteCursorContext(fx.doc, fx.secondPostStart)).toEqual(
        expect.objectContaining({ kind: "mention-boundary", edge: "end" })
      );
      expect(describeHandoffNoteCursorContext(fx.doc, fx.continuationWire).kind).toBe("text");
      fx.root.remove();
    });

    it("nativeSelection on row-0 alias wire uses text-node authority not mention node", () => {
      const fx = mountMultiMentionSoftWrapFixture();
      const mentionNodes = fx.doc.nodes
        .map((node, i) => (node.type === "mention" ? i : -1))
        .filter((i) => i >= 0);
      const secondMentionIdx = mentionNodes[1]!;
      const liveMentionEnd = {
        nodeIndex: secondMentionIdx,
        nodeOffset: 1 + fx.agent.length,
      };
      const restoreAnchor = stubHandoffNoteAnchorRectAtWire(fx.root, fx.doc, fx.secondPostStart, {
        top: fx.row0Top,
        left: 624,
      });

      const resolved = resolveClickIngressSelection(fx.root, fx.doc, liveMentionEnd, undefined, {
        clientX: 630,
        clientY: fx.row0Top,
      });
      restoreAnchor();

      expect(resolved.resolution).toBe("nativeSelection");
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.secondPostStart);
      expect(fx.doc.nodes[resolved.focus.nodeIndex]?.type).toBe("text");
      expect(fx.doc.nodes[resolved.focus.nodeIndex]?.type).not.toBe("mention");

      fx.root.remove();
    });

    it("row-0 sticky click keeps stale live when viewport probe aliases continuation", () => {
      const fx = mountMultiMentionSoftWrapFixture();
      const priorFocus = wireOffsetToDocPos(fx.doc, fx.wire.length);
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, priorFocus);
      const row0EndWire = layoutContentRowEndWire(layout, fx.doc, 0)!;
      const authorityPos = docPosAtContentWire(fx.doc, row0EndWire);
      const clickX = layoutContentRowStickyColumn(layout, fx.doc, 0)!;
      const restoreProbe = stubCaretProbeHits(fx.root, fx.doc, [
        { column: clickX, rowTop: fx.row0Top, pos: authorityPos },
      ]);
      setSelectionAtWire(fx.root, fx.doc, fx.continuationWire, fx.continuationWire);

      const repaired = repairDocSelectionIfNeeded(fx.root, fx.doc, priorFocus, {
        mode: "strand-only",
        click: { clientX: clickX, clientY: fx.row0Top },
      });

      expect(docPosToWireOffset(fx.doc, repaired)).toBe(fx.continuationWire);
      expect(docPosToWireOffset(fx.doc, repaired)).not.toBe(row0EndWire);

      restoreProbe();
      fx.root.remove();
    });

    it("row-0 far-right click accepts soft-wrap continuation live via row agreement", () => {
      const fx = mountMultiMentionSoftWrapFixture();
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, fx.continuationTextPos);
      const row0EndWire = layoutContentRowEndWire(layout, fx.doc, 0)!;
      expect(row0EndWire).toBe(fx.secondPostStart);
      expect(docToWire(fx.doc)[row0EndWire]).toBe(" ");
      expect(layout.rowIndexForWire(fx.continuationWire)).not.toBe(0);

      const livePos = wireOffsetToDocPos(fx.doc, fx.continuationWire);
      const resolved = resolveClickIngressSelection(fx.root, fx.doc, livePos, undefined, {
        clientX: 630,
        clientY: fx.row0Top,
      });
      expect(resolved.resolution).toBe("nativeSelection");
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.continuationWire);
      expect(docPosToWireOffset(fx.doc, resolved.focus)).not.toBe(fx.secondPostStart);

      setSelectionAtWire(fx.root, fx.doc, fx.continuationWire, fx.continuationWire);
      const repaired = repairDocSelectionIfNeeded(
        fx.root,
        fx.doc,
        wireOffsetToDocPos(fx.doc, fx.wire.length),
        {
          mode: "strand-only",
          click: { clientX: 630, clientY: fx.row0Top },
        }
      );

      expect(docPosToWireOffset(fx.doc, repaired)).toBe(fx.continuationWire);

      fx.root.remove();
    });

    it("live session case A — row-0 click at 629 keeps continuation wire", () => {
      const fx = mountMultiMentionSoftWrapFixture();
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, fx.continuationTextPos);
      const extentRight = layoutContentRowContentExtentRight(layout, fx.doc, 0)!;
      expect(extentRight).toBeGreaterThan(624);
      expect(extentRight).toBeLessThan(629);
      expect(629).toBeGreaterThan(extentRight);
      const livePos = fx.continuationTextPos;

      const resolved = resolveClickIngressSelection(fx.root, fx.doc, livePos, undefined, {
        clientX: 629,
        clientY: 141,
      });
      expect(resolved.resolution).toBe("nativeSelection");
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.continuationWire);

      fx.root.remove();
    });

    it("live session case A — row-0 click past sticky keeps continuation wire 44", () => {
      const fx = mountMultiMentionSoftWrapFixture();
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, fx.continuationTextPos);
      const sticky = layoutContentRowStickyColumn(layout, fx.doc, 0)!;
      expect(sticky).toBeGreaterThan(620);
      const livePos = fx.continuationTextPos;
      expect(docPosToWireOffset(fx.doc, livePos)).toBe(fx.continuationWire);

      const resolved = resolveClickIngressSelection(fx.root, fx.doc, livePos, undefined, {
        clientX: 633,
        clientY: 139,
      });
      expect(resolved.resolution).toBe("nativeSelection");
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.continuationWire);

      fx.root.remove();
    });

    it("row-1 click accepts postfix spacer alias live at text-tail", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      const spacer = fx.doc.nodes[fx.postfixSpacerNode];
      expect(spacer?.type).toBe("text");
      if (spacer?.type !== "text") {
        fx.root.remove();
        return;
      }
      const tailPos: HandoffNoteDocPos = {
        nodeIndex: fx.postfixSpacerNode,
        nodeOffset: spacer.text.length,
      };
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, tailPos);
      const row1EndWire = layoutContentRowEndWire(layout, fx.doc, 1)!;
      expect(docPosToWireOffset(fx.doc, tailPos)).toBe(fx.fourthMentionStart);
      // Alias wire is row-1 content end — paint authority maps it to row 1, not pill row 2.
      expect(row1EndWire).toBe(fx.fourthMentionStart);
      expect(layoutRowForFocus(fx.root, fx.doc, layout, tailPos)).toBe(1);

      const resolved = resolveClickIngressSelection(fx.root, fx.doc, tailPos, undefined, {
        clientX: 537,
        clientY: fx.row1Top,
      });
      expect(resolved.resolution).toBe("nativeSelection");
      expect(resolved.focus).toEqual(tailPos);
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.fourthMentionStart);

      fx.root.remove();
    });

    it("strand-only authority read round-trips cross-row spacer tail without alias repair", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      const spacer = fx.doc.nodes[fx.postfixSpacerNode];
      expect(spacer?.type).toBe("text");
      if (spacer?.type !== "text") {
        fx.root.remove();
        return;
      }
      const tailPos: HandoffNoteDocPos = {
        nodeIndex: fx.postfixSpacerNode,
        nodeOffset: spacer.text.length,
      };
      setDocSelection(fx.root, fx.doc, collapsedSelection(tailPos), {
        from: tailPos,
        source: "test.authority",
      });
      const authorityRead = readDocSelection(fx.root, fx.doc, { from: tailPos });
      expect(authorityRead.focus).toEqual(tailPos);
      const strandResolved = repairDocSelectionIfNeeded(fx.root, fx.doc, tailPos, {
        mode: "strand-only",
      });
      expect(strandResolved).toEqual(tailPos);
      fx.root.remove();
    });

    it("postfix spacer row-1 click repair keeps text-tail authority", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      const spacer = fx.doc.nodes[fx.postfixSpacerNode];
      expect(spacer?.type).toBe("text");
      if (spacer?.type !== "text") {
        fx.root.remove();
        return;
      }
      const tailPos: HandoffNoteDocPos = {
        nodeIndex: fx.postfixSpacerNode,
        nodeOffset: spacer.text.length,
      };
      setSelectionAtDocPos(fx.root, fx.doc, tailPos);
      const live = readDocSelection(fx.root, fx.doc);
      expect(docPosToWireOffset(fx.doc, live.focus)).toBe(fx.fourthMentionStart);

      const repaired = repairDocSelectionIfNeeded(
        fx.root,
        fx.doc,
        wireOffsetToDocPos(fx.doc, fx.wire.length),
        {
          mode: "strand-only",
          click: { clientX: 537, clientY: fx.row1Top },
        }
      );
      expect(repaired).toEqual(tailPos);
      expect(docPosToWireOffset(fx.doc, repaired)).toBe(fx.fourthMentionStart);

      fx.root.remove();
    });

    it("live session case B — row-1 click past sticky keeps postfix alias wire", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      const spacer = fx.doc.nodes[fx.postfixSpacerNode];
      expect(spacer?.type).toBe("text");
      if (spacer?.type !== "text") {
        fx.root.remove();
        return;
      }
      const tailPos: HandoffNoteDocPos = {
        nodeIndex: fx.postfixSpacerNode,
        nodeOffset: spacer.text.length,
      };
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, tailPos);
      const sticky = layoutContentRowStickyColumn(layout, fx.doc, 1)!;
      expect(sticky).toBeGreaterThan(520);
      expect(layout.rowIndexForWire(fx.fourthMentionStart)).toBe(2);

      const resolved = resolveClickIngressSelection(fx.root, fx.doc, tailPos, undefined, {
        clientX: 546,
        clientY: 164,
      });
      expect(resolved.resolution).toBe("nativeSelection");
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.fourthMentionStart);

      fx.root.remove();
    });

    it("nativeSelection on postfix alias keeps spacer text-tail doc pos", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      const spacer = fx.doc.nodes[fx.postfixSpacerNode];
      expect(spacer?.type).toBe("text");
      if (spacer?.type !== "text") {
        fx.root.remove();
        return;
      }
      const tailPos: HandoffNoteDocPos = {
        nodeIndex: fx.postfixSpacerNode,
        nodeOffset: spacer.text.length,
      };
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, tailPos);
      const row1EndSample = layoutContentRowEndSample(layout, fx.doc, 1)!;
      const restore = stubCaretProbeHits(fx.root, fx.doc, [
        {
          column: 546,
          rowTop: row1EndSample.top,
          pos: tailPos,
        },
      ]);

      const resolved = resolveClickIngressSelection(
        fx.root,
        fx.doc,
        wireOffsetToDocPos(fx.doc, fx.fourthMentionStart),
        undefined,
        { clientX: 546, clientY: fx.row1Top }
      );
      restore();

      expect(resolved.resolution).toBe("nativeSelection");
      expect(resolved.focus).toEqual(tailPos);
      expect(fx.doc.nodes[resolved.focus.nodeIndex]?.type).toBe("text");

      fx.root.remove();
    });

    it("row-1 click after mention accepts same-row live via paint row agreement", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      const livePos = wireOffsetToDocPos(fx.doc, fx.fourthMentionStart);
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, livePos);
      expect(
        layout.continuationAfterRowEndWire(layoutContentRowEndWire(layout, fx.doc, 1)!)
      ).toBeNull();
      expect(layoutRowForFocus(fx.root, fx.doc, layout, livePos)).toBe(1);

      const resolved = resolveClickIngressSelection(fx.root, fx.doc, livePos, undefined, {
        clientX: 542,
        clientY: fx.row1Top,
      });

      expect(resolved.resolution).toBe("nativeSelection");
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.fourthMentionStart);
      expect(fx.doc.nodes[resolved.focus.nodeIndex]?.type).toBe("text");

      fx.root.remove();
    });

    it("row-1 far-right click keeps sandwich spacer paint row, not wrap continuation", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      const livePos = wireOffsetToDocPos(fx.doc, fx.fourthMentionStart);
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, livePos);
      expect(
        layout.continuationAfterRowEndWire(layoutContentRowEndWire(layout, fx.doc, 1)!)
      ).toBeNull();
      expect(layoutRowForFocus(fx.root, fx.doc, layout, livePos)).toBe(1);

      const resolved = resolveClickIngressSelection(fx.root, fx.doc, livePos, undefined, {
        clientX: 542,
        clientY: fx.row1Top,
      });

      expect(resolved.resolution).toBe("nativeSelection");
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.fourthMentionStart);
      expect(fx.doc.nodes[resolved.focus.nodeIndex]?.type).toBe("text");

      fx.root.remove();
    });

    it("row-1 sticky click keeps stale live when viewport misses", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      const livePos = wireOffsetToDocPos(fx.doc, fx.fourthMentionStart);
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, livePos);
      const sticky = layoutContentRowStickyColumn(layout, fx.doc, 1)!;

      const resolved = resolveClickIngressSelection(fx.root, fx.doc, livePos, undefined, {
        clientX: sticky,
        clientY: 164,
      });

      expect(resolved.resolution).toBe("nativeSelection");
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.fourthMentionStart);

      fx.root.remove();
    });

    it("row-1 sticky viewport probe restores spacer text-tail when live is alias on row 1", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      const spacer = fx.doc.nodes[fx.postfixSpacerNode];
      expect(spacer?.type).toBe("text");
      if (spacer?.type !== "text") {
        fx.root.remove();
        return;
      }
      const tailPos: HandoffNoteDocPos = {
        nodeIndex: fx.postfixSpacerNode,
        nodeOffset: spacer.text.length,
      };
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, tailPos);
      const sticky = layoutContentRowStickyColumn(layout, fx.doc, 1)!;
      const paintPoint = resolveDomPointAtDocPos(fx.root, fx.doc, tailPos)!;
      const restoreProbe = stubCaretProbeHits(fx.root, fx.doc, [
        { column: sticky, rowTop: fx.row1Top, pos: tailPos },
      ]);

      const resolved = resolveClickIngressSelection(fx.root, fx.doc, tailPos, undefined, {
        clientX: sticky,
        clientY: fx.row1Top,
      });
      expect(resolved.resolution).toBe("nativeSelection");
      expect(resolved.focus).toEqual(tailPos);
      setDocSelection(fx.root, fx.doc, collapsedSelection(resolved.focus), {
        source: "test.viewportSticky",
      });

      const range = fx.root.ownerDocument.getSelection()!.getRangeAt(0);
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.fourthMentionStart);
      expect(range.startContainer).toBe(paintPoint.node);
      expect(range.startOffset).toBe(paintPoint.offset);

      restoreProbe();
      fx.root.remove();
    });

    it("row-0 sticky click with live at row-end paints outside mention pill", () => {
      const fx = mountMultiMentionSoftWrapFixture();
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, fx.continuationTextPos);
      const row0EndWire = layoutContentRowEndWire(layout, fx.doc, 0)!;
      expect(row0EndWire).toBe(fx.secondPostStart);
      expect(docToWire(fx.doc)[row0EndWire]).toBe(" ");
      expect(describeHandoffNoteCursorContext(fx.doc, row0EndWire)).toEqual(
        expect.objectContaining({ kind: "mention-boundary", edge: "end" })
      );

      const authorityPos = docPosAtContentWire(fx.doc, row0EndWire);
      expect(fx.doc.nodes[authorityPos.nodeIndex]?.type).toBe("text");
      expect(authorityPos.nodeIndex).toBe(fx.middleTextNode);

      const authorityPaint = resolveDomPointAtDocPos(fx.root, fx.doc, authorityPos, {
        from: authorityPos,
      })!;
      expect(authorityPaint.node.nodeType).toBe(Node.TEXT_NODE);
      expect(domPointInMentionPill(fx.root, authorityPaint.node)).toBe(false);

      const clickX = layoutContentRowStickyColumn(layout, fx.doc, 0)!;
      const resolved = resolveClickIngressSelection(fx.root, fx.doc, authorityPos, undefined, {
        clientX: clickX,
        clientY: fx.row0Top,
      });
      expect(resolved.resolution).toBe("nativeSelection");
      setDocSelection(fx.root, fx.doc, collapsedSelection(resolved.focus), {
        source: "test.stickyRowEndLive",
      });

      const range = fx.root.ownerDocument.getSelection()!.getRangeAt(0);
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(row0EndWire);
      expect(range.startContainer).toBe(authorityPaint.node);
      expect(range.startOffset).toBe(authorityPaint.offset);
      expect(domPointInMentionPill(fx.root, range.startContainer)).toBe(false);

      fx.root.remove();
    });

    it("row-1 mid-column click lands interior when live is on pill row below", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      const fourthMentionNode = fx.mentionNodes[3]!;
      const livePos: HandoffNoteDocPos = { nodeIndex: fourthMentionNode, nodeOffset: 3 };
      expect(
        layoutRowForFocus(
          fx.root,
          fx.doc,
          buildHandoffNoteLayoutMap(fx.root, fx.doc, livePos),
          livePos
        )
      ).toBe(2);
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, livePos);
      const row1EndSample = layoutContentRowEndSample(layout, fx.doc, 1)!;
      const restore = stubCaretProbeHits(fx.root, fx.doc, [
        {
          column: row1EndSample.left,
          rowTop: row1EndSample.top,
          pos: wireOffsetToDocPos(fx.doc, fx.wrapRowStartWire),
        },
        {
          column: 544,
          rowTop: row1EndSample.top,
          pos: wireOffsetToDocPos(fx.doc, fx.interiorWire),
        },
      ]);

      const resolved = resolveClickIngressSelection(fx.root, fx.doc, livePos, undefined, {
        clientX: 544,
        clientY: fx.row1Top,
      });
      restore();

      expect(resolved.resolution).toBe("viewportCaretHit");
      expect(docPosToWireOffset(fx.doc, resolved.focus)).toBe(fx.interiorWire);
      expect(docPosToWireOffset(fx.doc, resolved.focus)).not.toBe(fx.wrapRowStartWire);
      fx.root.remove();
    });

    it("long plain-text soft wrap keeps continuation live when click is past row sticky", () => {
      const agent = MULTI_MENTION_SOFT_WRAP_AGENT;
      const longTail = "x".repeat(40);
      const wire = `pre @${agent} ${longTail}`;
      const doc = wireToDoc(wire);
      const root = document.createElement("div");
      root.style.width = "200px";
      root.contentEditable = "true";
      document.body.appendChild(root);
      renderHandoffNoteDoc(root, doc, {
        colorByAgentId: new Map([[agent, "#06f"]]),
      });
      Object.defineProperty(root, "clientWidth", { configurable: true, value: 200 });

      const mentionNode = doc.nodes.findIndex((node) => node.type === "mention");
      const postMentionNode = mentionNode + 1;
      const postStart = docPosToWireOffset(doc, { nodeIndex: postMentionNode, nodeOffset: 0 });
      const continuationWire = postStart + 1;
      const ROW0 = 100;
      const ROW1 = 118;
      stubHandoffNoteMentionLayoutCoords(root, new Map([[mentionNode, { top: ROW0, left: 80 }]]));
      stubTextNodeLineRects(root, doc, postMentionNode, [
        { top: ROW0, left: 120, width: 60 },
        { top: ROW1, left: 40, width: 160 },
      ]);

      const samples = [
        { wire: 0, top: ROW0, left: 10 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: mentionNode, nodeOffset: 0 }),
          top: ROW0,
          left: 80,
        },
        { wire: postStart, top: ROW0, left: 170 },
        { wire: continuationWire, top: ROW1, left: 45 },
        { wire: docToWire(doc).length, top: ROW1, left: 180 },
      ];
      setMeasuredSamplesCache(root, wire, 200, samples);

      const layout = buildHandoffNoteLayoutMap(
        root,
        doc,
        wireOffsetToDocPos(doc, continuationWire)
      );
      const row0End = layoutContentRowEndWire(layout, doc, 0)!;
      expect(layout.continuationAfterRowEndWire(row0End)).toBe(continuationWire);

      const resolved = resolveClickIngressSelection(
        root,
        doc,
        wireOffsetToDocPos(doc, continuationWire),
        undefined,
        { clientX: 175, clientY: ROW0 }
      );

      expect(resolved.resolution).toBe("nativeSelection");
      expect(docPosToWireOffset(doc, resolved.focus)).toBe(continuationWire);
      expect(docPosToWireOffset(doc, resolved.focus)).not.toBe(row0End);
      root.remove();
    });
  });

  describe("vertical — wire newline cross sparse column fallback", () => {
    const AGENT = "caliper-aaaaaaa";
    const ROW0_TOP = 141.1;
    const ROW1_TOP = 177.49;
    const GOAL_COLUMN = 612;
    const VISUAL_ROW_START = 347.5;

    function wireNewlineWire() {
      return `pre @${AGENT} x @${AGENT} post @${AGENT} @${AGENT} \nlower @${AGENT} `;
    }

    function wireNewlineSamples(wire: string) {
      const doc = wireToDoc(wire);
      const lowerLineStart = wire.indexOf("\n") + 1;
      const row0EndBeforeBreak = lowerLineStart - 1;
      const secondMentionStart = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 });
      return [
        { wire: 0, top: ROW0_TOP, left: VISUAL_ROW_START },
        { wire: 4, top: ROW0_TOP, left: 374.73 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 2, nodeOffset: 1 }),
          top: ROW0_TOP,
          left: 491.89,
        },
        { wire: secondMentionStart, top: ROW0_TOP, left: 507.67 },
        { wire: row0EndBeforeBreak, top: ROW0_TOP, left: 624.82 },
        { wire: lowerLineStart, top: ROW1_TOP, left: VISUAL_ROW_START },
        { wire: wire.length - 1, top: ROW1_TOP, left: GOAL_COLUMN },
        { wire: wire.length, top: ROW1_TOP, left: GOAL_COLUMN },
      ];
    }

    it("sparse layout path brackets to upper row end not mention interior", () => {
      const wire = wireNewlineWire();
      const doc = wireToDoc(wire);
      const lowerEof = wire.length - 1;
      const row0EndBeforeBreak = wire.indexOf("\n");
      const root = document.createElement("div");
      document.body.appendChild(root);
      Object.defineProperty(root, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(root, doc, {
        colorByAgentId: new Map([[AGENT, "#06f"]]),
      });
      setMeasuredSamplesCache(root, wire, root.clientWidth, wireNewlineSamples(wire));
      const layout = buildHandoffNoteLayoutMap(root, doc, wireOffsetToDocPos(doc, lowerEof));

      try {
        const moved = resolveLayoutVerticalArrowMove(
          doc,
          wireOffsetToDocPos(doc, lowerEof),
          "up",
          layout,
          GOAL_COLUMN
        );

        expect(moved.handled).toBe(true);
        expect(moved.branch).toMatch(/^sparse-row-end/);
        expect(docPosToWireOffset(doc, moved.pos)).toBe(row0EndBeforeBreak);
        expect(docPosToWireOffset(doc, moved.pos)).not.toBe(62);
      } finally {
        root.remove();
      }
    });

    it("Down wide upper row end lands lower EOF not mention interior", () => {
      const wire = wireNewlineWire();
      const doc = wireToDoc(wire);
      const row0EndBeforeBreak = wire.indexOf("\n");
      const lowerEof = wire.length - 1;
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, row0EndBeforeBreak),
        "down",
        wireNewlineSamples(wire),
        GOAL_COLUMN,
        18.2
      );
      expect(moved.handled).toBe(true);
      expect(moved.branch).toMatch(/^sparse-row-end/);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(lowerEof);
      expect(
        describeHandoffNoteCursorContext(doc, docPosToWireOffset(doc, moved.pos)).kind
      ).not.toBe("mention-interior");
    });
  });

  describe("vertical — same-wire soft-wrap pill half-split", () => {
    const AGENT = "caliper-aaaaaaa";
    const ROW0_TOP = 141.1;
    const ROW1_TOP = 159.3;
    const GOAL_WIDE = 612;

    function softWrapTwoPillRowWire() {
      return `pre @${AGENT} x @${AGENT} post @${AGENT} @${AGENT} `;
    }

    function softWrapTwoPillRowLandmarks(wire: string) {
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("post");
      const secondMentionStart = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 });
      const secondMentionEnd = docPosToWireOffset(doc, {
        nodeIndex: 3,
        nodeOffset: 1 + AGENT.length,
      });
      const firstMentionStart = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: 0 });
      return {
        doc,
        tailStart,
        firstMentionStart,
        secondMentionEnd,
        samples: [
          { wire: 0, top: ROW0_TOP, left: 347.5 },
          { wire: 4, top: ROW0_TOP, left: 374.73 },
          {
            wire: docPosToWireOffset(doc, { nodeIndex: 2, nodeOffset: 1 }),
            top: ROW0_TOP,
            left: 491.89,
          },
          { wire: secondMentionStart, top: ROW0_TOP, left: 507.67 },
          { wire: tailStart - 1, top: ROW0_TOP, left: 624.82 },
          { wire: wire.length, top: ROW1_TOP, left: 377.81 },
          { wire: tailStart, top: ROW1_TOP, left: 377.8125 },
          { wire: firstMentionStart, top: ROW0_TOP, left: 360 },
        ],
      };
    }

    it("up from wrap mention-end uses pill half-split on prefix row", () => {
      const wire = softWrapTwoPillRowWire();
      const { doc, secondMentionEnd, tailStart, samples } = softWrapTwoPillRowLandmarks(wire);
      const mentionEnd = wire.length - 1;
      const root = document.createElement("div");
      document.body.appendChild(root);
      Object.defineProperty(root, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubHandoffNoteMentionLayoutCoords(
        root,
        new Map([
          [1, { top: ROW0_TOP, left: 360 }],
          [3, { top: ROW0_TOP, left: 507.67 }],
        ])
      );
      setMeasuredSamplesCache(root, wire, root.clientWidth, samples);
      const layout = buildHandoffNoteLayoutMap(root, doc, wireOffsetToDocPos(doc, mentionEnd));

      try {
        const moved = resolveLayoutVerticalArrowMove(
          doc,
          wireOffsetToDocPos(doc, mentionEnd),
          "up",
          layout,
          GOAL_WIDE,
          root
        );
        expect(moved.handled).toBe(true);
        expect(moved.branch).toBe("pill-column-snap");
        expect(docPosToWireOffset(doc, moved.pos)).toBe(secondMentionEnd);
        expect(docPosToWireOffset(doc, moved.pos)).not.toBe(tailStart);
      } finally {
        root.remove();
      }
    });

    it("down from prefix uses bracket or DOM column probe not pill snap override", () => {
      const wire = softWrapTwoPillRowWire();
      const { doc, samples } = softWrapTwoPillRowLandmarks(wire);
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 2),
        "down",
        samples,
        361.11,
        18.2
      );
      expect(moved.handled).toBe(true);
      expect(moved.branch).not.toBe("pill-column-snap");
      expect(
        describeHandoffNoteCursorContext(doc, docPosToWireOffset(doc, moved.pos)).kind
      ).not.toBe("mention-interior");
    });
  });

  describe("vertical — paint authority landing", () => {
    it("multiline up lands first mention on target row (visual-row-start, not second pill)", () => {
      const agentA = "caliper-aaaaaaa";
      const agentB = "caliper-bbbbbbb";
      const wire = `handoff notes @${agentA} \n@${agentA} @${agentB} \n@${agentA} `;
      const line2Mention = wire.indexOf("@", wire.indexOf("\n") + 1);
      const line2SecondMention = wire.indexOf(`@${agentB}`);
      const line3Mention = wire.lastIndexOf("@");
      const doc = wireToDoc(wire);
      const root = document.createElement("div");
      root.contentEditable = "true";
      document.body.appendChild(root);
      renderHandoffNoteDoc(root, doc, {
        colorByAgentId: new Map([
          [agentA, "#06f"],
          [agentB, "#f06"],
        ]),
      });
      seedMonotonicMeasuredLayout(root, wire);
      try {
        assertVerticalMove(root, doc, line3Mention, -1, line2Mention, line2SecondMention);
      } finally {
        root.remove();
      }
    });

    it("glued @A@B: up with sticky column in Bob left half lands at Bob start", () => {
      const agentA = "caliper-aaaaaaa";
      const agentB = "caliper-bbbbbbb";
      const ROW0_TOP = 141.1;
      const ROW1_TOP = 159.3;
      const BOB_PILL_LEFT = 520;
      const GOAL_IN_BOB_LEFT = 530;
      const doc = wireToDoc(`pre @${agentA}@${agentB} tail\nbot @${agentA} `);
      const wire = docToWire(doc);
      const aliceStart = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: 0 });
      const bobStart = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 });
      const botMention = wire.lastIndexOf("@");
      const root = document.createElement("div");
      root.contentEditable = "true";
      document.body.appendChild(root);
      Object.defineProperty(root, "clientWidth", { configurable: true, value: 640 });
      renderHandoffNoteDoc(root, doc, {
        colorByAgentId: new Map([
          [agentA, "#06f"],
          [agentB, "#f06"],
        ]),
      });
      stubHandoffNoteMentionLayoutCoords(
        root,
        new Map([
          [1, { top: ROW0_TOP, left: 400 }],
          [3, { top: ROW0_TOP, left: BOB_PILL_LEFT, width: 140 }],
        ])
      );
      setMeasuredSamplesCache(root, wire, root.clientWidth, [
        { wire: 0, top: ROW0_TOP, left: 347.5 },
        { wire: aliceStart, top: ROW0_TOP, left: 400 },
        { wire: bobStart, top: ROW0_TOP, left: BOB_PILL_LEFT },
        { wire: botMention, top: ROW1_TOP, left: GOAL_IN_BOB_LEFT },
        { wire: wire.length, top: ROW1_TOP, left: GOAL_IN_BOB_LEFT },
      ]);
      try {
        const moved = resolveDomVerticalArrowMove(
          root,
          doc,
          wireOffsetToDocPos(doc, botMention),
          "up",
          { stickyGoalColumn: GOAL_IN_BOB_LEFT }
        );
        expect(moved.handled).toBe(true);
        expect(moved.branch).toBe("pill-column-snap");
        expect(docPosToWireOffset(doc, moved.pos)).toBe(bobStart);
      } finally {
        root.remove();
      }
    });

    it("up from row-2 suffix preserves sticky goal via layout pill half-split on row-1 mention", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      const thirdMentionNode = fx.mentionNodes[2]!;
      const thirdMentionStart = docPosToWireOffset(fx.doc, {
        nodeIndex: thirdMentionNode,
        nodeOffset: 0,
      });
      const thirdMentionEnd = docPosToWireOffset(fx.doc, {
        nodeIndex: thirdMentionNode,
        nodeOffset: 1 + fx.agent.length,
      });
      const row2PastEnd = fx.wire.length;
      const stickyGoal = 484.23;
      const restoreProbe = stubCaretProbeAtDocPos(
        fx.root,
        fx.doc,
        stickyGoal,
        fx.row1Top,
        wireOffsetToDocPos(fx.doc, thirdMentionStart)
      );
      try {
        const moved = resolveDomVerticalArrowMove(
          fx.root,
          fx.doc,
          wireOffsetToDocPos(fx.doc, row2PastEnd),
          "up",
          { stickyGoalColumn: stickyGoal }
        );
        expect(moved.handled).toBe(true);
        expect(moved.branch).toBe("pill-column-snap");
        expect(docPosToWireOffset(fx.doc, moved.pos)).toBe(thirdMentionEnd);
        expect(moved.goalColumn).toBeCloseTo(stickyGoal, 1);
      } finally {
        restoreProbe();
        fx.root.remove();
      }
    });

    it("stale sticky from row-0 Down at pill column pill-snaps on live-session layout", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      const sticky = 484.22918701171875;
      const liveSamples = [
        { wire: 0, top: 140.67, left: 349.5 },
        { wire: 52, top: 159.3, left: 398.7 },
        { wire: 70, top: 159.3, left: 515.85 },
        { wire: 97, top: 177.06, left: 482.45 },
        { wire: 44, top: 158.86, left: 349.5 },
        { wire: 51, top: 158.86, left: 395.7 },
      ];
      setMeasuredSamplesCache(fx.root, fx.wire, fx.rootWidth, liveSamples);
      reapplyThreeRowMentionSoftWrapStubs(fx);
      try {
        const moved = resolveDomVerticalArrowMove(
          fx.root,
          fx.doc,
          wireOffsetToDocPos(fx.doc, 0),
          "down",
          { stickyGoalColumn: sticky }
        );
        expect(moved.handled).toBe(true);
        expect(moved.branch).toBe("pill-column-snap");
        expect(moved.goalColumn).toBeCloseTo(sticky, 1);
      } finally {
        fx.root.remove();
      }
    });

    it("click ingress keeps spacer text-tail doc pos (not wire-scan owner)", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      try {
        const spacer = fx.doc.nodes[fx.postfixSpacerNode];
        expect(spacer?.type).toBe("text");
        if (spacer?.type !== "text") {
          return;
        }
        const tailPos: HandoffNoteDocPos = {
          nodeIndex: fx.postfixSpacerNode,
          nodeOffset: spacer.text.length,
        };
        setSelectionAtWire(fx.root, fx.doc, fx.fourthMentionStart, fx.fourthMentionStart);
        const live = readDocSelection(fx.root, fx.doc).focus;
        const resolved = resolveClickIngressSelection(fx.root, fx.doc, live, undefined, {
          clientX: 542,
          clientY: 163,
        });
        expect(resolved.focus).toEqual(tailPos);
        expect(resolved.resolution).toBe("nativeSelection");
      } finally {
        fx.root.remove();
      }
    });
  });

  describe("vertical — blank-band goal authority", () => {
    it("entering a blank row resets sticky goal to that blank row's measured start", () => {
      const doc = wireToDoc("x\n\ntail");
      const blankLeft = 12;
      const rows: HandoffNoteLayoutRow[] = [
        {
          kind: "content",
          top: 100,
          minLeft: 80,
          maxLeft: 120,
          samples: [{ wire: 0, top: 100, left: 80 }],
        },
        {
          kind: "blank",
          top: 118,
          minLeft: blankLeft,
          maxLeft: blankLeft,
          breakProbeWire: 1,
          samples: [{ wire: 1, top: 118, left: blankLeft }],
        },
        {
          kind: "content",
          top: 136,
          minLeft: 64,
          maxLeft: 120,
          samples: [{ wire: 3, top: 136, left: 64 }],
        },
      ];
      const layout: HandoffNoteLayoutMap = {
        samples: rows.flatMap((row) => row.samples),
        rows,
        lineHeight: 18,
        visualRowCount: rows.length,
        rowIndexForWire: (wire) => {
          if (wire === 1) return 1;
          if (wire >= 3) return 2;
          return 0;
        },
        coordsForWire: (wire) =>
          rows.flatMap((row) => row.samples).find((sample) => sample.wire === wire) ?? null,
        paintContextForWire: () => null,
        continuationAfterRowEndWire: () => null,
        shouldPreserveGoalColumnOnShorterRowLanding: () => false,
      };

      const moved = resolveLayoutVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 3),
        "up",
        layout,
        64
      );

      expect(moved.handled).toBe(true);
      expect(moved.branch).toBe("blank-band-break-probe");
      expect(docPosToWireOffset(doc, moved.pos)).toBe(1);
      expect(moved.goalColumn).toBe(blankLeft);
      expect(moved.goalColumn).not.toBe(80);
    });

    it("up from blank above soft-wrap continuation lands on that row, not prefix wire 0", () => {
      const agent = "caliper-aaaaaaa";
      const wire = `pre @${agent} x @${agent} post @${agent} @${agent} \n\ntail`;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("post");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const visualStart = 347.5;
      const rows: HandoffNoteLayoutRow[] = [
        {
          kind: "content",
          top: 141.1,
          minLeft: visualStart,
          maxLeft: 624.82,
          samples: [
            { wire: 0, top: 141.1, left: visualStart },
            { wire: tailStart - 1, top: 141.1, left: 624.82 },
          ],
        },
        {
          kind: "content",
          top: 159.3,
          minLeft: 382.09,
          maxLeft: 624.52,
          samples: [{ wire: tailStart, top: 159.3, left: 382.09 }],
        },
        {
          kind: "blank",
          top: 177.06,
          minLeft: visualStart,
          maxLeft: visualStart,
          breakProbeWire: probe,
          samples: [{ wire: probe, top: 177.06, left: visualStart }],
        },
        {
          kind: "content",
          top: 195.26,
          minLeft: 377.52,
          maxLeft: 624.52,
          samples: [{ wire: wire.length - 1, top: 195.26, left: 377.52 }],
        },
      ];
      const layout: HandoffNoteLayoutMap = {
        samples: rows.flatMap((row) => row.samples),
        rows,
        lineHeight: 18,
        visualRowCount: rows.length,
        rowIndexForWire: (w) => {
          if (w === probe) return 2;
          if (w >= tailStart && w < probe) return 1;
          if (w >= wire.length - 1) return 3;
          return 0;
        },
        coordsForWire: (w) =>
          rows.flatMap((row) => row.samples).find((sample) => sample.wire === w) ?? null,
        paintContextForWire: () => null,
        continuationAfterRowEndWire: () => null,
        shouldPreserveGoalColumnOnShorterRowLanding: () => false,
      };

      const moved = resolveLayoutVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, probe),
        "up",
        layout,
        visualStart
      );

      expect(moved.handled).toBe(true);
      expect(moved.branch).toBe("blank-exit-visual-row-start");
      expect(docPosToWireOffset(doc, moved.pos)).toBe(tailStart);
      expect(layout.rowIndexForWire(docPosToWireOffset(doc, moved.pos))).toBe(1);
      expect(moved.goalColumn).toBe(visualStart);
    });

    it("up from blank above wire-newline row lands substantive text start when min-left sample is @", () => {
      const agent = "caliper-aaaaaaa";
      const wire = `pre @${agent} x @${agent} \nline @${agent} @${agent} \n\nline`;
      const doc = wireToDoc(wire);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const visualStart = 347.5;
      const middleRowAtWire = wire.indexOf("@", wire.indexOf("\n") + 1);
      const docLineStartWire = wire.indexOf("line", wire.indexOf("\n"));
      const rows: HandoffNoteLayoutRow[] = [
        {
          kind: "content",
          top: 141.1,
          minLeft: visualStart,
          maxLeft: 628.38,
          samples: [
            { wire: 0, top: 141.1, left: visualStart },
            { wire: docLineStartWire - 1, top: 141.1, left: 628.38 },
          ],
        },
        {
          kind: "content",
          top: 159.3,
          minLeft: visualStart,
          maxLeft: 624.52,
          samples: [
            { wire: docLineStartWire, top: 159.3, left: visualStart },
            { wire: middleRowAtWire, top: 159.3, left: 382.09 },
            { wire: middleRowAtWire + 18, top: 159.3, left: 499.25 },
          ],
        },
        {
          kind: "blank",
          top: 177.06,
          minLeft: visualStart,
          maxLeft: visualStart,
          breakProbeWire: probe,
          samples: [{ wire: probe, top: 177.06, left: visualStart }],
        },
        {
          kind: "content",
          top: 195.26,
          minLeft: 377.52,
          maxLeft: 624.52,
          samples: [{ wire: wire.length - 1, top: 195.26, left: 377.52 }],
        },
      ];
      const layout: HandoffNoteLayoutMap = {
        samples: rows.flatMap((row) => row.samples),
        rows,
        lineHeight: 18,
        visualRowCount: rows.length,
        rowIndexForWire: (w) => {
          if (w === probe) return 2;
          if (w >= docLineStartWire && w < probe) return 1;
          if (w >= wire.length - 4) return 3;
          return 0;
        },
        coordsForWire: (w) =>
          rows.flatMap((row) => row.samples).find((sample) => sample.wire === w) ?? null,
        paintContextForWire: () => null,
        continuationAfterRowEndWire: () => null,
        shouldPreserveGoalColumnOnShorterRowLanding: () => false,
      };

      const moved = resolveLayoutVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, probe),
        "up",
        layout,
        visualStart
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(docLineStartWire);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(middleRowAtWire);
      expect(describeHandoffNoteCursorContext(doc, docPosToWireOffset(doc, moved.pos)).kind).toBe(
        "text"
      );
      expect(moved.goalColumn).toBe(visualStart);
    });

    it("up from blank above wire-newline row keeps layout min-left when it is plain text", () => {
      const wire = "a".repeat(100);
      const doc = wireToDoc(wire);
      const probe = 88;
      const visualStart = 347.5;
      const middleRowStartWire = 50;
      const docLineStartWire = 45;
      const rows: HandoffNoteLayoutRow[] = [
        {
          kind: "content",
          top: 141.1,
          minLeft: visualStart,
          maxLeft: 628.38,
          samples: [
            { wire: 0, top: 141.1, left: visualStart },
            { wire: docLineStartWire, top: 141.1, left: 380 },
          ],
        },
        {
          kind: "content",
          top: 159.3,
          minLeft: 382.09,
          maxLeft: 624.52,
          samples: [
            { wire: middleRowStartWire, top: 159.3, left: 382.09 },
            { wire: 68, top: 159.3, left: 499.25 },
          ],
        },
        {
          kind: "blank",
          top: 177.06,
          minLeft: visualStart,
          maxLeft: visualStart,
          breakProbeWire: probe,
          samples: [{ wire: probe, top: 177.06, left: visualStart }],
        },
        {
          kind: "content",
          top: 195.26,
          minLeft: 377.52,
          maxLeft: 624.52,
          samples: [{ wire: 94, top: 195.26, left: 377.52 }],
        },
      ];
      const layout: HandoffNoteLayoutMap = {
        samples: rows.flatMap((row) => row.samples),
        rows,
        lineHeight: 18,
        visualRowCount: rows.length,
        rowIndexForWire: (w) => {
          if (w === probe) return 2;
          if (w >= middleRowStartWire && w < probe) return 1;
          if (w >= 94) return 3;
          return 0;
        },
        coordsForWire: (w) =>
          rows.flatMap((row) => row.samples).find((sample) => sample.wire === w) ?? null,
        paintContextForWire: () => null,
        continuationAfterRowEndWire: () => null,
        shouldPreserveGoalColumnOnShorterRowLanding: () => false,
      };

      const moved = resolveLayoutVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, probe),
        "up",
        layout,
        visualStart
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(middleRowStartWire);
      expect(docPosToWireOffset(doc, moved.pos)).not.toBe(docLineStartWire);
      expect(layout.rowIndexForWire(docPosToWireOffset(doc, moved.pos))).toBe(1);
      expect(moved.goalColumn).toBe(visualStart);
    });

    it("three-step up from lower through blank keeps blank-band visual start sticky", () => {
      const agent = "caliper-aaaaaaa";
      const wire = `pre @${agent} x @${agent} post @${agent} @${agent} \n\ntail`;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("post");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const visualStart = 347.5;
      const rows: HandoffNoteLayoutRow[] = [
        {
          kind: "content",
          top: 141.1,
          minLeft: visualStart,
          maxLeft: 624.82,
          samples: [
            { wire: 0, top: 141.1, left: visualStart },
            { wire: tailStart - 1, top: 141.1, left: 624.82 },
          ],
        },
        {
          kind: "content",
          top: 159.3,
          minLeft: 382.09,
          maxLeft: 624.52,
          samples: [{ wire: tailStart, top: 159.3, left: 382.09 }],
        },
        {
          kind: "blank",
          top: 177.06,
          minLeft: visualStart,
          maxLeft: visualStart,
          breakProbeWire: probe,
          samples: [{ wire: probe, top: 177.06, left: visualStart }],
        },
        {
          kind: "content",
          top: 195.26,
          minLeft: 377.52,
          maxLeft: 624.52,
          samples: [{ wire: wire.length - 1, top: 195.26, left: 377.52 }],
        },
      ];
      const layout: HandoffNoteLayoutMap = {
        samples: rows.flatMap((row) => row.samples),
        rows,
        lineHeight: 18,
        visualRowCount: rows.length,
        rowIndexForWire: (w) => {
          if (w === probe) return 2;
          if (w >= tailStart && w < probe) return 1;
          if (w >= wire.length - 1) return 3;
          return 0;
        },
        coordsForWire: (w) =>
          rows.flatMap((row) => row.samples).find((sample) => sample.wire === w) ?? null,
        paintContextForWire: () => null,
        continuationAfterRowEndWire: () => null,
        shouldPreserveGoalColumnOnShorterRowLanding: () => false,
      };

      const lowerEof = wire.length - 1;
      const toBlank = resolveLayoutVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, lowerEof),
        "up",
        layout,
        377.52
      );
      expect(docPosToWireOffset(doc, toBlank.pos)).toBe(probe);

      const toWrap = resolveLayoutVerticalArrowMove(
        doc,
        toBlank.pos,
        "up",
        layout,
        toBlank.goalColumn ?? visualStart
      );
      expect(docPosToWireOffset(doc, toWrap.pos)).toBe(tailStart);
      expect(toWrap.goalColumn).toBe(visualStart);

      const toPrefix = resolveLayoutVerticalArrowMove(
        doc,
        toWrap.pos,
        "up",
        layout,
        toWrap.goalColumn ?? visualStart
      );
      expect(docPosToWireOffset(doc, toPrefix.pos)).toBe(0);
      expect(layout.rowIndexForWire(docPosToWireOffset(doc, toPrefix.pos))).toBe(0);
    });

    it("down from blank below soft-wrap lands lower content row visual start", () => {
      const agent = "caliper-aaaaaaa";
      const wire = `pre @${agent} x @${agent} post @${agent} @${agent} \n\ntail`;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("post");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const lowerStart = wire.indexOf("tail");
      const visualStart = 347.5;
      const rows: HandoffNoteLayoutRow[] = [
        {
          kind: "content",
          top: 141.1,
          minLeft: visualStart,
          maxLeft: 624.82,
          samples: [
            { wire: 0, top: 141.1, left: visualStart },
            { wire: tailStart - 1, top: 141.1, left: 624.82 },
          ],
        },
        {
          kind: "content",
          top: 159.3,
          minLeft: 382.09,
          maxLeft: 624.52,
          samples: [{ wire: tailStart, top: 159.3, left: 382.09 }],
        },
        {
          kind: "blank",
          top: 177.06,
          minLeft: visualStart,
          maxLeft: visualStart,
          breakProbeWire: probe,
          samples: [{ wire: probe, top: 177.06, left: visualStart }],
        },
        {
          kind: "content",
          top: 195.26,
          minLeft: 377.52,
          maxLeft: 624.52,
          samples: [{ wire: lowerStart, top: 195.26, left: 377.52 }],
        },
      ];
      const layout: HandoffNoteLayoutMap = {
        samples: rows.flatMap((row) => row.samples),
        rows,
        lineHeight: 18,
        visualRowCount: rows.length,
        rowIndexForWire: (w) => {
          if (w === probe) return 2;
          if (w >= lowerStart) return 3;
          if (w >= tailStart && w < probe) return 1;
          return 0;
        },
        coordsForWire: (w) =>
          rows.flatMap((row) => row.samples).find((sample) => sample.wire === w) ?? null,
        paintContextForWire: () => null,
        continuationAfterRowEndWire: () => null,
        shouldPreserveGoalColumnOnShorterRowLanding: () => false,
      };

      const moved = resolveLayoutVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, probe),
        "down",
        layout,
        visualStart
      );

      expect(moved.handled).toBe(true);
      expect(moved.branch).toBe("blank-exit-visual-row-start");
      expect(docPosToWireOffset(doc, moved.pos)).toBeGreaterThanOrEqual(lowerStart);
      expect(layout.rowIndexForWire(docPosToWireOffset(doc, moved.pos))).toBe(3);
    });
  });

  describe("vertical target line — down co-top inline blank skip", () => {
    const doc = wireToDoc("row\nbelow");

    function layoutWithRows(rows: HandoffNoteLayoutRow[]): HandoffNoteLayoutMap {
      return {
        samples: rows.flatMap((row) => row.samples),
        rows,
        lineHeight: 18,
        visualRowCount: rows.length,
        rowIndexForWire: () => -1,
        coordsForWire: () => null,
        paintContextForWire: () => null,
        continuationAfterRowEndWire: () => null,
        shouldPreserveGoalColumnOnShorterRowLanding: () => false,
      };
    }

    it("down skips co-top inline blank to the next content row", () => {
      const rows: HandoffNoteLayoutRow[] = [
        {
          kind: "content",
          top: 100,
          minLeft: 0,
          maxLeft: 80,
          samples: [{ wire: 0, top: 100, left: 0 }],
        },
        {
          kind: "blank",
          top: 100,
          minLeft: 0,
          maxLeft: 0,
          breakProbeWire: 3,
          samples: [{ wire: 3, top: 100, left: 0 }],
        },
        {
          kind: "content",
          top: 118,
          minLeft: 0,
          maxLeft: 80,
          samples: [{ wire: 4, top: 118, left: 0 }],
        },
      ];
      expect(resolveVerticalTargetLineIndex(doc, layoutWithRows(rows), "down", 0, 1)).toBe(2);
    });

    it("down does not skip blank on its own visual row", () => {
      const rows: HandoffNoteLayoutRow[] = [
        {
          kind: "content",
          top: 100,
          minLeft: 0,
          maxLeft: 80,
          samples: [{ wire: 0, top: 100, left: 0 }],
        },
        {
          kind: "blank",
          top: 118,
          minLeft: 0,
          maxLeft: 0,
          breakProbeWire: 3,
          samples: [{ wire: 3, top: 118, left: 0 }],
        },
        {
          kind: "content",
          top: 136,
          minLeft: 0,
          maxLeft: 80,
          samples: [{ wire: 4, top: 136, left: 0 }],
        },
      ];
      expect(resolveVerticalTargetLineIndex(doc, layoutWithRows(rows), "down", 0, 1)).toBe(1);
    });
  });

  describe("vertical row-start landing on sparse visual rows", () => {
    const agent = "caliper-aaaaaaa";

    it("down from row start lands soft-wrap continuation start before past-end", () => {
      const wire = `pre @${agent} x @${agent} seg`;
      const doc = wireToDoc(wire);
      const tailStart = wire.lastIndexOf("seg");
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 0),
        "down",
        [
          { wire: 0, top: 141.1, left: 347.5 },
          { wire: 4, top: 141.1, left: 374.73 },
          {
            wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
            top: 141.1,
            left: 507.67,
          },
          { wire: tailStart - 1, top: 141.1, left: 624.82 },
          { wire: wire.length, top: 158.86, left: 370.17 },
          { wire: tailStart, top: 140.67, left: 624.82 },
        ],
        347.5,
        18
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(tailStart);
    });

    it("down from row start lands embedded lower row start when only row end is sampled", () => {
      const wire = `head @${agent} tail @${agent} \nlower`;
      const doc = wireToDoc(wire);
      const lowerStart = wire.indexOf("\n") + 1;
      const moved = resolveMeasuredVerticalArrowMove(
        doc,
        wireOffsetToDocPos(doc, 0),
        "down",
        [
          { wire: 0, top: 100, left: 0 },
          { wire: wire.indexOf("@"), top: 100, left: 48 },
          { wire: lowerStart - 1, top: 100, left: 260 },
          { wire: wire.length, top: 118, left: 64 },
        ],
        0,
        18
      );

      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(lowerStart);
    });
  });
});
