import { describe, expect, it, beforeEach } from "vitest";
import { normalizeHandoffNoteDoc, wireToDoc } from "@caliper/core";
import {
  parseHandoffNoteDom,
  parseHandoffNoteDomToDoc,
  renderHandoffNoteDoc,
  tryPatchDocDom,
  isHandoffMentionElement,
  sameRenderedDocStructure,
  getHandoffNoteEditorTabStops,
} from "./handoff-note-dom.js";
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
    const agentId = "caliper-zn4u0ymbt";
    renderHandoffNoteDoc(
      root,
      {
        nodes: [
          { type: "text", text: "dhhd " },
          { type: "mention", agentId },
          { type: "text", text: "dhhdh @ " },
        ],
      },
      { colorByAgentId: new Map([[agentId, "#f00"]]) }
    );

    expect(parseHandoffNoteDom(root)).toBe(`dhhd @${agentId}dhhdh @ `);
    expect(parseHandoffNoteDomToDoc(root)).toEqual({
      nodes: [
        { type: "text", text: "dhhd " },
        { type: "mention", agentId },
        { type: "text", text: "dhhdh @ " },
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
    expect(root.childNodes.length).toBe(3);
    const normalizedDoc = wireToDoc(parseHandoffNoteDom(root));
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
});
