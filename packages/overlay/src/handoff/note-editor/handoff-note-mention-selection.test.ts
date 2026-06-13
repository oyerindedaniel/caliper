import { describe, expect, it } from "vitest";
import { docPosToWireOffset, wireOffsetToDocPos, wireToDoc } from "@caliper/core";
import { resolveSelectedMentionArrowExit } from "./handoff-note-mention-selection.js";

describe("resolveSelectedMentionArrowExit", () => {
  const agent = "caliper-aaaaaaa";

  it("vertical exit lands on the mention row start", () => {
    const wire = `notes here\n@${agent} tail\nbelow`;
    const doc = wireToDoc(wire);
    const mentionNode = doc.nodes.findIndex((node) => node.type === "mention");
    const rowStart = wire.indexOf("\n") + 1;
    const expected = wireOffsetToDocPos(doc, rowStart);

    expect(resolveSelectedMentionArrowExit(doc, mentionNode, "down")).toEqual(expected);
    expect(resolveSelectedMentionArrowExit(doc, mentionNode, "up")).toEqual(expected);
  });

  it("horizontal exit lands on the pill end", () => {
    const wire = `@${agent} tail`;
    const doc = wireToDoc(wire);
    const pillEnd = wire.indexOf("@") + `@${agent}`.length;
    for (const direction of ["left", "right"] as const) {
      const exit = resolveSelectedMentionArrowExit(doc, 0, direction);
      expect(exit).not.toBeNull();
      expect(docPosToWireOffset(doc, exit!)).toBe(pillEnd);
    }
  });
});
