import { describe, expect, it } from "vitest";
import {
  applyDocDelete,
  applyDocInsertText,
  applyDocLineBreak,
  insertMentionAtSelection,
  spliceDocSelection,
} from "./handoff-note-doc-edits.js";
import {
  collapsedSelection,
  docPosToWireOffset,
  resolveDocVerticalArrowMove,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import { docToWire, normalizeHandoffNoteDoc, wireToDoc } from "./handoff-note-doc.js";
import { resolveActiveHandoffMentionQueryDoc } from "../utils/handoff-note.js";

describe("spliceDocSelection", () => {
  it("replaces a wire range derived from doc positions", () => {
    const doc = wireToDoc("hello");
    const start = wireOffsetToDocPos(doc, 2);
    const end = wireOffsetToDocPos(doc, 4);
    const result = spliceDocSelection(doc, start, end, "p");
    expect(docToWire(result.doc)).toBe("hepo");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(3);
  });
});

describe("applyDocInsertText", () => {
  it("inserts plain text at a collapsed caret", () => {
    const doc = wireToDoc("hello");
    const focus = wireOffsetToDocPos(doc, 5);
    const result = applyDocInsertText(doc, collapsedSelection(focus), "!");
    expect(docToWire(result.doc)).toBe("hello!");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(6);
  });

  it("inserts a spaced @ after a committed mention end", () => {
    const agentId = "caliper-abc123";
    const wire = `dhhd @${agentId} `;
    const doc = wireToDoc(wire);
    const focus = wireOffsetToDocPos(doc, `dhhd @${agentId}`.length);
    const result = applyDocInsertText(doc, collapsedSelection(focus), "@");
    expect(docToWire(result.doc)).toBe(`dhhd @${agentId} @ `);
  });

  it("inserts at mention start without entering the pill", () => {
    const agentId = "caliper-rrrhd9muz";
    const wire = `DHD \n\n\n\n@${agentId} `;
    const doc = wireToDoc(wire);
    const mentionStart = wire.indexOf("@");
    const mentionNodeIndex = doc.nodes.findIndex((node) => node.type === "mention");
    const focus = wireOffsetToDocPos(doc, mentionStart);
    const result = applyDocInsertText(doc, collapsedSelection(focus), "D");
    expect(docToWire(result.doc)).toBe(`DHD \n\n\n\nD@${agentId} `);
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
    expect(result.selection.focus.nodeIndex).toBe(mentionNodeIndex - 1);
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(mentionStart + 1);
  });

  it("appends in the pre-mention text node when the caret is on the mention atom", () => {
    const agentId = "caliper-q91s2jvy5";
    const wire = `djdjd @${agentId} `;
    const doc = wireToDoc(wire);
    const mentionNodeIndex = doc.nodes.findIndex((node) => node.type === "mention");
    const result = applyDocInsertText(
      doc,
      collapsedSelection({ nodeIndex: mentionNodeIndex, nodeOffset: 0 }),
      "y"
    );
    expect(docToWire(result.doc)).toBe(`djdjd y@${agentId} `);
    expect(result.selection.focus.nodeIndex).toBe(mentionNodeIndex - 1);
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
  });

  it("keeps consecutive insertions in the pre-mention text node from a mention atom", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `djdjd @${agentA} @${agentB} `;
    const doc = wireToDoc(wire);
    const mentionNodeIndex = doc.nodes.reduce(
      (last, node, nodeIndex) => (node.type === "mention" ? nodeIndex : last),
      -1
    );
    const onMention = { nodeIndex: mentionNodeIndex, nodeOffset: 0 };

    let state = applyDocInsertText(doc, collapsedSelection(onMention), "y");
    const textIdx = mentionNodeIndex - 1;
    state = applyDocInsertText(state.doc, state.selection, "y");
    state = applyDocInsertText(state.doc, state.selection, "y");

    expect(docToWire(state.doc)).toBe(`djdjd @${agentA} yyy@${agentB} `);
    expect(state.selection.focus.nodeIndex).toBe(textIdx);
    expect(state.doc.nodes[state.selection.focus.nodeIndex]?.type).toBe("text");
  });

  it("appends in the text node at a mention boundary after line breaks", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `ab @${agentA} @${agentB} tail`;
    const doc = wireToDoc(wire);
    const mentionStart = wire.lastIndexOf("@");

    let state = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, mentionStart)));
    for (let i = 0; i < 3; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }

    const priorFocus = state.selection.focus;
    const result = applyDocInsertText(state.doc, state.selection, "d");

    expect(docToWire(result.doc)).toBe(`ab @${agentA} \n\n\n\nd@${agentB} tail`);
    expect(result.selection.focus.nodeIndex).toBe(priorFocus.nodeIndex);
    expect(result.selection.focus.nodeOffset).toBeGreaterThan(priorFocus.nodeOffset);
    expect(doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
  });

  it("inserts locally after vertical move onto a blank line before a committed mention", () => {
    const agent = "caliper-qyuw2w0jq";
    const wire = `djd @${agent} d@${agent} ddjjdggdg\n\n\n @${agent} @${agent} `;
    const doc = wireToDoc(wire);
    const typingInText = wire.indexOf("ddjjdggdg") + 4;
    const moved = resolveDocVerticalArrowMove(doc, wireOffsetToDocPos(doc, typingInText), "down");
    expect(moved.handled).toBe(true);

    const result = applyDocInsertText(doc, collapsedSelection(moved.pos), "d");

    const mentionCount = doc.nodes.filter((node) => node.type === "mention").length;
    expect(result.doc.nodes.filter((node) => node.type === "mention").length).toBe(mentionCount);
    expect(docToWire(result.doc)).toMatch(new RegExp(`\\n @${agent} @${agent} $`));
    expect(docToWire(result.doc)).not.toMatch(new RegExp(` d@${agent} @${agent}`));
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
  });

  it("keeps appending in the text node across consecutive characters at a boundary", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `ab @${agentA} @${agentB} tail`;
    const doc = wireToDoc(wire);

    let state = applyDocLineBreak(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, wire.lastIndexOf("@")))
    );

    state = applyDocInsertText(state.doc, state.selection, "d");
    const afterD = state.selection.focus;
    state = applyDocInsertText(state.doc, state.selection, "h");

    expect(docToWire(state.doc)).toBe(`ab @${agentA} \ndh@${agentB} tail`);
    expect(state.selection.focus.nodeIndex).toBe(afterD.nodeIndex);
    expect(state.selection.focus.nodeOffset).toBeGreaterThan(afterD.nodeOffset);
    expect(doc.nodes[state.selection.focus.nodeIndex]?.type).toBe("text");
  });
});

