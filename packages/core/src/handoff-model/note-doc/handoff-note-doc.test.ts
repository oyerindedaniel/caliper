import { describe, expect, it } from "vitest";
import {
  type HandoffNoteDoc,
  createTextDoc,
  docLength,
  docToWire,
  docsEqual,
  emptyHandoffNoteDoc,
  insertMentionAt,
  canonicalizeHandoffNoteDocFromWire,
  normalizeHandoffNoteDoc,
  parseHandoffNoteWire,
  resolveHandoffNoteArrowMove,
  resolveHandoffNoteMentionEdit,
  resolveHandoffWireCursor,
  separateAdjacentMentions,
  snapHandoffNoteCursorOutOfMentionInterior,
  offsetAtDocPosition,
  resolveDocPosition,
  spliceDocWireRange,
  wireToDoc,
  isArrow,
} from "./handoff-note-doc.js";

describe("isArrow", () => {
  it("matches any arrow by default", () => {
    expect(isArrow("ArrowLeft")).toBe(true);
    expect(isArrow("ArrowDown")).toBe(true);
    expect(isArrow("Enter")).toBe(false);
  });

  it("composes horizontal, vertical, and single-axis matchers", () => {
    expect(isArrow.horc("ArrowLeft")).toBe(true);
    expect(isArrow.horc("ArrowUp")).toBe(false);
    expect(isArrow.ver("ArrowDown")).toBe(true);
    expect(isArrow.ver("ArrowRight")).toBe(false);
    expect(isArrow.left("ArrowLeft")).toBe(true);
    expect(isArrow.right("ArrowRight")).toBe(true);
    expect(isArrow.up("ArrowUp")).toBe(true);
    expect(isArrow.down("ArrowDown")).toBe(true);
  });

  it("maps keys to nav directions", () => {
    expect(isArrow.direction("ArrowLeft")).toBe("left");
    expect(isArrow.horcDirection("ArrowRight")).toBe("right");
    expect(isArrow.verDirection("ArrowUp")).toBe("up");
    expect(isArrow.direction("Tab")).toBeNull();
  });
});

describe("wireToDoc / docToWire", () => {
  it("round-trips empty string", () => {
    expect(docToWire(wireToDoc(""))).toBe("");
    expect(wireToDoc("")).toEqual(emptyHandoffNoteDoc());
  });

  it("round-trips plain text", () => {
    const wire = "hello world";
    expect(docToWire(wireToDoc(wire))).toBe(wire);
  });

  it("round-trips a single mention", () => {
    const wire = "Hi @caliper-abc123 there";
    expect(docToWire(wireToDoc(wire))).toBe(wire);
  });

  it("canonicalizes adjacent mentions without spaces", () => {
    const wire = "@caliper-a@caliper-b";
    expect(docToWire(wireToDoc(wire))).toBe("@caliper-a @caliper-b");
  });

  it("round-trips multiple mentions with text between", () => {
    const wire = "Fix @caliper-abc123 next to @caliper-def456";
    expect(docToWire(wireToDoc(wire))).toBe(wire);
  });

  it("matches parseHandoffNoteWire structure", () => {
    const wire = "A @caliper-x B";
    const doc = wireToDoc(wire);
    expect(doc.nodes).toEqual([
      { type: "text", text: "A " },
      { type: "mention", agentId: "caliper-x" },
      { type: "text", text: " B" },
    ]);
    expect(parseHandoffNoteWire(wire)).toEqual(doc.nodes);
  });

  it("is the canonical wire ingress (parse + normalize once)", () => {
    const wire = "@caliper-a@caliper-b\nline";
    expect(wireToDoc(wire)).toEqual(
      canonicalizeHandoffNoteDocFromWire({ nodes: parseHandoffNoteWire(wire) })
    );
  });

  it("does not treat invalid @ tokens as mentions", () => {
    const wire = "email@example.com @not-valid";
    expect(docToWire(wireToDoc(wire))).toBe(wire);
    expect(wireToDoc(wire).nodes).toEqual([{ type: "text", text: wire }]);
  });

  it("coalesces adjacent text nodes after splice", () => {
    const doc = wireToDoc("ab");
    const next = spliceDocWireRange(doc, 1, 1, "Z");
    expect(docToWire(next)).toBe("aZb");
    expect(next.nodes).toEqual([{ type: "text", text: "aZb" }]);
  });
});

