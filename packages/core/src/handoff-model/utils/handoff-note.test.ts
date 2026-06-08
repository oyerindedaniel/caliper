import { describe, expect, it } from "vitest";
import { filterHandoffItems, handoffItemLabel, resolveHandoffNote } from "./handoff-note.js";

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

describe("handoffItemLabel", () => {
  it("prefers element text", () => {
    expect(
      handoffItemLabel({ selector: "caliper-a", text: "  Buy now  ", tagName: "button" })
    ).toBe("Buy now");
  });
});