describe("applyDocLineBreak", () => {
  it("inserts a newline at mention start", () => {
    const agentId = "caliper-abc123";
    const wire = `dd @${agentId} `;
    const doc = wireToDoc(wire);
    const focus = wireOffsetToDocPos(doc, "dd ".length);
    const result = applyDocLineBreak(doc, collapsedSelection(focus));
    expect(docToWire(result.doc)).toBe(`dd \n@${agentId} `);
  });

  it("places caret in the text node after a break before a later mention", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `ab @${agentA} @${agentB} tail`;
    const doc = wireToDoc(wire);
    const mentionStart = wire.lastIndexOf("@");
    const focus = wireOffsetToDocPos(doc, mentionStart);

    const result = applyDocLineBreak(doc, collapsedSelection(focus));

    expect(docToWire(result.doc)).toBe(`ab @${agentA} \n@${agentB} tail`);
    expect(result.selection.focus).not.toEqual(focus);
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
    const caretWire = docPosToWireOffset(result.doc, result.selection.focus);
    expect(caretWire).not.toBe(mentionStart);
    expect(caretWire).toBeGreaterThan(mentionStart);
  });

  it("advances caret across consecutive breaks before a mention", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `ab @${agentA} @${agentB} tail`;
    const doc = wireToDoc(wire);
    const focus = wireOffsetToDocPos(doc, wire.lastIndexOf("@"));

    const first = applyDocLineBreak(doc, collapsedSelection(focus));
    const second = applyDocLineBreak(first.doc, first.selection);

    expect(second.selection.focus).not.toEqual(first.selection.focus);
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBeGreaterThan(
      docPosToWireOffset(first.doc, first.selection.focus)
    );
  });

  it("keeps caret on the content line when breaking from the mention atom", () => {
    const agent = "caliper-qa9roq9pp";
    const wire = `djdjdj @${agent} `;
    const doc = wireToDoc(wire);
    const onMention = {
      nodeIndex: doc.nodes.findIndex((node) => node.type === "mention"),
      nodeOffset: 0,
    };
    const mentionStartWire = docPosToWireOffset(doc, onMention);

    const result = applyDocLineBreak(doc, collapsedSelection(onMention));

    expect(docToWire(result.doc)).toBe(`djdjdj \n@${agent} `);
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBeLessThan(mentionStartWire);
  });

  it("keeps caret on the content line when breaking from a later mention atom", () => {
    const agent = "caliper-qa9roq9pp";
    const wire = `dhhd @${agent} dhhd @${agent} `;
    const doc = wireToDoc(wire);
    let mentionCount = 0;
    let onMention = { nodeIndex: 0, nodeOffset: 0 };
    for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
      if (doc.nodes[nodeIndex]?.type === "mention") {
        mentionCount++;
        if (mentionCount === 2) {
          onMention = { nodeIndex, nodeOffset: 0 };
          break;
        }
      }
    }
    const mentionStartWire = docPosToWireOffset(doc, onMention);

    const result = applyDocLineBreak(doc, collapsedSelection(onMention));

    expect(docToWire(result.doc)).toBe(`dhhd @${agent} dhhd \n@${agent} `);
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBeLessThan(mentionStartWire);
  });

  it("advances caret past the pre-break mention wire when the gap is whitespace only", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `ab @${agentA} @${agentB} tail`;
    const doc = wireToDoc(wire);
    const onMention = wireOffsetToDocPos(doc, wire.lastIndexOf("@"));
    const mentionStartWire = docPosToWireOffset(doc, onMention);

    const result = applyDocLineBreak(doc, collapsedSelection(onMention));

    expect(docToWire(result.doc)).toBe(`ab @${agentA} \n@${agentB} tail`);
    const caretWire = docPosToWireOffset(result.doc, result.selection.focus);
    expect(caretWire).not.toBe(mentionStartWire);
    expect(caretWire).toBeGreaterThan(mentionStartWire);
  });

  it("consecutive breaks from a mention atom add blank lines before the pill", () => {
    const agent = "caliper-qa9roq9pp";
    const wire = `djdjdj @${agent} `;
    const doc = wireToDoc(wire);
    const first = applyDocLineBreak(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, wire.indexOf("@")))
    );
    const second = applyDocLineBreak(first.doc, first.selection);

    expect(docToWire(second.doc)).toBe(`djdjdj \n\n@${agent} `);
    const textNode = second.doc.nodes[second.selection.focus.nodeIndex];
    expect(textNode?.type).toBe("text");
    if (textNode?.type === "text") {
      expect(second.selection.focus.nodeOffset).toBe(textNode.text.length);
    }
  });

  it("never leaves caret at the pre-break mention wire when breaking from a mention atom", () => {
    const agent = "caliper-qa9roq9pp";
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wires = [
      `djdjd @${agent} `,
      `djdjd @${agent} @${agent} `,
      `ab @${agentA} @${agentB} tail`,
      `dhhd @${agent} dhhd @${agent} `,
    ];

    for (const wire of wires) {
      const doc = wireToDoc(wire);
      const onMention = wireOffsetToDocPos(doc, wire.lastIndexOf("@"));
      const mentionStartWire = docPosToWireOffset(doc, onMention);
      const result = applyDocLineBreak(doc, collapsedSelection(onMention));
      expect(docPosToWireOffset(result.doc, result.selection.focus), wire).not.toBe(
        mentionStartWire
      );
    }
  });

  it("consecutive breaks from a later pill with a whitespace gap", () => {
    const agent = "caliper-qa9roq9pp";
    const wire = `djdjd @${agent} @${agent} `;
    const doc = wireToDoc(wire);
    const onMention = wireOffsetToDocPos(doc, wire.lastIndexOf("@"));
    const first = applyDocLineBreak(doc, collapsedSelection(onMention));
    const second = applyDocLineBreak(first.doc, first.selection);

    expect(docToWire(second.doc)).toBe(`djdjd @${agent} \n\n@${agent} `);
  });
});