describe("resolveDocPosition / offsetAtDocPosition", () => {
  const note = "Hi @caliper-abc123 there";
  const doc = wireToDoc(note);
  const mentionStart = note.indexOf("@");
  const mentionEnd = mentionStart + 1 + "caliper-abc123".length;

  it("maps start, middle of text, and end offsets", () => {
    expect(resolveDocPosition(doc, 0)).toEqual({ nodeIndex: 0, nodeOffset: 0 });
    expect(resolveDocPosition(doc, 2)).toEqual({ nodeIndex: 0, nodeOffset: 2 });
    expect(resolveDocPosition(doc, mentionStart)).toEqual({ nodeIndex: 1, nodeOffset: 0 });
    expect(resolveDocPosition(doc, mentionStart + 3)).toEqual({
      nodeIndex: 1,
      nodeOffset: 3,
    });
    expect(resolveDocPosition(doc, mentionEnd)).toEqual({ nodeIndex: 2, nodeOffset: 0 });
    expect(resolveDocPosition(doc, note.length)).toEqual({
      nodeIndex: 2,
      nodeOffset: note.length - mentionEnd,
    });
  });

  it("clamps out-of-range offsets", () => {
    expect(resolveDocPosition(doc, -5)).toEqual({ nodeIndex: 0, nodeOffset: 0 });
    expect(resolveDocPosition(doc, 999)).toEqual({
      nodeIndex: 2,
      nodeOffset: note.length - mentionEnd,
    });
  });

  it("round-trips offset through position helpers", () => {
    for (const offset of [0, 1, mentionStart, mentionStart + 1, mentionEnd, note.length]) {
      const pos = resolveDocPosition(doc, offset);
      expect(pos).not.toBeNull();
      expect(offsetAtDocPosition(doc, pos!.nodeIndex, pos!.nodeOffset)).toBe(offset);
    }
  });

  it("handles empty doc at offset 0", () => {
    const empty = emptyHandoffNoteDoc();
    expect(resolveDocPosition(empty, 0)).toEqual({ nodeIndex: 0, nodeOffset: 0 });
    expect(docLength(empty)).toBe(0);
  });
});

describe("spliceDocWireRange", () => {
  it("inserts in the middle of text", () => {
    const doc = createTextDoc("hello");
    expect(docToWire(spliceDocWireRange(doc, 2, 2, "XX"))).toBe("heXXllo");
  });

  it("replaces an entire mention token", () => {
    const wire = "Hi @caliper-abc123 there";
    const doc = wireToDoc(wire);
    const start = wire.indexOf("@");
    const end = start + "@caliper-abc123".length;
    expect(docToWire(spliceDocWireRange(doc, start, end, "@caliper-xyz789"))).toBe(
      "Hi @caliper-xyz789 there"
    );
  });

  it("deletes a mention by replacing with empty string", () => {
    const wire = "Hi @caliper-abc123 there";
    const doc = wireToDoc(wire);
    const start = wire.indexOf("@");
    const end = start + "@caliper-abc123".length;
    expect(docToWire(spliceDocWireRange(doc, start, end, ""))).toBe("Hi  there");
  });

  it("normalizes inverted start/end before splicing", () => {
    const doc = createTextDoc("abcd");
    expect(docToWire(spliceDocWireRange(doc, 3, 1, "-"))).toBe("a-d");
    expect(docToWire(spliceDocWireRange(doc, 3, 1, ""))).toBe("ad");
  });
});

