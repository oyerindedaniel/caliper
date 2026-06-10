import { describe, expect, it } from "vitest";
import {
  filterHandoffItems,
  formatHandoffAgentIdPill,
  handoffItemLabel,
  parseHandoffNoteSegments,
  resolveHandoffNote,
  resolveHandoffNoteAtomicEdit,
  resolveHandoffNoteArrowMove,
  snapHandoffNoteCursorOutOfMentionInterior,
  isExactHandoffMentionQuery,
  isHandoffPendingNoteEmpty,
} from "./handoff-note.js";

describe("resolveHandoffNote", () => {
  it("strips @ from agent id mentions", () => {
    expect(resolveHandoffNote("Fix @caliper-abc123 next to @caliper-def456 alignment")).toBe(
      "Fix caliper-abc123 next to caliper-def456 alignment"
    );
  });

  it("leaves plain text unchanged", () => {
    expect(resolveHandoffNote("No mentions here")).toBe("No mentions here");
  });
});

describe("filterHandoffItems", () => {
  const items = [
    {
      agentId: "caliper-abc123",
      fingerprint: { selector: "caliper-abc123", text: "Submit", tagName: "button" },
    },
    {
      agentId: "caliper-xyz789",
      fingerprint: { selector: "caliper-xyz789", text: "Cancel", tagName: "button" },
    },
  ];

  it("returns all items for empty query", () => {
    expect(filterHandoffItems(items, "")).toHaveLength(2);
  });

  it("filters by agent id fragment", () => {
    expect(filterHandoffItems(items, "xyz")).toEqual([items[1]]);
  });

  it("filters by label text", () => {
    expect(filterHandoffItems(items, "sub")).toEqual([items[0]]);
  });

  it("matches labels when query omits spaces", () => {
    const prose = [
      {
        agentId: "caliper-prose1",
        fingerprint: { selector: "caliper-prose1", text: "The boy is gold", tagName: "p" },
      },
    ];
    expect(filterHandoffItems(prose, "theboy")).toEqual(prose);
  });
});

describe("parseHandoffNoteSegments", () => {
  it("splits text and mention tokens", () => {
    expect(parseHandoffNoteSegments("Fix @caliper-abc123 next")).toEqual([
      { type: "text", value: "Fix " },
      { type: "mention", agentId: "caliper-abc123" },
      { type: "text", value: " next" },
    ]);
  });
});

describe("resolveHandoffNoteAtomicEdit", () => {
  it("backspace removes an entire mention when cursor is inside it", () => {
    const note = "Hi @caliper-abc123 there";
    const mentionStart = note.indexOf("@");
    expect(resolveHandoffNoteAtomicEdit(note, mentionStart + 5, "backspace")).toEqual({
      note: "Hi  there",
      cursor: mentionStart,
    });
  });

  it("backspace removes an entire mention when cursor is after it", () => {
    const note = "Hi @caliper-abc123";
    expect(resolveHandoffNoteAtomicEdit(note, note.length, "backspace")).toEqual({
      note: "Hi ",
      cursor: 3,
    });
  });

  it("backspace leaves plain text alone", () => {
    expect(resolveHandoffNoteAtomicEdit("hello", 3, "backspace")).toBeNull();
  });

  it("delete removes an entire mention when cursor is inside it", () => {
    const note = "Hi @caliper-abc123 there";
    const mentionStart = note.indexOf("@");
    expect(resolveHandoffNoteAtomicEdit(note, mentionStart + 1, "delete")).toEqual({
      note: "Hi  there",
      cursor: mentionStart,
    });
  });
});

describe("resolveHandoffNoteArrowMove", () => {
  const note = "Hi @caliper-abc123 there";
  const mentionStart = note.indexOf("@");
  const mentionEnd = mentionStart + 1 + "caliper-abc123".length;

  it("jumps from after a mention to its start on ArrowLeft", () => {
    expect(resolveHandoffNoteArrowMove(note, mentionEnd, "left")).toEqual({
      cursor: mentionStart,
      handled: true,
    });
  });

  it("jumps from before a mention to its end on ArrowRight", () => {
    expect(resolveHandoffNoteArrowMove(note, mentionStart, "right")).toEqual({
      cursor: mentionEnd,
      handled: true,
    });
  });

  it("jumps out of mention interiors toward the arrow direction", () => {
    expect(resolveHandoffNoteArrowMove(note, mentionStart + 3, "left")).toEqual({
      cursor: mentionStart,
      handled: true,
    });
    expect(resolveHandoffNoteArrowMove(note, mentionStart + 3, "right")).toEqual({
      cursor: mentionEnd,
      handled: true,
    });
  });

  it("steps through plain text normally", () => {
    expect(resolveHandoffNoteArrowMove(note, mentionEnd + 1, "left")).toEqual({
      cursor: mentionEnd + 1,
      handled: false,
    });
  });

  it("crosses a trailing space before jumping over the mention", () => {
    const spaced = "Hi @caliper-abc123 there";
    const end = spaced.indexOf("@") + 1 + "caliper-abc123".length;
    const spaceIndex = end;
    expect(resolveHandoffNoteArrowMove(spaced, spaceIndex, "left")).toEqual({
      cursor: spaced.indexOf("@"),
      handled: true,
    });
  });
});

describe("snapHandoffNoteCursorOutOfMentionInterior", () => {
  const note = "Hi @caliper-abc123 there";
  const mentionStart = note.indexOf("@");
  const mentionEnd = mentionStart + 1 + "caliper-abc123".length;

  it("snaps toward start when moving left into a mention", () => {
    expect(snapHandoffNoteCursorOutOfMentionInterior(note, mentionEnd - 1, mentionEnd)).toBe(
      mentionStart
    );
  });

  it("snaps toward end when moving right into a mention", () => {
    expect(snapHandoffNoteCursorOutOfMentionInterior(note, mentionStart + 1, mentionStart)).toBe(
      mentionEnd
    );
  });
});

describe("isExactHandoffMentionQuery", () => {
  const agentIds = ["caliper-abc123", "caliper-xyz789"];

  it("matches a full registered agent id", () => {
    expect(isExactHandoffMentionQuery("caliper-abc123", agentIds)).toBe(true);
  });

  it("rejects partial queries still being typed", () => {
    expect(isExactHandoffMentionQuery("caliper-ab", agentIds)).toBe(false);
  });

  it("rejects empty queries", () => {
    expect(isExactHandoffMentionQuery("", agentIds)).toBe(false);
  });
});

describe("isHandoffPendingNoteEmpty", () => {
  it("treats blank and whitespace-only notes as empty", () => {
    expect(isHandoffPendingNoteEmpty("")).toBe(true);
    expect(isHandoffPendingNoteEmpty("   ")).toBe(true);
  });

  it("allows committed mention tokens and plain text", () => {
    expect(isHandoffPendingNoteEmpty("@caliper-abc123 ")).toBe(false);
    expect(isHandoffPendingNoteEmpty("ship it")).toBe(false);
  });
});

describe("formatHandoffAgentIdPill", () => {
  it("drops caliper- prefix for display", () => {
    expect(formatHandoffAgentIdPill("caliper-abc123")).toBe("abc123");
  });
});

describe("handoffItemLabel", () => {
  it("prefers element text", () => {
    expect(
      handoffItemLabel({ selector: "caliper-a", text: "  Buy now  ", tagName: "button" })
    ).toBe("Buy now");
  });
});