describe("applyDocDelete", () => {
  const agentA = "caliper-aaaaaaa";
  const agentB = "caliper-bbbbbbb";
  const agentC = "caliper-ccccccc";

  function interMentionGapIndex(doc: ReturnType<typeof wireToDoc>, which = 0) {
    const indices = doc.nodes
      .map((node, nodeIndex) =>
        node.type === "text" &&
        doc.nodes[nodeIndex - 1]?.type === "mention" &&
        doc.nodes[nodeIndex + 1]?.type === "mention"
          ? nodeIndex
          : -1
      )
      .filter((nodeIndex) => nodeIndex >= 0);
    return indices[which]!;
  }

  function deleteLikeEditor(
    doc: ReturnType<typeof wireToDoc>,
    pos: { nodeIndex: number; nodeOffset: number },
    direction: "backspace" | "delete"
  ) {
    const result = applyDocDelete(doc, collapsedSelection(pos), direction);
    if (!result) {
      return null;
    }
    return { ...result, doc: normalizeHandoffNoteDoc(result.doc) };
  }

  it("deletes a committed mention with backspace at its end", () => {
    const wire = "Hi @caliper-abc123 there";
    const doc = wireToDoc(wire);
    const focus = wireOffsetToDocPos(doc, "Hi @caliper-abc123".length);
    const result = applyDocDelete(doc, collapsedSelection(focus), "backspace");
    expect(result).not.toBeNull();
    expect(docToWire(result!.doc)).toBe("Hi  there");
  });

  it("deletes selected text", () => {
    const doc = wireToDoc("hello");
    const anchor = wireOffsetToDocPos(doc, 1);
    const focus = wireOffsetToDocPos(doc, 4);
    const result = applyDocDelete(doc, { anchor, focus }, "backspace");
    expect(docToWire(result!.doc)).toBe("ho");
  });

  it("forward delete in a single-space inter-mention gap survives normalize", () => {
    const wire = `@${agentA} @${agentB} @${agentC} `;
    const doc = wireToDoc(wire);
    const gapIdx = interMentionGapIndex(doc, 0);
    const result = deleteLikeEditor(doc, { nodeIndex: gapIdx, nodeOffset: 0 }, "delete");
    expect(result).not.toBeNull();
    expect(docToWire(result!.doc)).toBe(`@${agentA}@${agentB} @${agentC} `);
  });

  it("backspace at gap start removes gap text without deleting the left pill", () => {
    const wire = `@${agentA} @${agentB} @${agentC} `;
    const doc = wireToDoc(wire);
    const gapIdx = interMentionGapIndex(doc, 0);
    const result = deleteLikeEditor(doc, { nodeIndex: gapIdx, nodeOffset: 0 }, "backspace");
    expect(result).not.toBeNull();
    expect(docToWire(result!.doc)).toBe(`@${agentA}@${agentB} @${agentC} `);
  });

  it("forward delete at gap end is a no-op", () => {
    const wire = `@${agentA} @${agentB} `;
    const doc = wireToDoc(wire);
    const gapIdx = interMentionGapIndex(doc, 0);
    const gapLen = doc.nodes[gapIdx]!.type === "text" ? doc.nodes[gapIdx]!.text.length : 0;
    expect(deleteLikeEditor(doc, { nodeIndex: gapIdx, nodeOffset: gapLen }, "delete")).toBeNull();
  });

  it("places caret on the left mention end when a gap separator is fully removed", () => {
    const wire = `@${agentA} @${agentB} `;
    const doc = wireToDoc(wire);
    const gapIdx = interMentionGapIndex(doc, 0);
    const result = deleteLikeEditor(doc, { nodeIndex: gapIdx, nodeOffset: 0 }, "delete");
    expect(result).not.toBeNull();
    expect(docToWire(result!.doc)).toBe(`@${agentA}@${agentB} `);
    const focusNode = result!.doc.nodes[result!.selection.focus.nodeIndex];
    expect(focusNode?.type).toBe("mention");
    if (focusNode?.type === "mention") {
      expect(focusNode.agentId).toBe(agentA);
      expect(result!.selection.focus.nodeOffset).toBe(1 + agentA.length);
    }
  });

  it("does not remove the right pill on a second forward delete after merging a gap", () => {
    const wire = `@${agentA} @${agentA} @${agentB} `;
    const doc = wireToDoc(wire);
    const gapIdx = interMentionGapIndex(doc, 1);
    const first = deleteLikeEditor(doc, { nodeIndex: gapIdx, nodeOffset: 0 }, "delete");
    expect(first).not.toBeNull();
    expect(docToWire(first!.doc)).toBe(`@${agentA} @${agentA}@${agentB} `);
    expect(deleteLikeEditor(first!.doc, first!.selection.focus, "delete")).toBeNull();
  });

  it("forward delete at an adjacent mention boundary is a no-op", () => {
    const doc = normalizeHandoffNoteDoc({
      nodes: [
        { type: "mention", agentId: agentA },
        { type: "mention", agentId: agentB },
        { type: "text", text: " " },
      ],
    });
    const rightMentionIdx = doc.nodes.findIndex(
      (node) => node.type === "mention" && node.agentId === agentB
    );
    expect(
      deleteLikeEditor(doc, { nodeIndex: rightMentionIdx, nodeOffset: 0 }, "delete")
    ).toBeNull();
  });

  describe("backspace at mention atom start", () => {
    function mentionStartPos(doc: ReturnType<typeof wireToDoc>, agentId: string) {
      const idx = doc.nodes.findIndex(
        (node) => node.type === "mention" && node.agentId === agentId
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      return { nodeIndex: idx, nodeOffset: 0 };
    }

    it("control: backspace at mention end deletes the whole mention", () => {
      const wire = `Hi @${agentA} there`;
      const doc = wireToDoc(wire);
      const mentionEnd = wireOffsetToDocPos(doc, `Hi @${agentA}`.length);
      const result = applyDocDelete(doc, collapsedSelection(mentionEnd), "backspace");
      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe("Hi  there");
    });

    it("nibbles the separator before a mention from the end and moves caret into that text node", () => {
      const wire = `prefix @${agentA} suffix @${agentB} `;
      const doc = wireToDoc(wire);
      const focus = mentionStartPos(doc, agentB);
      const result = applyDocDelete(doc, collapsedSelection(focus), "backspace");
      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`prefix @${agentA} suffix@${agentB} `);
      const focusNode = result!.doc.nodes[result!.selection.focus.nodeIndex];
      expect(focusNode?.type).toBe("text");
      expect(result!.selection.focus.nodeOffset).toBe(
        focusNode?.type === "text" ? focusNode.text.length : -1
      );
    });

    it("keeps nibbling preceding text while caret stays in that text node", () => {
      const wire = `prefix @${agentA} suffix @${agentB} `;
      let doc = wireToDoc(wire);
      let focus = mentionStartPos(doc, agentB);
      let state = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      state = applyDocDelete(state.doc, state.selection, "backspace")!;
      expect(docToWire(state.doc)).toBe(`prefix @${agentA} suffi@${agentB} `);
      const focusNode = state.doc.nodes[state.selection.focus.nodeIndex];
      expect(focusNode?.type).toBe("text");
      expect(state.selection.focus.nodeOffset).toBe(
        focusNode?.type === "text" ? focusNode.text.length : -1
      );
    });

    it("deletes the mention atom when there is no preceding text to nibble", () => {
      const doc = normalizeHandoffNoteDoc({
        nodes: [
          { type: "mention", agentId: agentA },
          { type: "mention", agentId: agentB },
          { type: "text", text: " " },
        ],
      });
      const focus = mentionStartPos(doc, agentB);
      const result = applyDocDelete(doc, collapsedSelection(focus), "backspace");
      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`@${agentA} `);
      const focusNode = result!.doc.nodes[result!.selection.focus.nodeIndex];
      expect(focusNode?.type).toBe("text");
      if (focusNode?.type === "text") {
        expect(focusNode.text).toBe(" ");
        expect(result!.selection.focus.nodeOffset).toBe(0);
      }
    });
  });

  describe("forward delete at mention boundaries", () => {
    function mentionStartPos(doc: ReturnType<typeof wireToDoc>, agentId: string) {
      const idx = doc.nodes.findIndex(
        (node) => node.type === "mention" && node.agentId === agentId
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      return { nodeIndex: idx, nodeOffset: 0 };
    }

    function textEndBeforeMention(doc: ReturnType<typeof wireToDoc>, agentId: string) {
      const idx = doc.nodes.findIndex(
        (node) => node.type === "mention" && node.agentId === agentId
      );
      expect(idx).toBeGreaterThan(0);
      const textNode = doc.nodes[idx - 1]!;
      expect(textNode.type).toBe("text");
      return {
        nodeIndex: idx - 1,
        nodeOffset: textNode.type === "text" ? textNode.text.length : 0,
      };
    }

    it("deletes the whole mention when caret is on the mention atom start", () => {
      const wire = `prefix @${agentA} suffix @${agentB}`;
      const doc = wireToDoc(wire);
      const focus = mentionStartPos(doc, agentB);
      const result = applyDocDelete(doc, collapsedSelection(focus), "delete");
      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`prefix @${agentA} suffix `);
      expect(docToWire(result!.doc)).not.toContain(agentB);
    });

    it("is a no-op at the text-before-mention boundary (does not nibble preceding text)", () => {
      const wire = `prefix @${agentA} suffix @${agentB}`;
      const doc = wireToDoc(wire);
      const focus = textEndBeforeMention(doc, agentB);
      expect(applyDocDelete(doc, collapsedSelection(focus), "delete")).toBeNull();
      expect(docToWire(doc)).toBe(wire);
    });
  });
});

