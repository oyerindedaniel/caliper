/**
 * Integration pipeline for handoff note editor navigation and edits.
 *
 * Primary entry: editor.handleKeyDown (arrows) with authority === live DOM parity.
 * Sibling blocks cover beforeInput delete and keydown Backspace on blank-band fixtures.
 * selectionchange ingress lives in create-handoff-note-editor.test.ts; repair primitives
 * in handoff-note-selection.test.ts.
 *
 * Contract: handoff-note-arrow-contract.md
 */
import {
  blankVisualLineStartOpenedByProbe,
  collapsedSelectionWithIntent,
  describeHandoffNoteCursorContext,
  docPosToWireOffset,
  listEmbeddedBlankBandGroups,
  listEmbeddedBlankBandProbeWires,
  listBlankVisualLineStartWires,
  isEmbeddedBlankBandProbeWire,
  resolveDocVerticalArrowMove,
  wireOffsetToDocPos,
  wireToDoc,
  type HandoffNoteArrowDirection,
  type HandoffNoteCaretAffinity,
  type HandoffNoteDoc,
} from "@caliper/core";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createHandoffNoteEditor, type HandoffNoteEditor } from "./create-handoff-note-editor.js";
import {
  resolvePaintContextAtWire,
  resolvePaintHorizontalArrowMove,
} from "./handoff-note-dom-points.js";
import {
  setMeasuredSamplesCache,
  invalidateHandoffNoteLayoutCache,
} from "./handoff-note-layout-map.js";
import {
  isHandoffBlankAnchorElement,
  isHandoffLinePadElement,
  isHandoffWireBreakElement,
} from "./handoff-note-dom.js";
import {
  readDomWireCursor,
  monotonicMeasuredLayoutSamples,
  seedMonotonicMeasuredLayout,
  dispatchSelectionChange,
  setDomCaretAtTextEnd,
  setDomCaretAtTextStart,
  setSelectionAtWire,
  stubHandoffNoteMentionLayoutCoords,
  refreshHandoffNoteEditorLayoutGeometry,
  prepareVerticalColumnProbe,
  stubCaretProbeAtDocPos,
  stubHandoffNoteAnchorRectAtWire,
  stubHandoffNoteAnchorRectAtDocPos,
  readHandoffNoteLayoutRowIndexForTests,
} from "./handoff-note-test-helpers.js";

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

/** Bounded arrow walk — fails fast if caret stops moving (avoids infinite while on no-op/CRE). */
function pressArrowUntil(
  editor: HandoffNoteEditor,
  axis: ArrowAxis,
  sign: ArrowSign,
  done: (cursor: number) => boolean,
  label: string
): void {
  const maxSteps = Math.max(8, editor.getWire().length + 8);
  for (let step = 0; step < maxSteps; step++) {
    if (done(editor.getCursor())) {
      return;
    }
    const before = editor.getCursor();
    expect(pressArrow(editor, axis, sign), `${label} handled @${before}`).toBe(true);
    expect(editor.getCursor(), `${label} must move @${before}`).not.toBe(before);
  }
  throw new Error(`${label}: exceeded ${maxSteps} presses (cursor=${editor.getCursor()})`);
}

function assertPaintHorizontal(
  doc: HandoffNoteDoc,
  fromWire: number,
  direction: HandoffNoteArrowDirection,
  expectWire: number,
  options?: {
    focusAffinity?: HandoffNoteCaretAffinity;
    expectAffinity?: HandoffNoteCaretAffinity | undefined;
  }
): void {
  const focus = resolvePaintContextAtWire(doc, fromWire).focusPos;
  const move = resolvePaintHorizontalArrowMove(doc, focus, direction, {
    focusAffinity: options?.focusAffinity,
  });
  expect(move.handled).toBe(true);
  expect(docPosToWireOffset(doc, move.pos)).toBe(expectWire);
  expect(describeHandoffNoteCursorContext(doc, expectWire).kind).not.toBe("mention-interior");
  if (options && "expectAffinity" in options) {
    expect(move.selection.focusAffinity).toBe(options.expectAffinity);
  }
}

function expectCaretParity(
  editor: HandoffNoteEditor,
  root: HTMLElement,
  wire: number,
  label?: string,
  affinity?: { expect: HandoffNoteCaretAffinity | undefined }
): void {
  const authority = editor.getCursor();
  const liveDom = readDomWireCursor(root, editor.getDoc());
  expect(authority, label ? `${label} authority` : "authority").toBe(wire);
  expect(liveDom, label ? `${label} live DOM` : "live DOM").toBe(wire);
  if (affinity) {
    expect(editor.getSelectionState().focusAffinity, label ? `${label} affinity` : "affinity").toBe(
      affinity.expect
    );
  }
}

/** Delete-probe / multi-char-abutting empty CRE break wires paint blank-band ZWSP, not bare BR. */
function expectDomCaretPaintedAtBlankAnchor(root: HTMLElement, label?: string): void {
  const node = root.ownerDocument.getSelection()?.anchorNode;
  const onWireBreak = node instanceof HTMLBRElement && isHandoffWireBreakElement(node);
  const inBlankAnchor =
    node?.nodeType === Node.TEXT_NODE && isHandoffBlankAnchorElement(node.parentNode);
  expect(inBlankAnchor, label ? `${label} blank-anchor paint` : "blank-anchor paint").toBe(true);
  expect(onWireBreak, label ? `${label} not wire-break` : "not wire-break").toBe(false);
}

/**
 * Trailing empty line-start at `wire.length` paints the EOF line-pad `<br>`, not the prior
 * delete-probe blank-anchor and not a bare wire-break.
 */
function expectDomCaretPaintedAtLinePad(root: HTMLElement, label?: string): void {
  const selection = root.ownerDocument.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  expect(range, label ? `${label} selection` : "selection").toBeTruthy();
  const node = range!.startContainer;
  const onPad = isHandoffLinePadElement(node as Node);
  const inBlankAnchor =
    node.nodeType === Node.TEXT_NODE && isHandoffBlankAnchorElement(node.parentNode);
  expect(onPad, label ? `${label} line-pad paint` : "line-pad paint").toBe(true);
  expect(inBlankAnchor, label ? `${label} not blank-anchor` : "not blank-anchor").toBe(false);
  expect(
    node instanceof HTMLBRElement && isHandoffWireBreakElement(node),
    label ? `${label} not wire-break` : "not wire-break"
  ).toBe(false);
}

/** Emptied empty CRE / prefix-only empty row paints bare wire-break (first visual line). */
function expectDomCaretPaintedAtWireBreak(root: HTMLElement, label?: string): void {
  const node = root.ownerDocument.getSelection()?.anchorNode;
  const onWireBreak = node instanceof HTMLBRElement && isHandoffWireBreakElement(node);
  const inBlankAnchor =
    node?.nodeType === Node.TEXT_NODE && isHandoffBlankAnchorElement(node.parentNode);
  expect(onWireBreak, label ? `${label} wire-break paint` : "wire-break paint").toBe(true);
  expect(inBlankAnchor, label ? `${label} not blank-anchor` : "not blank-anchor").toBe(false);
}

/** Navigable blank caret wires — empty line-starts, not delete/paint probe docks. */
function blankNavStops(doc: HandoffNoteDoc): number[] {
  return listBlankVisualLineStartWires(doc);
}

function setDocWithLayout(
  editor: HandoffNoteEditor,
  root: HTMLElement,
  wire: string,
  cursor: number,
  samples: { wire: number; top: number; left: number }[]
): void {
  editor.setDocFromWire(wire, cursor, { resetHistory: true });
  setMeasuredSamplesCache(root, wire, root.clientWidth, samples);
}

/** One vertical keypress with DOM column-probe stub (jsdom has no real hit-test). */
function pressVerticalWithColumnProbe(
  editor: HandoffNoteEditor,
  root: HTMLElement,
  args: {
    fromWire: number;
    goalColumn: number;
    probeTargetWire: number;
    samples: { wire: number; top: number; left: number }[];
    sign: -1 | 1;
    mentionCoords?: Map<number, { top: number; left: number; width?: number; height?: number }>;
    expectMinVisualRows?: number;
  }
): void {
  const probe = prepareVerticalColumnProbe({
    root,
    doc: editor.getDoc(),
    wire: editor.getWire(),
    fromWire: args.fromWire,
    goalColumn: args.goalColumn,
    probeTargetWire: args.probeTargetWire,
    samples: args.samples,
    mentionCoords: args.mentionCoords,
    expectMinVisualRows: args.expectMinVisualRows ?? 2,
  });
  try {
    expect(pressArrow(editor, "vertical", args.sign)).toBe(true);
  } finally {
    probe.restore();
  }
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
  const blankRun = blankNavStops(doc).filter(
    (stop) => stop >= middleRowTailEnd && stop < bottomLineStart
  );
  const endOfLastMention = bottomLineStart + bottomLine.length - 1;
  return { middleRowLineStart, blankRun, endOfLastMention };
}