describe("ambiguous flat wire vs structural doc", () => {
  const agentId = "caliper-zn4u0ymbt";
  const structuralDoc: HandoffNoteDoc = {
    nodes: [
      { type: "text", text: "dhhd " },
      { type: "mention", agentId },
      { type: "text", text: "dhhdh @ " },
    ],
  };

  it("wireToDoc mis-parses text glued after a mention on the flat wire", () => {
    const wire = docToWire(structuralDoc);
    expect(wire).toBe(`dhhd @${agentId}dhhdh @ `);
    expect(wireToDoc(wire).nodes).toEqual([
      { type: "text", text: "dhhd " },
      { type: "mention", agentId: `${agentId}dhhdh` },
      { type: "text", text: " @ " },
    ]);
  });

  it("structural splice keeps text after a committed mention", () => {
    const wire = docToWire(structuralDoc);
    const atOffset = wire.indexOf("@", wire.indexOf(agentId) + agentId.length);
    const next = insertMentionAt(structuralDoc, agentId, atOffset, atOffset + 1);
    expect(next.nodes).toEqual([
      { type: "text", text: "dhhd " },
      { type: "mention", agentId },
      { type: "text", text: "dhhdh " },
      { type: "mention", agentId },
      { type: "text", text: " " },
    ]);
    expect(docToWire(next)).toBe(`dhhd @${agentId}dhhdh @${agentId} `);
  });
});

describe("insertMentionAt", () => {
  it("replaces an active @query with a mention and trailing space", () => {
    const doc = wireToDoc("Fix @ab");
    const queryStart = "Fix ".length;
    const cursor = docToWire(doc).length;
    const next = insertMentionAt(doc, "caliper-abc123", queryStart, cursor);
    expect(docToWire(next)).toBe("Fix @caliper-abc123 ");
  });

  it("inserts mention in empty doc", () => {
    const next = insertMentionAt(emptyHandoffNoteDoc(), "caliper-abc123", 0, 0);
    expect(docToWire(next)).toBe("@caliper-abc123 ");
  });

  it("inserts mention between text nodes", () => {
    const doc = wireToDoc("Hi  there");
    const next = insertMentionAt(doc, "caliper-abc123", 3, 3);
    expect(docToWire(next)).toBe("Hi @caliper-abc123  there");
  });

  it("inserts a second mention before an existing pill when @query abuts it", () => {
    const existing = "caliper-roly0omlb";
    const incoming = "caliper-trzuwweoc";
    const doc: HandoffNoteDoc = {
      nodes: [
        { type: "text", text: "hhh \n\n\n\n@" },
        { type: "mention", agentId: existing },
        { type: "text", text: " " },
      ],
    };
    const queryStart = `hhh \n\n\n\n`.length;
    const next = insertMentionAt(doc, incoming, queryStart, queryStart + 1);
    expect(docToWire(next)).toBe(`hhh \n\n\n\n@${incoming} @${existing} `);
    expect(next.nodes.filter((node) => node.type === "mention")).toHaveLength(2);
  });
});

describe("normalizeHandoffNoteDoc", () => {
  it("coalesces adjacent text nodes without inserting mention separators", () => {
    const doc: HandoffNoteDoc = {
      nodes: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
        { type: "mention", agentId: "caliper-aaa11111" },
        { type: "mention", agentId: "caliper-bbb22222" },
      ],
    };
    const next = normalizeHandoffNoteDoc(doc);
    expect(next.nodes).toEqual([
      { type: "text", text: "ab" },
      { type: "mention", agentId: "caliper-aaa11111" },
      { type: "mention", agentId: "caliper-bbb22222" },
    ]);
  });
});

describe("canonicalizeHandoffNoteDocFromWire", () => {
  it("coalesces text and separates adjacent mentions on wire ingress", () => {
    const doc: HandoffNoteDoc = {
      nodes: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
        { type: "mention", agentId: "caliper-aaa11111" },
        { type: "mention", agentId: "caliper-bbb22222" },
      ],
    };
    const next = canonicalizeHandoffNoteDocFromWire(doc);
    expect(next.nodes).toEqual([
      { type: "text", text: "ab" },
      { type: "mention", agentId: "caliper-aaa11111" },
      { type: "text", text: " " },
      { type: "mention", agentId: "caliper-bbb22222" },
    ]);
  });
});