describe("insertMentionAtSelection", () => {
  it("commits an active @ query token", () => {
    const doc = wireToDoc("dhhdd @");
    const start = wireOffsetToDocPos(doc, 6);
    const end = wireOffsetToDocPos(doc, 7);
    const result = insertMentionAtSelection(doc, "caliper-qbd2kuqrg", start, end);
    expect(docToWire(result.doc)).toBe("dhhdd @caliper-qbd2kuqrg ");
  });
});

describe("resolveActiveHandoffMentionQueryDoc", () => {
  it("opens an empty query when the caret is on @", () => {
    const doc = wireToDoc("HDHD @");
    const focus = wireOffsetToDocPos(doc, docToWire(doc).length);
    expect(resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus))).toEqual({
      queryStart: wireOffsetToDocPos(doc, 5),
      query: "",
    });
  });

  it("does not reopen when typing after a committed mention", () => {
    const wire = "HDHD @caliper-abc123D ";
    const doc = wireToDoc(wire);
    const focus = wireOffsetToDocPos(doc, wire.length - 1);
    expect(resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus))).toBeNull();
  });

  it("opens a new query for a later @", () => {
    const wire = "Hi @caliper-abc123 ping @xy";
    const doc = wireToDoc(wire);
    const focus = wireOffsetToDocPos(doc, wire.length);
    const active = resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus));
    expect(active?.query).toBe("xy");
    expect(docPosToWireOffset(doc, active!.queryStart)).toBe(wire.lastIndexOf("@"));
  });

  it("closes the query on a blank line immediately after @", () => {
    const doc = wireToDoc("dhd @\n");
    const focus = wireOffsetToDocPos(doc, docToWire(doc).length);
    expect(resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus))).toBeNull();
  });

  it("does not treat committed mentions as multiline queries", () => {
    const wire = "dhd @caliper-abc123 \n";
    const doc = wireToDoc(wire);
    const focus = wireOffsetToDocPos(doc, wire.length);
    expect(resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus))).toBeNull();
  });
});