function mountEditorHost(
  agentIds: string[] = [AGENT_COMPOSITE, AGENT_A, AGENT_B, "caliper-abc123", "caliper-spacer01"]
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
        // CRE: Down→Right at last char establishes content-row-end on that char (same wire).
        expectWire: wire.length - 1,
        expectAffinity: "after" as const,
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
    ])("$note", ({ from, axis, sign, expectWire, expectAffinity, note }) => {
      host.editor.setDocFromWire(wire, from, { resetHistory: true });
      expect(pressArrow(host.editor, axis, sign)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        expectWire,
        note,
        expectAffinity !== undefined ? { expect: expectAffinity } : undefined
      );
    });
  });

  describe("horizontal — mention jump and plain text", () => {
    it("jumps over a mention atom then returns", () => {
      const mentionStart = "Hi ".length;
      const mentionEnd = mentionStart + "@caliper-abc123".length;
      host.editor.setDocFromWire("Hi @caliper-abc123 there", mentionStart, { resetHistory: true });

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, mentionEnd);
      // Paint-normalized land: atomic end selection owns post-mention text at the alias wire.
      expect(
        host.editor.getDoc().nodes[host.editor.getSelectionState().focus.nodeIndex]?.type
      ).toBe("text");

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

  describe("horizontal — paint authority (resolvePaintHorizontalArrowMove)", () => {
    it("steps adjacent plain text", () => {
      const doc = wireToDoc("abcdef");
      assertPaintHorizontal(doc, 3, "right", 4);
      assertPaintHorizontal(doc, 4, "left", 3);
    });

    it("jumps over a mention from its start and returns", () => {
      const doc = wireToDoc("Hi @caliper-abc123 there");
      const startWire = "Hi ".length;
      const endWire = "Hi @caliper-abc123".length;
      assertPaintHorizontal(doc, startWire, "right", endWire);
      assertPaintHorizontal(doc, endWire, "left", startWire);
    });

    it("steps through adjacent mentions separated by canonical space", () => {
      const doc = wireToDoc("@caliper-a@caliper-b");
      const firstEnd = "@caliper-a".length;
      const move = resolvePaintHorizontalArrowMove(doc, wireOffsetToDocPos(doc, firstEnd), "right");
      expect(move.handled).toBe(true);
      expect(docPosToWireOffset(doc, move.pos)).toBeGreaterThan(firstEnd);
    });

    const suffixWire = `row @${AGENT_A} mid @${AGENT_B} tail\n\n\nlower @${AGENT_A} `;
    const rowTail = suffixWire.indexOf("tail") + 2;
    const lowerMention = suffixWire.lastIndexOf("@");

    it("matrix: row tail steps right and left along substantive text", () => {
      const doc = wireToDoc(suffixWire);
      assertPaintHorizontal(doc, rowTail, "right", rowTail + 1);
      assertPaintHorizontal(doc, rowTail + 1, "left", rowTail);
    });

    it("matrix: suffix blank interior steps blank-to-blank; leave skips line-start \\n", () => {
      const doc = wireToDoc(suffixWire);
      const stops = blankNavStops(doc);
      expect(stops.length).toBeGreaterThanOrEqual(2);
      assertPaintHorizontal(doc, stops[0]!, "right", stops[1]!);
      assertPaintHorizontal(doc, stops[1]!, "left", stops[0]!);
      const lowerStart = suffixWire.indexOf("lower");
      assertPaintHorizontal(doc, stops[1]!, "right", lowerStart);
      assertPaintHorizontal(doc, lowerStart, "left", stops[1]!);
    });

    it("matrix: CRE after enters first blank stop in one Right (skips probe-only dock)", () => {
      const doc = wireToDoc(suffixWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const stops = blankNavStops(doc);
      const cre = probes[0]! - 1;
      expect(stops[0]).toBe(blankVisualLineStartOpenedByProbe(doc, probes[0]!)!);
      // Probe-only opener is not a horizontal caret hop.
      expect(stops).not.toContain(probes[0]!);
      assertPaintHorizontal(doc, cre, "right", stops[0]!, { focusAffinity: "after" });
      assertPaintHorizontal(doc, stops[0]!, "left", cre);
    });

    it("matrix: lower mention steps right to end and left to pill start", () => {
      const doc = wireToDoc(suffixWire);
      const mentionEnd = lowerMention + `@${AGENT_A}`.length;
      assertPaintHorizontal(doc, lowerMention, "right", mentionEnd);
      assertPaintHorizontal(doc, mentionEnd, "left", lowerMention);
    });
  });

  describe("horizontal — sandwich spacer paint seams", () => {
    const SPACER_AGENT = "caliper-spacer01";

    it("post-mention Right steps spacer then crosses next pill as one token", () => {
      const wire = `head @${SPACER_AGENT} @${SPACER_AGENT} end`;
      const mentionEndWire = `head @${SPACER_AGENT}`.length - 1;
      const spacerStartWire = `head @${SPACER_AGENT}`.length;
      const continuationWire = spacerStartWire + 1;

      host.editor.setDocFromWire(wire, mentionEndWire, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, spacerStartWire, "mention end → spacer");
      expect(host.editor.getSelectionState().focus).toEqual({ nodeIndex: 2, nodeOffset: 0 });
      expect(host.editor.getDoc().nodes[2]?.type).toBe("text");

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, continuationWire, "spacer → continuation");
      expect(host.editor.getSelectionState().focus).toEqual({ nodeIndex: 2, nodeOffset: 1 });

      // One-token: do not micro-stop at following mention start.
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expect(host.editor.getSelectionState().focus).toEqual({ nodeIndex: 4, nodeOffset: 0 });
      expect(host.editor.getDoc().nodes[3]?.type).toBe("mention");
      expect(host.editor.getDoc().nodes[4]?.type).toBe("text");
    });

    it("RIGHT from mention start lands spacer text focus without keepAuthority dead press", () => {
      const wire = `hea @${SPACER_AGENT} d @${SPACER_AGENT} tail`;
      const secondMentionStart = wire.lastIndexOf(`@${SPACER_AGENT}`);
      const spacerStartWire = secondMentionStart + `@${SPACER_AGENT}`.length;
      const doc = wireToDoc(wire);
      const mentionNodeIndex = doc.nodes.findIndex(
        (n, i) =>
          n.type === "mention" &&
          docPosToWireOffset(doc, { nodeIndex: i, nodeOffset: 0 }) === secondMentionStart
      );
      expect(mentionNodeIndex).toBeGreaterThanOrEqual(0);
      const mentionStart = { nodeIndex: mentionNodeIndex, nodeOffset: 0 };

      // Wire import at alias prefers text-before; force mention-start like live after text→mention step.
      host.editor.applyDoc(doc, { anchor: mentionStart, focus: mentionStart });
      expect(host.editor.getSelectionState().focus).toEqual(mentionStart);

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      // Paint-normalized landing of atomic end = spacer text@0 (contract paint authority).
      const focus = host.editor.getSelectionState().focus;
      expect(docPosToWireOffset(host.editor.getDoc(), focus)).toBe(spacerStartWire);
      expect(host.editor.getDoc().nodes[focus.nodeIndex]?.type).toBe("text");
      expect(focus.nodeOffset).toBe(0);
      expectCaretParity(host.editor, host.root, spacerStartWire, "start → spacer owner");

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, spacerStartWire + 1, "spacer → interior");
      expect(host.editor.getSelectionState().focus.nodeOffset).toBe(1);
    });

    /**
     * Pill is one horizontal token: text-before Right must not micro-stop at mention start
     * (same-wire flip). Land post-mention paint owner in one press (spacer, or soft-wrap
     * continuation when root promotes).
     */
    it("RIGHT from text-before crosses mention to spacer text without start micro-stop", () => {
      const wire = `hea @${SPACER_AGENT} d @${SPACER_AGENT} tail`;
      const secondMentionStart = wire.lastIndexOf(`@${SPACER_AGENT}`);
      const spacerStartWire = secondMentionStart + `@${SPACER_AGENT}`.length;

      host.editor.setDocFromWire(wire, secondMentionStart, { resetHistory: true });
      const before = host.editor.getSelectionState().focus;
      expect(host.editor.getDoc().nodes[before.nodeIndex]?.type).toBe("text");
      expect(docPosToWireOffset(host.editor.getDoc(), before)).toBe(secondMentionStart);

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      const afterCross = host.editor.getSelectionState().focus;
      expect(host.editor.getDoc().nodes[afterCross.nodeIndex]?.type).toBe("text");
      expect(docPosToWireOffset(host.editor.getDoc(), afterCross)).toBe(spacerStartWire);
      expect(afterCross.nodeOffset).toBe(0);
      expectCaretParity(host.editor, host.root, spacerStartWire, "text-before → spacer owner");

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, spacerStartWire + 1, "spacer → interior");
    });

    it("inter-mention gap text steps char-by-char without mention jump", () => {
      const wire = `x @${SPACER_AGENT} d @${SPACER_AGENT} z`;
      const gapNodeIndex = 2;
      const gapStartWire = `x @${SPACER_AGENT} `.length;
      const gapEndWire = gapStartWire + 2;
      host.editor.setDocFromWire(wire, gapEndWire, { resetHistory: true });
      setSelectionAtWire(host.root, host.editor.getDoc(), gapEndWire, gapEndWire, {
        fromOffset: gapEndWire,
      });
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expect(host.editor.getSelectionState().focus).toEqual({
        nodeIndex: gapNodeIndex,
        nodeOffset: 2,
      });
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expect(host.editor.getSelectionState().focus).toEqual({
        nodeIndex: gapNodeIndex,
        nodeOffset: 1,
      });
      expect(host.editor.getDoc().nodes[gapNodeIndex]?.type).toBe("text");
    });
  });

  describe("vertical — boundary bleed with layout", () => {
    const bleedWire = `header \n\n\n@${AGENT_A} tail\n\n@${AGENT_A} end`;
    const firstLineExtreme = 4;
    const firstLineBleedWire = firstLineExtreme - 1;
    const lastMentionAt = bleedWire.lastIndexOf("@");
    const lastLineExtremeEnd = lastMentionAt + `@${AGENT_A}`.length;
    const layoutSamples = (() => {
      const byWire = new Map(
        monotonicMeasuredLayoutSamples(bleedWire, { baseTop: 100, stride: 36 }).map((sample) => [
          sample.wire,
          sample,
        ])
      );
      byWire.set(firstLineBleedWire, { wire: firstLineBleedWire, top: 100, left: 40 });
      byWire.set(firstLineExtreme, { wire: firstLineExtreme, top: 100, left: 80 });
      return [...byWire.values()].sort((left, right) => left.wire - right.wire);
    })();

    it("first line: up and left resolve to the same wire offset", () => {
      host.editor.setDocFromWire(bleedWire, firstLineExtreme, { resetHistory: true });
      setMeasuredSamplesCache(host.root, bleedWire, host.root.clientWidth, layoutSamples);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstLineBleedWire, "vertical −1");

      host.editor.setDocFromWire(bleedWire, firstLineExtreme, { resetHistory: true });
      setMeasuredSamplesCache(host.root, bleedWire, host.root.clientWidth, layoutSamples);
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstLineBleedWire, "horizontal −1");
    });

    it("last line: down and right resolve to the same wire offset", () => {
      host.editor.setDocFromWire(bleedWire, lastMentionAt, { resetHistory: true });
      setMeasuredSamplesCache(host.root, bleedWire, host.root.clientWidth, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastLineExtremeEnd, "vertical +1");

      host.editor.setDocFromWire(bleedWire, lastMentionAt, { resetHistory: true });
      setMeasuredSamplesCache(host.root, bleedWire, host.root.clientWidth, layoutSamples);
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
      const samples = monotonicMeasuredLayoutSamples(wire);
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: from,
        goalColumn: 0,
        probeTargetWire: expectWire,
        samples,
        sign,
        expectMinVisualRows: 3,
      });
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
    const blankAboveRow = blankNavStops(multiPillDoc)
      .filter((wire) => wire < firstPillOnRow)
      .at(-1)!;

    it("later pill on same row crosses to blank line above", () => {
      host.editor.setDocFromWire(multiPillWire, secondPillOnRow, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, multiPillWire);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(blankAboveRow);
      expect(host.editor.getCursor()).not.toBe(firstPillOnRow);
      expectCaretParity(host.editor, host.root, blankAboveRow);
    });

    it("first pill on same row crosses to blank line above", () => {
      host.editor.setDocFromWire(multiPillWire, firstPillOnRow, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, multiPillWire);
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
    const pillRowStops = blankNavStops(pillRowDoc);
    const firstBlankBelowPillRow = pillRowStops.filter((wire) => wire >= pillRowEndingNewline)[0]!;
    const blanksAbovePillRow = pillRowStops.filter((wire) => wire < pillRowStart);
    // Prior blank stop above the newline that sits immediately over the pill row.
    const emptyLineAbovePillRow = blanksAbovePillRow
      .filter((wire) => wire < pillRowStart - 1)
      .at(-1)!;

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
        note: "newline immediately above pill row crosses to prior blank stop",
        wire: pillRowWire,
        from: pillRowStart - 1,
        sign: -1 as const,
        expectWire: emptyLineAbovePillRow,
        notExpectWire: pillRowEndingNewline - 1,
      },
    ])("$note", ({ wire, from, sign, expectWire, notExpectWire }) => {
      host.editor.setDocFromWire(wire, from, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);
      expect(pressArrow(host.editor, "vertical", sign)).toBe(true);
      expect(host.editor.getCursor()).toBe(expectWire);
      expect(host.editor.getCursor()).not.toBe(notExpectWire);
      expectCaretParity(host.editor, host.root, expectWire);
    });
  });

  describe("vertical — wire-line blank runs", () => {
    const gapWire = "header\n\n\n tail";
    const gapBlanks = blankNavStops(wireToDoc(gapWire));

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

    it("content-bearing trailing blanks: Up from document-end steps empty line-starts", () => {
      const content = "header ";
      const wire = `${content}\n\n\n`;
      const blanks = listBlankVisualLineStartWires(wireToDoc(wire));
      expect(blanks).toEqual([8, 9, 10]);
      const lastBlank = blanks[blanks.length - 1]!;
      expect(lastBlank).toBe(wire.length);
      host.editor.setDocFromWire(wire, lastBlank, { resetHistory: true });

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[blanks.length - 2]!);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[blanks.length - 3]!);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, 0);
    });

    it("content-bearing trailing blanks: Down lands on document-end empty stop (no phantom beyond)", () => {
      const content = "header ";
      const wire = `${content}\n\n\n`;
      const blanks = listBlankVisualLineStartWires(wireToDoc(wire));
      expect(blanks).toEqual([8, 9, 10]);
      const lastBlank = blanks[blanks.length - 1]!;
      expect(lastBlank).toBe(wire.length);
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[0]!);

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[1]!);

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastBlank);

      // Already on last empty line-start — further Down does not invent another stop.
      pressArrow(host.editor, "vertical", 1);
      expect(host.editor.getCursor()).toBe(lastBlank);
      expectCaretParity(host.editor, host.root, lastBlank);
    });

    it("blank-only leading-newline band: document-end is last empty stop; Up steps one blank", () => {
      // Live skip: caret at wire.length aliased onto last probe row → Up landed probe-2.
      // Line-slot authority: empty open + n newlines → n+1 blank stops including document end.
      const cases = ["\n\n\n\n", "\n\n\n\n\n\n"] as const;
      for (const wire of cases) {
        const stops = listBlankVisualLineStartWires(wireToDoc(wire));
        const lastStop = stops[stops.length - 1]!;
        const prevStop = stops[stops.length - 2]!;
        expect(stops).toHaveLength(wire.length + 1);
        expect(lastStop).toBe(wire.length);
        host.editor.setDocFromWire(wire, wire.length, { resetHistory: true });
        expect(host.editor.getCursor(), JSON.stringify(wire)).toBe(lastStop);
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor(), JSON.stringify(wire)).toBe(prevStop);
      }
    });
  });

  describe("vertical — wire-line column 0 after pill suffix", () => {
    const shiftEnterPairWire = `row @${AGENT_A} mid @${AGENT_B} \n\ntail @${AGENT_A} `;
    const blankLineStart = blankNavStops(wireToDoc(shiftEnterPairWire))[0]!;
    const prefixMentionAt = shiftEnterPairWire.indexOf("@");
    const lowerMentionEnd = shiftEnterPairWire.length - 1;

    function stubShiftEnterPairMentionRows(): void {
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 118, left: 40 }],
          [3, { top: 118, left: 200 }],
          [5, { top: 280, left: 80 }],
        ])
      );
    }

    it("up from blank wire line at column 0 with editor parity", () => {
      host.editor.setDocFromWire(shiftEnterPairWire, blankLineStart, { resetHistory: true });
      stubShiftEnterPairMentionRows();
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(0);
      expect(host.editor.getCursor()).not.toBe(prefixMentionAt);
      expectCaretParity(host.editor, host.root, 0, "up from blank wire line");
    });

    it("vertical chain from lower mention never lands on prefix mention with editor parity", () => {
      host.editor.setDocFromWire(shiftEnterPairWire, lowerMentionEnd, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, shiftEnterPairWire);
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
    const blanksBelowTail = blankNavStops(wireToDoc(longBeforeMentionWire)).filter(
      (wire) => wire >= tailRowEnd
    );
    const blankAboveContentRow = blanksBelowTail[0]!;
    /** Adjacent blank visual row below the content line (one Down step). */
    const firstBlankBelowTail = blanksBelowTail[0]!;
    const rowVisualStart = longBeforeMentionWire.indexOf("row");

    it("long tail line: blank below tail and up round-trip with editor parity", () => {
      host.editor.setDocFromWire(longBeforeMentionWire, blankAboveContentRow, {
        resetHistory: true,
      });
      seedMonotonicMeasuredLayout(host.root, longBeforeMentionWire);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(rowVisualStart);
      expect(host.editor.getCursor()).not.toBe(0);
      expectCaretParity(host.editor, host.root, rowVisualStart, "up from blank below tail");

      host.editor.setDocFromWire(longBeforeMentionWire, tailContent, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, longBeforeMentionWire);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, firstBlankBelowTail, "down to blank below tail");
    });
  });

  describe("vertical — column preserve two-pill row to plain row", () => {
    const row1 = `row @${AGENT_A} mid @${AGENT_B} end`;
    const gapMid = row1.indexOf(" mid ") + 3;
    const column = gapMid;
    const wire = `${row1}\n${" ".repeat(column)}mark`;

    it("inter-pill gap round-trip via DOM probe", () => {
      const row1Top = VISUAL_ROW_TOP.r1;
      const row2Top = VISUAL_ROW_TOP.r2;
      const belowGap = row1.length + 1 + column;
      const row2Start = row1.length + 1;
      const mentionA = row1.indexOf(`@${AGENT_A}`);
      const mentionB = row1.indexOf(`@${AGENT_B}`);
      const layoutSamples = [
        { wire: 0, top: row1Top, left: 0 },
        { wire: mentionA, top: row1Top, left: 40 },
        { wire: mentionB, top: row1Top, left: 200 },
        { wire: gapMid, top: row1Top, left: 120 },
        { wire: row1.length - 1, top: row1Top, left: 280 },
        { wire: row2Start, top: row2Top, left: 0 },
        { wire: belowGap, top: row2Top, left: 120 },
        { wire: wire.length - 1, top: row2Top, left: 160 },
      ];
      const goalColumn = 120;
      const mentionCoords = new Map([
        [1, { top: row1Top, left: 40, width: 70 }],
        [3, { top: row1Top, left: 200 }],
      ]);
      host.editor.setDocFromWire(wire, gapMid, { resetHistory: true });
      const editorWire = host.editor.getWire();
      const doc = host.editor.getDoc();
      const downProbe = prepareVerticalColumnProbe({
        root: host.root,
        doc,
        wire: editorWire,
        fromWire: gapMid,
        goalColumn,
        probeTargetWire: belowGap,
        samples: layoutSamples,
        mentionCoords,
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
        expect(host.editor.getCursor()).toBe(belowGap);
        expectCaretParity(host.editor, host.root, belowGap, "down from inter-pill gap");
      } finally {
        downProbe.restore();
      }

      host.editor.setDocFromWire(wire, belowGap, { resetHistory: true });
      const upProbe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: belowGap,
        goalColumn,
        probeTargetWire: gapMid,
        samples: layoutSamples,
        mentionCoords,
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor()).toBe(gapMid);
        expect(host.editor.getCursor()).not.toBe(row1.indexOf("@"));
        expectCaretParity(host.editor, host.root, gapMid, "up to inter-pill gap");
      } finally {
        upProbe.restore();
      }
    });
  });

  describe("vertical — wire newline with layout", () => {
    const wrapAgentA = "caliper-linea01";
    const wrapAgentB = "caliper-lineb02";
    const wrapWire = `@${wrapAgentA} header\n\n@${wrapAgentA} fill@${wrapAgentB} tail `;
    const wrapBlankStop = blankNavStops(wireToDoc(wrapWire))[0]!;
    const wrapNextLineStart = wrapWire.indexOf("@", wrapWire.indexOf("\n"));
    const wrapRow1Top = 141;
    const wrapRowBlankTop = 159;
    const wrapRow2Top = 177;
    const wrapStartLeft = 347;

    function mountWrapLayoutSamples(fromWire: number, expectWire: number) {
      const samples = [
        { wire: 0, top: wrapRow1Top, left: wrapStartLeft },
        { wire: wrapBlankStop, top: wrapRowBlankTop, left: wrapStartLeft },
        { wire: wrapNextLineStart, top: wrapRow2Top, left: wrapStartLeft },
        { wire: fromWire, top: wrapRow2Top, left: wrapStartLeft },
        { wire: wrapWire.length, top: wrapRow2Top, left: wrapStartLeft + 120 },
      ];
      // Column goal sample for the landing wire — never alias a blank stop onto content Y.
      if (expectWire !== wrapBlankStop) {
        samples.push({ wire: expectWire, top: wrapRow2Top, left: wrapStartLeft + 80 });
      }
      return samples;
    }

    it("empty wire line and next line start round-trip", () => {
      host.editor.setDocFromWire(wrapWire, wrapBlankStop, { resetHistory: true });
      setMeasuredSamplesCache(
        host.root,
        wrapWire,
        host.root.clientWidth,
        mountWrapLayoutSamples(wrapBlankStop, wrapNextLineStart)
      );
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, wrapNextLineStart);

      host.editor.setDocFromWire(wrapWire, wrapNextLineStart, { resetHistory: true });
      setMeasuredSamplesCache(
        host.root,
        wrapWire,
        host.root.clientWidth,
        mountWrapLayoutSamples(wrapNextLineStart, wrapBlankStop)
      );
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, wrapBlankStop);
    });

    it("last wire line start boundary-bleeds to mention end", () => {
      const lastLineStart = wrapWire.lastIndexOf("\n") + 1;
      const lastLineMentionEnd = lastLineStart + `@${wrapAgentA}`.length;
      host.editor.setDocFromWire(wrapWire, lastLineStart, { resetHistory: true });
      setMeasuredSamplesCache(
        host.root,
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
    const emptyRowWire = blankNavStops(suffixDoc)[0]!;
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
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        suffixBlankAbovePillLayoutSamples()
      );
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
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        suffixBlankAbovePillLayoutSamples()
      );
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(lowerPillStartWire);
      const focus = host.editor.getSelectionState().focus;
      expect(host.editor.getDoc().nodes[focus.nodeIndex]?.type).toBe("mention");
      expect(focus.nodeOffset).toBe(0);
    });

    it("down from lower pill line start boundary-bleeds to post-mention space", () => {
      host.editor.setDocFromWire(wire, lowerPillStartWire, { resetHistory: true });
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        suffixBlankAbovePillLayoutSamples()
      );
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
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        suffixBlankAbovePillLayoutSamples()
      );
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      const focus = host.editor.getSelectionState().focus;
      expect(host.editor.getDoc().nodes[focus.nodeIndex]?.type).toBe("mention");
      expect(host.editor.getCursor()).toBe(lowerPillStartWire);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, postMentionSpaceWire, "second down bleeds right");
    });

    it("round-trip — up from post-mention then down chain restores lower pill start", () => {
      host.editor.setDocFromWire(wire, postMentionSpaceWire - 1, { resetHistory: true });
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        suffixBlankAbovePillLayoutSamples()
      );
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
      const firstSuffixBlankWire = blankNavStops(twoPillDoc)[0]!;
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
        setDocWithLayout(
          host.editor,
          host.root,
          twoPillWire,
          lowerPillStartWire,
          twoPillSuffixBlankLayoutSamples()
        );
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor()).toBe(firstSuffixBlankWire);
        expect(host.editor.getCursor()).not.toBe(postFirstPillWire);
        expectCaretParity(host.editor, host.root, firstSuffixBlankWire);
      });

      it("down from suffix blank returns to lower pill with editor/DOM parity", () => {
        setDocWithLayout(
          host.editor,
          host.root,
          twoPillWire,
          firstSuffixBlankWire,
          twoPillSuffixBlankLayoutSamples()
        );
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
      thirdBlankAboveBottom = landmarks.blankRun.at(-1)!;
      secondBlankAboveBottom = landmarks.blankRun.at(-2)!;
      firstBlankAboveBottom = landmarks.blankRun[0]!;
      expect(landmarks.blankRun.length).toBeGreaterThanOrEqual(3);

      host.editor.setDocFromWire(wire, endOfLastMention, { resetHistory: true });
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        monotonicMeasuredLayoutSamples(wire)
      );
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
        firstBlankAboveBottom,
        "third step to upper blank in band"
      );

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        middleRowLineStart,
        "fourth step exits blank band to middle row visual start"
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
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        monotonicMeasuredLayoutSamples(wire)
      );

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(firstBlankAboveBottom);
      expectCaretParity(host.editor, host.root, firstBlankAboveBottom, "blank band step up");

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
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        monotonicMeasuredLayoutSamples(wire)
      );

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        firstBlankAboveBottom,
        "middle row into blank band"
      );
    });
  });

  describe("vertical — embedded blank band", () => {
    function tailLowerRowWire(): string {
      return `header @${AGENT_COMPOSITE} \n\n\ntail @${AGENT_COMPOSITE} `;
    }

    it("counts two blank probes — third newline is lower row line start", () => {
      const wire = tailLowerRowWire();
      expect(listEmbeddedBlankBandProbeWires(wireToDoc(wire))).toHaveLength(2);
    });
  });

  describe("vertical — embedded blank band measured path", () => {
    const wire = `header @${AGENT_COMPOSITE} \n\n\ntail @${AGENT_COMPOSITE} `;

    it("up from eof lands blank stops with wire and caret-row parity", () => {
      const doc = wireToDoc(wire);
      const stops = blankNavStops(doc);
      host.editor.setDocFromWire(wire, wire.length, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[1]!, "eof to lower blank");

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[0]!, "lower blank to upper blank");
    });

    it("down from lower blank lands tail row visual start with wire and caret-row parity", () => {
      const doc = wireToDoc(wire);
      const stops = blankNavStops(doc);
      const tailRowStart = wire.indexOf("tail");
      host.editor.setDocFromWire(wire, stops[1]!, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, tailRowStart, "lower blank to tail row start");
    });

    it("down from lower blank with sparse measured samples lands substantive lower row start", () => {
      const lowerRowWire = `header @${AGENT_COMPOSITE} \n\n\nlower @${AGENT_COMPOSITE} `;
      const doc = wireToDoc(lowerRowWire);
      const stops = blankNavStops(doc);
      const lowerRowStart = lowerRowWire.indexOf("lower");
      const lowerMentionStart = lowerRowWire.indexOf("@", lowerRowStart);
      const ROW1 = 141.1;
      const ROW2 = 177.49;
      const ROW3 = 213.89;
      const ROW4 = 250.29;

      host.editor.setDocFromWire(lowerRowWire, stops[1]!, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: ROW1, left: 80 }],
          [3, { top: ROW4, left: 0 }],
        ])
      );
      setMeasuredSamplesCache(host.root, lowerRowWire, host.root.clientWidth, [
        { wire: 0, top: ROW1, left: 0 },
        { wire: stops[0]!, top: ROW2, left: 0 },
        { wire: stops[1]!, top: ROW3, left: 0 },
        { wire: lowerMentionStart, top: ROW4, left: 0 },
        { wire: lowerRowWire.length - 1, top: ROW4, left: 120 },
      ]);

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(
        host.editor,
        host.root,
        lowerRowStart,
        "lower blank to substantive lower row start"
      );
    });

    it("typing on lower blank after arrow up from eof inserts on that row not the row above", () => {
      const doc = wireToDoc(wire);
      const stops = blankNavStops(doc);
      host.editor.setDocFromWire(wire, wire.length, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[1]!, "eof to lower blank");

      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "insertText",
          data: "x",
          bubbles: true,
          cancelable: true,
        })
      );

      expect(host.editor.getWire()).toBe(
        `header @${AGENT_COMPOSITE} \n\nx\ntail @${AGENT_COMPOSITE} `
      );
      expect(host.editor.getCursor()).toBe(stops[1]!);
    });

    it("filled blank row round-trips vertical navigation after typing", () => {
      const mentionCoords = new Map([
        [1, { top: 150, left: 80 }],
        [3, { top: 280, left: 0 }],
      ]);
      const layoutOptions = { mentionCoords, baseTop: 150, stride: 36 };
      const wireBefore = `header @${AGENT_COMPOSITE} \n\n\ntail @${AGENT_COMPOSITE} `;
      const docBefore = wireToDoc(wireBefore);
      const stopsBefore = blankNavStops(docBefore);

      host.editor.setDocFromWire(wireBefore, wireBefore.length, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(host.root, mentionCoords);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, stopsBefore[1]!, "eof to lower blank");

      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "insertText",
          data: "x",
          bubbles: true,
          cancelable: true,
        })
      );

      const wireAfter = host.editor.getWire();
      const typedWire = wireAfter.indexOf("x");
      expect(typedWire).toBeGreaterThanOrEqual(0);
      expect(wireAfter).toBe(`header @${AGENT_COMPOSITE} \n\nx\ntail @${AGENT_COMPOSITE} `);
      expect(isEmbeddedBlankBandProbeWire(host.editor.getDoc(), typedWire)).toBe(false);

      refreshHandoffNoteEditorLayoutGeometry(
        host.root,
        host.editor.getDoc(),
        wireAfter,
        layoutOptions
      );

      const tailStart = wireAfter.indexOf("tail");
      const samplesAfter = monotonicMeasuredLayoutSamples(wireAfter);
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: typedWire,
        goalColumn: samplesAfter.find((s) => s.wire === typedWire)?.left ?? 0,
        probeTargetWire: tailStart,
        samples: samplesAfter,
        sign: 1,
        mentionCoords,
        expectMinVisualRows: 3,
      });
      expectCaretParity(host.editor, host.root, tailStart, "down to tail after fill");

      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: tailStart,
        goalColumn: samplesAfter.find((s) => s.wire === typedWire)?.left ?? 0,
        probeTargetWire: typedWire,
        samples: samplesAfter,
        sign: -1,
        mentionCoords,
        expectMinVisualRows: 3,
      });
      expectCaretParity(host.editor, host.root, typedWire, "up back to filled row");
    });

    it("typing on upper blank after arrow up through lower blank inserts on that row", () => {
      const doc = wireToDoc(wire);
      const stops = blankNavStops(doc);
      host.editor.setDocFromWire(wire, wire.length, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[1]!, "eof to lower blank");
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[0]!, "lower blank to upper blank");

      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "insertText",
          data: "x",
          bubbles: true,
          cancelable: true,
        })
      );

      expect(host.editor.getWire()).toBe(
        `header @${AGENT_COMPOSITE} \nx\n\ntail @${AGENT_COMPOSITE} `
      );
      expect(host.editor.getCursor()).toBe(stops[0]!);
    });

    it("typing on lower blank after arrow down inserts on that row not the row above", () => {
      const doc = wireToDoc(wire);
      const stops = blankNavStops(doc);
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[0]!, "down to upper blank");
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[1]!, "down to lower blank");

      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "insertText",
          data: "x",
          bubbles: true,
          cancelable: true,
        })
      );

      expect(host.editor.getWire()).toBe(
        `header @${AGENT_COMPOSITE} \n\nx\ntail @${AGENT_COMPOSITE} `
      );
      expect(host.editor.getCursor()).toBe(stops[1]!);
    });

    it("first char into mid blank does not paint wire-break", () => {
      const stops = blankNavStops(wireToDoc(wire));
      host.editor.setDocFromWire(wire, wire.length, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(stops[1]!);

      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "insertText",
          data: "m",
          bubbles: true,
          cancelable: true,
        })
      );
      dispatchSelectionChange(host.root);

      expect(host.editor.getWire()).toContain("\nm\n");
      const selNode = host.root.ownerDocument.getSelection()?.anchorNode;
      expect(selNode instanceof HTMLBRElement && isHandoffWireBreakElement(selNode)).toBe(false);
    });

    it("type mesh into mid blank must not scramble via repair live-behind", () => {
      const stops = blankNavStops(wireToDoc(wire));
      host.editor.setDocFromWire(wire, wire.length, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(stops[1]!);

      for (const ch of ["m", "e", "s", "h"]) {
        host.editor.handleBeforeInput(
          new InputEvent("beforeinput", {
            inputType: "insertText",
            data: ch,
            bubbles: true,
            cancelable: true,
          })
        );
        dispatchSelectionChange(host.root);
      }

      expect(host.editor.getWire()).toContain("\nmesh\n");
    });
  });

  describe("EOF trailing blank band — editor pipeline", () => {
    function insertLineBreak(): void {
      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "insertLineBreak",
          bubbles: true,
          cancelable: true,
        })
      );
    }

    function insertText(data: string): void {
      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "insertText",
          data,
          bubbles: true,
          cancelable: true,
        })
      );
    }

    function pressBackspace(): boolean {
      return host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
      );
    }

    it("two EOF breaks then type fills lower blank row", () => {
      const prefix = "content";
      host.editor.setDocFromWire(prefix, prefix.length, { resetHistory: true });

      insertLineBreak();
      insertLineBreak();
      insertText("d");

      expect(host.editor.getWire()).toBe(`${prefix}\n\nd`);
      expect(listEmbeddedBlankBandProbeWires(host.editor.getDoc())).toEqual([prefix.length]);
    });

    it("sole-char row first Shift+Enter lands on trailing empty line-start", () => {
      host.editor.setDocFromWire("d", 1, { resetHistory: true });
      insertLineBreak();
      expect(host.editor.getWire()).toBe("d\n");
      expect(host.editor.getCursor()).toBe(2);
    });

    describe("first Shift+Enter EOF blank paint (contract)", () => {
      it.each([
        { prefix: "sh", label: "two-letter no trailing space" },
        { prefix: "content", label: "word no trailing space" },
        { prefix: "sh ", label: "trailing space control" },
      ])("$label: first Shift+Enter paints EOF line-pad not bare wire-break", ({ prefix }) => {
        host.editor.setDocFromWire(prefix, prefix.length, { resetHistory: true });
        insertLineBreak();
        expect(host.editor.getWire()).toBe(`${prefix}\n`);
        expect(host.editor.getCursor()).toBe(prefix.length + 1);
        expectDomCaretPaintedAtLinePad(
          host.root,
          `first Shift+Enter after ${JSON.stringify(prefix)}`
        );
      });

      it("content-bearing sole-char Shift+Enter lands on trailing empty line-start", () => {
        host.editor.setDocFromWire("d", 1, { resetHistory: true });
        insertLineBreak();
        expect(host.editor.getWire()).toBe("d\n");
        expect(listEmbeddedBlankBandProbeWires(host.editor.getDoc())).toEqual([1]);
        expect(listBlankVisualLineStartWires(host.editor.getDoc())).toEqual([2]);
        expect(host.editor.getCursor()).toBe(2);
      });

      it("second Shift+Enter after no-space prefix still paints EOF line-pad", () => {
        host.editor.setDocFromWire("sh", 2, { resetHistory: true });
        insertLineBreak();
        insertLineBreak();
        expect(host.editor.getWire()).toBe("sh\n\n");
        expect(host.editor.getCursor()).toBe(4);
        expectDomCaretPaintedAtLinePad(host.root, "second Shift+Enter");
      });
    });

    it("second sole-char Shift+Enter advances to next trailing empty line-start", () => {
      host.editor.setDocFromWire("d", 1, { resetHistory: true });
      insertLineBreak();
      insertLineBreak();
      expect(host.editor.getWire()).toBe("d\n\n");
      expect(listEmbeddedBlankBandProbeWires(host.editor.getDoc())).toEqual([1, 2]);
      expect(listBlankVisualLineStartWires(host.editor.getDoc())).toEqual([2, 3]);
      expect(host.editor.getCursor()).toBe(3);
    });

    it("empty doc first Shift+Enter lands on new trailing empty line stop", () => {
      host.editor.setDocFromWire("", 0, { resetHistory: true });
      insertLineBreak();
      expect(host.editor.getWire()).toBe("\n");
      expect(host.editor.getCursor()).toBe(1);
    });

    it("two EOF breaks backspace on lower blank lands remaining blank not CRE (no jump)", () => {
      const prefix = "content";
      host.editor.setDocFromWire(prefix, prefix.length, { resetHistory: true });

      insertLineBreak();
      insertLineBreak();

      expect(host.editor.getCursor()).toBe(host.editor.getWire().length);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`${prefix}\n`);
      expect(blankNavStops(host.editor.getDoc())).toEqual([prefix.length + 1]);
      expectCaretParity(
        host.editor,
        host.root,
        prefix.length + 1,
        "lower blank BS lands remaining blank"
      );
      expect(host.editor.getSelectionState().focusAffinity).toBeUndefined();
    });

    it("two EOF breaks type arrow up backspace collapses blank not content above", () => {
      const prefix = "content";
      host.editor.setDocFromWire(prefix, prefix.length, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, prefix);

      insertLineBreak();
      insertLineBreak();
      insertText("d");

      const stops = blankNavStops(host.editor.getDoc());
      const openedWire = host.editor.getWire();
      seedMonotonicMeasuredLayout(host.root, openedWire);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[0]!, "arrow up to upper blank");

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`${prefix}\nd`);
      expect(host.editor.getCursor()).toBe(prefix.length - 1);
    });

    it("two EOF breaks type arrow up delete collapses blank not content above or below", () => {
      const prefix = "content";
      host.editor.setDocFromWire(prefix, prefix.length, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, prefix);

      insertLineBreak();
      insertLineBreak();
      insertText("d");

      const stops = blankNavStops(host.editor.getDoc());
      seedMonotonicMeasuredLayout(host.root, host.editor.getWire());

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[0]!, "arrow up to upper blank");

      expect(
        host.editor.handleKeyDown(
          new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
        )
      ).toBe(true);
      expect(host.editor.getWire()).toBe(`${prefix}\nd`);
      expect(host.editor.getCursor()).toBe(host.editor.getWire().lastIndexOf("d"));
    });

    it("mention row two EOF breaks type backspace on blank preserves pill", () => {
      const prefix = `row @${AGENT_A} `;
      host.editor.setDocFromWire(prefix, prefix.length, { resetHistory: true });

      insertLineBreak();
      insertLineBreak();
      insertText("d");

      const probes = listEmbeddedBlankBandProbeWires(host.editor.getDoc());
      host.editor.setDocFromWire(host.editor.getWire(), probes[0]!, { resetHistory: true });

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`${prefix}\nd`);
      expect(host.editor.getDoc().nodes.filter((node) => node.type === "mention")).toHaveLength(1);
    });
  });

  describe("substantive suffix with EOF blank band — chip through mention after click", () => {
    const rowWire = `header @${AGENT_A} tail`;

    function insertLineBreak(): void {
      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "insertLineBreak",
          bubbles: true,
          cancelable: true,
        })
      );
    }

    function pressBackspace(): boolean {
      return host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
      );
    }

    function pressDelete(): boolean {
      return host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
      );
    }

    function clickRowSuffixEnd(): void {
      const probes = listEmbeddedBlankBandProbeWires(host.editor.getDoc());
      const rowEnd = probes[0]! - 1;
      const rowTailText = [...host.root.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.startsWith(" tail")
      );
      expect(rowTailText).toBeDefined();
      setDomCaretAtTextEnd(host.root, rowTailText as Text);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(rowEnd);
    }

    it("backspace after row end click chips suffix then mention-end removes mention at probe alias", () => {
      host.editor.setDocFromWire(rowWire, rowWire.length, { resetHistory: true });
      insertLineBreak();
      insertLineBreak();
      insertLineBreak();
      clickRowSuffixEnd();

      const agentToken = `@${AGENT_A}`;
      for (let i = 0; i < 12 && host.editor.getWire().includes(agentToken); i++) {
        expect(pressBackspace()).toBe(true);
      }
      expect(host.editor.getWire()).not.toContain(agentToken);
      expect(host.editor.getWire()).toBe(`header \n\n\n`);
      expect(host.editor.getDoc().nodes.filter((node) => node.type === "mention")).toHaveLength(0);
    });

    it("backspace after spacer chip survives browser selectionchange then removes mention", () => {
      host.editor.setDocFromWire(rowWire, rowWire.length, { resetHistory: true });
      insertLineBreak();
      insertLineBreak();
      insertLineBreak();
      clickRowSuffixEnd();

      const agentToken = `@${AGENT_A}`;
      const targetWire = `header ${agentToken}\n\n\n`;
      for (let i = 0; i < 20 && host.editor.getWire() !== targetWire; i++) {
        expect(pressBackspace()).toBe(true);
      }
      expect(host.editor.getWire()).toBe(targetWire);

      dispatchSelectionChange(host.root);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).not.toContain(agentToken);
      expect(host.editor.getWire()).toBe(`header \n\n\n`);
    });

    it("delete after row visual start click chips prefix through mention", () => {
      host.editor.setDocFromWire(rowWire, rowWire.length, { resetHistory: true });
      insertLineBreak();
      insertLineBreak();

      const firstText = host.root.childNodes[0];
      expect(firstText?.nodeType).toBe(Node.TEXT_NODE);
      expect(firstText?.textContent).toBe("header ");
      setDomCaretAtTextStart(host.root, firstText as Text);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(0);

      const agentToken = `@${AGENT_A}`;
      for (let i = 0; i < "header ".length; i++) {
        expect(pressDelete()).toBe(true);
      }
      expect(host.editor.getWire()).toBe(`${agentToken} tail\n\n`);
      expect(host.editor.getDoc().nodes.filter((node) => node.type === "mention")).toHaveLength(1);
    });
  });

  describe("text-node boundary ownership — edit ingress", () => {
    function pressBackspace(): boolean {
      return host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
      );
    }

    function pressDelete(): boolean {
      return host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
      );
    }

    it("backspace after plain text-node tail click nibbles on first press", () => {
      const plainWire = `hello\n\n\nlower `;
      const doc = wireToDoc(plainWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerEnd = probes[0]! - 1;

      host.editor.setDocFromWire(plainWire, 0, { resetHistory: true });
      const firstText = host.root.childNodes[0];
      expect(firstText?.nodeType).toBe(Node.TEXT_NODE);
      setDomCaretAtTextEnd(host.root, firstText as Text);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(headerEnd);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`hell\n\n\nlower `);
      expectCaretParity(host.editor, host.root, headerEnd - 1, "plain text-node tail");
    });

    it("backspace after mention suffix text-node tail click nibbles on first press", () => {
      const suffixWire = `header @${AGENT_COMPOSITE} row\n\n\nlower `;
      const doc = wireToDoc(suffixWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerEnd = probes[0]! - 1;

      host.editor.setDocFromWire(suffixWire, 0, { resetHistory: true });
      const rowTailText = [...host.root.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent === " row"
      );
      expect(rowTailText).toBeDefined();
      setDomCaretAtTextEnd(host.root, rowTailText as Text);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(headerEnd);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`header @${AGENT_COMPOSITE} ro\n\n\nlower `);
    });

    it("delete after lower-row text-node head click nibbles on first press", () => {
      const wire = `hello\n\n\nlower `;
      const lowerStart = wire.indexOf("lower");

      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      const lowerText = [...host.root.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.startsWith("lower")
      );
      expect(lowerText).toBeDefined();
      setDomCaretAtTextStart(host.root, lowerText as Text);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(lowerStart);

      expect(pressDelete()).toBe(true);
      expect(host.editor.getWire()).toBe(`hello\n\n\nower `);
    });

    it("delete at visual start on sole-char row before blank band keeps caret before char", () => {
      const wire = `he\n\n\n`;
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      const firstText = host.root.childNodes[0];
      expect(firstText?.nodeType).toBe(Node.TEXT_NODE);
      setDomCaretAtTextStart(host.root, firstText as Text);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(0);

      expect(pressDelete()).toBe(true);
      expect(host.editor.getWire()).toBe(`e\n\n\n`);
      expectCaretParity(host.editor, host.root, 0, "sole-char row visual start after delete");
    });
  });

  describe("embedded blank-band delete after arrow", () => {
    const wire = `header @${AGENT_COMPOSITE} \n\n\ntail @${AGENT_COMPOSITE} `;

    function deleteBackward(): void {
      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "deleteContentBackward",
          bubbles: true,
          cancelable: true,
        })
      );
    }

    function deleteForward(): void {
      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "deleteContentForward",
          bubbles: true,
          cancelable: true,
        })
      );
    }

    function pressBackspace(): boolean {
      return host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
      );
    }

    function pressDelete(): boolean {
      return host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
      );
    }

    it("backspace on upper sandwiched blank after arrow down collapses one blank row", () => {
      const doc = wireToDoc(wire);
      const stops = blankNavStops(doc);
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[0]!, "down to upper blank");

      deleteBackward();

      expect(host.editor.getWire()).toBe(
        `header @${AGENT_COMPOSITE} \n\ntail @${AGENT_COMPOSITE} `
      );
      // Under content: remount CRE/`after` on header — leftover blank stays until focused.
      const resultWire = host.editor.getWire();
      expectCaretParity(
        host.editor,
        host.root,
        resultWire.indexOf("\n") - 1,
        "upper sandwiched blank backspace remounts CRE on header",
        { expect: "after" }
      );
    });

    it("backspace on lower blank after arrow down lands remaining blank not CRE (no jump)", () => {
      const doc = wireToDoc(wire);
      const stops = blankNavStops(doc);
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[1]!, "down to lower blank");

      deleteBackward();

      expect(host.editor.getWire()).toBe(
        `header @${AGENT_COMPOSITE} \n\ntail @${AGENT_COMPOSITE} `
      );
      const remain = blankNavStops(host.editor.getDoc());
      expect(remain.length).toBeGreaterThanOrEqual(1);
      expect(blankNavStops(host.editor.getDoc())).toEqual([25]);
      expectCaretParity(host.editor, host.root, 25, "lower blank BS lands remaining blank");
      expect(host.editor.getSelectionState().focusAffinity).toBeUndefined();
    });

    it("delete on lower blank after arrow down lands tail visual start", () => {
      const doc = wireToDoc(wire);
      const stops = blankNavStops(doc);
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(
        host.root,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, stops[1]!, "down to lower blank");

      deleteForward();

      const resultWire = host.editor.getWire();
      expect(resultWire).toBe(`header @${AGENT_COMPOSITE} \n\ntail @${AGENT_COMPOSITE} `);
      const tailAt = resultWire.indexOf("tail");
      expectCaretParity(
        host.editor,
        host.root,
        tailAt,
        "lower blank delete lands tail visual start"
      );
    });

    it("keydown backspace at header row end nibbles trailing suffix text", () => {
      const suffixWire = `header @${AGENT_COMPOSITE} row\n\n\nlower `;
      const doc = wireToDoc(suffixWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerEnd = probes[0]! - 1;

      // CRE `after`: Backspace unit-behind is the focused last char (not prior char).
      host.editor.applyDoc(
        doc,
        collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, headerEnd), "content-row-end")
      );
      expectCaretParity(host.editor, host.root, headerEnd, "header row end before nibble", {
        expect: "after",
      });

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`header @${AGENT_COMPOSITE} ro\n\n\nlower `);
    });

    it("keydown backspace after blank-band BA click remounts CRE on header; leftover blank stays", () => {
      const suffixWire = `header @${AGENT_COMPOSITE} row\n\n\nlower `;
      const doc = wireToDoc(suffixWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const [firstProbe] = probes;
      const blankStop = blankVisualLineStartOpenedByProbe(doc, firstProbe!);
      expect(blankStop).not.toBeNull();

      host.editor.setDocFromWire(suffixWire, 0, { resetHistory: true });
      setSelectionAtWire(host.root, host.editor.getDoc(), firstProbe!, firstProbe!);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(blankStop);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`header @${AGENT_COMPOSITE} row\n\nlower `);
      const afterFirst = host.editor.getWire();
      expectCaretParity(
        host.editor,
        host.root,
        afterFirst.indexOf("\n") - 1,
        "first collapse remounts CRE on header",
        { expect: "after" }
      );

      // Leftover blank must be focused again — collapse then remounts CRE again.
      const remainingAfterFirst = listEmbeddedBlankBandProbeWires(wireToDoc(afterFirst))[0]!;
      host.editor.setDocFromWire(afterFirst, remainingAfterFirst, { resetHistory: true });
      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`header @${AGENT_COMPOSITE} row\nlower `);
      const resultWire = host.editor.getWire();
      expectCaretParity(
        host.editor,
        host.root,
        resultWire.indexOf("\n") - 1,
        "second collapse remounts CRE on header again",
        { expect: "after" }
      );
    });

    it("keydown backspace on sandwiched blank remounts CRE on header (leftover blank stays)", () => {
      const suffixWire = `header @${AGENT_COMPOSITE} row\n\n\nlower `;
      const doc = wireToDoc(suffixWire);
      const [upperBlankStop] = blankNavStops(doc);

      host.editor.setDocFromWire(suffixWire, upperBlankStop!, { resetHistory: true });
      stubHandoffNoteMentionLayoutCoords(host.root, new Map([[1, { top: 150, left: 80 }]]));

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`header @${AGENT_COMPOSITE} row\n\nlower `);
      const resultWire = host.editor.getWire();
      expectCaretParity(
        host.editor,
        host.root,
        resultWire.indexOf("\n") - 1,
        "sandwiched blank collapse remounts CRE on header",
        { expect: "after" }
      );
    });

    it("keydown backspace at single-char header row end deletes character before blank band", () => {
      const suffixWire = `h\n\n\ntail`;
      const doc = wireToDoc(suffixWire);
      const headerEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;

      host.editor.applyDoc(
        doc,
        collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, headerEnd), "content-row-end")
      );

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\n\ntail`);
      expectCaretParity(host.editor, host.root, 0, "sole-char chip lands on empty content row end");
      expectDomCaretPaintedAtWireBreak(host.root, "emptied header empty CRE");
    });

    it("keydown backspace on sole-char row before blank band keeps editor/DOM parity", () => {
      const suffixWire = `d\n\n`;
      const doc = wireToDoc(suffixWire);
      const rowEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;

      host.editor.applyDoc(
        doc,
        collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, rowEnd), "content-row-end")
      );

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\n`);
      expectCaretParity(host.editor, host.root, 0, "d chip to empty row end");
      expectDomCaretPaintedAtWireBreak(host.root, "emptied sole-char empty CRE");
    });

    it("keydown Delete clearing sole char from visual start paints emptied empty CRE bare BR", () => {
      host.editor.setDocFromWire(`h\n\n`, 0, { resetHistory: true });
      expect(pressDelete()).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\n`);
      expectCaretParity(host.editor, host.root, 0, "Delete sole char to empty CRE");
      expectDomCaretPaintedAtWireBreak(host.root, "Delete emptied empty CRE");
    });

    it("keydown backspace on two-char row before blank band nibbles at caret not row chip", () => {
      const suffixWire = `he\n\n`;
      const doc = wireToDoc(suffixWire);
      host.editor.setDocFromWire(suffixWire, 1, { resetHistory: true });
      setSelectionAtWire(host.root, doc, 1);
      dispatchSelectionChange(host.root);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`e\n\n`);
      expect(host.editor.getCursor()).toBe(0);
      expectCaretParity(
        host.editor,
        host.root,
        0,
        "two-char interior backspace nibble removes char before caret"
      );
    });

    it("keydown CRE backspace after row-end click chips to sole char on content not probe", () => {
      const suffixWire = `ab\n\n`;
      host.editor.setDocFromWire(suffixWire, 0, { resetHistory: true });
      const firstText = host.root.childNodes[0];
      expect(firstText?.nodeType).toBe(Node.TEXT_NODE);
      setDomCaretAtTextEnd(host.root, firstText as Text);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(1);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`a\n\n`);
      expect(host.editor.getCursor()).toBe(0);
      expect(isEmbeddedBlankBandProbeWire(host.editor.getDoc(), host.editor.getCursor())).toBe(
        false
      );
      expectCaretParity(host.editor, host.root, 0, "partial CRE chip lands on remaining char");
    });

    it("keydown backspace on sandwiched probe between filled rows lands at upper row end", () => {
      const suffixWire = "header \n\n\nmiddle\n\ntail";
      const doc = wireToDoc(suffixWire);
      const sandwichedProbe = listEmbeddedBlankBandGroups(doc).find(
        (group) => group.probes.length === 1
      )!.probes[0]!;

      host.editor.setDocFromWire(suffixWire, sandwichedProbe, { resetHistory: true });

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe("header \n\n\nmiddle\ntail");
      const resultWire = host.editor.getWire();
      const upperRowEnd = resultWire.indexOf("middle") + "middle".length - 1;
      expect(host.editor.getCursor()).toBe(upperRowEnd);
      expectCaretParity(
        host.editor,
        host.root,
        upperRowEnd,
        "sandwiched probe collapse lands at upper row end"
      );
    });

    it("keydown backspace at first probe on sole-char sandwiched row remounts then chips header", () => {
      const suffixWire = `h\n\n\ntail`;
      const doc = wireToDoc(suffixWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      host.editor.setDocFromWire(suffixWire, probes[0]!, { resetHistory: true });

      // Under content: remount CRE/`after` on `h` — leftover blanks stay until focused.
      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`h\n\ntail`);
      expect(host.editor.getCursor()).toBe(0);
      expect(host.editor.getSelectionState().focusAffinity).toBe("after");

      // Next Backspace chips the sole char (not another blank collapse).
      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\ntail`);

      // Leading blanks: progressive trash toward lower content.
      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`\ntail`);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`tail`);
      expect(host.editor.getCursor()).toBe(0);
    });

    it("keydown backspace after clearing sole header character collapses blank band to lower start", () => {
      const suffixWire = `h\n\n\nlower `;
      const doc = wireToDoc(suffixWire);
      host.editor.applyDoc(
        doc,
        collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, 0), "content-row-end")
      );

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\n\nlower `);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\nlower `);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`\nlower `);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`lower `);
      expect(host.editor.getCursor()).toBe(0);
    });

    it("keydown backspace through prefix-only blank band keeps editor/DOM parity", () => {
      host.editor.setDocFromWire(`\n\n\n`, 0, { resetHistory: true });

      for (const expectedWire of [`\n\n`, `\n`, ``]) {
        expect(pressBackspace()).toBe(true);
        expect(host.editor.getWire()).toBe(expectedWire);
        expectCaretParity(host.editor, host.root, 0, `collapse to ${JSON.stringify(expectedWire)}`);
        if (expectedWire !== "") {
          expectDomCaretPaintedAtWireBreak(
            host.root,
            `leading blank ${JSON.stringify(expectedWire)}`
          );
        }
      }
    });
  });

  describe("horizontal — middle-row tail", () => {
    it("steps forward and back along middle-row tail text", () => {
      const wire = buildCompositeBlankBandWire();
      const tailStart = wire.indexOf(" tail") + 1;
      const tailInterior = tailStart + 2;
      const lastChar = wire.indexOf("\n", tailStart) - 1;

      host.editor.setDocFromWire(wire, tailInterior, { resetHistory: true });
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        monotonicMeasuredLayoutSamples(wire)
      );

      // Right onto last letter lands the char (deletion point) — after is a second same-wire Right.
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastChar, "on last letter", {
        expect: undefined,
      });

      // Same-wire Right establishes content-row-end.
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastChar, "establish after", {
        expect: "after",
      });

      // Left from after flips to before on the same char.
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastChar, "flip before", {
        expect: "before",
      });

      // Left from before leaves to previous char.
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, tailInterior, "back to interior", {
        expect: undefined,
      });
    });
  });

  /**
   * Visual between-char: step onto last content char lands deletion point;
   * content-row-end is a same-wire Right flip (Backspace-ready).
   */
  describe("horizontal — visual between-char CRE (contract)", () => {
    it("one-row EOF: Right onto last char then Right establishes after; Backspace chips", () => {
      const wire = "tail";
      const lastChar = wire.length - 1;
      host.editor.setDocFromWire(wire, lastChar - 1, { resetHistory: true });

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastChar, "one Right → last char", {
        expect: undefined,
      });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastChar, "second Right → after", {
        expect: "after",
      });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(false);

      const bs = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
      expect(host.editor.handleKeyDown(bs)).toBe(true);
      expect(host.editor.getWire()).toBe("tai");
    });

    it("multiline before break: Right onto last char is deletion point (not after)", () => {
      const wire = "abcdef\nghij";
      const lastBeforeBreak = wire.indexOf("\n") - 1;
      host.editor.setDocFromWire(wire, lastBeforeBreak - 1, { resetHistory: true });

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastBeforeBreak, "onto last", {
        expect: undefined,
      });
    });

    it("paint primitive: step onto last-before-break does not stamp after", () => {
      const doc = wireToDoc("abcdef\nghij");
      const lastBeforeBreak = "abcdef".length - 1;
      assertPaintHorizontal(doc, lastBeforeBreak - 1, "right", lastBeforeBreak, {
        expectAffinity: undefined,
      });
    });

    it("paint primitive: EOF last char step from previous does not stamp after", () => {
      const doc = wireToDoc("abcdef\nghij");
      const eofCre = "abcdef\nghij".length - 1;
      assertPaintHorizontal(doc, eofCre - 1, "right", eofCre, {
        expectAffinity: undefined,
      });
    });

    it("trailing space before blank: Right onto space is a real hop (not CRE after)", () => {
      const wire = "whedg \n\ndhhd ";
      const spaceWire = 5;
      host.editor.setDocFromWire(wire, 4, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, spaceWire, "onto trailing space", {
        expect: undefined,
      });
    });

    it("blank band: Right from blank stop lands next content start", () => {
      const wire = "whedg \n\ndhhd ";
      const blankStop = blankNavStops(wireToDoc(wire))[0]!;
      const contentStart = 8;
      host.editor.setDocFromWire(wire, blankStop, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, contentStart, "leave blank → content");
    });

    it("blank band: Left from content start lands blank stop", () => {
      const wire = "whedg \n\ndhhd ";
      const blankStop = blankNavStops(wireToDoc(wire))[0]!;
      host.editor.setDocFromWire(wire, 8, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, blankStop, "enter blank from below");
    });

    it("ordinary line break: Right from CRE after lands next content start (not the \\n)", () => {
      const wire = "abcdef\nghij";
      const lastBeforeBreak = wire.indexOf("\n") - 1;
      const nextContent = lastBeforeBreak + 2;
      host.editor.setDocFromWire(wire, lastBeforeBreak, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expect(host.editor.getSelectionState().focusAffinity).toBe("after");
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, nextContent, "leave after → next row start");
    });
  });

  describe("horizontal — CRE affinity flip and leave", () => {
    it("plain multiline: already on last omit — Right after; Left flips then steps", () => {
      const wire = "abcdef\nghij";
      const lastBeforeBreak = wire.indexOf("\n") - 1;
      host.editor.setDocFromWire(wire, lastBeforeBreak, { resetHistory: true });
      expect(host.editor.getSelectionState().focusAffinity).toBeUndefined();

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastBeforeBreak, "establish after", {
        expect: "after",
      });

      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastBeforeBreak, "flip before", {
        expect: "before",
      });

      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastBeforeBreak - 1, "leave to previous", {
        expect: undefined,
      });
    });

    it("plain multiline: after Right leaves onto next content start", () => {
      const wire = "abcdef\nghij";
      const lastBeforeBreak = wire.indexOf("\n") - 1;
      const nextContent = lastBeforeBreak + 2;
      host.editor.setDocFromWire(wire, lastBeforeBreak - 1, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expect(host.editor.getSelectionState().focusAffinity).toBeUndefined();
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expect(host.editor.getSelectionState().focusAffinity).toBe("after");
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, nextContent, "leave after → next row");
    });

    it("EOF last char: Right onto last; Right after; Left flips — never wire.length past-end", () => {
      const wire = "abcdef\nghij";
      const eofCre = wire.length - 1;
      host.editor.setDocFromWire(wire, eofCre - 1, { resetHistory: true });

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, eofCre, "EOF onto last", { expect: undefined });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, eofCre, "EOF after", { expect: "after" });
      expect(host.editor.getCursor()).toBeLessThan(wire.length);

      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, eofCre, "EOF before", { expect: "before" });
    });

    it("paint move: on last omit Right after; Left from after flips; Left leaves", () => {
      const doc = wireToDoc("abcdef\nghij");
      const lastBeforeBreak = "abcdef".length - 1;
      assertPaintHorizontal(doc, lastBeforeBreak, "right", lastBeforeBreak, {
        expectAffinity: "after",
      });
      assertPaintHorizontal(doc, lastBeforeBreak, "left", lastBeforeBreak, {
        focusAffinity: "after",
        expectAffinity: "before",
      });
      assertPaintHorizontal(doc, lastBeforeBreak, "left", lastBeforeBreak - 1, {
        focusAffinity: "before",
        expectAffinity: undefined,
      });
    });
  });

  describe("horizontal — prefix gap before mention after blank run", () => {
    it("steps into last blank stop before mention and returns", () => {
      const multilineWire = `header \n\n\n\n\n@${AGENT_A} `;
      const mentionStart = multilineWire.indexOf("@");
      const lastBlank = blankNavStops(wireToDoc(multilineWire)).at(-1)!;

      host.editor.setDocFromWire(multilineWire, mentionStart, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastBlank);

      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, mentionStart);
    });
  });

  describe("horizontal — matrix suffix doc positions", () => {
    const suffixWire = `row @${AGENT_A} mid @${AGENT_B} tail\n\n\nlower @${AGENT_A} `;
    const rowTail = suffixWire.indexOf("tail") + 2;
    const lowerMention = suffixWire.lastIndexOf("@");

    it("row tail and suffix blank round-trip horizontally with editor parity", () => {
      host.editor.setDocFromWire(suffixWire, rowTail, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, rowTail + 1, "Right → last char", {
        expect: undefined,
      });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, rowTail + 1, "Right → after on last", {
        expect: "after",
      });
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, rowTail + 1, "Left → before on last", {
        expect: "before",
      });
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, rowTail, "Left → previous");

      const blankStops = blankNavStops(wireToDoc(suffixWire));
      const lastBlank = blankStops.at(-1)!;
      const lowerStart = suffixWire.indexOf("lower");
      host.editor.setDocFromWire(suffixWire, lastBlank, { resetHistory: true });
      expect(pressArrow(host.editor, "horizontal", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lowerStart, "leave blank → lower");
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, lastBlank, "enter blank from lower");
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
    it("five-pill row line start enters blank below not second pill with editor parity", () => {
      const row = `row @${AGENT_A} @${AGENT_A} @${AGENT_A} @${AGENT_A} @${AGENT_A} end`;
      const wire = `${row}\n\n\nfollow`;
      const firstPill = wire.indexOf(`@${AGENT_A}`);
      const secondPill = wire.indexOf(`@${AGENT_A}`, firstPill + 1);
      const firstBlank = blankNavStops(wireToDoc(wire)).find((stop) => stop > row.length - 1)!;
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(firstBlank);
      expect(host.editor.getCursor()).not.toBe(secondPill);
      expectCaretParity(host.editor, host.root, firstBlank);
    });

    it("seven-blank wire band monotonic descent from header to tail with editor parity", () => {
      const wire = `header${"\n".repeat(8)} tail`;
      const doc = wireToDoc(wire);
      const blanks = blankNavStops(doc);
      const tailLineStart = wire.lastIndexOf("\n") + 1;
      const rowTop = 100;
      const samples: { wire: number; top: number; left: number }[] = [
        { wire: 0, top: rowTop, left: 0 },
        { wire: 5, top: rowTop, left: 40 },
      ];
      let blankTop = rowTop + 36;
      for (const blank of blanks) {
        samples.push({ wire: blank, top: blankTop, left: 0 });
        blankTop += 36;
      }
      samples.push(
        { wire: tailLineStart, top: blankTop, left: 0 },
        { wire: wire.length - 1, top: blankTop, left: 40 }
      );
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      setMeasuredSamplesCache(host.root, wire, host.root.clientWidth, samples);
      for (const blank of blanks) {
        expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
        expectCaretParity(host.editor, host.root, blank);
      }
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, tailLineStart, "tail row visual start");
    });
    it("three-pill row tail enters blank below with editor parity", () => {
      const row = `row @${AGENT_A} @${AGENT_A} @${AGENT_A} end`;
      const wire = `${row}\n\n\nfollow`;
      const rowTail = row.length - 1;
      const blanksBelowRow = blankNavStops(wireToDoc(wire)).filter((stop) => stop > rowTail);
      const firstBlankBelowRow = blanksBelowRow[0]!;
      host.editor.setDocFromWire(wire, rowTail, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(firstBlankBelowRow);
      expectCaretParity(host.editor, host.root, firstBlankBelowRow);
    });

    it("five-blank wire band column-0 round-trip with editor parity", () => {
      const header = "header";
      const wire = `${header}${"\n".repeat(6)}tail`;
      const blanks = blankNavStops(wireToDoc(wire));
      expect(blanks).toHaveLength(5);
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[0]!);
      host.editor.setDocFromWire(wire, blanks[0]!, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, 0);
    });

    it("four-pill row line start and first blank below round-trip with editor parity", () => {
      const row = `row @${AGENT_A} @${AGENT_A} @${AGENT_A} @${AGENT_A} end`;
      const wire = `${row}\n\n\nfollow`;
      const pillRowStart = 0;
      const firstBlank = blankNavStops(wireToDoc(wire))[0]!;
      const secondPill = wire.indexOf(`@${AGENT_A}`, wire.indexOf(`@${AGENT_A}`) + 1);
      host.editor.setDocFromWire(wire, pillRowStart, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(firstBlank);
      expect(host.editor.getCursor()).not.toBe(secondPill);
      expectCaretParity(host.editor, host.root, firstBlank);
      host.editor.setDocFromWire(wire, firstBlank, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, pillRowStart);
    });

    it("seven-blank wire band column-0 round-trip with editor parity", () => {
      const wire = `header${"\n".repeat(8)} tail`;
      const doc = wireToDoc(wire);
      const blanks = blankNavStops(doc);
      const tailStart = wire.lastIndexOf("\n") + 1;
      const samples = monotonicMeasuredLayoutSamples(wire);
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      setMeasuredSamplesCache(host.root, wire, host.root.clientWidth, samples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[0]!);
      host.editor.setDocFromWire(wire, tailStart, { resetHistory: true });
      setMeasuredSamplesCache(host.root, wire, host.root.clientWidth, samples);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expectCaretParity(host.editor, host.root, blanks[6]!);
      host.editor.setDocFromWire(wire, blanks[0]!, { resetHistory: true });
      setMeasuredSamplesCache(host.root, wire, host.root.clientWidth, samples);
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

    it("prefix and wrapped interior round-trip via DOM probe", () => {
      const goalColumn = 362;
      host.editor.setDocFromWire(wire, prefixMidWire, { resetHistory: true });
      const downProbe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: prefixMidWire,
        goalColumn,
        probeTargetWire: wrappedInteriorWire,
        samples: layoutSamples,
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
        expect(host.editor.getCursor()).toBe(wrappedInteriorWire);
        expectCaretParity(host.editor, host.root, wrappedInteriorWire);
      } finally {
        downProbe.restore();
      }

      host.editor.setDocFromWire(wire, wrappedInteriorWire, { resetHistory: true });
      const upProbe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: wrappedInteriorWire,
        goalColumn,
        probeTargetWire: prefixMidWire,
        samples: layoutSamples,
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor()).toBe(prefixMidWire);
        expectCaretParity(host.editor, host.root, prefixMidWire);
      } finally {
        upProbe.restore();
      }
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
      const goalColumn = 482.7083435058594;
      host.editor.setDocFromWire(wire, secondMentionEnd, { resetHistory: true });
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: secondMentionEnd,
        goalColumn,
        probeTargetWire: postMentionStart,
        samples: layoutSamples,
        sign: -1,
      });
      expectCaretParity(host.editor, host.root, postMentionStart, "up to upper row tail");

      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: postMentionStart,
        goalColumn,
        probeTargetWire: secondMentionEnd,
        samples: layoutSamples,
        sign: 1,
      });
      expectCaretParity(host.editor, host.root, secondMentionEnd, "down restores lower row end");
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
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: L.wrapRow2InteriorWire,
        goalColumn: 0,
        probeTargetWire: L.line1Start,
        samples: layoutSamples,
        sign: 1,
      });
      expectCaretParity(host.editor, host.root, L.line1Start, "visual row below");
    });

    it("round-trip — wrap interior down then up restores interior", () => {
      setDocWithLayout(host.editor, host.root, wire, L.wrapRow2InteriorWire, layoutSamples);
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: L.wrapRow2InteriorWire,
        goalColumn: 0,
        probeTargetWire: L.line1Start,
        samples: layoutSamples,
        sign: 1,
      });
      expectCaretParity(host.editor, host.root, L.line1Start);
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: L.line1Start,
        goalColumn: 0,
        probeTargetWire: L.wrapRow2InteriorWire,
        samples: layoutSamples,
        sign: -1,
      });
      expectCaretParity(host.editor, host.root, L.wrapRow2InteriorWire);
    });

    it("two-step down from wrap row 1 visits wrap row 2 before row below", () => {
      setDocWithLayout(host.editor, host.root, wire, L.wrapRow1Wire, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(L.wrapRow2InteriorWire);
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: L.wrapRow2InteriorWire,
        goalColumn: 0,
        probeTargetWire: L.line1Start,
        samples: layoutSamples,
        sign: 1,
      });
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
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: L.middleWrapRow2Interior,
        goalColumn: 0,
        probeTargetWire: L.bottomStart,
        samples: layoutSamples,
        sign: 1,
      });
      expectCaretParity(host.editor, host.root, L.bottomStart);
    });

    it("up from middle wrap row 2 interior lands on middle wrap row 1", () => {
      setDocWithLayout(host.editor, host.root, wire, L.middleWrapRow2Interior, layoutSamples);
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: L.middleWrapRow2Interior,
        goalColumn: 0,
        probeTargetWire: L.middleWrapRow1,
        samples: layoutSamples,
        sign: -1,
      });
      expectCaretParity(host.editor, host.root, L.middleWrapRow1);
    });

    it("down from top visual row crosses to middle wrap row 1", () => {
      setDocWithLayout(host.editor, host.root, wire, 0, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, L.middleWrapRow1, "short top to middle");
    });
  });

  describe("vertical — empty row below wrapped line", () => {
    const baseWire = wrappedFirstLineWire().replace(/\nrow3$/, "");
    const wire = `${baseWire}\n\nbelow`;
    const blankDoc = wireToDoc(wire);
    const blankStop = blankNavStops(blankDoc)[0]!;
    // Content end above the blank band is still probe-1 (stop is empty line-start).
    const wrapTail = listEmbeddedBlankBandProbeWires(blankDoc)[0]! - 1;
    const belowStart = wire.lastIndexOf("\n") + 1;

    function samples() {
      const base = samplesForWrappedFirstLine(
        wire.replace(/\n\nbelow$/, "\nrow3"),
        VISUAL_ROW_TOP.r3
      );
      return [
        ...base.filter((sample) => sample.wire < blankStop),
        { wire: wrapTail, top: VISUAL_ROW_TOP.r2, left: 400 },
        { wire: blankStop, top: VISUAL_ROW_TOP.r3, left: 0 },
        { wire: belowStart, top: VISUAL_ROW_TOP.r4, left: 0 },
        { wire: wire.length - 1, top: VISUAL_ROW_TOP.r4, left: 40 },
      ];
    }

    it("down from wrap row 2 tail lands on empty row not row below", () => {
      setDocWithLayout(host.editor, host.root, wire, wrapTail, samples());
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, blankStop, "empty row");
      expect(host.editor.getCursor()).not.toBe(belowStart);
    });

    it("down from empty row crosses to row below", () => {
      setDocWithLayout(host.editor, host.root, wire, blankStop, samples());
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
      const layoutSamples = samples();
      setDocWithLayout(host.editor, host.root, wire, L.wrapRow2InteriorWire, layoutSamples);
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: L.wrapRow2InteriorWire,
        goalColumn: 0,
        probeTargetWire: line1Start,
        samples: layoutSamples,
        sign: 1,
      });
      expectCaretParity(host.editor, host.root, line1Start);
      expect(host.editor.getCursor()).not.toBe(line2Start);
    });
  });

  describe("vertical — wrapped line then Shift+Enter row below", () => {
    const wire = `header @${AGENT_A} ${longTail(12)}\nrow3`;
    const L = landmarksForWrappedFirstLine(wire);

    it("down chain visits wrap row 2 then visual row below", () => {
      const layoutSamples = samplesForWrappedFirstLine(wire);
      setDocWithLayout(host.editor, host.root, wire, L.wrapRow1Wire, layoutSamples);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(L.wrapRow2InteriorWire);
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: L.wrapRow2InteriorWire,
        goalColumn: 0,
        probeTargetWire: L.line1Start,
        samples: layoutSamples,
        sign: 1,
      });
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
      const samples = [
        { wire: prefixStart, top: row1Top, left: 0 },
        { wire: postMentionStart, top: row1Top, left: 200 },
        { wire: firstMentionEnd, top: row1Top, left: 220 },
        { wire: secondPostStart, top: row1Top, left: 400 },
        { wire: secondMentionEnd, top: row1Top, left: 420 },
        { wire: tailWire, top: row2Top, left: 520 },
      ];
      host.editor.setDocFromWire(wire, tailWire, { resetHistory: true });
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: tailWire,
        goalColumn: 520,
        probeTargetWire: secondPostStart,
        samples,
        sign: -1,
      });
      expect(host.editor.getCursor()).not.toBe(tailWire - 1);
      expect(host.editor.getCursor()).toBeLessThan(tailWire - 5);
      expectCaretParity(host.editor, host.root, host.editor.getCursor(), "vertical up from tail");
    });
  });

  describe("vertical — full soft-wrapped post-mention tail", () => {
    const agent = AGENT_A;
    const wire = `he @${agent} x @${agent} tail`;
    const doc = wireToDoc(wire);
    const tailStart = wire.indexOf("tail");
    const tailInterior = tailStart + 2;
    const tailPastEnd = wire.length;
    const row0Head = 0;
    const row0Top = 141.1;
    const row1Top = 158.86;
    const row0EndAfterSpacer = tailStart - 1;

    function compactWrapSamples() {
      return [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 3, top: row0Top, left: 359.58 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 492.52,
        },
        { wire: tailStart - 1, top: row0Top, left: 609.68 },
        { wire: tailPastEnd, top: row1Top, left: 370.02 },
        { wire: tailStart, top: 140.67, left: 609.68 },
      ];
    }

    beforeEach(() => {
      host.root.style.width = "310px";
      Object.defineProperty(host.root, "clientWidth", { configurable: true, value: 310 });
    });

    it("up from wrap tail uses vertical layout not horizontal bleed", () => {
      host.editor.setDocFromWire(wire, tailInterior, { resetHistory: true });
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: tailInterior,
        goalColumn: 370.02,
        probeTargetWire: row0EndAfterSpacer,
        samples: compactWrapSamples(),
        sign: -1,
      });
      expect(host.editor.getCursor()).not.toBe(tailInterior - 1);
      expect(host.editor.getCursor()).toBeLessThan(tailStart);
      expectCaretParity(host.editor, host.root, host.editor.getCursor(), "up from wrap interior");
    });

    it("DOM probe preserves wrap-tail column on row above", () => {
      const secondMentionStart = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 });
      const goalColumn = 394;
      const targetWire = 3;
      host.editor.setDocFromWire(wire, tailInterior, { resetHistory: true });
      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: tailInterior,
        goalColumn,
        probeTargetWire: targetWire,
        samples: compactWrapSamples(),
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor()).toBeLessThan(secondMentionStart);
        expect(host.editor.getCursor()).not.toBe(row0EndAfterSpacer);
        expectCaretParity(host.editor, host.root, host.editor.getCursor(), "wrap column up");
      } finally {
        probe.restore();
      }
    });

    it("DOM probe preserves column when prefix text mismatches", () => {
      const wrapWire = `he @${agent} x @${agent} seg`;
      const wrapDoc = wireToDoc(wrapWire);
      const tailStart = wrapWire.lastIndexOf("seg");
      const tailInterior = tailStart + 1;
      const goalColumn = 362.67;
      const wrapSamples = [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 3, top: row0Top, left: 359.58 },
        {
          wire: docPosToWireOffset(wrapDoc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 492.52,
        },
        { wire: tailStart - 1, top: row0Top, left: 617.32 },
        { wire: wrapWire.length, top: row1Top, left: 362.67 },
        { wire: tailStart, top: 140.67, left: 617.32 },
      ];
      host.editor.setDocFromWire(wrapWire, tailInterior, { resetHistory: true });
      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: tailInterior,
        goalColumn,
        probeTargetWire: 3,
        samples: wrapSamples,
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor()).toBe(3);
        expectCaretParity(host.editor, host.root, 3, "wrap column up after prefix mismatch");
      } finally {
        probe.restore();
      }
    });

    it("prefix round-trip when tail text mismatches upper prefix", () => {
      const wrapWire = `pre @${agent} x @${agent} post @${agent} @${agent} `;
      const wrapDoc = wireToDoc(wrapWire);
      const prefixInterior = 2;
      const tailStart = wrapWire.indexOf("post");
      const tailInterior = tailStart + 2;
      const goalColumn = 361.11;
      const spacerWire = tailStart - 1;
      const secondMentionStart = docPosToWireOffset(wrapDoc, { nodeIndex: 3, nodeOffset: 0 });
      const wrapSamples = [
        { wire: 0, top: row0Top, left: 347.5 },
        { wire: 4, top: row0Top, left: 374.73 },
        {
          wire: docPosToWireOffset(wrapDoc, { nodeIndex: 2, nodeOffset: 1 }),
          top: row0Top,
          left: 491.89,
        },
        { wire: secondMentionStart, top: row0Top, left: 507.67 },
        { wire: spacerWire, top: row0Top, left: 624.82 },
        { wire: wrapWire.length, top: row1Top, left: 377.81 },
        { wire: tailStart, top: row1Top, left: 377.8125 },
        { wire: tailInterior, top: row1Top, left: 394 },
        {
          wire: docPosToWireOffset(wrapDoc, { nodeIndex: 2, nodeOffset: 1 }),
          top: row0Top - 0.43,
          left: 491.89,
        },
        { wire: tailStart, top: row0Top - 0.43, left: 624.82 },
      ];

      host.editor.setDocFromWire(wrapWire, prefixInterior, { resetHistory: true });

      const restoreSourceAnchor = stubHandoffNoteAnchorRectAtWire(
        host.root,
        wrapDoc,
        prefixInterior,
        { top: row0Top, left: goalColumn }
      );
      const restoreTailAnchor = stubHandoffNoteAnchorRectAtWire(host.root, wrapDoc, tailInterior, {
        top: row1Top,
        left: goalColumn,
      });
      const restoreDownProbe = stubCaretProbeAtDocPos(
        host.root,
        wrapDoc,
        goalColumn,
        row1Top,
        wireOffsetToDocPos(wrapDoc, tailInterior)
      );
      setMeasuredSamplesCache(host.root, wrapWire, host.root.clientWidth, wrapSamples);

      try {
        expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
        expect(host.editor.getCursor()).toBe(tailInterior);

        restoreDownProbe();
        const restoreUpProbe = stubCaretProbeAtDocPos(
          host.root,
          wrapDoc,
          goalColumn,
          row0Top,
          wireOffsetToDocPos(wrapDoc, prefixInterior)
        );
        setMeasuredSamplesCache(host.root, wrapWire, host.root.clientWidth, wrapSamples);

        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor()).toBe(prefixInterior);
        expectCaretParity(
          host.editor,
          host.root,
          prefixInterior,
          "prefix mismatch wrap round-trip"
        );

        restoreUpProbe();
      } finally {
        restoreTailAnchor();
        restoreSourceAnchor();
      }
    });

    it("DOM probe preserves wrap-tail interior column on descent from prefix", () => {
      const wrapWire = `he @${agent} x @${agent} seg`;
      const wrapDoc = wireToDoc(wrapWire);
      const tailStart = wrapWire.lastIndexOf("seg");
      const tailInterior = tailStart + 1;
      const goalColumn = 346.52666666666664;
      const wrapSamples = [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 3, top: row0Top, left: 359.58 },
        {
          wire: docPosToWireOffset(wrapDoc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 492.52,
        },
        { wire: tailStart - 1, top: row0Top, left: 617.32 },
        { wire: wrapWire.length, top: row1Top, left: 362.67 },
        { wire: tailStart, top: 140.67, left: 617.32 },
      ];
      host.editor.setDocFromWire(wrapWire, 1, { resetHistory: true });
      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: 1,
        goalColumn,
        probeTargetWire: tailInterior,
        samples: wrapSamples,
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
        expect(host.editor.getCursor()).toBe(tailInterior);
        expectCaretParity(host.editor, host.root, tailInterior, "wrap column down from prefix");
      } finally {
        probe.restore();
      }
    });

    it("down from row 0 head lands on wrapped tail without horizontal bleed", () => {
      host.editor.setDocFromWire(wire, row0Head, { resetHistory: true });
      setMeasuredSamplesCache(host.root, wire, host.root.clientWidth, compactWrapSamples());

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(tailStart);
      expect(host.editor.getCursor()).not.toBe(row0Head + 1);
      expectCaretParity(host.editor, host.root, host.editor.getCursor(), "down from row 0 head");
    });

    it("top bleed then down lands wrap continuation start", () => {
      const wrapWire = `pre @${agent} x @${agent} seg`;
      const wrapDoc = wireToDoc(wrapWire);
      const wrapTailStart = wrapWire.lastIndexOf("seg");
      const wrapTailPastEnd = wrapWire.length;
      const wrapSamples = [
        { wire: 0, top: row0Top, left: 347.5 },
        { wire: 4, top: row0Top, left: 374.73 },
        {
          wire: docPosToWireOffset(wrapDoc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 507.67,
        },
        { wire: wrapTailStart - 1, top: row0Top, left: 624.82 },
        { wire: wrapTailPastEnd, top: row1Top, left: 370.17 },
        { wire: wrapTailStart, top: 140.67, left: 624.82 },
      ];
      host.editor.setDocFromWire(wrapWire, 3, { resetHistory: true });
      setMeasuredSamplesCache(host.root, wrapWire, host.root.clientWidth, wrapSamples);

      pressArrowUntil(host.editor, "vertical", -1, (cursor) => cursor === 0, "up to doc start");

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, wrapTailStart, "down after top bleed");
    });

    it("bottom bleed then up preserves column via DOM probe", () => {
      const wrapWire = `pre @${agent} x @${agent} seg`;
      const wrapTailStart = wrapWire.lastIndexOf("seg");
      const wrapTailPastEnd = wrapWire.length;
      // CRE: collapsed EOF caret is last content char, not wire.length past-end.
      const eofCreWire = Math.max(0, wrapWire.length - 1);
      const goalColumn = 370.17;
      const wrapSamples = [
        { wire: 0, top: row0Top, left: 347.5 },
        { wire: 4, top: row0Top, left: 374.73 },
        {
          wire: docPosToWireOffset(wireToDoc(wrapWire), { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 507.67,
        },
        { wire: wrapTailStart - 1, top: row0Top, left: 624.82 },
        { wire: wrapTailPastEnd, top: row1Top, left: 370.17 },
        { wire: wrapTailStart, top: 140.67, left: 624.82 },
      ];
      host.editor.setDocFromWire(wrapWire, wrapTailStart, { resetHistory: true });
      setMeasuredSamplesCache(host.root, wrapWire, host.root.clientWidth, wrapSamples);

      pressArrowUntil(
        host.editor,
        "vertical",
        1,
        (cursor) => cursor >= eofCreWire,
        "down to EOF CRE"
      );

      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: host.editor.getCursor(),
        goalColumn,
        probeTargetWire: 4,
        samples: wrapSamples,
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expectCaretParity(host.editor, host.root, 4, "up after bottom bleed");
      } finally {
        probe.restore();
      }
    });

    it("up from lower row keeps authority on upper row before top bleed", () => {
      const wrapWire = `pre @${agent} x @${agent} tail @${agent} `;
      const wrapDoc = wireToDoc(wrapWire);
      const firstMentionStart = docPosToWireOffset(wrapDoc, { nodeIndex: 1, nodeOffset: 0 });
      const firstPostStart = docPosToWireOffset(wrapDoc, { nodeIndex: 2, nodeOffset: 0 });
      const secondMentionStart = docPosToWireOffset(wrapDoc, { nodeIndex: 3, nodeOffset: 0 });
      const secondPostStart = docPosToWireOffset(wrapDoc, { nodeIndex: 4, nodeOffset: 0 });
      const thirdMentionStart = docPosToWireOffset(wrapDoc, { nodeIndex: 5, nodeOffset: 0 });
      const thirdPostStart = docPosToWireOffset(wrapDoc, { nodeIndex: 6, nodeOffset: 0 });
      const wrapSamples = [
        { wire: 0, top: row0Top, left: 347.5 },
        { wire: firstMentionStart, top: row0Top, left: 374.73 },
        { wire: firstPostStart - 1, top: row0Top, left: 491.89 },
        { wire: secondMentionStart, top: row0Top, left: 507.67 },
        { wire: secondPostStart, top: row1Top, left: 624.82 },
        { wire: thirdMentionStart, top: row1Top, left: 404.76 },
        { wire: thirdPostStart - 1, top: row1Top, left: 521.92 },
        { wire: wrapWire.length, top: row1Top, left: 525.47 },
        { wire: firstPostStart, top: row0Top - 0.43, left: 491.89 },
        { wire: secondPostStart + 1, top: row0Top - 0.43, left: 624.82 },
      ];
      host.editor.setDocFromWire(wrapWire, wrapWire.length, { resetHistory: true });
      setMeasuredSamplesCache(host.root, wrapWire, host.root.clientWidth, wrapSamples);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      const upperLanding = host.editor.getCursor();

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBeLessThan(upperLanding);
    });

    it("up from lower row end lands on upper row end after the wrapped spacer", () => {
      const wrapWire = `pre @${agent} x @${agent} line @${agent} @${agent} `;
      const wrapDoc = wireToDoc(wrapWire);
      const firstMentionEnd = docPosToWireOffset(wrapDoc, {
        nodeIndex: 1,
        nodeOffset: agent.length,
      });
      const firstPostStart = docPosToWireOffset(wrapDoc, { nodeIndex: 2, nodeOffset: 0 });
      const secondMentionStart = docPosToWireOffset(wrapDoc, { nodeIndex: 3, nodeOffset: 0 });
      const secondPostStart = docPosToWireOffset(wrapDoc, { nodeIndex: 4, nodeOffset: 0 });
      const secondTextStart = secondPostStart + 1;
      const thirdMentionStart = docPosToWireOffset(wrapDoc, { nodeIndex: 5, nodeOffset: 0 });
      const thirdMentionEnd = docPosToWireOffset(wrapDoc, {
        nodeIndex: 5,
        nodeOffset: agent.length,
      });
      const thirdPostStart = docPosToWireOffset(wrapDoc, { nodeIndex: 6, nodeOffset: 0 });
      const fourthMentionEnd = docPosToWireOffset(wrapDoc, {
        nodeIndex: 7,
        nodeOffset: agent.length,
      });
      const wrapSamples = [
        { wire: 0, top: row0Top, left: 347.5 },
        { wire: 4, top: row0Top, left: 374.73 },
        { wire: firstMentionEnd, top: row0Top, left: 491.89 },
        { wire: secondMentionStart, top: row0Top, left: 507.67 },
        { wire: secondPostStart, top: row1Top, left: 624.82 },
        { wire: thirdMentionStart, top: row1Top, left: 382.09 },
        { wire: thirdMentionEnd, top: row1Top, left: 499.25 },
        { wire: thirdPostStart, top: row1Top, left: 503.81 },
        { wire: fourthMentionEnd, top: row1Top, left: 620.97 },
        { wire: wrapWire.length, top: row1Top, left: 624.52 },
        { wire: firstPostStart, top: row0Top - 0.43, left: 491.89 },
        { wire: secondTextStart, top: row0Top - 0.43, left: 624.82 },
      ];
      const fromWire = Math.max(0, wrapWire.length - 1);
      host.editor.setDocFromWire(wrapWire, fromWire, { resetHistory: true });
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire,
        goalColumn: 624.52,
        probeTargetWire: secondPostStart,
        samples: wrapSamples,
        sign: -1,
      });
      expect(host.editor.getCursor()).not.toBe(secondTextStart);
      expect(host.editor.getCursor()).toBe(secondPostStart);
      expect(wrapDoc.nodes[host.editor.getSelectionState().focus.nodeIndex]?.type).toBe("text");
      expectCaretParity(
        host.editor,
        host.root,
        host.editor.getCursor(),
        "up lands at upper row end after wrapped spacer"
      );
    });

    it("down from row 0 end after spacer and up round-trip without horizontal bleed", () => {
      const samples = compactWrapSamples();
      host.editor.setDocFromWire(wire, row0EndAfterSpacer, { resetHistory: true });
      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: row0EndAfterSpacer,
        goalColumn: 609.68,
        probeTargetWire: tailStart,
        samples,
        sign: 1,
      });
      expect(host.editor.getCursor()).toBeGreaterThanOrEqual(tailStart);

      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: host.editor.getCursor(),
        goalColumn: 609.68,
        probeTargetWire: row0EndAfterSpacer,
        samples,
        sign: -1,
      });
      expect(host.editor.getCursor()).toBe(row0EndAfterSpacer);
      expectCaretParity(host.editor, host.root, row0EndAfterSpacer, "down then up from row 0 end");
    });

    it("up from wrapped tail interior after horizontal step uses vertical layout", () => {
      host.editor.setDocFromWire(wire, tailPastEnd, { resetHistory: true });
      setMeasuredSamplesCache(host.root, wire, host.root.clientWidth, compactWrapSamples());
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expect(pressArrow(host.editor, "horizontal", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(tailInterior);

      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: tailInterior,
        goalColumn: 370.02,
        probeTargetWire: row0EndAfterSpacer,
        samples: compactWrapSamples(),
        sign: -1,
      });
      expect(host.editor.getCursor()).not.toBe(tailInterior - 1);
      expect(host.editor.getCursor()).toBeLessThan(tailStart);
      expectCaretParity(host.editor, host.root, host.editor.getCursor(), "left then up");
    });
  });

  describe("vertical — blank band exit to soft-wrap continuation row", () => {
    const agent = AGENT_A;
    const row0Top = 141.1;
    const row1Top = 159.3;
    const row2Top = 177.49;
    const row3Top = 195.89;
    const row4Top = 214.29;
    const visualRowStart = 347.5;

    function softWrapBlankBandWire() {
      return `pre @${agent} x @${agent} post @${agent} @${agent} \n\n\nlower @${agent} `;
    }

    function softWrapBlankBandSamples(wire: string) {
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("post");
      const lowerStart = wire.indexOf("lower");
      const [upperBlank, lowerBlank] = blankNavStops(doc);
      const secondMentionStart = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 });
      return [
        { wire: 0, top: row0Top, left: visualRowStart },
        { wire: 4, top: row0Top, left: 374.73 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 2, nodeOffset: 1 }),
          top: row0Top,
          left: 491.89,
        },
        { wire: secondMentionStart, top: row0Top, left: 507.67 },
        { wire: tailStart - 1, top: row0Top, left: 624.82 },
        { wire: tailStart, top: row1Top, left: 377.8125 },
        { wire: upperBlank!, top: row2Top, left: visualRowStart },
        { wire: lowerBlank!, top: row3Top, left: visualRowStart },
        { wire: lowerStart, top: row4Top, left: visualRowStart },
        { wire: wire.length, top: row4Top, left: 624.82 },
      ];
    }

    beforeEach(() => {
      host.root.style.width = "310px";
      Object.defineProperty(host.root, "clientWidth", { configurable: true, value: 310 });
    });

    it("up from upper blank stop lands wrap continuation row visual start (one row per press)", () => {
      const wire = softWrapBlankBandWire();
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("post");
      const upperBlankStop = blankNavStops(doc)[0]!;
      host.editor.setDocFromWire(wire, upperBlankStop, { resetHistory: true });
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        softWrapBlankBandSamples(wire)
      );

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(tailStart);
      expect(host.editor.getCursor()).not.toBe(0);
      expectCaretParity(host.editor, host.root, tailStart, "blank exit to wrap row visual start");
    });

    it("two-step up from upper blank visits wrap row then prefix row", () => {
      const wire = softWrapBlankBandWire();
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("post");
      const upperBlankStop = blankNavStops(doc)[0]!;
      const samples = softWrapBlankBandSamples(wire);
      host.editor.setDocFromWire(wire, upperBlankStop, { resetHistory: true });
      setMeasuredSamplesCache(host.root, wire, host.root.clientWidth, samples);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(tailStart);
      expect(
        readHandoffNoteLayoutRowIndexForTests(
          host.root,
          host.editor.getDoc(),
          host.editor.getCursor()
        )
      ).toBe(1);

      pressVerticalWithColumnProbe(host.editor, host.root, {
        fromWire: tailStart,
        goalColumn: 347.5,
        probeTargetWire: 0,
        samples,
        sign: -1,
      });
      expect(
        readHandoffNoteLayoutRowIndexForTests(
          host.root,
          host.editor.getDoc(),
          host.editor.getCursor()
        )
      ).toBe(0);
      expect(host.editor.getCursor()).toBe(0);
      expectCaretParity(host.editor, host.root, 0, "wrap row to prefix visual start");
    });

    it("down from wrap continuation enters upper blank stop", () => {
      const wire = softWrapBlankBandWire();
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("post");
      const upperBlankStop = blankNavStops(doc)[0]!;
      host.editor.setDocFromWire(wire, tailStart, { resetHistory: true });
      setMeasuredSamplesCache(
        host.root,
        wire,
        host.root.clientWidth,
        softWrapBlankBandSamples(wire)
      );

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(upperBlankStop);
      expectCaretParity(host.editor, host.root, upperBlankStop, "wrap continuation to blank");
    });
  });

  describe("vertical — wire line break sticky column through shorter upper row", () => {
    const wire = "hi\nmuch longer lower line";
    const upperEnd = wire.indexOf("\n") - 1;
    const lowerPastEnd = wire.length;
    const row0Top = 100;
    const row1Top = 118;
    const upperMaxLeft = 95;
    const lowerWideLeft = 440;

    function lineBreakSamples() {
      return [
        { wire: 0, top: row0Top, left: 40 },
        { wire: upperEnd, top: row0Top, left: upperMaxLeft },
        { wire: lowerPastEnd, top: row1Top, left: lowerWideLeft },
      ];
    }

    it("up from wide lower row preserves sticky for down round-trip", () => {
      // CRE: collapsed EOF is last content char, not wire.length past-end.
      const lowerCre = Math.max(0, lowerPastEnd - 1);
      host.editor.setDocFromWire(wire, lowerCre, { resetHistory: true });
      const doc = host.editor.getDoc();
      const landPos = wireOffsetToDocPos(doc, upperEnd);
      const restoreOnChar = stubHandoffNoteAnchorRectAtDocPos(host.root, doc, landPos, {
        top: row0Top,
        left: upperMaxLeft,
      });
      const restoreAfter = stubHandoffNoteAnchorRectAtDocPos(
        host.root,
        doc,
        landPos,
        { top: row0Top, left: upperMaxLeft + 8 },
        { focusAffinity: "after" }
      );
      const upProbe = prepareVerticalColumnProbe({
        root: host.root,
        doc,
        wire: host.editor.getWire(),
        fromWire: lowerCre,
        goalColumn: lowerWideLeft,
        probeTargetWire: upperEnd,
        samples: lineBreakSamples(),
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expectCaretParity(host.editor, host.root, upperEnd, "up clamp to shorter upper", {
          expect: "after",
        });
      } finally {
        upProbe.restore();
      }

      const downProbe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: upperEnd,
        goalColumn: lowerWideLeft,
        probeTargetWire: lowerCre,
        samples: lineBreakSamples(),
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
        expectCaretParity(host.editor, host.root, lowerCre, "down restores wide lower column");
      } finally {
        downProbe.restore();
        restoreAfter();
        restoreOnChar();
      }
    });

    it("down onto shorter lower content end lands after", () => {
      const shortLower = "wxyz\nab\n";
      const from = 3;
      const lowerEnd = 6;
      const samples = [
        { wire: 0, top: row0Top, left: 40 },
        { wire: 1, top: row0Top, left: 55 },
        { wire: 2, top: row0Top, left: 70 },
        { wire: 3, top: row0Top, left: 440 },
        { wire: 5, top: row1Top, left: 40 },
        { wire: 6, top: row1Top, left: upperMaxLeft },
        { wire: 7, top: row1Top + 18, left: 40 },
      ];
      host.editor.setDocFromWire(shortLower, from, { resetHistory: true });
      const doc = host.editor.getDoc();
      const landPos = wireOffsetToDocPos(doc, lowerEnd);
      const restoreOnChar = stubHandoffNoteAnchorRectAtDocPos(host.root, doc, landPos, {
        top: row1Top,
        left: upperMaxLeft,
      });
      const restoreAfter = stubHandoffNoteAnchorRectAtDocPos(
        host.root,
        doc,
        landPos,
        { top: row1Top, left: upperMaxLeft + 8 },
        { focusAffinity: "after" }
      );
      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc,
        wire: host.editor.getWire(),
        fromWire: from,
        goalColumn: 440,
        probeTargetWire: lowerEnd,
        samples,
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
        expectCaretParity(host.editor, host.root, lowerEnd, "down clamp shorter lower", {
          expect: "after",
        });
      } finally {
        probe.restore();
        restoreAfter();
        restoreOnChar();
      }
    });

    it("up onto mid-row last char keeps omit when sticky is nearer on-char than after", () => {
      // Live: bottom after first d → Up into "se"; probe hits `e` but sticky is mid-glyph → after s, not se|.
      const wire = "header\nse\ndhhd";
      const midLast = wire.indexOf("e", wire.indexOf("\n"));
      const afterFirstLowerD = wire.indexOf("\n", midLast) + 2;
      const row2Top = 136;
      const onCharLeft = 337;
      const afterCharLeft = 346;
      const goalColumn = 341;
      const samples = [
        { wire: 0, top: row0Top, left: 40 },
        { wire: 5, top: row0Top, left: 95 },
        { wire: midLast - 1, top: row1Top, left: onCharLeft - 2 },
        { wire: midLast, top: row1Top, left: onCharLeft },
        { wire: afterFirstLowerD - 1, top: row2Top, left: onCharLeft },
        { wire: afterFirstLowerD, top: row2Top, left: goalColumn },
        { wire: wire.length, top: row2Top, left: afterCharLeft + 10 },
      ];
      host.editor.setDocFromWire(wire, afterFirstLowerD, { resetHistory: true });
      const doc = host.editor.getDoc();
      const landPos = wireOffsetToDocPos(doc, midLast);
      // Affinity rect stubs before prepare — prepare re-seeds samples last (stubs wipe cache).
      const restoreOnChar = stubHandoffNoteAnchorRectAtDocPos(host.root, doc, landPos, {
        top: row1Top,
        left: onCharLeft,
      });
      const restoreAfter = stubHandoffNoteAnchorRectAtDocPos(
        host.root,
        doc,
        landPos,
        { top: row1Top, left: afterCharLeft },
        { focusAffinity: "after" }
      );
      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc,
        wire,
        fromWire: afterFirstLowerD,
        goalColumn,
        probeTargetWire: midLast,
        samples,
        expectMinVisualRows: 3,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expectCaretParity(host.editor, host.root, midLast, "up sticky nearer on-char", {
          expect: undefined,
        });
      } finally {
        probe.restore();
        restoreAfter();
        restoreOnChar();
      }
    });

    it("up onto mid-row last char uses after when sticky is at after-glyph", () => {
      const wire = "header\nse\ndhhd";
      const midLast = wire.indexOf("e", wire.indexOf("\n"));
      const afterFirstLowerD = wire.indexOf("\n", midLast) + 2;
      const row2Top = 136;
      const onCharLeft = 337;
      const afterCharLeft = 346;
      const goalColumn = afterCharLeft;
      const samples = [
        { wire: 0, top: row0Top, left: 40 },
        { wire: 5, top: row0Top, left: 95 },
        { wire: midLast - 1, top: row1Top, left: onCharLeft - 2 },
        { wire: midLast, top: row1Top, left: onCharLeft },
        { wire: afterFirstLowerD - 1, top: row2Top, left: onCharLeft },
        { wire: afterFirstLowerD, top: row2Top, left: goalColumn },
        { wire: wire.length, top: row2Top, left: afterCharLeft + 10 },
      ];
      host.editor.setDocFromWire(wire, afterFirstLowerD, { resetHistory: true });
      const doc = host.editor.getDoc();
      const landPos = wireOffsetToDocPos(doc, midLast);
      const restoreOnChar = stubHandoffNoteAnchorRectAtDocPos(host.root, doc, landPos, {
        top: row1Top,
        left: onCharLeft,
      });
      const restoreAfter = stubHandoffNoteAnchorRectAtDocPos(
        host.root,
        doc,
        landPos,
        { top: row1Top, left: afterCharLeft },
        { focusAffinity: "after" }
      );
      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc,
        wire,
        fromWire: afterFirstLowerD,
        goalColumn,
        probeTargetWire: midLast,
        samples,
        expectMinVisualRows: 3,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expectCaretParity(host.editor, host.root, midLast, "up sticky at after-glyph", {
          expect: "after",
        });
      } finally {
        probe.restore();
        restoreAfter();
        restoreOnChar();
      }
    });
  });

  describe("vertical — wire newline cross wide column via DOM probe", () => {
    const agent = AGENT_A;
    const row0Top = 141.1;
    const row1Top = 177.49;
    const goalColumn = 612;
    const visualRowStart = 347.5;

    function wireNewlineWideColumnWire() {
      return `pre @${agent} x @${agent} post @${agent} @${agent} \nlower @${agent} `;
    }

    function wireNewlineWideColumnSamples(wire: string) {
      const doc = wireToDoc(wire);
      const lowerLineStart = wire.indexOf("\n") + 1;
      const row0EndBeforeBreak = lowerLineStart - 1;
      const secondMentionStart = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 });
      return [
        { wire: 0, top: row0Top, left: visualRowStart },
        { wire: 4, top: row0Top, left: 374.73 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 2, nodeOffset: 1 }),
          top: row0Top,
          left: 491.89,
        },
        { wire: secondMentionStart, top: row0Top, left: 507.67 },
        { wire: row0EndBeforeBreak, top: row0Top, left: 624.82 },
        { wire: lowerLineStart, top: row1Top, left: visualRowStart },
        { wire: wire.length - 1, top: row1Top, left: goalColumn },
        { wire: wire.length, top: row1Top, left: goalColumn },
      ];
    }

    beforeEach(() => {
      host.root.style.width = "310px";
      Object.defineProperty(host.root, "clientWidth", { configurable: true, value: 310 });
    });

    it("up from lower eof wide goal lands upper row end not mention interior", () => {
      const wire = wireNewlineWideColumnWire();
      const doc = wireToDoc(wire);
      const lowerEof = wire.length - 1;
      const row0EndBeforeBreak = wire.indexOf("\n");
      host.editor.setDocFromWire(wire, lowerEof, { resetHistory: true });
      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire,
        fromWire: lowerEof,
        goalColumn,
        probeTargetWire: row0EndBeforeBreak,
        samples: wireNewlineWideColumnSamples(wire),
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor()).toBe(row0EndBeforeBreak);
        expect(host.editor.getCursor()).not.toBe(62);
        expectCaretParity(
          host.editor,
          host.root,
          row0EndBeforeBreak,
          "wire newline up DOM column probe"
        );
      } finally {
        probe.restore();
      }
    });
  });

  describe("vertical — shift-enter lower line DOM column probe", () => {
    const agent = AGENT_A;
    const wire = `pre @${agent} x @${agent} \nseg`;
    const doc = wireToDoc(wire);
    const lowerLineStart = wire.indexOf("\n") + 1;
    const lowerInterior = lowerLineStart + 1;
    const row0Top = 141.1;
    const row1Top = 158.86;

    function shiftEnterLowerSamples() {
      return [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 4, top: row0Top, left: 367.23 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 484.39,
        },
        { wire: lowerLineStart - 1, top: row0Top, left: 609.68 },
        { wire: wire.length, top: row1Top, left: 362.67 },
      ];
    }

    beforeEach(() => {
      host.root.style.width = "310px";
      Object.defineProperty(host.root, "clientWidth", { configurable: true, value: 310 });
    });

    it("DOM probe preserves column up from shift-enter lower interior", () => {
      const goalColumn = 362.67;
      host.editor.setDocFromWire(wire, lowerInterior, { resetHistory: true });
      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: lowerInterior,
        goalColumn,
        probeTargetWire: 1,
        samples: shiftEnterLowerSamples(),
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor()).toBe(1);
        expectCaretParity(host.editor, host.root, 1, "shift-enter column up");
      } finally {
        probe.restore();
      }
    });

    it("DOM probe preserves column down from upper prefix to lower interior", () => {
      const goalColumn = 346.8075;
      host.editor.setDocFromWire(wire, 1, { resetHistory: true });
      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: 1,
        goalColumn,
        probeTargetWire: lowerInterior,
        samples: shiftEnterLowerSamples(),
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
        expect(host.editor.getCursor()).toBe(lowerInterior);
        expectCaretParity(host.editor, host.root, lowerInterior, "shift-enter column down");
      } finally {
        probe.restore();
      }
    });
  });

  describe("vertical — embedded substantive lower wire line column", () => {
    const agent = AGENT_A;
    const wire = `he @${agent} x @${agent} \nseg`;
    const doc = wireToDoc(wire);
    const lowerLineStart = wire.indexOf("\n") + 1;
    const lowerInterior = lowerLineStart + 1;
    const lowerPastEnd = wire.length;
    const row0Top = 141.1;
    const row1Top = 158.86;
    const secondMentionStart = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 });
    const row0EndAfterSpacer = lowerLineStart - 1;

    function lowerLineSamples() {
      return [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 3, top: row0Top, left: 359.58 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 492.52,
        },
        { wire: row0EndAfterSpacer, top: row0Top, left: 609.68 },
        { wire: lowerPastEnd, top: row1Top, left: 370.02 },
      ];
    }

    beforeEach(() => {
      host.root.style.width = "310px";
      Object.defineProperty(host.root, "clientWidth", { configurable: true, value: 310 });
    });

    it("DOM probe preserves column on embedded lower line, not mention band", () => {
      const goalColumn = 370.02;
      const targetWire = 3;
      host.editor.setDocFromWire(wire, lowerInterior, { resetHistory: true });
      const probe = prepareVerticalColumnProbe({
        root: host.root,
        doc: host.editor.getDoc(),
        wire: host.editor.getWire(),
        fromWire: lowerInterior,
        goalColumn,
        probeTargetWire: targetWire,
        samples: lowerLineSamples(),
        expectMinVisualRows: 2,
      });
      try {
        expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
        expect(host.editor.getCursor()).toBeLessThan(secondMentionStart);
        expect(host.editor.getCursor()).not.toBe(row0EndAfterSpacer);
        expectCaretParity(
          host.editor,
          host.root,
          host.editor.getCursor(),
          "embedded lower column up"
        );
      } finally {
        probe.restore();
      }
    });
  });

  describe("vertical — interchanged embedded blank band groups", () => {
    const agent = AGENT_A;

    function complexMultiBandWire() {
      return `header @${agent} \n\n\nmiddle\n\n\ntail @${agent} suffix`;
    }

    function complexMultiBandLandmarks(wire: string) {
      const doc = wireToDoc(wire);
      const groups = listEmbeddedBlankBandGroups(doc);
      const middleStart = wire.indexOf("middle");
      const middleEnd = middleStart + "middle".length;
      const tailStart = wire.indexOf("tail");
      const suffixEnd = wire.length - 1;
      const stops = blankNavStops(doc);
      return {
        doc,
        groups,
        middleStart,
        suffixEnd,
        upperBandStops: stops.filter((stop) => stop < middleStart),
        lowerBandStops: stops.filter((stop) => stop > middleEnd && stop < tailStart),
      };
    }

    it("splits two blank band groups on mention composite wire", () => {
      const { groups } = complexMultiBandLandmarks(complexMultiBandWire());
      expect(groups.length).toBe(2);
      expect(groups[0]!.probes.length).toBeGreaterThanOrEqual(2);
      expect(groups[1]!.probes.length).toBeGreaterThanOrEqual(2);
    });

    it("up from suffix tail steps through lower band then middle row", () => {
      const wire = complexMultiBandWire();
      const { doc, middleStart, suffixEnd, lowerBandStops, upperBandStops } =
        complexMultiBandLandmarks(wire);
      host.editor.setDocFromWire(wire, suffixEnd, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(lowerBandStops.at(-1)!);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(lowerBandStops.at(-2)!);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(middleStart);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(upperBandStops.at(-1)!);
      expect(blankNavStops(doc).includes(host.editor.getCursor())).toBe(true);
    });

    it("up from lower band first stop lands middle row not upper band", () => {
      const wire = complexMultiBandWire();
      const { middleStart, lowerBandStops } = complexMultiBandLandmarks(wire);
      host.editor.setDocFromWire(wire, lowerBandStops[0]!, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(middleStart);
      expectCaretParity(host.editor, host.root, middleStart, "lower band exit to middle");
    });

    it("down from header enters upper band first stop then round-trips", () => {
      const wire = complexMultiBandWire();
      const { upperBandStops } = complexMultiBandLandmarks(wire);
      const upperFirstStop = upperBandStops[0]!;
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(upperFirstStop);
      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(0);
      expectCaretParity(host.editor, host.root, 0, "upper blank round-trip to header");
    });
  });

  describe("vertical — post-blank-band substantive wire lines", () => {
    const wire = `prefix @${AGENT_A} @${AGENT_A} \n\n middle\nlower `;

    function sessionLandmarks() {
      const doc = wireToDoc(wire);
      const stops = blankNavStops(doc);
      const middleLineStart = wire.indexOf(" middle");
      const lowerLineStart = wire.indexOf("\n", middleLineStart) + 1;
      return { stops, middleLineStart, lowerLineStart, eof: wire.length - 1 };
    }

    it("up from bottom row hits middle content row before blank band", () => {
      const { stops, middleLineStart, eof } = sessionLandmarks();
      host.editor.setDocFromWire(wire, eof, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(middleLineStart);
      expect(host.editor.getCursor()).not.toBe(stops[0]);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(stops.at(-1));
    });

    it("down from middle row crosses to lower content row", () => {
      const { middleLineStart, lowerLineStart } = sessionLandmarks();
      host.editor.setDocFromWire(wire, middleLineStart, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);

      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expect(host.editor.getCursor()).toBe(lowerLineStart);
    });

    it("up from middle row enters blank band above", () => {
      const { stops, middleLineStart } = sessionLandmarks();
      host.editor.setDocFromWire(wire, middleLineStart, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(stops.at(-1));
    });
  });

  describe("vertical — stacked blank rows round-trip", () => {
    const wire = "header\n\n";

    it("up and down visit each blank row separately", () => {
      const doc = wireToDoc(wire);
      const stops = blankNavStops(doc);
      expect(stops).toEqual([7, 8]);
      const upperBlank = stops[0]!;
      const lowerBlank = stops[1]!;

      host.editor.setDocFromWire(wire, lowerBlank, { resetHistory: true });
      seedMonotonicMeasuredLayout(host.root, wire);

      expect(pressArrow(host.editor, "vertical", -1)).toBe(true);
      expect(host.editor.getCursor()).toBe(upperBlank);
      expect(pressArrow(host.editor, "vertical", 1)).toBe(true);
      expectCaretParity(host.editor, host.root, lowerBlank, "stacked blank round-trip");
    });
  });

  describe("click ingress — prefix edit after intentional click", () => {
    const wire = `prefix @${AGENT_A} @${AGENT_A} \n\n lower `;

    function pressBackspace(): boolean {
      return host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
      );
    }

    it("backspace nibbles prefix after click at prefix end", () => {
      const prefixEnd = "prefix".length;
      host.editor.setDocFromWire(wire, 0, { resetHistory: true });
      setSelectionAtWire(host.root, host.editor.getDoc(), prefixEnd, prefixEnd);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(prefixEnd);

      expect(pressBackspace()).toBe(true);
      expect(host.editor.getWire()).toBe(`prefi @${AGENT_A} @${AGENT_A} \n\n lower `);
      expectCaretParity(host.editor, host.root, prefixEnd - 1, "prefix nibble");
    });
  });
});