describe("separateAdjacentMentions", () => {
  it("inserts a space between back-to-back mention atoms", () => {
    const doc: HandoffNoteDoc = {
      nodes: [
        { type: "text", text: "jdjd " },
        { type: "mention", agentId: "caliper-aaa11111" },
        { type: "mention", agentId: "caliper-bbb22222" },
      ],
    };
    const next = separateAdjacentMentions(doc);
    expect(docToWire(next)).toBe("jdjd @caliper-aaa11111 @caliper-bbb22222");
  });
});

describe("docsEqual", () => {
  it("treats wire-equivalent docs as equal", () => {
    const a = wireToDoc("a @caliper-x b");
    const b = wireToDoc("a @caliper-x b");
    expect(docsEqual(a, b)).toBe(true);
  });
});

describe("resolveHandoffNoteMentionEdit", () => {
  it("backspace removes an entire mention when cursor is inside it", () => {
    const note = "Hi @caliper-abc123 there";
    const mentionStart = note.indexOf("@");
    expect(resolveHandoffNoteMentionEdit(wireToDoc(note), mentionStart + 5, "backspace")).toEqual({
      doc: wireToDoc("Hi  there"),
      cursor: mentionStart,
    });
  });

  it("backspace removes an entire mention when cursor is after it", () => {
    const note = "Hi @caliper-abc123";
    expect(resolveHandoffNoteMentionEdit(wireToDoc(note), note.length, "backspace")).toEqual({
      doc: wireToDoc("Hi "),
      cursor: 3,
    });
  });

  it("backspace leaves plain text alone", () => {
    expect(resolveHandoffNoteMentionEdit(wireToDoc("hello"), 3, "backspace")).toBeNull();
  });

  it("delete removes an entire mention when cursor is inside it", () => {
    const note = "Hi @caliper-abc123 there";
    const mentionStart = note.indexOf("@");
    expect(resolveHandoffNoteMentionEdit(wireToDoc(note), mentionStart + 1, "delete")).toEqual({
      doc: wireToDoc("Hi  there"),
      cursor: mentionStart,
    });
  });
});

describe("resolveHandoffNoteArrowMove", () => {
  const note = "Hi @caliper-abc123 there";
  const doc = wireToDoc(note);
  const mentionStart = note.indexOf("@");
  const mentionEnd = mentionStart + 1 + "caliper-abc123".length;

  it("jumps from after a mention to its start on ArrowLeft", () => {
    expect(resolveHandoffNoteArrowMove(doc, mentionEnd, "left")).toEqual({
      cursor: mentionStart,
      handled: true,
    });
  });

  it("jumps from before a mention to its end on ArrowRight", () => {
    expect(resolveHandoffNoteArrowMove(doc, mentionStart, "right")).toEqual({
      cursor: mentionEnd,
      handled: true,
    });
  });

  it("jumps out of mention interiors toward the arrow direction", () => {
    expect(resolveHandoffNoteArrowMove(doc, mentionStart + 3, "left")).toEqual({
      cursor: mentionStart,
      handled: true,
    });
    expect(resolveHandoffNoteArrowMove(doc, mentionStart + 3, "right")).toEqual({
      cursor: mentionEnd,
      handled: true,
    });
  });

  it("steps through plain text with handled true", () => {
    expect(resolveHandoffNoteArrowMove(doc, mentionEnd + 1, "left")).toEqual({
      cursor: mentionEnd,
      handled: true,
    });
  });

  it("steps left from the start of a mention instead of delegating to the browser", () => {
    expect(resolveHandoffNoteArrowMove(doc, mentionStart, "left")).toEqual({
      cursor: mentionStart - 1,
      handled: true,
    });
  });

  it("steps right from the end of a mention instead of delegating to the browser", () => {
    expect(resolveHandoffNoteArrowMove(doc, mentionEnd, "right")).toEqual({
      cursor: mentionEnd + 1,
      handled: true,
    });
  });

  it("steps left across newlines before a mention on the next line", () => {
    const multiline = "hhshhs \n\n\n\n\n@caliper-abc123 ";
    const multilineDoc = wireToDoc(multiline);
    const mentionStart = multiline.indexOf("@");
    expect(resolveHandoffNoteArrowMove(multilineDoc, mentionStart, "left")).toEqual({
      cursor: mentionStart - 1,
      handled: true,
    });
    expect(resolveHandoffNoteArrowMove(multilineDoc, mentionStart - 1, "left")).toEqual({
      cursor: mentionStart - 2,
      handled: true,
    });
  });

  it("crosses a trailing space before jumping over the mention", () => {
    const spaced = "Hi @caliper-abc123 there";
    const spacedDoc = wireToDoc(spaced);
    const end = spaced.indexOf("@") + 1 + "caliper-abc123".length;
    expect(resolveHandoffNoteArrowMove(spacedDoc, end, "left")).toEqual({
      cursor: spaced.indexOf("@"),
      handled: true,
    });
  });
});