describe("mention query insert folds blank continuation lines onto @", () => {
  function replayShiftEnterPartialBackspace() {
    let doc = wireToDoc("dhd @");
    let focus = wireOffsetToDocPos(doc, docToWire(doc).length);
    let state = applyDocLineBreak(doc, collapsedSelection(focus));
    for (let i = 0; i < 3; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    for (let i = 0; i < 3; i++) {
      const deleted = applyDocDelete(state.doc, state.selection, "backspace");
      expect(deleted).not.toBeNull();
      state = deleted!;
    }
    return state;
  }

  it("keeps session closed until filter typing resumes", () => {
    const state = replayShiftEnterPartialBackspace();
    expect(docToWire(state.doc)).toBe("dhd @\n");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)).toBeNull();
  });

  it("folds filter chars onto the @ line and reopens the query", () => {
    let state = replayShiftEnterPartialBackspace();
    state = applyDocInsertText(state.doc, state.selection, "d");
    expect(docToWire(state.doc)).toBe("dhd @d");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("d");

    state = applyDocInsertText(state.doc, state.selection, "h");
    expect(docToWire(state.doc)).toBe("dhd @dh");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("dh");
  });

  it("folds the first filter char without requiring partial backspace", () => {
    let doc = wireToDoc("dhd @");
    let state = applyDocLineBreak(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, docToWire(doc).length))
    );
    state = applyDocInsertText(state.doc, state.selection, "d");
    expect(docToWire(state.doc)).toBe("dhd @d");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("d");
  });

  it("folds onto an existing query on a repeat multiline cycle", () => {
    let doc = wireToDoc("dhd @");
    let focus = wireOffsetToDocPos(doc, docToWire(doc).length);
    let state = applyDocLineBreak(doc, collapsedSelection(focus));
    for (let i = 0; i < 3; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    for (let i = 0; i < 3; i++) {
      state = applyDocDelete(state.doc, state.selection, "backspace")!;
    }
    state = applyDocInsertText(state.doc, state.selection, "f");
    expect(docToWire(state.doc)).toBe("dhd @f");

    state = applyDocLineBreak(state.doc, state.selection);
    for (let i = 0; i < 2; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    for (let i = 0; i < 2; i++) {
      state = applyDocDelete(state.doc, state.selection, "backspace")!;
    }
    expect(docToWire(state.doc)).toBe("dhd @f\n");

    state = applyDocInsertText(state.doc, state.selection, "e");
    expect(docToWire(state.doc)).toBe("dhd @fe");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("fe");
  });
});
