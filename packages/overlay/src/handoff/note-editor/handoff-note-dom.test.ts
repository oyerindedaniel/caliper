import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  applyDocInsertText,
  blankVisualLineStartOpenedByProbe,
  collapsedSelection,
  collapsedSelectionWithIntent,
  docPosToWireOffset,
  docToWire,
  describeHandoffNoteCursorContext,
  isEmbeddedBlankBandCollapseProbeWire,
  isEmbeddedBlankBandProbeWire,
  listEmbeddedBlankBandProbeWires,
  listBlankVisualLineStartWires,
  normalizeHandoffNoteDoc,
  wireOffsetToDocPos,
  wireToDoc,
  type HandoffNoteDoc,
} from "@caliper/core";
import {
  docOffsetFromContentTextNodeDomPoint,
  domOffsetForContentRowEndInSplitText,
  domPointToDocPos,
  isContentTextNodeDomTailBeforeBreak,
  resolveDomPointAtDocPos,
  resolveDomReadDocPos,
  resolvePaintDocPos,
  resolvePaintContext,
  resolvePaintContextAtWire,
  resolvePaintHorizontalArrowMove,
  describeCaretContext,
} from "./handoff-note-dom-points.js";
import {
  HANDOFF_LINE_PAD_ATTR,
  HANDOFF_BLANK_ANCHOR_ATTR,
  HANDOFF_WIRE_BREAK_ATTR,
  parseHandoffNoteDom,
  parseHandoffNoteDomToDoc,
  renderHandoffNoteDoc,
  renderedDomChildCount,
  tryPatchDocDom,
  isHandoffMentionElement,
  isHandoffBlankAnchorElement,
  isHandoffLinePadElement,
  isHandoffLineStartAnchorElement,
  isHandoffWireBreakElement,
  sameRenderedDocStructure,
  getHandoffNoteEditorTabStops,
} from "./handoff-note-dom.js";
import { readDocSelection, setDocSelection } from "./handoff-note-selection.js";
import {
  mountThreeRowMentionSoftWrapFixture,
  applyThreeRowSpacerBrowserParityLayoutStubs,
  stubHandoffNoteMentionLayoutCoords,
  seedMonotonicMeasuredLayout,
  readDomWireCursor,
  mountMultiMentionSoftWrapFixture,
  setSelectionAtWire,
  dispatchSelectionChange,
} from "./handoff-note-test-helpers.js";
import { applyDocDeleteWithWireLineSeats as applyDocDelete } from "@caliper/core/handoff-note-test";
import { invalidateHandoffNoteLayoutCache } from "./handoff-note-layout-map.js";
import { createHandoffNoteEditor, type HandoffNoteEditor } from "./create-handoff-note-editor.js";

function createEditorRoot(): HTMLDivElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