describe("resolveHandoffWireCursor", () => {
  const note = "Hi @caliper-abc123 there";
  const doc = wireToDoc(note);
  const mentionStart = note.indexOf("@");
  const mentionEnd = mentionStart + 1 + "caliper-abc123".length;

  it("clamps and snaps mention interiors before render", () => {
    expect(resolveHandoffWireCursor(doc, mentionStart + 3, mentionEnd)).toBe(mentionStart);
    expect(resolveHandoffWireCursor(doc, note.length + 5, 0)).toBe(note.length);
    expect(resolveHandoffWireCursor(doc, mentionStart, mentionStart)).toBe(mentionStart);
  });
});

describe("snapHandoffNoteCursorOutOfMentionInterior", () => {
  const note = "Hi @caliper-abc123 there";
  const doc = wireToDoc(note);
  const mentionStart = note.indexOf("@");
  const mentionEnd = mentionStart + 1 + "caliper-abc123".length;

  it("snaps toward start when moving left into a mention", () => {
    expect(snapHandoffNoteCursorOutOfMentionInterior(doc, mentionEnd - 1, mentionEnd)).toBe(
      mentionStart
    );
  });

  it("snaps toward end when moving right into a mention", () => {
    expect(snapHandoffNoteCursorOutOfMentionInterior(doc, mentionStart + 1, mentionStart)).toBe(
      mentionEnd
    );
  });
});

describe("sanitizeMentionPasteWire", () => {
  const agentA = "caliper-nfyjfcdjk";
  const agentB = "caliper-81nzvlqbv";

  it("leaves canonical mention wire unchanged", async () => {
    const { sanitizeMentionPasteWire } = await import("./handoff-note-paste.js");
    const wire = `@${agentA} @${agentB} `;
    expect(sanitizeMentionPasteWire(wire)).toBe(wire);
  });

  it("removes plain agent-id echo after mention tokens", async () => {
    const { sanitizeMentionPasteWire } = await import("./handoff-note-paste.js");
    const doubled = `@${agentA} @${agentB} ${agentA} ${agentB} `;
    expect(sanitizeMentionPasteWire(doubled)).toBe(`@${agentA} @${agentB}`);
  });
});

describe("docSelectionToWire", () => {
  it("serializes a range across mention atoms as wire tokens", async () => {
    const { docSelectionToWire, wireOffsetToDocPos } = await import("./handoff-note-doc-pos.js");
    const agentA = "caliper-abc123";
    const agentB = "caliper-def456";
    const wire = `hi @${agentA} @${agentB} `;
    const doc = wireToDoc(wire);
    const start = wireOffsetToDocPos(doc, 0);
    const end = wireOffsetToDocPos(doc, wire.length);
    expect(docSelectionToWire(doc, { anchor: start, focus: end })).toBe(wire);
  });
});
