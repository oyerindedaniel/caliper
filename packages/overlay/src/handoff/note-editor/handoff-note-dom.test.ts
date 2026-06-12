import { describe, expect, it, beforeEach } from "vitest";
import { normalizeHandoffNoteDoc, wireToDoc } from "@caliper/core";
import {
  normalizeHandoffNoteDom,
  parseHandoffNoteDom,
  parseHandoffNoteDomToDoc,
  renderHandoffNoteDoc,
  isHandoffMentionElement,
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

  it("normalizes fragmented newline nodes into canonical doc children", () => {
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
    const firstText = root.firstChild as Text;
    const newline = document.createTextNode("\n");
    root.insertBefore(newline, firstText.nextSibling);
    root.insertBefore(document.createTextNode("\n"), newline.nextSibling);
    setSelectionAtWire(root, domDoc, 12, 12);

    const colors = new Map([[agentId, "#f00"]]);
    expect(normalizeHandoffNoteDom(root, { colorByAgentId: colors })).toBe(true);
    expect(
      (root.querySelector("span[data-handoff-mention]") as HTMLSpanElement).style.getPropertyValue(
        "--caliper-handoff-pill-color"
      )
    ).toBe("#f00");
    expect(root.childNodes.length).toBe(3);
    const normalizedDoc = wireToDoc(parseHandoffNoteDom(root));
    setSelectionAtWire(root, normalizedDoc, 12, 12, { source: "normalize" });
    expect(readDomWireCursor(root, normalizedDoc)).toBe(12);
  });

  it("updates highlight class without rebuilding DOM when wire unchanged", () => {
    const doc = wireToDoc("@caliper-abc123");
    const colors = new Map([["caliper-abc123", "#f00"]]);
    renderHandoffNoteDoc(root, doc, { colorByAgentId: colors });
    const pill = root.querySelector("span[data-handoff-mention]")!;
    const first = pill.className;
    renderHandoffNoteDoc(root, doc, {
      colorByAgentId: colors,
      highlightedAgentId: "caliper-abc123",
    });
    expect(pill.className).not.toBe(first);
    expect(pill.className).toContain("handoff-mention-pill-highlighted");
  });
});