describe("handoff-note-dom", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = createEditorRoot();
  });

  it("renders and parses plain text", () => {
    const doc = wireToDoc("hello");
    renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
    expect(parseHandoffNoteDom(root)).toBe("hello");
    expect(root.childNodes).toHaveLength(1);
    expect(root.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  });

  it("renders mention pills as non-editable atoms", () => {
    const doc = wireToDoc("Hi @caliper-abc123 there");
    renderHandoffNoteDoc(root, doc, {
      colorByAgentId: new Map([["caliper-abc123", "#f00"]]),
    });
    const pill = root.querySelector("span[data-handoff-mention]");
    expect(pill).not.toBeNull();
    expect(isHandoffMentionElement(pill!)).toBe(true);
    expect(pill?.getAttribute("contenteditable")).toBe("false");
    expect(pill?.textContent).toBe("caliper-abc123");
    expect(parseHandoffNoteDom(root)).toBe("Hi @caliper-abc123 there");
  });

  it("round-trips adjacent mentions with a canonical separator", () => {
    const wire = "@caliper-a@caliper-b";
    const canonical = "@caliper-a @caliper-b";
    renderHandoffNoteDoc(root, wireToDoc(wire), {
      colorByAgentId: new Map([
        ["caliper-a", "#1"],
        ["caliper-b", "#2"],
      ]),
    });
    expect(parseHandoffNoteDom(root)).toBe(canonical);
    expect(normalizeHandoffNoteDoc(parseHandoffNoteDomToDoc(root))).toEqual(wireToDoc(wire));
  });

  it("parses text after a mention without absorbing it into the agent id", () => {
    const agentId = "caliper-aaaaaaa";
    renderHandoffNoteDoc(
      root,
      {
        nodes: [
          { type: "text", text: "pre1 " },
          { type: "mention", agentId },
          { type: "text", text: "pre2 @ " },
        ],
      },
      { colorByAgentId: new Map([[agentId, "#f00"]]) }
    );

    expect(parseHandoffNoteDom(root)).toBe(`pre1 @${agentId}pre2 @ `);
    expect(parseHandoffNoteDomToDoc(root)).toEqual({
      nodes: [
        { type: "text", text: "pre1 " },
        { type: "mention", agentId },
        { type: "text", text: "pre2 @ " },
      ],
    });
  });

  it("ignores invalid @ patterns in plain text", () => {
    const wire = "email@example.com";
    renderHandoffNoteDoc(root, wireToDoc(wire), { colorByAgentId: new Map() });
    expect(root.querySelector("[data-handoff-mention]")).toBeNull();
    expect(parseHandoffNoteDom(root)).toBe(wire);
  });

  it("reconciles fragmented DOM via parse normalize and trustDoc render (compositionEnd path)", () => {
    const agentId = "caliper-abc123";
    const domDoc = {
      nodes: [
        { type: "text" as const, text: "hhshhs " },
        { type: "text" as const, text: "\n\n\n\n\n" },
        { type: "mention" as const, agentId },
        { type: "text" as const, text: " " },
      ],
    };
    renderHandoffNoteDoc(root, domDoc, {
      colorByAgentId: new Map([[agentId, "#f00"]]),
    });
    const authorityDoc = normalizeHandoffNoteDoc(domDoc);
    const firstText = root.firstChild as Text;
    const newline = document.createTextNode("\n");
    root.insertBefore(newline, firstText.nextSibling);
    root.insertBefore(document.createTextNode("\n"), newline.nextSibling);
    setSelectionAtWire(root, authorityDoc, 12, 12);

    const colors = new Map([[agentId, "#f00"]]);
    const parsed = normalizeHandoffNoteDoc(parseHandoffNoteDomToDoc(root));
    const outcome = renderHandoffNoteDoc(
      root,
      parsed,
      { colorByAgentId: colors },
      {
        trustDoc: true,
        previousDoc: authorityDoc,
      }
    );
    expect(outcome).toEqual({ domReplaced: true, docChanged: true });
    expect(
      (root.querySelector("span[data-handoff-mention]") as HTMLSpanElement).style.getPropertyValue(
        "--caliper-handoff-pill-color"
      )
    ).toBe("#f00");
    const normalizedDoc = wireToDoc(parseHandoffNoteDom(root));
    expect(root.childNodes.length).toBe(renderedDomChildCount(normalizedDoc));
    // Blank caret identity is the empty line-start stop (not a probe wire). Round-trip a stop.
    const blankStops = listBlankVisualLineStartWires(normalizedDoc);
    expect(blankStops.length).toBeGreaterThan(0);
    const stop = blankStops[Math.floor(blankStops.length / 2)]!;
    setSelectionAtWire(root, normalizedDoc, stop, stop);
    expect(readDomWireCursor(root, normalizedDoc)).toBe(stop);
  });

  it("renders mention pills as keyboard-focusable buttons", () => {
    const agentId = "caliper-abc123";
    const doc = wireToDoc(`hi @${agentId} there`);
    renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[agentId, "#f00"]]) });
    const pill = root.querySelector<HTMLSpanElement>("span[data-handoff-mention]")!;
    expect(pill.tabIndex).toBe(0);
    expect(pill.getAttribute("role")).toBe("button");
    expect(pill.getAttribute("aria-label")).toBe(`Mention ${agentId}`);
    expect(getHandoffNoteEditorTabStops(root)).toEqual([root, pill]);
  });

  it("orders tab stops editor-first then pills in document order", () => {
    const agent = "caliper-abc123";
    const doc = wireToDoc(`a @${agent} b @${agent} c`);
    renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[agent, "#f00"]]) });
    const pills = [...root.querySelectorAll<HTMLSpanElement>("span[data-handoff-mention]")];
    expect(getHandoffNoteEditorTabStops(root)).toEqual([root, ...pills]);
  });

  it("updates highlight class without rebuilding DOM when wire unchanged", () => {
    const doc = wireToDoc("@caliper-abc123");
    const colors = new Map([["caliper-abc123", "#f00"]]);
    renderHandoffNoteDoc(root, doc, { colorByAgentId: colors });
    const pill = root.querySelector("span[data-handoff-mention]")!;
    const first = pill.className;
    renderHandoffNoteDoc(root, doc, {
      colorByAgentId: colors,
      selectedMentionNodeIndex: 0,
    });
    expect(pill.className).not.toBe(first);
    expect(pill.className).toContain("handoff-mention-pill-highlighted");
  });

  it("patches text in place when rendered structure is unchanged", () => {
    const prevDoc = wireToDoc("hello");
    renderHandoffNoteDoc(root, prevDoc, { colorByAgentId: new Map() });
    const textNode = root.firstChild as Text;
    const nextDoc = wireToDoc("hello!");
    const outcome = renderHandoffNoteDoc(
      root,
      nextDoc,
      { colorByAgentId: new Map() },
      { trustDoc: true, previousDoc: prevDoc }
    );
    expect(outcome).toEqual({ domReplaced: false, docChanged: true });
    expect(root.childNodes).toHaveLength(1);
    expect(textNode).toBe(root.firstChild);
    expect(textNode.textContent).toBe("hello!");
    expect(parseHandoffNoteDom(root)).toBe("hello!");
  });

  it("full rebuilds when mention structure changes", () => {
    const agentId = "caliper-abc123";
    const prevDoc = wireToDoc("hi");
    renderHandoffNoteDoc(root, prevDoc, { colorByAgentId: new Map([[agentId, "#f00"]]) });
    const prevFirstChild = root.firstChild;
    const nextDoc = wireToDoc(`hi @${agentId}`);
    const outcome = renderHandoffNoteDoc(
      root,
      nextDoc,
      { colorByAgentId: new Map([[agentId, "#f00"]]) },
      { trustDoc: true, previousDoc: prevDoc }
    );
    expect(outcome).toEqual({ domReplaced: true, docChanged: true });
    expect(root.childNodes.length).toBeGreaterThan(1);
    expect(root.querySelector("[data-handoff-mention]")).not.toBeNull();
    expect(prevFirstChild).not.toBe(root.firstChild);
  });

  it("tryPatchDocDom returns false when child count mismatches", () => {
    const prevDoc = wireToDoc("ab");
    renderHandoffNoteDoc(root, prevDoc, { colorByAgentId: new Map() });
    const nextDoc = wireToDoc("abc");
    expect(tryPatchDocDom(root, prevDoc, nextDoc, { colorByAgentId: new Map() })).toBe(true);
    root.appendChild(document.createTextNode("extra"));
    expect(tryPatchDocDom(root, prevDoc, nextDoc, { colorByAgentId: new Map() })).toBe(false);
  });

  it("tryPatchDocDom fails when a text slot is not a text node", () => {
    const prevDoc = wireToDoc("ab");
    const nextDoc = wireToDoc("abc");
    renderHandoffNoteDoc(root, prevDoc, { colorByAgentId: new Map() });
    const span = document.createElement("span");
    span.textContent = "ab";
    root.replaceChild(span, root.firstChild!);
    expect(tryPatchDocDom(root, prevDoc, nextDoc, { colorByAgentId: new Map() })).toBe(false);
  });

  it("tryPatchDocDom fails when mention agentId in DOM does not match doc", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const doc = wireToDoc(`@${agentA}`);
    renderHandoffNoteDoc(root, doc, {
      colorByAgentId: new Map([
        [agentA, "#f00"],
        [agentB, "#0f0"],
      ]),
    });
    const pill = root.querySelector("span[data-handoff-mention]") as HTMLSpanElement;
    pill.setAttribute("data-agent-id", agentB);
    expect(tryPatchDocDom(root, doc, doc, { colorByAgentId: new Map([[agentA, "#f00"]]) })).toBe(
      false
    );
  });

  it("sameRenderedDocStructure rejects coalesced text node count changes", () => {
    const prevDoc = {
      nodes: [
        { type: "text" as const, text: "ab" },
        { type: "text" as const, text: "cd" },
      ],
    };
    const nextDoc = wireToDoc("abcd");
    expect(sameRenderedDocStructure(prevDoc, nextDoc)).toBe(false);
  });

  it("trustDoc full rebuilds when a stray element breaks domReady", () => {
    const prevDoc = wireToDoc("hi");
    renderHandoffNoteDoc(root, prevDoc, { colorByAgentId: new Map() });
    const textNode = root.firstChild;
    const nextDoc = wireToDoc("hi!");
    root.appendChild(document.createElement("div"));
    const outcome = renderHandoffNoteDoc(
      root,
      nextDoc,
      { colorByAgentId: new Map() },
      { trustDoc: true, previousDoc: prevDoc }
    );
    expect(outcome).toEqual({ domReplaced: true, docChanged: true });
    expect(root.childNodes.length).toBe(1);
    expect(root.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(root.firstChild).not.toBe(textNode);
    expect(parseHandoffNoteDom(root)).toBe("hi!");
  });

  it("patches trailing text in text-mention-text docs without rebuilding", () => {
    const agentId = "caliper-abc123";
    const prevDoc = wireToDoc(`Hi @${agentId} there`);
    renderHandoffNoteDoc(root, prevDoc, {
      colorByAgentId: new Map([[agentId, "#f00"]]),
    });
    const leadingText = root.firstChild as Text;
    const pill = root.querySelector("span[data-handoff-mention]")!;
    const trailingText = root.lastChild as Text;
    const nextDoc = wireToDoc(`Hi @${agentId} there!`);
    const outcome = renderHandoffNoteDoc(
      root,
      nextDoc,
      { colorByAgentId: new Map([[agentId, "#f00"]]) },
      { trustDoc: true, previousDoc: prevDoc }
    );
    expect(outcome).toEqual({ domReplaced: false, docChanged: true });
    expect(root.childNodes).toHaveLength(3);
    expect(leadingText).toBe(root.firstChild);
    expect(pill).toBe(root.childNodes[1]);
    expect(trailingText).toBe(root.lastChild);
    expect(trailingText.textContent).toBe(" there!");
    expect(parseHandoffNoteDom(root)).toBe(`Hi @${agentId} there!`);
  });

  it("undo-like restore full rebuilds when rendered structure changes", () => {
    const agentId = "caliper-abc123";
    const colors = new Map([[agentId, "#f00"]]);
    const plainDoc = wireToDoc("hello");
    const mentionDoc = wireToDoc(`hello @${agentId}`);

    renderHandoffNoteDoc(root, plainDoc, { colorByAgentId: colors });
    const plainTextNode = root.firstChild;

    const addMentionOutcome = renderHandoffNoteDoc(
      root,
      mentionDoc,
      { colorByAgentId: colors },
      {
        trustDoc: true,
        previousDoc: plainDoc,
      }
    );
    expect(addMentionOutcome).toEqual({ domReplaced: true, docChanged: true });
    expect(root.querySelector("[data-handoff-mention]")).not.toBeNull();

    const restoreOutcome = renderHandoffNoteDoc(
      root,
      plainDoc,
      { colorByAgentId: colors },
      {
        trustDoc: true,
        previousDoc: mentionDoc,
      }
    );
    expect(restoreOutcome).toEqual({ domReplaced: true, docChanged: true });
    expect(root.querySelector("[data-handoff-mention]")).toBeNull();
    expect(root.childNodes).toHaveLength(1);
    expect(root.firstChild).not.toBe(plainTextNode);
    expect(parseHandoffNoteDom(root)).toBe("hello");
  });

  describe("wire newline line box", () => {
    it("EOF wire newline renders bare last wire-break then layout-only line-pad (no blank-anchor before pad)", () => {
      const wire = "header \n";
      renderHandoffNoteDoc(root, wireToDoc(wire), { colorByAgentId: new Map() });
      expect(parseHandoffNoteDom(root)).toBe(wire);
      const wireBreak = root.querySelector(`br[${HANDOFF_WIRE_BREAK_ATTR}]`)!;
      const pad = root.querySelector(`br[${HANDOFF_LINE_PAD_ATTR}]`)!;
      expect(wireBreak).not.toBeNull();
      expect(pad).not.toBeNull();
      expect(wireBreak.nextSibling).toBe(pad);
      expect(root.querySelector(`span[${HANDOFF_BLANK_ANCHOR_ATTR}]`)).toBeNull();
    });

    it("mid-doc newline does not add line-pad before following text", () => {
      const wire = "header\ntail";
      renderHandoffNoteDoc(root, wireToDoc(wire), { colorByAgentId: new Map() });
      expect(parseHandoffNoteDom(root)).toBe(wire);
      expect(root.querySelectorAll(`br[${HANDOFF_WIRE_BREAK_ATTR}]`).length).toBe(1);
      expect(root.querySelector(`br[${HANDOFF_LINE_PAD_ATTR}]`)).toBeNull();
    });

    it("requesting past-end after EOF newline paints trailing line-pad (not prior probe)", () => {
      const wire = "header \n";
      const doc = wireToDoc(wire);
      const lastProbe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const eofStop = listBlankVisualLineStartWires(doc).find((stop) => stop === wire.length);
      expect(eofStop).toBe(wire.length);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      setSelectionAtWire(root, doc, wire.length);
      expect(root.querySelector(`br[${HANDOFF_LINE_PAD_ATTR}]`)).not.toBeNull();
      const selection = root.ownerDocument.getSelection()!;
      const range = selection.getRangeAt(0);
      expect(isHandoffLinePadElement(range.startContainer)).toBe(true);
      expect(isHandoffBlankAnchorElement(range.startContainer.parentNode)).toBe(false);
      expect(readDomWireCursor(root, doc)).toBe(wire.length);
      expect(readDomWireCursor(root, doc)).not.toBe(lastProbe);
    });

    it("last probe bare wire-break and trailing line-pad are distinct paint docks", () => {
      // One probe → one dock: emptied probes omit ba; last probe bare BR; EOF paints pad.
      const wire = "\n\n\n\n";
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      expect(stops).toEqual([0, 1, 2, 3, 4]);
      expect(probes).toEqual([0, 1, 2, 3]);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

      const lastProbe = probes[probes.length - 1]!;
      const eofStop = wire.length;
      const lastProbePoint = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, lastProbe));
      const eofPoint = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, eofStop));
      expect(lastProbePoint).not.toBeNull();
      expect(eofPoint).not.toBeNull();
      expect(isHandoffWireBreakElement(lastProbePoint!.node)).toBe(true);
      expect(isHandoffLinePadElement(eofPoint!.node)).toBe(true);
      expect(lastProbePoint!.node).not.toBe(eofPoint!.node);

      const pad = root.querySelector(`br[${HANDOFF_LINE_PAD_ATTR}]`)!;
      expect(root.querySelectorAll(`span[${HANDOFF_BLANK_ANCHOR_ATTR}]`)).toHaveLength(0);
      expect(lastProbePoint!.node.nextSibling).toBe(pad);

      for (const probe of probes) {
        const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, probe));
        expect(isHandoffWireBreakElement(point!.node)).toBe(true);
        expect(isHandoffBlankAnchorElement(point!.node.nextSibling)).toBe(false);
      }
    });

    it("orphan blank-anchor without preceding wire-break refuses EOF/BOF soft remap", () => {
      const doc = wireToDoc("hello");
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      const orphan = document.createElement("span");
      orphan.setAttribute(HANDOFF_BLANK_ANCHOR_ATTR, "true");
      orphan.appendChild(document.createTextNode("\u200b"));
      root.appendChild(orphan);
      const zwsp = orphan.firstChild!;
      expect(() => domPointToDocPos(root, doc, zwsp, 0)).toThrow(
        /blank-anchor without preceding wire-break/
      );
      expect(() => domPointToDocPos(root, doc, orphan, 0)).toThrow(
        /blank-anchor without preceding wire-break/
      );
    });

    it("orphan line-start-anchor without following atom refuses EOF/BOF soft remap", () => {
      const doc = wireToDoc("hello");
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      const orphan = document.createElement("span");
      orphan.setAttribute("data-handoff-line-start-anchor", "true");
      orphan.appendChild(document.createTextNode("\u200b"));
      root.appendChild(orphan);
      expect(() => domPointToDocPos(root, doc, orphan.firstChild!, 0)).toThrow(
        /line-start-anchor without following atom/
      );
    });
  });

  describe("embedded blank band wire-break caret", () => {
    const AGENT = "caliper-aaaaaaa";
    const suffixBlankBandWire = () => `header @${AGENT} \n\n\ntail @${AGENT} `;

    beforeEach(() => {
      invalidateHandoffNoteLayoutCache();
      Object.defineProperty(root, "clientWidth", { configurable: true, value: 480 });
    });

    afterEach(() => {
      invalidateHandoffNoteLayoutCache();
    });

    it("interior text offset resolves to a text node", () => {
      const doc = wireToDoc("hello");
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      const point = resolveDomPointAtDocPos(root, doc, { nodeIndex: 0, nodeOffset: 2 });
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
    });

    it("blank probe resolves to blank-band anchor text, not bare wire-break", () => {
      const wire = suffixBlankBandWire();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      expect(probes).toHaveLength(2);

      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      for (const probeWire of probes) {
        const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, probeWire));
        expect(point, `wire ${probeWire}`).not.toBeNull();
        expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
        expect(
          isHandoffBlankAnchorElement(point!.node.parentNode),
          `wire ${probeWire} should land in <span ${HANDOFF_BLANK_ANCHOR_ATTR}>`
        ).toBe(true);
        expect(point?.offset).toBe(0);
      }
    });

    it("prefix-only leading blank probes paint bare wire-break (emptied empty CRE)", () => {
      // Prefix-only / emptied empty CRE: empty row above → first-line bare BR, not blank ZWSP.
      for (const wire of [`\n`, `\n\n`, `\n\n\ntail`, `\n\ntail`]) {
        const doc = wireToDoc(wire);
        const probes = listEmbeddedBlankBandProbeWires(doc);
        if (probes.length === 0) {
          continue;
        }
        const focusWire = probes[0]!;

        renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

        const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, focusWire));
        expect(point, wire).not.toBeNull();
        expect(
          point?.node instanceof HTMLBRElement && isHandoffWireBreakElement(point!.node),
          wire
        ).toBe(true);
        expect(isHandoffBlankAnchorElement(point?.node.parentNode), wire).toBe(false);
        const roundTrip = domPointToDocPos(root, doc, point!.node, point!.offset);
        expect(docPosToWireOffset(doc, roundTrip)).toBe(focusWire);
      }
    });

    it("substantive sole-char row end before band paints wire-break not blank-band anchor", () => {
      const doc = wireToDoc("h\n\n\n");
      const rowEnd = wireOffsetToDocPos(doc, 1);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      const point = resolveDomPointAtDocPos(root, doc, rowEnd);
      expect(point?.node instanceof HTMLBRElement && isHandoffWireBreakElement(point!.node)).toBe(
        true
      );
      expect(isHandoffBlankAnchorElement(point?.node.parentNode)).toBe(false);
    });

    it("multi-char EOF blank probe before pad paints bare BR (pad owns trailing stop)", () => {
      // Pad-preceding probe is always bare — typing stop is the line-pad, not a ba sibling.
      const doc = wireToDoc("sh\n");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const focus = wireOffsetToDocPos(doc, probe);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      const point = resolveDomPointAtDocPos(root, doc, focus);
      expect(point?.node instanceof HTMLBRElement && isHandoffWireBreakElement(point!.node)).toBe(
        true
      );
      expect(isHandoffBlankAnchorElement(point?.node.parentNode)).toBe(false);
      expect(root.querySelector(`span[${HANDOFF_BLANK_ANCHOR_ATTR}]`)).toBeNull();
    });

    it("multi-char mid-doc blank probe emits and paints blank-anchor", () => {
      const doc = wireToDoc("sh\n\ntail");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const focus = wireOffsetToDocPos(doc, probe);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      const point = resolveDomPointAtDocPos(root, doc, focus);
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(isHandoffBlankAnchorElement(point?.node.parentNode)).toBe(true);
    });

    it("cleared content row end at interior probe paints blank-anchor seat", () => {
      const wire = `header \n\n\nmiddle\n\n\nd\n\n\nlower`;
      const doc = wireToDoc(wire);
      const dPos = wire.indexOf("\nd\n", wire.indexOf("middle")) + 1;
      expect(wire[dPos]).toBe("d");
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, dPos), "after"),
        "backspace"
      )!;
      expect(docToWire(chipped.doc)).toBe("header \n\n\nmiddle\n\n\n\n\n\nlower");
      const focusWire = docPosToWireOffset(chipped.doc, chipped.selection.focus);
      expect(
        isEmbeddedBlankBandCollapseProbeWire(chipped.doc, focusWire, chipped.selection.focus)
      ).toBe(false);

      renderHandoffNoteDoc(root, chipped.doc, { colorByAgentId: new Map() });

      const point = resolveDomPointAtDocPos(root, chipped.doc, chipped.selection.focus);
      expect(point).not.toBeNull();
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(isHandoffBlankAnchorElement(point?.node.parentNode)).toBe(true);
      const roundTrip = domPointToDocPos(root, chipped.doc, point!.node, point!.offset);
      // Coincident focus parks on that stop's seat; probe-only opens the next stop.
      const expectedStop = listBlankVisualLineStartWires(chipped.doc).includes(focusWire)
        ? focusWire
        : blankVisualLineStartOpenedByProbe(chipped.doc, focusWire);
      expect(expectedStop).not.toBeNull();
      expect(docPosToWireOffset(chipped.doc, roundTrip)).toBe(expectedStop);
    });

    it("Delete leftover pad between fused bands paints blank-anchor seat; intent stays off delete-probe", () => {
      const wire = `upper @${AGENT} \n\n\n \n\n\nlower`;
      const doc = wireToDoc(wire);
      const padWire = wire.indexOf(" \n\n\nlower");
      expect(wire[padWire]).toBe(" ");
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, padWire), "before"),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe(`upper @${AGENT} \n\n\n\n\n\nlower`);
      const focusWire = docPosToWireOffset(cleared.doc, cleared.selection.focus);
      expect(
        isEmbeddedBlankBandCollapseProbeWire(cleared.doc, focusWire, cleared.selection.focus)
      ).toBe(false);

      renderHandoffNoteDoc(root, cleared.doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      const point = resolveDomPointAtDocPos(root, cleared.doc, cleared.selection.focus)!;
      expect(point.node.nodeType).toBe(Node.TEXT_NODE);
      expect(isHandoffBlankAnchorElement(point.node.parentNode)).toBe(true);
      const roundTripWire = docPosToWireOffset(
        cleared.doc,
        domPointToDocPos(root, cleared.doc, point.node, point.offset)
      );
      const expectedStop = listBlankVisualLineStartWires(cleared.doc).includes(focusWire)
        ? focusWire
        : blankVisualLineStartOpenedByProbe(cleared.doc, focusWire);
      expect(expectedStop).not.toBeNull();
      expect(roundTripWire).toBe(expectedStop);
    });

    it("Delete sole leftover space before band paints bare wire-break off delete-probe", () => {
      const doc = wireToDoc(" \n\nmd");
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0), "before"),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe("\n\nmd");
      const focusWire = docPosToWireOffset(cleared.doc, cleared.selection.focus);
      expect(
        isEmbeddedBlankBandCollapseProbeWire(cleared.doc, focusWire, cleared.selection.focus)
      ).toBe(false);

      renderHandoffNoteDoc(root, cleared.doc, { colorByAgentId: new Map() });
      const point = resolveDomPointAtDocPos(root, cleared.doc, cleared.selection.focus)!;
      expect(point.node instanceof HTMLBRElement && isHandoffWireBreakElement(point.node)).toBe(
        true
      );
      expect(isHandoffBlankAnchorElement(point.node.parentNode)).toBe(false);
    });

    it("sandwiched blank probe still resolves to blank-band anchor without chip provenance", () => {
      const wire = suffixBlankBandWire();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      for (const probeWire of probes) {
        const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, probeWire));
        expect(point, `wire ${probeWire}`).not.toBeNull();
        expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
        expect(isHandoffBlankAnchorElement(point!.node.parentNode)).toBe(true);
      }
    });

    it("blank stop before content paints blank-anchor seat (not bare content line-start BR)", () => {
      const wire = suffixBlankBandWire();
      const doc = wireToDoc(wire);
      const lineStartBeforeTail = wire.indexOf("tail") - 1;
      expect(listBlankVisualLineStartWires(doc)).toContain(lineStartBeforeTail);
      expect(isEmbeddedBlankBandProbeWire(doc, lineStartBeforeTail)).toBe(false);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      const point = resolveDomPointAtDocPos(
        root,
        doc,
        wireOffsetToDocPos(doc, lineStartBeforeTail)
      );
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(isHandoffBlankAnchorElement(point!.node.parentNode)).toBe(true);
    });

    it("mid-doc stacked empties: upper and lower blank stops paint distinct blank-anchor seats", () => {
      const fixture = "shhs\n\n\nsgs";
      const doc = wireToDoc(fixture);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      seedMonotonicMeasuredLayout(root, fixture, { baseTop: 100, stride: 36 });

      const [upper, lower] = listBlankVisualLineStartWires(doc);
      const upperPoint = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, upper!));
      const lowerPoint = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, lower!));
      expect(upperPoint).not.toBeNull();
      expect(lowerPoint).not.toBeNull();
      expect(isHandoffBlankAnchorElement(upperPoint!.node.parentNode)).toBe(true);
      expect(isHandoffBlankAnchorElement(lowerPoint!.node.parentNode)).toBe(true);
      expect(upperPoint!.node).not.toBe(lowerPoint!.node);
    });

    it("post sole-char chip leading empties: every blank stop paints its seat and reads back", () => {
      const wire = "\n\n\ntail";
      const doc = wireToDoc(wire);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      seedMonotonicMeasuredLayout(root, wire, { baseTop: 100, stride: 36 });

      const stops = listBlankVisualLineStartWires(doc);
      expect(stops).toEqual([0, 1, 2]);
      expect(listEmbeddedBlankBandProbeWires(doc)).toEqual([0, 1]);

      for (const stopWire of stops) {
        const focus = wireOffsetToDocPos(doc, stopWire);
        const paint = resolveDomPointAtDocPos(root, doc, focus);
        expect(paint, `stop ${stopWire} must paint`).not.toBeNull();
        const roundTrip = domPointToDocPos(root, doc, paint!.node, paint!.offset);
        expect(docPosToWireOffset(doc, roundTrip), `stop ${stopWire} read-back`).toBe(stopWire);
      }

      const paint0 = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, 0));
      expect(paint0?.node instanceof HTMLBRElement && isHandoffWireBreakElement(paint0.node)).toBe(
        true
      );
      const paint1 = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, 1));
      expect(isHandoffBlankAnchorElement(paint1?.node.parentNode)).toBe(true);
      const paint2 = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, 2));
      expect(isHandoffBlankAnchorElement(paint2?.node.parentNode)).toBe(true);
    });

    it("parse ignores blank-band anchor spans", () => {
      const wire = suffixBlankBandWire();
      const doc = wireToDoc(wire);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      expect(parseHandoffNoteDom(root)).toBe(wire);
    });

    it("blank-band anchor DOM point round-trips through domPointToDocPos", () => {
      const wire = suffixBlankBandWire();
      const doc = wireToDoc(wire);
      const probeWire = listEmbeddedBlankBandProbeWires(doc)[1]!;
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, probeWire));
      expect(point).not.toBeNull();
      const roundTrip = domPointToDocPos(root, doc, point!.node, point!.offset);
      expect(docPosToWireOffset(doc, roundTrip)).toBe(probeWire);
    });

    it("content text-node trailing edge maps to content row end not blank probe", () => {
      const wire = `hello\n\n\nlower `;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerEnd = probes[0]! - 1;
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

      const firstText = root.childNodes[0];
      expect(firstText?.nodeType).toBe(Node.TEXT_NODE);
      const pos = domPointToDocPos(root, doc, firstText!, firstText!.textContent!.length);
      expect(docPosToWireOffset(doc, pos)).toBe(headerEnd);
      expect(docPosToWireOffset(doc, pos)).not.toBe(probes[0]);
    });

    it("line-break text-node tail maps to row end not storage newline", () => {
      const wire = `line1\nline2`;
      const doc = wireToDoc(wire);
      expect(listEmbeddedBlankBandProbeWires(doc)).toHaveLength(0);
      const line1End = "line1".length - 1;
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

      const firstText = root.childNodes[0];
      expect(firstText?.textContent).toBe("line1");
      const pos = domPointToDocPos(root, doc, firstText!, firstText!.textContent!.length);
      expect(docPosToWireOffset(doc, pos)).toBe(line1End);
      expect(docPosToWireOffset(doc, pos)).not.toBe("line1".length);
    });

    it("mention-end boundary paints caret outside pill", () => {
      const wire = `header @${AGENT} `;
      const doc = wireToDoc(wire);
      const mentionEndWire = `header @${AGENT}`.length;
      const mentionEnd = wireOffsetToDocPos(doc, mentionEndWire);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

      const point = resolveDomPointAtDocPos(root, doc, mentionEnd);
      expect(point).not.toBeNull();
      const mentionEl = root.querySelector("[data-handoff-mention]");
      expect(mentionEl?.contains(point!.node) ?? false).toBe(false);

      const roundTrip = domPointToDocPos(root, doc, point!.node, point!.offset);
      expect(docPosToWireOffset(doc, roundTrip)).toBe(mentionEndWire);
      expect(describeHandoffNoteCursorContext(doc, mentionEndWire).kind).toBe("mention-boundary");
    });

    it("soft-wrap postfix alias and continuation paint distinct DOM offsets", () => {
      const fx = mountMultiMentionSoftWrapFixture();
      try {
        const posAlias = resolvePaintContextAtWire(fx.doc, fx.secondPostStart, {
          root: fx.root,
        }).focusPos;
        const posCont = resolvePaintContextAtWire(fx.doc, fx.continuationWire, {
          root: fx.root,
        }).focusPos;
        const paintAlias = resolveDomPointAtDocPos(fx.root, fx.doc, posAlias, { from: posAlias })!;
        const paintCont = resolveDomPointAtDocPos(fx.root, fx.doc, posCont, { from: posCont })!;

        expect(paintAlias.offset).toBe(0);
        expect(paintCont.offset).toBe(1);
        expect(paintAlias.node.nodeType).toBe(Node.TEXT_NODE);
        expect(paintAlias.node).toBe(paintCont.node);
        expect(
          docPosToWireOffset(
            fx.doc,
            domPointToDocPos(fx.root, fx.doc, paintAlias.node, paintAlias.offset)
          )
        ).toBe(fx.secondPostStart);
        expect(
          docPosToWireOffset(
            fx.doc,
            domPointToDocPos(fx.root, fx.doc, paintCont.node, paintCont.offset)
          )
        ).toBe(fx.continuationWire);
      } finally {
        fx.root.remove();
      }
    });

    it("mention-start boundary paints caret outside pill", () => {
      const wire = `header @${AGENT} tail`;
      const doc = wireToDoc(wire);
      const mentionIdx = doc.nodes.findIndex((node) => node.type === "mention");
      const mentionStart = { nodeIndex: mentionIdx, nodeOffset: 0 };
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

      const point = resolveDomPointAtDocPos(root, doc, mentionStart);
      expect(point).not.toBeNull();
      const mentionEl = root.querySelector("[data-handoff-mention]");
      expect(mentionEl?.contains(point!.node) ?? false).toBe(false);

      const roundTrip = domPointToDocPos(root, doc, point!.node, point!.offset);
      expect(docPosToWireOffset(doc, roundTrip)).toBe(wire.indexOf("@"));
      expect(describeHandoffNoteCursorContext(doc, wire.indexOf("@"))).toEqual(
        expect.objectContaining({ kind: "mention-boundary", edge: "start" })
      );
    });

    it("mention end round-trips through resolveDomPointAtDocPos before EOF blank band", () => {
      const wire = `header @${AGENT} tail\n\n\n`;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const mentionIdx = doc.nodes.findIndex((node) => node.type === "mention");
      const mentionLastInterior = {
        nodeIndex: mentionIdx,
        nodeOffset: 1 + AGENT.length - 1,
      };
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

      const point = resolveDomPointAtDocPos(root, doc, mentionLastInterior);
      const mention = root.querySelector("span[data-handoff-mention]");
      expect(point?.node).toBe(mention?.firstChild);
      expect(point?.offset).toBeGreaterThan(0);

      const roundTrip = domPointToDocPos(root, doc, point!.node, point!.offset);
      expect(docPosToWireOffset(doc, roundTrip)).toBe(docPosToWireOffset(doc, mentionLastInterior));
      expect(isEmbeddedBlankBandProbeWire(doc, docPosToWireOffset(doc, roundTrip))).toBe(false);
    });

    it("content row end round-trips through resolveDomPointAtDocPos at text-node tail", () => {
      const wire = `hello\n\n\nlower `;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerEnd = probes[0]! - 1;
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

      const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, headerEnd), {
        focusAffinity: "after",
      });
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(point?.offset).toBe("hello".length);
      const roundTrip = domPointToDocPos(root, doc, point!.node, point!.offset);
      expect(docPosToWireOffset(doc, roundTrip)).toBe(headerEnd);
    });

    it("sole-char row: content end paints text-tail; following non-probe break paints br", () => {
      const wire = `header @${AGENT} \n\nm\ntail @${AGENT} `;
      const doc = wireToDoc(wire);
      const charWire = wire.indexOf("m");
      const breakAfterM = charWire + 1;
      expect(wire[breakAfterM]).toBe("\n");
      expect(isEmbeddedBlankBandProbeWire(doc, breakAfterM)).toBe(false);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      const charFocus = wireOffsetToDocPos(doc, charWire);
      const charPoint = resolveDomPointAtDocPos(root, doc, charFocus, {
        from: charFocus,
        focusAffinity: "after",
      });
      expect(charPoint).not.toBeNull();
      expect(charPoint!.node.nodeType).toBe(Node.TEXT_NODE);
      expect(charPoint!.node.textContent).toContain("m");
      expect(charPoint!.offset).toBe(1);

      const breakFocus = wireOffsetToDocPos(doc, breakAfterM);
      const breakPoint = resolveDomPointAtDocPos(root, doc, breakFocus, { from: breakFocus });
      expect(breakPoint).not.toBeNull();
      expect(
        breakPoint!.node instanceof HTMLBRElement && isHandoffWireBreakElement(breakPoint!.node)
      ).toBe(true);
    });

    it("substantive non-probe line break paints br (layout geom owner)", () => {
      const wire = `top\n${"hello world ".repeat(10)}tail`;
      const doc = wireToDoc(wire);
      const breakWire = wire.indexOf("\n");
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, breakWire));
      expect(point?.node instanceof HTMLBRElement && isHandoffWireBreakElement(point!.node)).toBe(
        true
      );
    });

    it("glued postfix substantive chip paints off blank-band anchor at mention-end alias", () => {
      const wire = `note @${AGENT}T\n\n\n`;
      const doc = wireToDoc(wire);
      // Blank-row unit: chip glued postfix from the content caret on T, not from the probe.
      const postfixWire = wire.search(/[A-Za-z]\n/);
      expect(postfixWire).toBeGreaterThanOrEqual(0);
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, postfixWire), "after"),
        "backspace"
      )!;
      expect(docToWire(chipped.doc)).toBe(`note @${AGENT}\n\n\n`);

      renderHandoffNoteDoc(root, chipped.doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      const focus = chipped.selection.focus;
      const paint = resolvePaintContext(chipped.doc, focus);
      // Blank-band abut: paint stays atomic end (not post-text) so DOM stays off blank anchor.
      expect(chipped.doc.nodes[paint.focusPos.nodeIndex]?.type).not.toBe("text");
      expect(paint.paintPos).toEqual(focus);
      const point = resolveDomPointAtDocPos(root, chipped.doc, paint.paintPos);
      expect(point).not.toBeNull();
      expect(isHandoffBlankAnchorElement(point?.node.parentNode)).toBe(false);
      const roundTrip = domPointToDocPos(root, chipped.doc, point!.node, point!.offset);
      expect(roundTrip).toEqual(focus);
      expect(
        isEmbeddedBlankBandCollapseProbeWire(
          chipped.doc,
          docPosToWireOffset(chipped.doc, roundTrip),
          roundTrip
        )
      ).toBe(false);
    });

    it("atomic end without blank-band abut paints post-atomic text at shared wire", () => {
      const fx = mountMultiMentionSoftWrapFixture();
      try {
        const mentionNodes = fx.doc.nodes
          .map((node, i) => (node.type === "mention" ? i : -1))
          .filter((i) => i >= 0);
        const atomicEnd = {
          nodeIndex: mentionNodes[1]!,
          nodeOffset: 1 + fx.agent.length,
        };
        const paint = resolvePaintContext(fx.doc, atomicEnd, { root: fx.root });
        expect(fx.doc.nodes[paint.focusPos.nodeIndex]?.type).not.toBe("text");
        expect(fx.doc.nodes[paint.paintPos.nodeIndex]?.type).toBe("text");
        expect(docPosToWireOffset(fx.doc, paint.paintPos)).toBe(
          docPosToWireOffset(fx.doc, atomicEnd)
        );
        expect(paint.paintPos).toEqual({ nodeIndex: atomicEnd.nodeIndex + 1, nodeOffset: 0 });
      } finally {
        fx.root.remove();
      }
    });

    it("postfix chip whitespace tail paints on spacer text not mention-edge alias", () => {
      const chipped = wireToDoc(`header @${AGENT} \n\n\n`);
      const probes = listEmbeddedBlankBandProbeWires(chipped);
      const rowEnd = probes[0]! - 1;
      const focus = wireOffsetToDocPos(chipped, rowEnd);

      renderHandoffNoteDoc(root, chipped, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      const point = resolveDomPointAtDocPos(root, chipped, focus, { focusAffinity: "after" });
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(point?.node.textContent?.[0]).toBe(" ");
      // Content row end of sole postfix spacer: text-tail (insertion point), still on spacer text.
      expect(point?.offset).toBe(1);
      expect(
        docPosToWireOffset(chipped, domPointToDocPos(root, chipped, point!.node, point!.offset))
      ).toBe(rowEnd);
      expect(describeHandoffNoteCursorContext(chipped, rowEnd).kind).toBe("mention-boundary");
      const mentionEl = root.querySelector("[data-handoff-mention]");
      expect(mentionEl?.contains(point!.node) ?? false).toBe(false);
    });

    it("plain leading whitespace paints at matching doc offset", () => {
      const doc = wireToDoc(" hello");
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

      const pos0 = wireOffsetToDocPos(doc, 0);
      const point = resolveDomPointAtDocPos(root, doc, pos0);
      expect(point?.offset).toBe(0);
      expect(describeHandoffNoteCursorContext(doc, 0).kind).toBe("text");

      const roundTrip = domPointToDocPos(root, doc, point!.node, point!.offset);
      expect(docPosToWireOffset(doc, roundTrip)).toBe(0);

      const point1 = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, 1))!;
      expect(point1.offset).toBe(1);
      expect(docPosToWireOffset(doc, domPointToDocPos(root, doc, point1.node, point1.offset))).toBe(
        1
      );
    });

    it("sandwiched row mention gate paints text tail not pill start after spacer forward delete", () => {
      const wire = `header @${AGENT} row\n\n @${AGENT} \nlower`;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      let rowStart = probes[0]! + 1;
      while (wire[rowStart] === "\n") {
        rowStart += 1;
      }
      const mentionAt = wire.indexOf("@", rowStart);
      const spaceWire = wire.lastIndexOf(" ", mentionAt);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spaceWire)),
        "delete"
      )!;
      renderHandoffNoteDoc(root, cleared.doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      const point = resolveDomPointAtDocPos(root, cleared.doc, cleared.selection.focus);
      expect(cleared.doc.nodes[cleared.selection.focus.nodeIndex]?.type).toBe("text");
      // Row-start mention after wire-break: ZWSP line-start anchor (selection-capable), not BR/root.
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(point?.node).not.toBeInstanceOf(HTMLBRElement);
      expect(isHandoffLineStartAnchorElement(point?.node.parentNode)).toBe(true);
      expect(
        docPosToWireOffset(
          cleared.doc,
          domPointToDocPos(root, cleared.doc, point!.node, point!.offset)
        )
      ).toBe(spaceWire);
      expect(isEmbeddedBlankBandProbeWire(cleared.doc, spaceWire)).toBe(false);
      expect(describeHandoffNoteCursorContext(cleared.doc, spaceWire).kind).toBe(
        "mention-boundary"
      );
    });

    it("forward delete last spacer before row-start mention paints line-start anchor not wire-break", () => {
      const wire = `webp\n\nwwth @${AGENT} \nlower`;
      let doc = wireToDoc(wire);
      let selection = collapsedSelection(wireOffsetToDocPos(doc, wire.indexOf("\n\n") + 2));
      for (const ch of ["w", "w", "t", "h", " "]) {
        const next = applyDocDelete(doc, selection, "delete")!;
        doc = next.doc;
        selection = next.selection;
      }
      expect(docToWire(doc)).toBe(`webp\n\n@${AGENT} \nlower`);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      const focus = selection.focus;
      const point = resolveDomPointAtDocPos(root, doc, focus, { from: focus })!;
      expect(point.node.nodeType).toBe(Node.TEXT_NODE);
      expect(point.node instanceof HTMLBRElement).toBe(false);
      expect(isHandoffLineStartAnchorElement(point.node.parentNode)).toBe(true);
      expect(docPosToWireOffset(doc, domPointToDocPos(root, doc, point.node, point.offset))).toBe(
        docPosToWireOffset(doc, focus)
      );
    });

    it("forward delete row-start mention paints leftover spacer at visual start (deletion-point affinity)", () => {
      const wireBefore = `wit @${AGENT} \n\n@${AGENT} \nbroth @${AGENT} `;
      const doc = wireToDoc(wireBefore);
      const mentionAt = wireBefore.indexOf("@", wireBefore.indexOf("\n\n") + 2);
      const removed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionAt)),
        "delete"
      )!;
      expect(docToWire(removed.doc)).toBe(`wit @${AGENT} \n\n \nbroth @${AGENT} `);
      expect(removed.selection.focusAffinity).toBe("before");

      const focus = removed.selection.focus;
      const focusWire = docPosToWireOffset(removed.doc, focus);
      expect(docToWire(removed.doc)[focusWire]).toBe(" ");

      renderHandoffNoteDoc(root, removed.doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      const point = resolveDomPointAtDocPos(root, removed.doc, focus, {
        focusAffinity: removed.selection.focusAffinity,
      })!;
      expect(point.node.nodeType).toBe(Node.TEXT_NODE);
      expect(point.node.textContent).toBe(" ");
      expect(point.offset).toBe(0);
    });

    it("forward delete row-start mention mid-blank paints leftover spacer at visual start", () => {
      const wireBefore = `whe\n\n@${AGENT} \nmean`;
      const doc = wireToDoc(wireBefore);
      const mentionAt = wireBefore.indexOf("@");
      const removed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionAt)),
        "delete"
      )!;
      expect(docToWire(removed.doc)).toBe(`whe\n\n \nmean`);
      expect(removed.selection.focusAffinity).toBe("before");

      renderHandoffNoteDoc(root, removed.doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      const point = resolveDomPointAtDocPos(root, removed.doc, removed.selection.focus, {
        focusAffinity: removed.selection.focusAffinity,
      })!;
      expect(point.node.nodeType).toBe(Node.TEXT_NODE);
      expect(point.node.textContent).toBe(" ");
      expect(point.offset).toBe(0);
    });

    it("delete mention paint/read round-trip keeps insert before leftover commit space", () => {
      const wireBefore = `whe\n\n@${AGENT} \nmean`;
      const doc = wireToDoc(wireBefore);
      const removed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, wireBefore.indexOf("@"))),
        "delete"
      )!;
      expect(removed.selection.focusAffinity).toBe("before");
      renderHandoffNoteDoc(root, removed.doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      setDocSelection(root, removed.doc, removed.selection);
      const live = readDocSelection(root, removed.doc);
      expect(live.focusAffinity).toBe("before");
      expect(docToWire(applyDocInsertText(removed.doc, live, "x").doc)).toBe(`whe\n\nx \nmean`);
    });

    it("row-chip landing paints text-tail and readDocSelection recovers after for Delete", () => {
      const doc0 = wireToDoc("whed\n\nm");
      const afterChip = applyDocDelete(
        doc0,
        collapsedSelection(wireOffsetToDocPos(doc0, 3)),
        "delete"
      )!;
      expect(docToWire(afterChip.doc)).toBe("whe\n\nm");
      expect(afterChip.selection.focusAffinity).toBe("after");

      renderHandoffNoteDoc(root, afterChip.doc, { colorByAgentId: new Map() });
      setDocSelection(root, afterChip.doc, afterChip.selection);
      const live = readDocSelection(root, afterChip.doc);
      expect(live.focusAffinity).toBe("after");
      expect(docToWire(applyDocDelete(afterChip.doc, live, "delete")!.doc)).toBe("whe\nm");
    });

    it("content-row-end selection paint/read keeps after through Delete", () => {
      const doc = wireToDoc("whe\n\nm");
      const cre = collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, 2), "content-row-end");
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      setDocSelection(root, doc, cre);
      const live = readDocSelection(root, doc);
      expect(live.focusAffinity).toBe("after");
      expect(docToWire(applyDocDelete(doc, live, "delete")!.doc)).toBe("whe\nm");
    });

    it("first mid-blank char paints text-tail after insert", () => {
      const wire = suffixBlankBandWire();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const inserted = applyDocInsertText(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[1]!)),
        "w"
      );
      renderHandoffNoteDoc(root, inserted.doc, {
        colorByAgentId: new Map([[AGENT, "#06f"]]),
      });
      const focus = inserted.selection.focus;
      const point = resolveDomPointAtDocPos(root, inserted.doc, focus, {
        from: focus,
        focusAffinity: inserted.selection.focusAffinity ?? "after",
      })!;
      expect(point.node.textContent).toBe("w");
      expect(point.offset).toBe(1);
    });
  });

  describe("mention sandwich alias collision paint", () => {
    const SANDWICH_AGENT = "caliper-sandwich01";

    function sandwichWire(): string {
      return `pre @${SANDWICH_AGENT} @${SANDWICH_AGENT} tail`;
    }

    function sandwichDoc() {
      return wireToDoc(sandwichWire());
    }

    function sandwichAliasAndContinuationWires(doc: ReturnType<typeof wireToDoc>) {
      const spacerIndex = 2;
      const aliasWire = docPosToWireOffset(doc, { nodeIndex: spacerIndex, nodeOffset: 0 });
      const continuationWire = docPosToWireOffset(doc, { nodeIndex: spacerIndex, nodeOffset: 1 });
      return { spacerIndex, aliasWire, continuationWire };
    }

    function mountSandwichEditor() {
      const root = document.createElement("div");
      root.style.width = "480px";
      document.body.appendChild(root);
      Object.defineProperty(root, "clientWidth", { configurable: true, value: 480 });
      const colorByAgentId = new Map([[SANDWICH_AGENT, "#06f"]]);
      const editor = createHandoffNoteEditor({
        getColorByAgentId: () => colorByAgentId,
        onWireChange: () => {},
      });
      editor.setRoot(root);
      return { root, editor, colorByAgentId };
    }

    function pressArrow(
      editor: HandoffNoteEditor,
      key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"
    ) {
      return editor.handleKeyDown(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      );
    }

    function pressBackspace(editor: HandoffNoteEditor) {
      return editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
      );
    }

    function insertText(root: HTMLDivElement, editor: HandoffNoteEditor, data: string) {
      editor.handleBeforeInput(
        new InputEvent("beforeInput", {
          inputType: "insertText",
          data,
          bubbles: true,
          cancelable: true,
        })
      );
      dispatchSelectionChange(root);
    }

    it("renders sandwiched mentions without extra scaffold", () => {
      const doc = sandwichDoc();
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[SANDWICH_AGENT, "#06f"]]) });
      expect(root.querySelector("[data-handoff-mention]")).not.toBeNull();
      expect(root.childNodes.length).toBe(renderedDomChildCount(doc));
      expect(parseHandoffNoteDom(root)).toBe(sandwichWire());
    });

    it("same-row sandwich mention-start does not paint-alias to spacer tail", () => {
      const doc = sandwichDoc();
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[SANDWICH_AGENT, "#06f"]]) });
      const { spacerIndex } = sandwichAliasAndContinuationWires(doc);
      const mentionStart = { nodeIndex: spacerIndex + 1, nodeOffset: 0 };
      expect(resolvePaintDocPos(doc, mentionStart, { root })).toEqual(mentionStart);
      expect(describeCaretContext(doc, mentionStart, { root }).kind).toBe("mention-boundary");
      const paintCtx = resolvePaintContext(doc, mentionStart, { root });
      expect(paintCtx).toEqual({
        focusPos: mentionStart,
        paintPos: mentionStart,
        caretKind: "mention-boundary",
      });
    });

    it("cross-row sandwich spacer aliases mention-start wire to text tail for paint", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      stubHandoffNoteMentionLayoutCoords(
        fx.root,
        new Map(
          fx.mentionNodes.map((nodeIndex, i) => [
            nodeIndex,
            {
              top: i < 2 ? fx.row0Top : i === 2 ? fx.row1Top : fx.row2Top,
              left: 500 + i * 8,
            },
          ])
        )
      );
      const spacer = fx.doc.nodes[fx.postfixSpacerNode];
      expect(spacer?.type).toBe("text");
      if (spacer?.type !== "text") {
        fx.root.remove();
        return;
      }
      const tailPos = { nodeIndex: fx.postfixSpacerNode, nodeOffset: spacer.text.length };
      const mentionStart = { nodeIndex: fx.postfixSpacerNode + 1, nodeOffset: 0 };
      expect(resolvePaintDocPos(fx.doc, mentionStart, { root: fx.root })).toEqual(tailPos);
      expect(describeCaretContext(fx.doc, tailPos, { root: fx.root }).kind).toBe("text");
      expect(resolvePaintContext(fx.doc, mentionStart, { root: fx.root })).toEqual({
        focusPos: mentionStart,
        paintPos: tailPos,
        caretKind: "text",
      });
      expect(describeCaretContext(fx.doc, mentionStart, { root: fx.root }).kind).toBe("text");
      fx.root.remove();
    });

    it("same-row sandwich paints spacer by doc pos; mention-start at pill boundary", () => {
      const doc = sandwichDoc();
      const { aliasWire, continuationWire, spacerIndex } = sandwichAliasAndContinuationWires(doc);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[SANDWICH_AGENT, "#06f"]]) });

      const paintAlias = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, aliasWire))!;
      const paintCont = resolveDomPointAtDocPos(
        root,
        doc,
        wireOffsetToDocPos(doc, continuationWire)
      )!;
      const paintTail = resolveDomPointAtDocPos(root, doc, {
        nodeIndex: spacerIndex,
        nodeOffset: 1,
      })!;
      const paintMentionStart = resolveDomPointAtDocPos(root, doc, {
        nodeIndex: spacerIndex + 1,
        nodeOffset: 0,
      })!;

      expect(paintAlias.node.nodeType).toBe(Node.TEXT_NODE);
      expect(paintAlias.offset).toBe(0);
      expect(paintTail.node.nodeType).toBe(Node.TEXT_NODE);
      expect(paintTail.offset).toBe(1);
      // Same-row: no paint alias — mention-start paints pill exterior, not spacer tail.
      expect(paintMentionStart).not.toEqual(paintTail);
      expect(paintCont).toEqual(paintMentionStart);
      expect(domPointToDocPos(root, doc, paintCont.node, paintCont.offset)).toEqual({
        nodeIndex: spacerIndex + 1,
        nodeOffset: 0,
      });
    });

    it("reads spacer offset 0 and 1 back to wires 23 and 24", () => {
      const doc = sandwichDoc();
      const { aliasWire, continuationWire } = sandwichAliasAndContinuationWires(doc);
      expect(aliasWire).toBe(23);
      expect(continuationWire).toBe(24);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[SANDWICH_AGENT, "#06f"]]) });

      const paintAlias = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, aliasWire))!;
      const paintCont = resolveDomPointAtDocPos(
        root,
        doc,
        wireOffsetToDocPos(doc, continuationWire)
      )!;

      expect(
        docPosToWireOffset(doc, domPointToDocPos(root, doc, paintAlias.node, paintAlias.offset))
      ).toBe(aliasWire);
      expect(
        docPosToWireOffset(doc, domPointToDocPos(root, doc, paintCont.node, paintCont.offset))
      ).toBe(continuationWire);
    });

    it("resolvePaintContextAtWire prefers continuation paint at alias wire", () => {
      const doc = sandwichDoc();
      const { continuationWire } = sandwichAliasAndContinuationWires(doc);
      const spacerCont = { nodeIndex: 2, nodeOffset: 1 };
      expect(resolvePaintContextAtWire(doc, continuationWire)).toEqual({
        focusPos: spacerCont,
        paintPos: spacerCont,
        caretKind: "text",
      });
    });

    it("resolvePaintHorizontalArrowMove steps sandwich spacer then crosses next pill as one token", () => {
      const doc = sandwichDoc();
      const mentionEndWire = `pre @${SANDWICH_AGENT}`.length - 1;
      let pos = wireOffsetToDocPos(doc, mentionEndWire);
      // Force mention-end focus (paint may alias to spacer at same wire).
      pos = { nodeIndex: 1, nodeOffset: 1 + SANDWICH_AGENT.length };

      const step1 = resolvePaintHorizontalArrowMove(doc, pos, "right");
      expect(step1.handled).toBe(true);
      expect(step1.pos).toEqual({ nodeIndex: 2, nodeOffset: 0 });
      pos = step1.pos;
      const step2 = resolvePaintHorizontalArrowMove(doc, pos, "right");
      expect(step2.handled).toBe(true);
      expect(step2.pos).toEqual({ nodeIndex: 2, nodeOffset: 1 });
      pos = step2.pos;
      // Pill is one token: spacer continuation Right crosses the following mention (no start micro-stop).
      const step3 = resolvePaintHorizontalArrowMove(doc, pos, "right");
      expect(step3.handled).toBe(true);
      expect(step3.pos).toEqual({ nodeIndex: 4, nodeOffset: 0 });
      expect(doc.nodes[3]?.type).toBe("mention");
      expect(doc.nodes[4]?.type).toBe("text");
    });

    it("editor horizontal from spacer continuation crosses next pill; Left lands mention start", () => {
      const host = mountSandwichEditor();
      try {
        const wire = sandwichWire();
        const doc = sandwichDoc();
        const { continuationWire } = sandwichAliasAndContinuationWires(doc);
        const spacerCont = { nodeIndex: 2, nodeOffset: 1 };
        host.editor.setDocFromWire(wire, continuationWire, { resetHistory: true });
        expect(host.editor.getSelectionState().focus).toEqual(spacerCont);
        expect(
          describeCaretContext(host.editor.getDoc(), spacerCont, { root: host.root }).kind
        ).toBe("text");
        expect(pressArrow(host.editor, "ArrowRight")).toBe(true);
        expect(host.editor.getSelectionState().focus).toEqual({ nodeIndex: 4, nodeOffset: 0 });
        expect(pressArrow(host.editor, "ArrowLeft")).toBe(true);
        // After crossing the pill, Left lands the pill start boundary (still landable).
        expect(host.editor.getSelectionState().focus).toEqual({ nodeIndex: 3, nodeOffset: 0 });
        expect(pressArrow(host.editor, "ArrowLeft")).toBe(true);
        expect(host.editor.getSelectionState().focus).toEqual(spacerCont);
      } finally {
        invalidateHandoffNoteLayoutCache();
        host.root.remove();
      }
    });

    it("integration: click, type, backspace, and arrows through sandwich spacer", () => {
      const host = mountSandwichEditor();
      try {
        const wire = sandwichWire();
        const doc = sandwichDoc();
        const { aliasWire, continuationWire } = sandwichAliasAndContinuationWires(doc);
        host.editor.setDocFromWire(wire, aliasWire, { resetHistory: true });
        expect(host.editor.getCursor()).toBe(aliasWire);
        const aliasPaint = resolveDomPointAtDocPos(
          host.root,
          host.editor.getDoc(),
          wireOffsetToDocPos(host.editor.getDoc(), aliasWire)
        )!;
        expect(aliasPaint.node.nodeType).toBe(Node.TEXT_NODE);
        expect(aliasPaint.offset).toBe(0);

        insertText(host.root, host.editor, "X");
        expect(host.editor.getWire()).toBe(`pre @${SANDWICH_AGENT} X@${SANDWICH_AGENT} tail`);
        expect(host.editor.getCursor()).toBe(aliasWire + 2);

        pressBackspace(host.editor);
        dispatchSelectionChange(host.root);
        expect(host.editor.getWire()).toBe(wire);
        expect(host.editor.getCursor()).toBe(continuationWire);

        host.editor.setDocFromWire(wire, continuationWire, { resetHistory: true });
        expect(pressArrow(host.editor, "ArrowLeft")).toBe(true);
        expect(host.editor.getCursor()).toBe(aliasWire);
        expect(pressArrow(host.editor, "ArrowRight")).toBe(true);
        expect(host.editor.getCursor()).toBe(continuationWire);
      } finally {
        invalidateHandoffNoteLayoutCache();
        host.root.remove();
      }
    });
  });

  describe("blank-probe wire alias — mention end owns same wire", () => {
    const AGENT = "caliper-aaaaaaa";

    function chippedMentionAbuttingBlank() {
      const doc0 = wireToDoc(`header @${AGENT} \n\n\n`);
      const spacerWire = listEmbeddedBlankBandProbeWires(doc0)[0]! - 1;
      const chipped = applyDocDelete(
        doc0,
        collapsedSelection(wireOffsetToDocPos(doc0, spacerWire), "after"),
        "backspace"
      )!;
      const mentionEnd = chipped.selection.focus;
      const probeWire = listEmbeddedBlankBandProbeWires(chipped.doc)[0]!;
      expect(chipped.doc.nodes[mentionEnd.nodeIndex]?.type).toBe("mention");
      expect(docPosToWireOffset(chipped.doc, mentionEnd)).toBe(probeWire);
      return { doc: chipped.doc, mentionEnd, probeWire };
    }

    it("wire ingress must not prefer blank text over mention end", () => {
      const { doc, mentionEnd, probeWire } = chippedMentionAbuttingBlank();
      expect(describeHandoffNoteCursorContext(doc, probeWire)).toEqual(
        expect.objectContaining({ kind: "mention-boundary", edge: "end" })
      );
      const atWire = resolvePaintContextAtWire(doc, probeWire);
      expect(doc.nodes[atWire.focusPos.nodeIndex]?.type).toBe("mention");
      expect(atWire.focusPos).toEqual(mentionEnd);
      expect(atWire.caretKind).toBe("mention-boundary");
    });

    it("resolvePaintContext(mentionEnd) matches atWire without from", () => {
      const { doc, mentionEnd, probeWire } = chippedMentionAbuttingBlank();
      const fromFocus = resolvePaintContext(doc, mentionEnd);
      const atWire = resolvePaintContextAtWire(doc, probeWire);
      expect(fromFocus.focusPos).toEqual(mentionEnd);
      expect(atWire.focusPos).toEqual(fromFocus.focusPos);
    });
  });

  describe("row-edge wire landing — paint focus owns aliases", () => {
    const AGENT = "caliper-aaaaaaa";

    it("mention after line break: wire lands on mention start not prior text past-end", () => {
      const doc = wireToDoc(`upper\n@${AGENT} `);
      const rowStartWire = "upper\n".length;
      const atWire = resolvePaintContextAtWire(doc, rowStartWire);
      expect(doc.nodes[atWire.focusPos.nodeIndex]?.type).toBe("mention");
      expect(atWire.focusPos.nodeOffset).toBe(0);
      expect(docPosToWireOffset(doc, atWire.focusPos)).toBe(rowStartWire);
    });

    it("soft-wrap postfix spacer: wire lands on text owner", () => {
      const fx = mountMultiMentionSoftWrapFixture();
      try {
        const atWire = resolvePaintContextAtWire(fx.doc, fx.secondPostStart, {
          root: fx.root,
        });
        expect(fx.doc.nodes[atWire.focusPos.nodeIndex]?.type).toBe("text");
        expect(docPosToWireOffset(fx.doc, atWire.focusPos)).toBe(fx.secondPostStart);
      } finally {
        fx.root.remove();
      }
    });
  });

  describe("horizontal CRE — last char + affinity, not past-end", () => {
    it("Right from EOF last char lands same char with after, not text.length", () => {
      const doc = wireToDoc("hello");
      const last = { nodeIndex: 0, nodeOffset: 4 };
      const moved = resolvePaintHorizontalArrowMove(doc, last, "right");
      expect(moved.handled).toBe(true);
      expect(moved.pos).toEqual(last);
      expect(moved.selection.focusAffinity).toBe("after");
    });

    it("Right from last char before break lands same char with after, not onto \\n", () => {
      const doc = wireToDoc("ab\n");
      const last = { nodeIndex: 0, nodeOffset: 1 };
      const moved = resolvePaintHorizontalArrowMove(doc, last, "right");
      expect(moved.handled).toBe(true);
      expect(moved.pos).toEqual(last);
      expect(moved.selection.focusAffinity).toBe("after");
      expect(docToWire(doc)[docPosToWireOffset(doc, moved.pos)]).toBe("b");
    });

    it("Left from CRE after returns before on the same char", () => {
      const doc = wireToDoc("hello");
      const last = { nodeIndex: 0, nodeOffset: 4 };
      const moved = resolvePaintHorizontalArrowMove(doc, last, "left", {
        focusAffinity: "after",
      });
      expect(moved.handled).toBe(true);
      expect(moved.pos).toEqual(last);
      expect(moved.selection.focusAffinity).toBe("before");
    });

    it("Right from CRE after at EOF is unhandled (no past-end invent)", () => {
      const doc = wireToDoc("hello");
      const last = { nodeIndex: 0, nodeOffset: 4 };
      const moved = resolvePaintHorizontalArrowMove(doc, last, "right", {
        focusAffinity: "after",
      });
      expect(moved.handled).toBe(false);
    });

    it("Right from last char before mention still uses text-length tail alias", () => {
      const doc = wireToDoc("pre @caliper-aaaaaaa ");
      const pre = doc.nodes[0];
      if (pre?.type !== "text") throw new Error("expected text");
      const last = { nodeIndex: 0, nodeOffset: pre.text.length - 1 };
      const moved = resolvePaintHorizontalArrowMove(doc, last, "right");
      expect(moved.handled).toBe(true);
      expect(moved.pos).toEqual({ nodeIndex: 0, nodeOffset: pre.text.length });
    });

    it("inter-atomic spacer Right still lands text.length continuation", () => {
      const doc = wireToDoc("@caliper-aaaaaaa @caliper-bbbbbbb ");
      const spacerIdx = doc.nodes.findIndex(
        (n, i) => n.type === "text" && n.text === " " && doc.nodes[i - 1]?.type === "mention"
      );
      const moved = resolvePaintHorizontalArrowMove(
        doc,
        { nodeIndex: spacerIdx, nodeOffset: 0 },
        "right"
      );
      expect(moved.handled).toBe(true);
      expect(moved.pos).toEqual({ nodeIndex: spacerIdx, nodeOffset: 1 });
    });

    it("Right from previous onto last-before-break does not stamp CRE after", () => {
      const doc = wireToDoc("abcdef\nghij");
      const lastBeforeBreak = wireOffsetToDocPos(doc, "abcdef".length - 1);
      const moved = resolvePaintHorizontalArrowMove(
        doc,
        wireOffsetToDocPos(doc, "abcdef".length - 2),
        "right"
      );
      expect(moved.handled).toBe(true);
      expect(moved.pos).toEqual(lastBeforeBreak);
      expect(moved.selection.focusAffinity).not.toBe("after");
    });

    it("trailing space before blank is a real hop (not CRE after on first land)", () => {
      const doc = wireToDoc("whedg \n\ndhhd ");
      const moved = resolvePaintHorizontalArrowMove(doc, wireOffsetToDocPos(doc, 4), "right");
      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(5);
      expect(docToWire(doc)[5]).toBe(" ");
      expect(moved.selection.focusAffinity).not.toBe("after");
    });

    it("Right from blank stop lands next content start", () => {
      const doc = wireToDoc("whedg \n\ndhhd ");
      const blankStop = listBlankVisualLineStartWires(doc)[0]!;
      expect(blankStop).toBe(7);
      const moved = resolvePaintHorizontalArrowMove(
        doc,
        wireOffsetToDocPos(doc, blankStop),
        "right"
      );
      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(8);
    });

    it("Left from content start enters blank stop in one hop", () => {
      const doc = wireToDoc("whedg \n\ndhhd ");
      const blankStop = listBlankVisualLineStartWires(doc)[0]!;
      const moved = resolvePaintHorizontalArrowMove(doc, wireOffsetToDocPos(doc, 8), "left");
      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(blankStop);
    });

    it("Right from CRE after on ordinary break lands next content (not the \\n)", () => {
      const doc = wireToDoc("abcdef\nghij");
      const last = "abcdef".length - 1;
      const moved = resolvePaintHorizontalArrowMove(doc, wireOffsetToDocPos(doc, last), "right", {
        focusAffinity: "after",
      });
      expect(moved.handled).toBe(true);
      expect(docPosToWireOffset(doc, moved.pos)).toBe(last + 2);
    });
  });

  describe("caret kind authority — focus vs wire", () => {
    const AGENT = "caliper-aaaaaaa";

    it("same wire — text focus is text; mention-end focus stays mention-boundary", () => {
      const doc = wireToDoc(`pre @${AGENT} mid`);
      const mentionIdx = doc.nodes.findIndex((n) => n.type === "mention");
      const mention = doc.nodes[mentionIdx]!;
      if (mention.type !== "mention") throw new Error("expected mention");
      const mentionEnd = {
        nodeIndex: mentionIdx,
        nodeOffset: 1 + mention.agentId.length,
      };
      const textAtAlias = { nodeIndex: mentionIdx + 1, nodeOffset: 0 };
      const aliasWire = docPosToWireOffset(doc, mentionEnd);
      expect(docPosToWireOffset(doc, textAtAlias)).toBe(aliasWire);

      expect(describeHandoffNoteCursorContext(doc, aliasWire)).toEqual(
        expect.objectContaining({ kind: "mention-boundary", edge: "end" })
      );
      expect(describeCaretContext(doc, textAtAlias).kind).toBe("text");
      expect(describeCaretContext(doc, mentionEnd)).toEqual(
        expect.objectContaining({ kind: "mention-boundary", edge: "end" })
      );
    });

    it("ordinary text wire and focus agree on text", () => {
      const doc = wireToDoc("hello");
      const focus = { nodeIndex: 0, nodeOffset: 2 };
      expect(describeHandoffNoteCursorContext(doc, 2).kind).toBe("text");
      expect(describeCaretContext(doc, focus).kind).toBe("text");
    });
  });

  describe("text-node boundary ownership primitives (Rule 4 — handoff-note-arrow-contract.md)", () => {
    it("detects browser text-node tail before a wire break", () => {
      expect(isContentTextNodeDomTailBeforeBreak(5, "hello", 0, 4)).toBe(true);
      expect(isContentTextNodeDomTailBeforeBreak(4, "hello", 0, 4)).toBe(false);
      expect(isContentTextNodeDomTailBeforeBreak(5, "hello", 3, 4)).toBe(false);
    });

    it("maps text-node tail to content row end on read", () => {
      expect(docOffsetFromContentTextNodeDomPoint(0, 5, "hello", 0, 4)).toBe(4);
      expect(docOffsetFromContentTextNodeDomPoint(0, 3, "hello", 0, 4)).toBe(3);
    });

    it("authority-preserving read keeps non-probe break insert landing over content text-tail last-char alias", () => {
      const wire = `header\nm\ntail`;
      const doc = wireToDoc(wire);
      const breakAfterM = wire.indexOf("m") + 1;
      const lastChar = breakAfterM - 1;
      expect(wire[breakAfterM]).toBe("\n");
      expect(isEmbeddedBlankBandProbeWire(doc, breakAfterM)).toBe(false);
      const authority = wireOffsetToDocPos(doc, breakAfterM);
      const read = wireOffsetToDocPos(doc, lastChar);
      expect(resolveDomReadDocPos(doc, read, authority)).toEqual(authority);
    });

    it("maps content row end to text-node tail only for explicit after", () => {
      expect(domOffsetForContentRowEndInSplitText(4, "hello", "after")).toBe(5);
      expect(domOffsetForContentRowEndInSplitText(4, "hello")).toBe(4);
      expect(domOffsetForContentRowEndInSplitText(3, "hello")).toBe(3);
      expect(domOffsetForContentRowEndInSplitText(0, " ")).toBe(0);
      expect(domOffsetForContentRowEndInSplitText(0, "h")).toBe(0);
      expect(domOffsetForContentRowEndInSplitText(0, " ", "after")).toBe(1);
      expect(domOffsetForContentRowEndInSplitText(0, "h", "after")).toBe(1);
    });

    it("deletion-point affinity keeps sole-char write at visual start not text-tail", () => {
      expect(domOffsetForContentRowEndInSplitText(0, " ", "before")).toBe(0);
      expect(domOffsetForContentRowEndInSplitText(0, "h", "before")).toBe(0);
      expect(domOffsetForContentRowEndInSplitText(0, " ", "after")).toBe(1);
    });

    it("EOF last part: after paints text-tail; omit/before stay on-char", () => {
      expect(domOffsetForContentRowEndInSplitText(0, "o", "after")).toBe(1);
      expect(domOffsetForContentRowEndInSplitText(0, "o")).toBe(0);
      expect(domOffsetForContentRowEndInSplitText(0, "o", "before")).toBe(0);
      expect(domOffsetForContentRowEndInSplitText(0, " ", "after")).toBe(1);
      expect(domOffsetForContentRowEndInSplitText(0, " ")).toBe(0);
    });

    it("maps whitespace-only tail before break on read", () => {
      expect(isContentTextNodeDomTailBeforeBreak(1, " ", 0, 4)).toBe(true);
      expect(docOffsetFromContentTextNodeDomPoint(0, 1, " ", 0, 4)).toBe(0);
    });

    it("single-char row: text-tail writes and reads as content row end", () => {
      expect(isContentTextNodeDomTailBeforeBreak(1, "h", 0, 4)).toBe(true);
      expect(docOffsetFromContentTextNodeDomPoint(0, 1, "h", 0, 4)).toBe(0);
    });

    it("post-mention spacer before content \\n paints text-tail; break paints BR", () => {
      const agent = "caliper-midblank01";
      const wire = `mesh @${agent} \n\nmesh @${agent} \nwhteh @${agent} `;
      const doc = wireToDoc(wire);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[agent, "#000"]]) });
      const spacerWire = wire.indexOf(`@${agent} \nwhteh`) + `@${agent} `.length - 1;
      const breakWire = spacerWire + 1;
      expect(wire[spacerWire]).toBe(" ");
      expect(wire[breakWire]).toBe("\n");

      const spacerPoint = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, spacerWire), {
        focusAffinity: "after",
      });
      expect(spacerPoint?.node.nodeType).toBe(Node.TEXT_NODE);
      expect((spacerPoint?.node as Text).data).toBe(" ");
      expect(spacerPoint?.offset).toBe(1);

      const breakPoint = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, breakWire));
      expect(breakPoint?.node instanceof HTMLBRElement).toBe(true);
    });
  });
});
