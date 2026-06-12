import { describe, expect, it } from "vitest";
import { parseHandoffNoteWire } from "../note-doc/handoff-note-doc.js";
import {
  filterHandoffItems,
  formatHandoffAgentIdPill,
  handoffItemLabel,
  resolveHandoffNote,
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

describe("parseHandoffNoteWire", () => {
  it("splits text and mention tokens", () => {
    expect(parseHandoffNoteWire("Fix @caliper-abc123 next")).toEqual([
      { type: "text", text: "Fix " },
      { type: "mention", agentId: "caliper-abc123" },
      { type: "text", text: " next" },
    ]);
  });
});

describe("isExactHandoffMentionQuery", () => {
  it("matches a full agent id token", () => {
    expect(isExactHandoffMentionQuery("caliper-abc123", ["caliper-abc123", "caliper-xyz789"])).toBe(
      true
    );
  });

  it("rejects partial tokens", () => {
    expect(isExactHandoffMentionQuery("abc", ["caliper-abc123"])).toBe(false);
  });
});

describe("isHandoffPendingNoteEmpty", () => {
  it("treats whitespace-only notes as empty", () => {
    expect(isHandoffPendingNoteEmpty("   ")).toBe(true);
  });

  it("treats mention-only whitespace as empty after resolve", () => {
    expect(isHandoffPendingNoteEmpty("@caliper-abc123 ")).toBe(false);
  });
});

describe("formatHandoffAgentIdPill", () => {
  it("compact drops caliper- prefix", () => {
    expect(formatHandoffAgentIdPill("caliper-abc123")).toBe("abc123");
  });

  it("full keeps the agent id", () => {
    expect(formatHandoffAgentIdPill("caliper-abc123", "full")).toBe("caliper-abc123");
  });
});

describe("handoffItemLabel", () => {
  it("prefers trimmed text", () => {
    expect(handoffItemLabel({ selector: "x", text: "Hello" })).toBe("Hello");
  });
});
