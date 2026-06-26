import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  docPosToWireOffset,
  describeHandoffNoteCursorContext,
  isEmbeddedBlankBandProbeWire,
  listEmbeddedBlankBandProbeWires,
  normalizeHandoffNoteDoc,
  wireOffsetToDocPos,
  wireToDoc,
} from "@caliper/core";
import {
  docOffsetFromContentTextNodeDomPoint,
  domOffsetForContentRowEndInSplitText,
  domPointToDocPos,
  isContentTextNodeDomTailBeforeBreak,
  resolveDomPointAtDocPos,
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
  isHandoffWireBreakElement,
  sameRenderedDocStructure,
  getHandoffNoteEditorTabStops,
} from "./handoff-note-dom.js";
import { invalidateHandoffNoteLayoutCache } from "./handoff-note-layout-map.js";
import { readDomWireCursor, setSelectionAtWire } from "./handoff-note-test-helpers.js";

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
    setSelectionAtWire(root, normalizedDoc, 12, 12, { source: "reconcile" });
    expect(readDomWireCursor(root, normalizedDoc)).toBe(12);
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
    it("EOF wire newline renders wire-break plus layout-only line-pad", () => {
      const wire = "header \n";
      renderHandoffNoteDoc(root, wireToDoc(wire), { colorByAgentId: new Map() });
      expect(parseHandoffNoteDom(root)).toBe(wire);
      expect(root.querySelector(`br[${HANDOFF_WIRE_BREAK_ATTR}]`)).not.toBeNull();
      expect(root.querySelector(`br[${HANDOFF_LINE_PAD_ATTR}]`)).not.toBeNull();
    });

    it("mid-doc newline does not add line-pad before following text", () => {
      const wire = "header\ntail";
      renderHandoffNoteDoc(root, wireToDoc(wire), { colorByAgentId: new Map() });
      expect(parseHandoffNoteDom(root)).toBe(wire);
      expect(root.querySelectorAll(`br[${HANDOFF_WIRE_BREAK_ATTR}]`).length).toBe(1);
      expect(root.querySelector(`br[${HANDOFF_LINE_PAD_ATTR}]`)).toBeNull();
    });

    it("caret after EOF newline lands before line-pad", () => {
      const wire = "header \n";
      const doc = wireToDoc(wire);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
      setSelectionAtWire(root, doc, wire.length);
      expect(root.querySelector(`br[${HANDOFF_LINE_PAD_ATTR}]`)).not.toBeNull();
      const selection = root.ownerDocument.getSelection()!;
      const range = selection.getRangeAt(0);
      expect(range.startContainer).toBe(root);
      expect(range.startOffset).toBe(root.childNodes.length - 1);
      expect(readDomWireCursor(root, doc)).toBe(wire.length);
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

    it("prefix-only leading blank probes resolve to wire-break, not blank anchor", () => {
      for (const wire of [`\n`, `\n\n`, `\n\n\ntail`]) {
        const doc = wireToDoc(wire);
        const focusWire = listEmbeddedBlankBandProbeWires(doc)[0]!;

        renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

        const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, focusWire));
        expect(point, wire).not.toBeNull();
        expect(
          point?.node instanceof HTMLBRElement && isHandoffWireBreakElement(point!.node),
          wire
        ).toBe(true);
        const roundTrip = domPointToDocPos(root, doc, point!.node, point!.offset);
        expect(docPosToWireOffset(doc, roundTrip)).toBe(focusWire);
      }
    });

    it("chip landing with delete provenance resolves interior probe to wire-break", () => {
      const wire = "header \n\n\nmiddle\n\n\n\n\nlower";
      const doc = wireToDoc(wire);
      const interiorProbe = listEmbeddedBlankBandProbeWires(doc)[4]!;

      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

      const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, interiorProbe), {
        chipBeforeBlankBand: true,
      });
      expect(point).not.toBeNull();
      expect(point?.node instanceof HTMLBRElement && isHandoffWireBreakElement(point!.node)).toBe(
        true
      );
      const roundTrip = domPointToDocPos(root, doc, point!.node, point!.offset);
      expect(docPosToWireOffset(doc, roundTrip)).toBe(interiorProbe);
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

    it("non-probe wire-break still resolves to br element", () => {
      const wire = suffixBlankBandWire();
      const doc = wireToDoc(wire);
      const lineStartBeforeTail = wire.indexOf("tail") - 1;
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      const point = resolveDomPointAtDocPos(
        root,
        doc,
        wireOffsetToDocPos(doc, lineStartBeforeTail)
      );
      expect(point?.node instanceof HTMLBRElement && isHandoffWireBreakElement(point!.node)).toBe(
        true
      );
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

      const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, headerEnd));
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(point?.offset).toBe("hello".length);
      const roundTrip = domPointToDocPos(root, doc, point!.node, point!.offset);
      expect(docPosToWireOffset(doc, roundTrip)).toBe(headerEnd);
    });

    it("postfix chip whitespace tail paints after spacer not mention-edge alias", () => {
      const chipped = wireToDoc(`header @${AGENT} \n\n\n`);
      const probes = listEmbeddedBlankBandProbeWires(chipped);
      const rowEnd = probes[0]! - 1;
      const focus = wireOffsetToDocPos(chipped, rowEnd);

      renderHandoffNoteDoc(root, chipped, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      const point = resolveDomPointAtDocPos(root, chipped, focus);
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(point?.offset).toBeGreaterThan(0);
      expect(
        docPosToWireOffset(chipped, domPointToDocPos(root, chipped, point!.node, point!.offset))
      ).toBe(rowEnd);
      expect(describeHandoffNoteCursorContext(chipped, rowEnd).kind).toBe("mention-boundary");
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

    it("maps content row end to text-node tail on write", () => {
      expect(domOffsetForContentRowEndInSplitText(4, "hello", 0, 4)).toBe(5);
      expect(domOffsetForContentRowEndInSplitText(3, "hello", 0, 4)).toBe(3);
      expect(domOffsetForContentRowEndInSplitText(0, " ", 0, 4)).toBe(1);
    });

    it("maps whitespace-only tail before break on read", () => {
      expect(isContentTextNodeDomTailBeforeBreak(1, " ", 0, 4)).toBe(true);
      expect(docOffsetFromContentTextNodeDomPoint(0, 1, " ", 0, 4)).toBe(0);
    });

    it("single-char row: visual start stays offset 0, tail reads as content row end", () => {
      expect(domOffsetForContentRowEndInSplitText(0, "h", 0, 4)).toBe(0);
      expect(isContentTextNodeDomTailBeforeBreak(1, "h", 0, 4)).toBe(false);
      expect(docOffsetFromContentTextNodeDomPoint(0, 1, "h", 0, 4)).toBe(1);
    });

    it("round-trips visual start vs content row end on sole-char row before blank band", () => {
      const wire = "h\n\n\n";
      const doc = wireToDoc(wire);
      renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

      const visualStart = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, 0));
      expect(visualStart?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(visualStart?.offset).toBe(0);
      expect(
        docPosToWireOffset(doc, domPointToDocPos(root, doc, visualStart!.node, visualStart!.offset))
      ).toBe(0);

      const rowEnd = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, 1));
      expect(
        docPosToWireOffset(doc, domPointToDocPos(root, doc, rowEnd!.node, rowEnd!.offset))
      ).toBe(1);
    });
  });
});
