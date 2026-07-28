import { describe, expect, it } from "vitest";
import {
  applyDocDelete as applyDocDeleteWithSeats,
  applyDocInsertText,
  applyDocLineBreak,
  insertMentionAtSelection,
  resolveHandoffNoteDeletePostLayoutRemount,
  snapDeleteCaretWire,
  spliceDocSelection,
} from "./handoff-note-doc-edits.js";
import {
  collapsedSelection,
  docEndPos,
  docPosToWireOffset,
  expandSelectionFocusToDocEndIfNeeded,
  resolveDocVerticalArrowMove,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import {
  docToWire,
  describeHandoffNoteCursorContext,
  normalizeHandoffNoteDoc,
  wireToDoc,
  type HandoffNoteDoc,
} from "./handoff-note-doc.js";
import {
  embeddedBlankBandAtEmptyContentRowEnd,
  embeddedBlankBandContentRowEndBeforeProbe,
  embeddedBlankBandProbeContext,
  isEmbeddedBlankBandCollapseProbeWire,
  listEmbeddedBlankBandGroups,
  listEmbeddedBlankBandProbeWires,
  listBlankVisualLineStartWires,
  resolveContentRowEditBeforeEmbeddedBlankBand,
  resolveRowChipBeforeEmbeddedBlankProbe,
} from "./handoff-note-embedded-newlines.js";
import {
  handoffNoteCaretOnAtomicNodeEnd,
  handoffNoteIsAtomicEndProbeAlias,
} from "./handoff-note-delete-intent.js";
import { resolveActiveHandoffMentionQueryDoc } from "../utils/handoff-note.js";
import {
  applyDocDeleteWithWireLineSeats as applyDocDelete,
  wireLineVisualRowSeats,
} from "./handoff-note-test-helpers.js";

function expectOffDeleteProbeInfrastructure(
  doc: HandoffNoteDoc,
  focusWire: number,
  focus: ReturnType<typeof wireOffsetToDocPos> = wireOffsetToDocPos(doc, focusWire)
): void {
  expect(isEmbeddedBlankBandCollapseProbeWire(doc, focusWire, focus)).toBe(false);
}

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
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(5);
    expect(result.selection.focusAffinity).toBe("after");
    expect(result.selection.anchor).toEqual(result.selection.focus);
  });

  it("inserts plain text after mention end into following text past leading offset", () => {
    const agentId = "caliper-sandwich01";
    const wire = `pre @${agentId} @${agentId} tail`;
    const doc = wireToDoc(wire);
    const mentionEnd = `pre @${agentId}`.length;
    const result = applyDocInsertText(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, mentionEnd)),
      "X"
    );
    expect(docToWire(result.doc)).toBe(`pre @${agentId} X@${agentId} tail`);
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(mentionEnd + 2);
  });

  it("inserts plain text after mention end before soft-wrap postfix without gluing", () => {
    const agentId = "caliper-wrapagent01";
    const wire = `pre @${agentId} d @${agentId} wraptext @${agentId} `;
    const doc = wireToDoc(wire);
    const postfixIdx = doc.nodes.findIndex((n) => n.type === "text" && n.text.includes("wraptext"));
    const mentionEnd = docPosToWireOffset(doc, {
      nodeIndex: postfixIdx - 1,
      nodeOffset: 1 + agentId.length,
    });
    const result = applyDocInsertText(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, mentionEnd)),
      "X"
    );
    expect(docToWire(result.doc)).toBe(`pre @${agentId} d @${agentId} Xwraptext @${agentId} `);
  });

  it("mention-end insert then backspace restores spacer and lands after space", () => {
    const agentId = "caliper-sandwich01";
    const doc = wireToDoc(`pre @${agentId} @${agentId} tail`);
    const mentionEnd = `pre @${agentId}`.length;
    let state = applyDocInsertText(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, mentionEnd)),
      "X"
    );
    expect(docToWire(state.doc)).toBe(`pre @${agentId} X@${agentId} tail`);
    state = applyDocDelete(state.doc, state.selection, "backspace")!;
    expect(docToWire(state.doc)).toBe(`pre @${agentId} @${agentId} tail`);
    expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(mentionEnd + 1);
  });

  it("mention end at EOF without following text still uses wire splice", () => {
    const agentId = "caliper-abc123";
    const wire = `header @${agentId}`;
    const doc = wireToDoc(wire);
    const result = applyDocInsertText(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, wire.length)),
      "X"
    );
    expect(docToWire(result.doc)).toBe(`header @${agentId}X`);
  });

  it("inserts a spaced @ after a committed mention end", () => {
    const agentId = "caliper-abc123";
    const wire = `pre1 @${agentId} `;
    const doc = wireToDoc(wire);
    const focus = wireOffsetToDocPos(doc, `pre1 @${agentId}`.length);
    const result = applyDocInsertText(doc, collapsedSelection(focus), "@");
    expect(docToWire(result.doc)).toBe(`pre1 @${agentId} @ `);
    expect(resolveActiveHandoffMentionQueryDoc(result.doc, result.selection)?.query).toBe("");
    expect(docToWire(result.doc)[docPosToWireOffset(result.doc, result.selection.focus)]).toBe("@");
  });

  it("inserts @ at mention start as a new session, not glued @@pill", () => {
    const agentId = "caliper-aaaaaaa";
    const wire = `prefix @${agentId} `;
    const doc = wireToDoc(wire);
    const mentionStart = wire.indexOf("@");
    const result = applyDocInsertText(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, mentionStart)),
      "@"
    );
    expect(docToWire(result.doc)).toBe(`prefix @ @${agentId} `);
    expect(docToWire(result.doc).includes("@@")).toBe(false);
    expect(resolveActiveHandoffMentionQueryDoc(result.doc, result.selection)?.query).toBe("");
    expect(docToWire(result.doc)[docPosToWireOffset(result.doc, result.selection.focus)]).toBe("@");
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
  });

  it("inserts @ from pre-mention text-tail alias (live click before pill) as a new session", () => {
    const agentId = "caliper-l5cg02c4k";
    const wire = `dhd @${agentId} dhhd`;
    const doc = wireToDoc(wire);
    const mentionStart = wire.indexOf("@");
    const prefix = doc.nodes[0];
    expect(prefix?.type).toBe("text");
    if (prefix?.type !== "text") {
      throw new Error("expected prefix text");
    }
    // Live click: same wire as mention-start, doc owner is text tail (not mention node).
    const textTail = collapsedSelection({
      nodeIndex: 0,
      nodeOffset: prefix.text.length,
    });
    expect(docPosToWireOffset(doc, textTail.focus)).toBe(mentionStart);
    const result = applyDocInsertText(doc, textTail, "@");
    expect(docToWire(result.doc)).toBe(`dhd @ @${agentId} dhhd`);
    expect(docToWire(result.doc).includes("@@")).toBe(false);
    expect(resolveActiveHandoffMentionQueryDoc(result.doc, result.selection)?.query).toBe("");
    expect(docToWire(result.doc)[docPosToWireOffset(result.doc, result.selection.focus)]).toBe("@");
  });

  it("inserts @ on the space char immediately before a pill as a new session", () => {
    const agentId = "caliper-aaaaaaa";
    const wire = `dhd @${agentId} `;
    const doc = wireToDoc(wire);
    const spaceWire = wire.indexOf("@") - 1;
    expect(wire[spaceWire]).toBe(" ");
    const result = applyDocInsertText(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, spaceWire)),
      "@"
    );
    expect(docToWire(result.doc).includes("@@")).toBe(false);
    expect(resolveActiveHandoffMentionQueryDoc(result.doc, result.selection)?.query).toBe("");
    expect(docToWire(result.doc)[docPosToWireOffset(result.doc, result.selection.focus)]).toBe("@");
  });

  it("inserts at mention start without entering the pill", () => {
    const agentId = "caliper-aaaaaaa";
    const wire = `HEAD \n\n\n\n@${agentId} `;
    const doc = wireToDoc(wire);
    const mentionStart = wire.indexOf("@");
    const mentionNodeIndex = doc.nodes.findIndex((node) => node.type === "mention");
    const focus = wireOffsetToDocPos(doc, mentionStart);
    const result = applyDocInsertText(doc, collapsedSelection(focus), "D");
    expect(docToWire(result.doc)).toBe(`HEAD \n\n\n\nD@${agentId} `);
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
    expect(result.selection.focus.nodeIndex).toBe(mentionNodeIndex - 1);
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(mentionStart + 1);
  });

  it("appends in the pre-mention text node when the caret is on the mention atom", () => {
    const agentId = "caliper-aaaaaaa";
    const wire = `prefix @${agentId} `;
    const doc = wireToDoc(wire);
    const mentionNodeIndex = doc.nodes.findIndex((node) => node.type === "mention");
    const result = applyDocInsertText(
      doc,
      collapsedSelection({ nodeIndex: mentionNodeIndex, nodeOffset: 0 }),
      "y"
    );
    expect(docToWire(result.doc)).toBe(`prefix y@${agentId} `);
    expect(result.selection.focus.nodeIndex).toBe(mentionNodeIndex - 1);
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
  });

  it("keeps consecutive insertions in the pre-mention text node from a mention atom", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `prefix @${agentA} @${agentB} `;
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

    expect(docToWire(state.doc)).toBe(`prefix @${agentA} yyy@${agentB} `);
    expect(state.selection.focus.nodeIndex).toBe(textIdx);
    expect(state.doc.nodes[state.selection.focus.nodeIndex]?.type).toBe("text");
  });

  it("preserves single-row whitespace pre-mention gap separator on text-tail insert", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const agentC = "caliper-ccccccc";
    const agentD = "caliper-ddddddd";
    const wire = `header @${agentA} @${agentB} tail @${agentC} @${agentD} `;
    const doc = wireToDoc(wire);
    const mentionNodes = doc.nodes.reduce<number[]>((acc, node, index) => {
      if (node.type === "mention") {
        acc.push(index);
      }
      return acc;
    }, []);
    const spacerNode = mentionNodes[2]! + 1;
    const spacer = doc.nodes[spacerNode];
    expect(spacer?.type).toBe("text");
    if (spacer?.type !== "text") {
      return;
    }
    const tailPos = { nodeIndex: spacerNode, nodeOffset: spacer.text.length };
    const result = applyDocInsertText(doc, collapsedSelection(tailPos), "d");
    expect(docToWire(result.doc)).toContain(" d @");
    expect(docToWire(result.doc)).not.toMatch(/d@caliper/);
    expect(result.selection.focus).toEqual({ nodeIndex: spacerNode, nodeOffset: 2 });
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
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

  it("inserts on the blank row after arrow lands on an embedded blank stop", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header @${agent} \n\n\ntail`;
    const doc = wireToDoc(wire);
    const stops = listBlankVisualLineStartWires(doc);
    expect(stops).toHaveLength(2);

    const onSecondBlank = wireOffsetToDocPos(doc, stops[1]!);
    const result = applyDocInsertText(doc, collapsedSelection(onSecondBlank), "x");

    expect(docToWire(result.doc)).toBe(`header @${agent} \n\nx\ntail`);
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(stops[1]!);
  });

  it("inserts on the first blank row when caret rests on the first blank stop", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header @${agent} \n\n\ntail`;
    const doc = wireToDoc(wire);
    const [firstStop] = listBlankVisualLineStartWires(doc);

    const result = applyDocInsertText(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, firstStop!)),
      "x"
    );

    expect(docToWire(result.doc)).toBe(`header @${agent} \nx\n\ntail`);
  });

  it("inserts on the first blank row when caret rests on the first embedded probe", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header @${agent} \n\n\ntail`;
    const doc = wireToDoc(wire);
    const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);

    const result = applyDocInsertText(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, firstProbe!)),
      "x"
    );

    expect(docToWire(result.doc)).toBe(`header @${agent} \nx\n\ntail`);
  });
});

describe("EOF trailing blank band — Shift+Enter caret on empty-line stop", () => {
  function stateAfterEofBreaks(prefix: string, count: number) {
    const doc = wireToDoc(prefix);
    let state = { doc, selection: collapsedSelection(wireOffsetToDocPos(doc, prefix.length)) };
    for (let i = 0; i < count; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    return state;
  }

  it("second consecutive EOF break lands caret on trailing empty-line stop", () => {
    const state = stateAfterEofBreaks("header", 2);
    const probes = listEmbeddedBlankBandProbeWires(state.doc);
    const caret = docPosToWireOffset(state.doc, state.selection.focus);
    const wire = docToWire(state.doc);

    expect(probes).toEqual([6, 7]);
    expect(caret).toBe(wire.length);
  });

  it("third consecutive EOF break advances caret monotonically through empty-line stops", () => {
    const state = stateAfterEofBreaks("header", 3);
    const probes = listEmbeddedBlankBandProbeWires(state.doc);
    const caret = docPosToWireOffset(state.doc, state.selection.focus);
    const wire = docToWire(state.doc);

    expect(probes).toEqual([6, 7, 8]);
    expect(caret).toBe(wire.length);
  });

  it("type after two EOF breaks fills lower blank row", () => {
    const state = stateAfterEofBreaks("header", 2);
    const result = applyDocInsertText(state.doc, state.selection, "d");

    expect(docToWire(result.doc)).toBe("header\n\nd");
    expect(listEmbeddedBlankBandProbeWires(result.doc)).toEqual([6]);
  });

  it("backspace on lower blank lands remaining blank above not CRE (no jump)", () => {
    const state = stateAfterEofBreaks("header", 2);
    expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(docToWire(state.doc).length);

    const result = applyDocDelete(state.doc, state.selection, "backspace")!;

    expect(docToWire(result.doc)).toBe("header\n");
    const remain = listBlankVisualLineStartWires(result.doc);
    expect(remain.length).toBe(1);
    expect(remain).toEqual([7]);
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(7);
    expect(result.selection.focusAffinity).toBeUndefined();
  });

  it("backspace on upper blank after fill collapses blank not header text", () => {
    const state = stateAfterEofBreaks("header", 2);
    const filled = applyDocInsertText(state.doc, state.selection, "d");
    const probes = listEmbeddedBlankBandProbeWires(filled.doc);

    const result = applyDocDelete(
      filled.doc,
      collapsedSelection(wireOffsetToDocPos(filled.doc, probes[0]!)),
      "backspace"
    )!;

    expect(docToWire(result.doc)).toBe("header\nd");
    // Sole blank between rows exhausted → Backspace progressive trash lands header CRE.
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe("header".length - 1);
    expect(result.selection.focusAffinity).toBe("after");
  });

  it("backspace on typed EOF row removes content then lands remaining blank not CRE", () => {
    const state = stateAfterEofBreaks("header", 2);
    const filled = applyDocInsertText(state.doc, state.selection, "d");

    const chipped = applyDocDelete(filled.doc, filled.selection, "backspace")!;

    expect(docToWire(chipped.doc)).toBe("header\n\n");

    const collapsed = applyDocDelete(chipped.doc, chipped.selection, "backspace")!;

    expect(docToWire(collapsed.doc)).toBe("header\n");
    const remain = listBlankVisualLineStartWires(collapsed.doc);
    expect(remain.length).toBe(1);
    expect(remain).toEqual([7]);
    expect(docPosToWireOffset(collapsed.doc, collapsed.selection.focus)).toBe(7);
    expect(collapsed.selection.focusAffinity).toBeUndefined();
  });

  it("delete on upper blank after fill collapses blank not header or typed row", () => {
    const state = stateAfterEofBreaks("header", 2);
    const filled = applyDocInsertText(state.doc, state.selection, "d");
    const probes = listEmbeddedBlankBandProbeWires(filled.doc);

    const result = applyDocDelete(
      filled.doc,
      collapsedSelection(wireOffsetToDocPos(filled.doc, probes[0]!)),
      "delete"
    )!;

    expect(docToWire(result.doc)).toBe("header\nd");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(
      docToWire(result.doc).lastIndexOf("d")
    );
  });

  it("delete at visual start of space-filled blank nips space not blank-band newline", () => {
    const base = wireToDoc("dh\n\n\nmen");
    // Second empty-line stop — fill that row so one blank remains above.
    const [, secondBlank] = listBlankVisualLineStartWires(base);
    const filled = applyDocInsertText(
      base,
      collapsedSelection(wireOffsetToDocPos(base, secondBlank!)),
      "      "
    );
    expect(docToWire(filled.doc)).toBe("dh\n\n      \nmen");
    expect(listEmbeddedBlankBandProbeWires(filled.doc)).toEqual([2]);

    const firstSpace = docToWire(filled.doc).indexOf(" ");
    const result = applyDocDelete(
      filled.doc,
      collapsedSelection(wireOffsetToDocPos(filled.doc, firstSpace)),
      "delete"
    )!;
    expect(docToWire(result.doc)).toBe("dh\n\n     \nmen");
    expect(listEmbeddedBlankBandProbeWires(result.doc)).toEqual([2]);
  });

  it("backspace at visual start of space-filled row collapses empty blank above not spaces", () => {
    const base = wireToDoc("dh\n\n\nmen");
    const [, secondBlank] = listBlankVisualLineStartWires(base);
    const filled = applyDocInsertText(
      base,
      collapsedSelection(wireOffsetToDocPos(base, secondBlank!)),
      "      "
    );
    const firstSpace = docToWire(filled.doc).indexOf(" ");
    const result = applyDocDelete(
      filled.doc,
      collapsedSelection(wireOffsetToDocPos(filled.doc, firstSpace)),
      "backspace"
    )!;
    // BOL backspace nips unit left (empty blank above), spaces remain.
    expect(docToWire(result.doc)).toBe("dh\n      \nmen");
    expect(docToWire(result.doc).includes("      ")).toBe(true);
  });

  it("mention row — two EOF breaks land on trailing empty stop; type fills blank; backspace preserves pill", () => {
    const agent = "caliper-aaaaaaa";
    const prefix = `row @${agent} `;
    const state = stateAfterEofBreaks(prefix, 2);
    const probes = listEmbeddedBlankBandProbeWires(state.doc);
    expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(docToWire(state.doc).length);

    const filled = applyDocInsertText(state.doc, state.selection, "d");
    expect(docToWire(filled.doc)).toBe(`${prefix}\n\nd`);
    expect(filled.doc.nodes.filter((node) => node.type === "mention")).toHaveLength(1);

    const collapsed = applyDocDelete(
      filled.doc,
      collapsedSelection(wireOffsetToDocPos(filled.doc, probes[0]!)),
      "backspace"
    )!;
    expect(docToWire(collapsed.doc)).toBe(`${prefix}\nd`);
    expect(collapsed.doc.nodes.filter((node) => node.type === "mention")).toHaveLength(1);
  });

  it("sandwiched tail below band — EOF breaks after tail land on trailing empty stop", () => {
    const agent = "caliper-aaaaaaa";
    const sandwiched = `header @${agent} \n\n\ntail`;
    const doc = wireToDoc(sandwiched);
    const probesBefore = listEmbeddedBlankBandProbeWires(doc);
    let state = {
      doc,
      selection: collapsedSelection(wireOffsetToDocPos(doc, sandwiched.length)),
    };
    state = applyDocLineBreak(state.doc, state.selection);
    state = applyDocLineBreak(state.doc, state.selection);
    const probesAfter = listEmbeddedBlankBandProbeWires(state.doc);

    expect(probesAfter.length).toBe(probesBefore.length + 2);
    expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(docToWire(state.doc).length);
  });
});

describe("embedded blank-band delete contract", () => {
  const agent = "caliper-aaaaaaa";

  function blankBandSuffixWire(lower = "tail"): string {
    return `header @${agent} \n\n\n${lower}`;
  }

  function headerRowEndWire(wire: string, probes: number[]): number {
    return probes[0]! - 1;
  }

  function multiBandWire(): string {
    return `header \n\n\nmiddle\n\n\nlower`;
  }

  describe("content row end — two-phase chip then collapse", () => {
    it("sole-char delete before band leaves caret off blank-band delete-probe infrastructure", () => {
      const doc = wireToDoc(`h\n\n\ntail`);
      const headerEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, headerEnd), "after"),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`\n\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        result!.doc,
        docPosToWireOffset(result!.doc, result!.selection.focus),
        result!.selection.focus
      );
    });

    it("prefix-only band: interior backspace nibble removes char at caret not row chip", () => {
      const doc = wireToDoc(`xy\n\n\n`);
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 1)),
        "backspace"
      )!;

      expect(docToWire(result.doc)).toBe(`y\n\n\n`);
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(0);
      expectOffDeleteProbeInfrastructure(
        result.doc,
        docPosToWireOffset(result.doc, result.selection.focus),
        result.selection.focus
      );
    });

    it("CRE backspace partial chip leaving sole char lands on that char with after not probe", () => {
      const doc = wireToDoc(`ab\n\n`);
      const rowEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, rowEnd), "after"),
        "backspace"
      )!;

      expect(docToWire(result.doc)).toBe(`a\n\n`);
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(0);
      expect(result.selection.focusAffinity).toBe("after");
      expectOffDeleteProbeInfrastructure(
        result.doc,
        docPosToWireOffset(result.doc, result.selection.focus),
        result.selection.focus
      );
    });

    it("multi-band chip on sole char before blank band leaves caret off delete-probe infrastructure", () => {
      const wire = "header \n\n\nmiddle\n\n\nd\n\n\nlower";
      const doc = wireToDoc(wire);
      const dPos = wire.lastIndexOf("d");

      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, dPos), "after"),
        "backspace"
      )!;

      expect(docToWire(chipped.doc)).toBe("header \n\n\nmiddle\n\n\n\n\n\nlower");
      expectOffDeleteProbeInfrastructure(
        chipped.doc,
        docPosToWireOffset(chipped.doc, chipped.selection.focus),
        chipped.selection.focus
      );
    });

    it("next backspace after multi-band chip collapses one blank from emptied content row", () => {
      const wire = "header \n\n\nmiddle\n\n\nd\n\n\nlower";
      const doc = wireToDoc(wire);
      const dPos = wire.lastIndexOf("d");
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, dPos), "after"),
        "backspace"
      )!;

      const collapsed = applyDocDelete(chipped.doc, chipped.selection, "backspace")!;

      expect(docToWire(collapsed.doc)).toBe("header \n\n\nmiddle\n\n\n\n\nlower");
    });

    it("next backspace after sole-char clear collapses one leading blank only", () => {
      const doc = wireToDoc(`h\n\n\ntail`);
      const headerEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, headerEnd), "after"),
        "backspace"
      )!;
      expect(docToWire(cleared.doc)).toBe(`\n\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        cleared.doc,
        docPosToWireOffset(cleared.doc, cleared.selection.focus),
        cleared.selection.focus
      );

      const collapsed = applyDocDelete(cleared.doc, cleared.selection, "backspace")!;
      expect(docToWire(collapsed.doc)).toBe(`\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        collapsed.doc,
        docPosToWireOffset(collapsed.doc, collapsed.selection.focus),
        collapsed.selection.focus
      );
    });

    it("single-blank band enters collapse infrastructure immediately after chip", () => {
      const doc = wireToDoc(`h\n\ntail`);
      const headerEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;

      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, headerEnd), "after"),
        "backspace"
      )!;

      expect(docToWire(cleared.doc)).toBe(`\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        cleared.doc,
        docPosToWireOffset(cleared.doc, cleared.selection.focus),
        cleared.selection.focus
      );
    });

    it("sandwiched sole-char row: probe backspace remounts CRE after; next chips char", () => {
      const doc = wireToDoc("h\n\n\ntail");
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;

      const atCre = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probe)),
        "backspace"
      )!;
      expect(docToWire(atCre.doc)).toBe("h\n\ntail");
      expect(docPosToWireOffset(atCre.doc, atCre.selection.focus)).toBe(0);
      expect(atCre.selection.focusAffinity).toBe("after");

      const cleared = applyDocDelete(atCre.doc, atCre.selection, "backspace")!;
      expect(docToWire(cleared.doc)).toBe("\n\ntail");
      expectOffDeleteProbeInfrastructure(
        cleared.doc,
        docPosToWireOffset(cleared.doc, cleared.selection.focus),
        cleared.selection.focus
      );
    });

    it("forward delete sole-char clear before band arms chip without landing on delete-probe", () => {
      const doc = wireToDoc(`h\n\n\ntail`);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0)),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe(`\n\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        cleared.doc,
        docPosToWireOffset(cleared.doc, cleared.selection.focus),
        cleared.selection.focus
      );
    });

    it("next delete after sole-char clear collapses one leading blank only", () => {
      const doc = wireToDoc(`h\n\n\ntail`);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0)),
        "delete"
      )!;
      const collapsed = applyDocDelete(cleared.doc, cleared.selection, "delete")!;
      expect(docToWire(collapsed.doc)).toBe(`\n\ntail`);
      expect(docPosToWireOffset(collapsed.doc, collapsed.selection.focus)).toBe(0);
    });

    it("chip-then-collapse ladder — each Delete nip lands downward on remaining blank or content", () => {
      const tail = "tail";
      let state = applyDocDelete(
        wireToDoc(`h\n\n\n${tail}`),
        collapsedSelection(wireOffsetToDocPos(wireToDoc(`h\n\n\n${tail}`), 0)),
        "delete"
      )!;

      // From band head, each Delete removes that blank; caret stays on remaining blank (wire 0).
      const midShapes = [`\n\n${tail}`, `\n${tail}`] as const;
      for (const expectedWire of midShapes) {
        state = applyDocDelete(state.doc, state.selection, "delete")!;
        expect(docToWire(state.doc)).toBe(expectedWire);
        expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(0);
      }
      // Last blank before content → content visual start.
      state = applyDocDelete(state.doc, state.selection, "delete")!;
      expect(docToWire(state.doc)).toBe(tail);
      expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(0);
    });

    it("backspace mirror — chip-then-collapse ladder lands on band head each nip", () => {
      const tail = "tail";
      let state = applyDocDelete(
        wireToDoc(`h\n\n\n${tail}`),
        collapsedSelection(wireOffsetToDocPos(wireToDoc(`h\n\n\n${tail}`), 0)),
        "delete"
      )!;
      const shapes = [`\n\n${tail}`, `\n${tail}`, tail] as const;
      for (const expectedWire of shapes) {
        state = applyDocDelete(state.doc, state.selection, "backspace")!;
        expect(docToWire(state.doc)).toBe(expectedWire);
        expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(0);
      }
    });

    it("delete at last leading probe before content lands next blank below (still before content)", () => {
      const tail = "tail";
      const doc = wireToDoc(`\n\n\n${tail}`);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const lastProbe = probes.at(-1)!;
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lastProbe)),
        "delete"
      )!;
      const next = docToWire(result.doc);
      const land = docPosToWireOffset(result.doc, result.selection.focus);
      const contentAt = next.indexOf(tail);
      expect(next).toBe(`\n\n${tail}`);
      // Collapsed probe still has an empty stop below it before content.
      expect(land).toBe(contentAt - 1);
      expect(next[land]).toBe("\n");
    });

    it("delete at second leading probe lands next blank below (still before content)", () => {
      const tail = "tail";
      const doc = wireToDoc(`\n\n\n${tail}`);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      expect(probes).toEqual([0, 1]);
      const secondProbe = probes[1]!;
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, secondProbe)),
        "delete"
      )!;
      const next = docToWire(result.doc);
      const land = docPosToWireOffset(result.doc, result.selection.focus);
      const contentAt = next.indexOf(tail);
      expect(next).toBe(`\n\n${tail}`);
      expect(land).toBe(contentAt - 1);
      expect(next[land]).toBe("\n");
    });
    it("delete at sole probe before substantive tail lands on line-start gate before content", () => {
      const tail = "tail";
      const doc = wireToDoc(`\n\n${tail}`);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probe)),
        "delete"
      )!;
      expect(docToWire(result!.doc)).toBe(`\n${tail}`);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(0);
    });

    function chipMentionRowBeforeBand(): {
      doc: ReturnType<typeof wireToDoc>;
      selection: ReturnType<typeof collapsedSelection>;
    } {
      const wire = `header @${agent} tail\n\n\n`;
      const doc = wireToDoc(wire);
      const rowEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
      let d = doc;
      // Progressive CRE trash: start at content-row-end (affinity after).
      let selection = collapsedSelection(wireOffsetToDocPos(doc, rowEnd), "after");
      const stableWire = `header @${agent} \n\n\n`;

      for (let i = 0; i < 20 && docToWire(d) !== stableWire; i++) {
        const next = applyDocDelete(d, selection, "backspace");
        expect(next).not.toBeNull();
        d = next!.doc;
        selection = next!.selection;
      }
      expect(docToWire(d)).toBe(stableWire);
      const afterSpace = applyDocDelete(d, selection, "backspace")!;
      return { doc: afterSpace.doc, selection: afterSpace.selection };
    }

    it("backspace at probe after spacer chip removes mention preserving blank run", () => {
      const { doc, selection } = chipMentionRowBeforeBand();
      const removed = applyDocDelete(doc, selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`header \n\n\n`);
      expect(docToWire(removed.doc)).not.toContain(`@${agent}`);
    });

    it("forward delete mention remove before band preserves blank run and stays off delete-probe", () => {
      const wire = `header @${agent} \n\n\n`;
      const doc = wireToDoc(wire);
      const mentionInterior = wire.indexOf("@") + 1;
      const removed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionInterior)),
        "delete"
      )!;
      expect(docToWire(removed.doc)).toBe(`header  \n\n\n`);
      expectOffDeleteProbeInfrastructure(
        removed.doc,
        docPosToWireOffset(removed.doc, removed.selection.focus)
      );
    });

    it("multi-char row chips without landing on delete-probe until the row is cleared", () => {
      let doc = wireToDoc(`hd\n\n\ntail`);
      // CRE: chip last char first (unit behind with after), then remaining sole char.
      let state = collapsedSelection(wireOffsetToDocPos(doc, 1), "after");

      const mid = applyDocDelete(doc, state, "backspace")!;
      expect(docToWire(mid.doc)).toBe(`h\n\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        mid.doc,
        docPosToWireOffset(mid.doc, mid.selection.focus),
        mid.selection.focus
      );

      const cleared = applyDocDelete(mid.doc, mid.selection, "backspace")!;
      expect(docToWire(cleared.doc)).toBe(`\n\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        cleared.doc,
        docPosToWireOffset(cleared.doc, cleared.selection.focus),
        cleared.selection.focus
      );
    });
  });

  describe("emptied content-row chip landing — abutting vs mid-fusion", () => {
    function landSnap(
      doc: HandoffNoteDoc,
      selection: { focus: ReturnType<typeof wireOffsetToDocPos> }
    ) {
      const focusWire = docPosToWireOffset(doc, selection.focus);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const ctx = embeddedBlankBandProbeContext(doc, focusWire);
      return {
        focusWire,
        probes,
        indexInGroup: ctx?.indexInGroup ?? -1,
        deleteProbe: isEmbeddedBlankBandCollapseProbeWire(doc, focusWire, selection.focus),
        emptyRowEnd: embeddedBlankBandAtEmptyContentRowEnd(doc, focusWire, selection.focus),
      };
    }

    it("abutting spacer clear lands band head as CRE (not blank beneath / delete-probe)", () => {
      const before = "mdh\n \n\ndh ";
      const spaceWire = before.indexOf(" \n\n");
      const doc = wireToDoc(before);
      const move = resolveRowChipBeforeEmbeddedBlankProbe(doc, spaceWire)!;
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spaceWire), "before"),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe("mdh\n\n\ndh ");
      const snap = landSnap(cleared.doc, cleared.selection);
      const bandHead = snap.probes[0]!;
      expect(move.caretWire).toBe(bandHead);
      expect(snap.focusWire).toBe(bandHead);
      expect(snap.indexInGroup).toBe(0);
      expect(snap.emptyRowEnd).toBe(true);
      expect(snap.deleteProbe).toBe(false);
      // Click on same wire + probe-infra focus shares CRE (no retained chip flag).
      const clickFocus = wireOffsetToDocPos(cleared.doc, bandHead);
      expect(embeddedBlankBandAtEmptyContentRowEnd(cleared.doc, bandHead, clickFocus)).toBe(true);
      expect(isEmbeddedBlankBandCollapseProbeWire(cleared.doc, bandHead, clickFocus)).toBe(false);
    });

    it("abutting spacer clear with stronger blank run lands band head as CRE", () => {
      const before = "dh\n \n\n\ndh ";
      const spaceWire = before.indexOf(" \n\n\n");
      const cleared = applyDocDelete(
        wireToDoc(before),
        collapsedSelection(wireOffsetToDocPos(wireToDoc(before), spaceWire), "before"),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe("dh\n\n\n\ndh ");
      const snap = landSnap(cleared.doc, cleared.selection);
      expect(snap.indexInGroup).toBe(0);
      expect(snap.focusWire).toBe(snap.probes[0]);
      expect(snap.emptyRowEnd).toBe(true);
      expect(snap.deleteProbe).toBe(false);
    });

    it("pad between bands keeps mid-fusion emptyRowEnd", () => {
      const before = "upper\n\n\n \n\n\nlower";
      const spaceWire = before.indexOf(" \n\n\nlower");
      const cleared = applyDocDelete(
        wireToDoc(before),
        collapsedSelection(wireOffsetToDocPos(wireToDoc(before), spaceWire), "before"),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe("upper\n\n\n\n\n\nlower");
      const snap = landSnap(cleared.doc, cleared.selection);
      expect(snap.deleteProbe).toBe(false);
      expect(snap.emptyRowEnd).toBe(true);
      const ctx = embeddedBlankBandProbeContext(cleared.doc, snap.focusWire)!;
      expect(ctx.indexInGroup).toBeLessThan(ctx.group.probes.length - 1);
    });

    it("sole-char CRE chip between bands keeps mid-fusion emptyRowEnd", () => {
      const wire = "header \n\n\nmiddle\n\n\nd\n\n\nlower";
      const dPos = wire.indexOf("\nd\n", wire.indexOf("middle")) + 1;
      const cleared = applyDocDelete(
        wireToDoc(wire),
        collapsedSelection(wireOffsetToDocPos(wireToDoc(wire), dPos), "after"),
        "backspace"
      )!;
      expect(docToWire(cleared.doc)).toBe("header \n\n\nmiddle\n\n\n\n\n\nlower");
      const snap = landSnap(cleared.doc, cleared.selection);
      expect(snap.deleteProbe).toBe(false);
      expect(snap.emptyRowEnd).toBe(true);
      expect(snap.indexInGroup).toBeGreaterThan(0);
    });

    it("mention spacer chip keeps same-wire mention-end alias (not probe infra CRE)", () => {
      const wire = `header @${agent} \n\n\n`;
      const spacerWire = listEmbeddedBlankBandProbeWires(wireToDoc(wire))[0]! - 1;
      const cleared = applyDocDelete(
        wireToDoc(wire),
        collapsedSelection(wireOffsetToDocPos(wireToDoc(wire), spacerWire), "after"),
        "backspace"
      )!;
      expect(docToWire(cleared.doc)).toBe(`header @${agent}\n\n\n`);
      expect(handoffNoteCaretOnAtomicNodeEnd(cleared.doc, cleared.selection.focus)).toBe(true);
      expect(handoffNoteIsAtomicEndProbeAlias(cleared.doc, cleared.selection.focus)).toBe(true);
      // Alias owner is not emptyRowEnd; probe-infra focus on same wire is.
      const focusWire = docPosToWireOffset(cleared.doc, cleared.selection.focus);
      expect(
        embeddedBlankBandAtEmptyContentRowEnd(cleared.doc, focusWire, cleared.selection.focus)
      ).toBe(false);
      expect(
        isEmbeddedBlankBandCollapseProbeWire(cleared.doc, focusWire, cleared.selection.focus)
      ).toBe(false);
      const probeFocus = wireOffsetToDocPos(cleared.doc, focusWire);
      expect(embeddedBlankBandAtEmptyContentRowEnd(cleared.doc, focusWire, probeFocus)).toBe(true);
    });
  });

  describe("multi-band — band-scoped step and collapse", () => {
    it("backspace on sandwiched lower-band first probe remounts CRE after on middle", () => {
      const wire = multiBandWire();
      const doc = wireToDoc(wire);
      const groups = listEmbeddedBlankBandGroups(doc);
      const lowerBand = groups[1]!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerBand.probes[0]!)),
        "backspace"
      );

      expect(result).not.toBeNull();
      const resultWire = docToWire(result!.doc);
      expect(resultWire).toBe(`header \n\n\nmiddle\n\nlower`);
      const middleEnd = resultWire.indexOf("\n", resultWire.indexOf("middle")) - 1;
      expect(resultWire[middleEnd]).toBe("e");
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(middleEnd);
      expect(result!.selection.focusAffinity).toBe("after");
    });

    it("backspace on lower-band interior blank stop remounts CRE after on middle", () => {
      const wire = multiBandWire();
      const doc = wireToDoc(wire);
      const lowerStops = listBlankVisualLineStartWires(doc).filter(
        (stop) => stop >= wire.indexOf("middle")
      );

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerStops[0]!)),
        "backspace"
      );

      expect(result).not.toBeNull();
      const resultWire = docToWire(result!.doc);
      expect(resultWire).toBe(`header \n\n\nmiddle\n\nlower`);
      const middleEnd = resultWire.indexOf("\n", resultWire.indexOf("middle")) - 1;
      expect(resultWire[middleEnd]).toBe("e");
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(middleEnd);
      expect(result!.selection.focusAffinity).toBe("after");
    });

    it("delete on upper-band last blank stop before middle lands middle visual start", () => {
      const wire = multiBandWire();
      const doc = wireToDoc(wire);
      const upperStops = listBlankVisualLineStartWires(doc).filter(
        (stop) => stop < wire.indexOf("middle")
      );

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, upperStops.at(-1)!)),
        "delete"
      );

      expect(result).not.toBeNull();
      const resultWire = docToWire(result!.doc);
      expect(resultWire).toBe(`header \n\nmiddle\n\n\nlower`);
      const land = docPosToWireOffset(result!.doc, result!.selection.focus);
      expect(land).toBe(resultWire.indexOf("middle"));
    });

    it("delete on lower-band last blank stop before lower lands lower visual start", () => {
      const wire = multiBandWire();
      const doc = wireToDoc(wire);
      const lowerStops = listBlankVisualLineStartWires(doc).filter(
        (stop) => stop >= wire.indexOf("middle")
      );

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerStops.at(-1)!)),
        "delete"
      );

      expect(result).not.toBeNull();
      const resultWire = docToWire(result!.doc);
      expect(resultWire).toBe(`header \n\n\nmiddle\n\nlower`);
      const land = docPosToWireOffset(result!.doc, result!.selection.focus);
      expect(land).toBe(resultWire.indexOf("lower"));
    });
  });

  describe("backspace", () => {
    it("on first trailing blank remounts CRE after on content (not leftover blank)", () => {
      const wire = "TOP\n\n";
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      expect(probes.length).toBe(2);
      const focus = wireOffsetToDocPos(doc, probes[0]!);
      expect(
        resolveContentRowEditBeforeEmbeddedBlankBand(doc, probes[0]!, "backspace", focus)
      ).toBeNull();

      const result = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      // Trailing-only: one blank removed; land content-row-end/`after` so next BS chips TOP.
      // Remaining `\n` stays until the blank row is focused — do not park omit on it.
      expect(docToWire(result.doc)).toBe("TOP\n");
      expect(docToWire(result.doc)[docPosToWireOffset(result.doc, result.selection.focus)]).toBe(
        "P"
      );
      expect(result.selection.focusAffinity).toBe("after");
      const chipped = applyDocDelete(result.doc, result.selection, "backspace")!;
      expect(docToWire(chipped.doc)).toBe("TO\n");
    });

    it("on first sandwiched blank remounts CRE after on header; next chips spacer", () => {
      const wire = blankBandSuffixWire();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      )!;

      expect(docToWire(result.doc)).toBe(`header @${agent} \n\ntail`);
      const headerCre = docToWire(result.doc).indexOf("\n") - 1;
      expect(docToWire(result.doc)[headerCre]).toBe(" ");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(headerCre);
      expect(result.selection.focusAffinity).toBe("after");
      const chipped = applyDocDelete(result.doc, result.selection, "backspace")!;
      expect(docToWire(chipped.doc)).toBe(`header @${agent}\n\ntail`);
    });

    it("on second blank with blank above lands remaining blank not CRE (no jump)", () => {
      const wire = blankBandSuffixWire();
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, stops[1]!)),
        "backspace"
      )!;

      expect(docToWire(result.doc)).toBe(`header @${agent} \n\ntail`);
      expect(listBlankVisualLineStartWires(result.doc)).toEqual([25]);
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(25);
      expect(result.selection.focusAffinity).toBeUndefined();
    });

    it("backspace last of trailing double blank lands remaining blank not CRE on TOP", () => {
      const doc = wireToDoc("TOP\n\n");
      const last = listBlankVisualLineStartWires(doc).at(-1)!;
      const once = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, last)),
        "backspace"
      )!;
      expect(docToWire(once.doc)).toBe("TOP\n");
      expect(listBlankVisualLineStartWires(once.doc)).toEqual([4]);
      expect(docPosToWireOffset(once.doc, once.selection.focus)).toBe(4);
      expect(once.selection.focusAffinity).toBeUndefined();
    });

    it("backspace lower sandwiched blank lands upper blank not CRE on upper", () => {
      const doc = wireToDoc("upper\n\n\nlower");
      const lowerBlank = listBlankVisualLineStartWires(doc).at(-1)!;
      const once = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerBlank)),
        "backspace"
      )!;
      expect(docToWire(once.doc)).toBe("upper\n\nlower");
      expect(listBlankVisualLineStartWires(once.doc)).toEqual([6]);
      expect(docPosToWireOffset(once.doc, once.selection.focus)).toBe(6);
      expect(once.selection.focusAffinity).toBeUndefined();
    });

    it("backspace at single-char header row end before blank band removes the character", () => {
      const wire = `h\n\n\ntail`;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      expect(probes[0]).toBe(1);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]! - 1), "after"),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`\n\n\ntail`);
    });

    it("after collapsing sandwiched blank reaches single-char header then chips it", () => {
      const doc = wireToDoc(`h\n\n\ntail`);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const atCre = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      )!;
      expect(docToWire(atCre.doc)).toBe("h\n\ntail");
      expect(atCre.selection.focusAffinity).toBe("after");
      expect(docPosToWireOffset(atCre.doc, atCre.selection.focus)).toBe(0);

      const cleared = applyDocDelete(atCre.doc, atCre.selection, "backspace")!;
      expect(docToWire(cleared.doc)).toBe("\n\ntail");
    });

    it("after clearing single-char header backspace on lower blank removes one blank-row newline", () => {
      let doc = wireToDoc(`h\n\n\ntail`);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0), "after"),
        "backspace"
      )!;
      expect(docToWire(cleared.doc)).toBe(`\n\n\ntail`);

      const probes = listEmbeddedBlankBandProbeWires(cleared.doc);
      const result = applyDocDelete(
        cleared.doc,
        collapsedSelection(wireOffsetToDocPos(cleared.doc, probes[1]!)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`\n\ntail`);
      const [remainingBlank] = listEmbeddedBlankBandProbeWires(result!.doc);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(remainingBlank);
    });

    it("backspace on first probe with empty row above collapses one blank toward lower content", () => {
      const doc = wireToDoc(`\n\n\ntail`);
      const [leadingBlank] = listEmbeddedBlankBandProbeWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, leadingBlank!)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`\n\ntail`);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(
        listEmbeddedBlankBandProbeWires(result!.doc)[0]
      );
    });

    it("repeated backspace through leading blank band lands at lower row visual start", () => {
      let doc = wireToDoc(`\n\n\nlower`);
      let state = collapsedSelection(wireOffsetToDocPos(doc, 0));

      for (const expectedWire of [`\n\nlower`, `\nlower`, `lower`]) {
        const collapsed = applyDocDelete(doc, state, "backspace");
        expect(collapsed).not.toBeNull();
        expect(docToWire(collapsed!.doc)).toBe(expectedWire);
        doc = collapsed!.doc;
        state = collapsed!.selection;
      }
      expect(docPosToWireOffset(doc, state.focus)).toBe(0);
    });

    it("backspace on blank stop above content with leading blanks lands on remaining stop", () => {
      const wire = `\n\nlower @${agent} `;
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);
      expect(stops).toEqual([0, 1]);
      // Wire before "lower" is the lower blank stop (not a probe dock).
      expect(
        isEmbeddedBlankBandCollapseProbeWire(doc, stops[1]!, wireOffsetToDocPos(doc, stops[1]!))
      ).toBe(false);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, stops[1]!)),
        "backspace"
      )!;
      expect(docToWire(result.doc)).toBe(`\nlower @${agent} `);
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(
        listBlankVisualLineStartWires(result.doc)[0]
      );
    });

    it("delete at last leading probe (final wire char) collapses one blank", () => {
      // Probe path must own this — not blank-stop remapping to stop-1.
      // Nothing below: progressive Delete lands nearest remaining blank above (no jump to band head).
      const doc = wireToDoc("\n\n\n");
      const lastProbe = listEmbeddedBlankBandProbeWires(doc).at(-1)!;
      expect(lastProbe).toBe(2);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lastProbe)),
        "delete"
      )!;
      expect(docToWire(result.doc)).toBe("\n\n");
      const land = docPosToWireOffset(result.doc, result.selection.focus);
      const stops = listBlankVisualLineStartWires(result.doc);
      expect(stops).toContain(land);
      expect(land).toBe(1);
    });

    it("backspace at last leading probe collapses one blank without band-head skip", () => {
      const doc = wireToDoc("\n\n\n");
      const lastProbe = listEmbeddedBlankBandProbeWires(doc).at(-1)!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lastProbe)),
        "backspace"
      )!;
      expect(docToWire(result.doc)).toBe("\n\n");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(1);
    });

    it("backspace at EOF blank stop under leading blanks does not jump to band head", () => {
      // Emptied mid content under leading blanks leaves caret on EOF stop (`\n\n` @ 2).
      // One Backspace must land the remaining higher empty line-start — not wire 0.
      const doc = wireToDoc("\n\n");
      const eofStop = listBlankVisualLineStartWires(doc).at(-1)!;
      expect(eofStop).toBe(2);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, eofStop)),
        "backspace"
      )!;
      expect(docToWire(result.doc)).toBe("\n");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(1);
      expect(listBlankVisualLineStartWires(result.doc).at(-1)).toBe(1);
    });

    it("delete at EOF blank stop under leading blanks collapses one blank (not band-head jump)", () => {
      // Leading-only: Delete may clear blanks; land remaining higher stop — not wire 0 skip.
      const doc = wireToDoc("\n\n");
      const eofStop = listBlankVisualLineStartWires(doc).at(-1)!;
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, eofStop)),
        "delete"
      )!;
      expect(docToWire(result.doc)).toBe("\n");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(1);
    });

    it("backspace at last leading blank stop before content lands remaining higher stop", () => {
      const doc = wireToDoc("\n\n\ntail");
      const lastBlankStop = listBlankVisualLineStartWires(doc).at(-1)!;
      expect(lastBlankStop).toBe(2);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lastBlankStop)),
        "backspace"
      )!;
      expect(docToWire(result.doc)).toBe("\n\ntail");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(1);
      expect(listBlankVisualLineStartWires(result.doc)).toEqual([0, 1]);
    });

    it("delete at last leading blank stop before content lands content visual start", () => {
      const doc = wireToDoc("\n\n\ntail");
      const lastBlankStop = listBlankVisualLineStartWires(doc).at(-1)!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lastBlankStop)),
        "delete"
      )!;
      const next = docToWire(result.doc);
      const focus = docPosToWireOffset(result.doc, result.selection.focus);
      expect(next).toBe("\n\ntail");
      expect(focus).toBe(next.indexOf("tail"));
    });

    it("delete on non-probe blank stop under leading blanks lands content not band head", () => {
      const wire = "\n\nabc\ndef\n";
      const doc = wireToDoc(wire);
      const stop = 1;
      expect(listBlankVisualLineStartWires(doc)).toContain(stop);
      expect(listEmbeddedBlankBandProbeWires(doc).includes(stop)).toBe(false);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, stop)),
        "delete"
      )!;
      const next = docToWire(result.doc);
      const land = docPosToWireOffset(result.doc, result.selection.focus);
      expect(next).toBe("\nabc\ndef\n");
      expect(land).toBe(next.indexOf("abc"));
    });

    it("delete on blank stop immediately before content lands content visual start", () => {
      const doc = wireToDoc("\n\ntail");
      const stopBeforeTail = listBlankVisualLineStartWires(doc).at(-1)!;
      expect(stopBeforeTail).toBe(1);
      expect(listEmbeddedBlankBandProbeWires(doc).includes(stopBeforeTail)).toBe(false);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, stopBeforeTail)),
        "delete"
      )!;
      const next = docToWire(result.doc);
      const land = docPosToWireOffset(result.doc, result.selection.focus);
      expect(next).toBe("\ntail");
      expect(land).toBe(next.indexOf("tail"));
      expect(land).not.toBe(0);
    });

    it("delete on mid-doc last blank before lower content lands lower visual start (not empty above)", () => {
      const doc = wireToDoc("xxxxx\n\n\nyyyy");
      const lastStop = listBlankVisualLineStartWires(doc).at(-1)!;
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lastStop)),
        "delete"
      )!;
      const after = docToWire(result.doc);
      expect(after).toBe("xxxxx\n\nyyyy");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(after.indexOf("yyyy"));
    });

    it("delete blank-stop before lower under leading blanks + trailing lands lower visual start", () => {
      const afterEmptyMid = "\n\n\n\n\nlower\n\n";
      const doc = wireToDoc(afterEmptyMid);
      const lowerAt = afterEmptyMid.indexOf("lower");
      const stopBeforeLower = listBlankVisualLineStartWires(doc)
        .filter((stop) => stop < lowerAt)
        .at(-1)!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, stopBeforeLower)),
        "delete"
      )!;
      const next = docToWire(result.doc);
      const land = docPosToWireOffset(result.doc, result.selection.focus);
      const contentAt = next.indexOf("lower");
      expect(next).toContain("lower");
      // Next row below collapsed blank is content — not trailing empties past lower.
      expect(land).toBe(contentAt);
    });

    it("backspace at sandwiched line-start \\n before lower does not jump to wire 0", () => {
      const wire = `upper @${agent} xx\n\n\nlower @${agent} `;
      const doc = wireToDoc(wire);
      const lineStartBeforeLower = wire.indexOf("lower") - 1;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lineStartBeforeLower)),
        "backspace"
      )!;
      const focusWire = docPosToWireOffset(result.doc, result.selection.focus);
      expect(focusWire).not.toBe(0);
      expect(docToWire(result.doc)).toBe(`upper @${agent} xx\n\nlower @${agent} `);
    });

    it("after deleting sole header character repeated backspace collapses blank band to lower start", () => {
      let doc = wireToDoc(`h\n\n\nlower`);
      let state = collapsedSelection(wireOffsetToDocPos(doc, 0), "after");
      const cleared = applyDocDelete(doc, state, "backspace")!;
      expect(docToWire(cleared.doc)).toBe(`\n\n\nlower`);
      doc = cleared.doc;
      state = cleared.selection;

      for (const expectedWire of [`\n\nlower`, `\nlower`, `lower`]) {
        const collapsed = applyDocDelete(doc, state, "backspace");
        expect(collapsed).not.toBeNull();
        expect(docToWire(collapsed!.doc)).toBe(expectedWire);
        doc = collapsed!.doc;
        state = collapsed!.selection;
      }
      expect(docPosToWireOffset(doc, state.focus)).toBe(0);
    });

    it("backspace on sandwiched single probe between filled rows lands at upper row end", () => {
      const wire = "header \n\n\nmiddle\n\ntail";
      const doc = wireToDoc(wire);
      const sandwichedProbe = listEmbeddedBlankBandGroups(doc).find(
        (group) => group.probes.length === 1
      )!.probes[0]!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, sandwichedProbe)),
        "backspace"
      )!;

      const resultWire = docToWire(result.doc);
      expect(resultWire).toBe("header \n\n\nmiddle\ntail");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(
        resultWire.indexOf("middle") + "middle".length - 1
      );
    });
  });

  describe("delete forward", () => {
    it("on first blank with blank below removes blank-row newline and lands on next blank row", () => {
      const wire = blankBandSuffixWire();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "delete"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`header @${agent} \n\ntail`);
      const [nextBlank] = listEmbeddedBlankBandProbeWires(result!.doc);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(nextBlank);
    });

    it("on second blank before lower content removes blank-row newline and lands tail visual start", () => {
      const wire = blankBandSuffixWire();
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, stops[1]!)),
        "delete"
      );

      expect(result).not.toBeNull();
      const resultWire = docToWire(result!.doc);
      expect(resultWire).toBe(`header @${agent} \n\ntail`);
      const land = docPosToWireOffset(result!.doc, result!.selection.focus);
      expect(land).toBe(resultWire.indexOf("tail"));
    });

    it("delete on sandwiched single probe between filled rows lands at lower row visual start", () => {
      const wire = "header \n\n\nmiddle\n\ntail";
      const doc = wireToDoc(wire);
      const sandwichedProbe = listEmbeddedBlankBandGroups(doc).find(
        (group) => group.probes.length === 1
      )!.probes[0]!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, sandwichedProbe)),
        "delete"
      )!;

      const resultWire = docToWire(result.doc);
      expect(resultWire).toBe("header \n\n\nmiddle\ntail");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(
        resultWire.indexOf("tail")
      );
    });

    it("delete at trailing empty-line stop lands remaining blank above not content (no jump)", () => {
      const wire = `header @${agent} \n\n`;
      const doc = wireToDoc(wire);
      const trailingStop = listBlankVisualLineStartWires(doc).at(-1)!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, trailingStop)),
        "delete"
      )!;
      const after = docToWire(result.doc);
      expect(after).toBe(`header @${agent} \n`);
      expect(listBlankVisualLineStartWires(result.doc)).toEqual([25]);
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(25);
      expect(result.selection.focusAffinity).toBeUndefined();
    });

    it("delete on trailing blanks under content lands blank then content then chips ahead", () => {
      const wire = "TOP\n\n";
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const first = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "delete"
      )!;
      expect(docToWire(first.doc)).toBe("TOP\n");
      const remaining = listEmbeddedBlankBandProbeWires(first.doc);
      expect(remaining).toEqual([3]);
      expect(docPosToWireOffset(first.doc, first.selection.focus)).toBe(3);
      expect(listBlankVisualLineStartWires(first.doc)).toEqual([4]);
      const second = applyDocDelete(
        first.doc,
        collapsedSelection(wireOffsetToDocPos(first.doc, remaining[0]!)),
        "delete"
      )!;
      expect(docToWire(second.doc)).toBe("TOP");
      expect(docPosToWireOffset(second.doc, second.selection.focus)).toBe(0);
      const third = applyDocDelete(
        second.doc,
        collapsedSelection(wireOffsetToDocPos(second.doc, 0)),
        "delete"
      )!;
      expect(docToWire(third.doc)).toBe("OP");
    });

    it("delete after clearing lower blank+content lands remaining blank not upper content", () => {
      let doc = wireToDoc("upper\n\n\nlower");
      const lowerBlank = listBlankVisualLineStartWires(doc).at(-1)!;
      const trashBlank = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerBlank)),
        "delete"
      )!;
      expect(docToWire(trashBlank.doc)).toBe("upper\n\nlower");
      doc = trashBlank.doc;
      let land = docPosToWireOffset(trashBlank.doc, trashBlank.selection.focus);
      for (const _ of "lower") {
        const once = applyDocDelete(
          doc,
          collapsedSelection(wireOffsetToDocPos(doc, land)),
          "delete"
        )!;
        doc = once.doc;
        land = docPosToWireOffset(once.doc, once.selection.focus);
      }
      expect(docToWire(doc).includes("lower")).toBe(false);
      const afterClear = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, land)),
        "delete"
      )!;
      expect(docToWire(afterClear.doc)).toBe("upper\n");
      expect(listBlankVisualLineStartWires(afterClear.doc)).toEqual([6]);
      expect(docPosToWireOffset(afterClear.doc, afterClear.selection.focus)).toBe(6);
      expect(afterClear.selection.focusAffinity).toBeUndefined();
    });

    it("delete last of trailing double blank under content lands remaining blank not |TOP", () => {
      const doc = wireToDoc("TOP\n\n");
      const last = listBlankVisualLineStartWires(doc).at(-1)!;
      const once = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, last)),
        "delete"
      )!;
      expect(docToWire(once.doc)).toBe("TOP\n");
      expect(listBlankVisualLineStartWires(once.doc)).toEqual([4]);
      expect(docPosToWireOffset(once.doc, once.selection.focus)).toBe(4);
    });

    it("delete trashing emptied trailing content row lands visual start of content above", () => {
      const wire = "lead\nupper\nlower\n";
      const doc = wireToDoc(wire);
      const eofStop = listBlankVisualLineStartWires(doc).at(-1)!;
      const once = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, eofStop)),
        "delete"
      )!;
      expect(docToWire(once.doc)).toBe("lead\nupper\nlower");
      expect(docPosToWireOffset(once.doc, once.selection.focus)).toBe(
        docToWire(once.doc).indexOf("lower")
      );
    });

    it("delete from pad-preceding last probe under mid lands mid visual start not lead (no skip)", () => {
      // Pad-preceding probe must use EOF blank-stop identity — probe wire alone sits on
      // mid’s line and adjacent-above would wrongly land lead (wire 0).
      const wire = "lead\nmid\n";
      const doc = wireToDoc(wire);
      const lastProbe = listEmbeddedBlankBandProbeWires(doc).at(-1)!;
      expect(lastProbe).toBe(8);
      expect(listBlankVisualLineStartWires(doc)).toEqual([9]);
      const once = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lastProbe)),
        "delete"
      )!;
      expect(docToWire(once.doc)).toBe("lead\nmid");
      expect(docPosToWireOffset(once.doc, once.selection.focus)).toBe(5);
    });

    it("delete from pad-preceding last probe under C of A\\nB\\nC\\n lands C not B (no skip)", () => {
      const wire = "A\nB\nC\n";
      const doc = wireToDoc(wire);
      const lastProbe = listEmbeddedBlankBandProbeWires(doc).at(-1)!;
      const once = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lastProbe)),
        "delete"
      )!;
      expect(docToWire(once.doc)).toBe("A\nB\nC");
      expect(docPosToWireOffset(once.doc, once.selection.focus)).toBe(wire.indexOf("C"));
    });

    it("backspace from pad-preceding last probe under mid remounts CRE on mid (no skip to lead)", () => {
      const wire = "lead\nmid\n";
      const doc = wireToDoc(wire);
      const lastProbe = listEmbeddedBlankBandProbeWires(doc).at(-1)!;
      const once = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lastProbe)),
        "backspace"
      )!;
      expect(docToWire(once.doc)).toBe("lead\nmid");
      expect(docPosToWireOffset(once.doc, once.selection.focus)).toBe(7);
      expect(once.selection.focusAffinity).toBe("after");
    });

    it("delete from mid content progressive clears mixture blanks and content to empty", () => {
      let doc = wireToDoc("lead\n\nmid\n\ntail");
      let land = docToWire(doc).indexOf("mid");
      for (let i = 0; i < 40; i++) {
        const once = applyDocDelete(
          doc,
          collapsedSelection(wireOffsetToDocPos(doc, land)),
          "delete"
        );
        if (!once) break;
        doc = once.doc;
        land = docPosToWireOffset(once.doc, once.selection.focus);
        if (docToWire(doc) === "") break;
      }
      expect(docToWire(doc)).toBe("");
    });

    it("repeated delete through prefix-only blanks clears to empty doc", () => {
      let doc = wireToDoc(`\n\n`);
      let state = collapsedSelection(wireOffsetToDocPos(doc, 0));

      for (const expectedWire of [`\n`, ``]) {
        const collapsed = applyDocDelete(doc, state, "delete");
        expect(collapsed).not.toBeNull();
        expect(docToWire(collapsed!.doc)).toBe(expectedWire);
        doc = collapsed!.doc;
        state = collapsed!.selection;
      }
      expect(docPosToWireOffset(doc, state.focus)).toBe(0);
    });

    it("delete on sole leftover prefix blank clears to empty (Backspace parity)", () => {
      const cleared = applyDocDelete(
        wireToDoc(`\n`),
        collapsedSelection(wireOffsetToDocPos(wireToDoc(`\n`), 0)),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe(``);
      expect(docPosToWireOffset(cleared.doc, cleared.selection.focus)).toBe(0);
    });

    it("repeated delete through leading blank band lands at lower row visual start", () => {
      let doc = wireToDoc(`\n\n\nlower`);
      let state = collapsedSelection(wireOffsetToDocPos(doc, 0));

      for (const expectedWire of [`\n\nlower`, `\nlower`, `lower`]) {
        const collapsed = applyDocDelete(doc, state, "delete");
        expect(collapsed).not.toBeNull();
        expect(docToWire(collapsed!.doc)).toBe(expectedWire);
        doc = collapsed!.doc;
        state = collapsed!.selection;
      }
      expect(docPosToWireOffset(doc, state.focus)).toBe(0);
    });

    it("delete on line-start \\n before content (empty CRE topology, not blank probe) splices to lower start", () => {
      const cleared = applyDocDelete(
        wireToDoc(`\nlower`),
        collapsedSelection(wireOffsetToDocPos(wireToDoc(`\nlower`), 0)),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe(`lower`);
      expect(docPosToWireOffset(cleared.doc, cleared.selection.focus)).toBe(0);
    });

    describe("line-start storage after emptied sandwiched row", () => {
      function sandwichedAfterMiddleRowCleared() {
        return `upper @${agent} xx\n\n\nlower @${agent} `;
      }

      it("delete at line-start \\n before lower content lands lower visual start", () => {
        const wire = sandwichedAfterMiddleRowCleared();
        const doc = wireToDoc(wire);
        const lineStartBeforeLower = wire.indexOf("lower") - 1;
        expect(wire[lineStartBeforeLower]).toBe("\n");
        expect(listEmbeddedBlankBandProbeWires(doc).length).toBe(2);
        expect(
          isEmbeddedBlankBandCollapseProbeWire(
            doc,
            lineStartBeforeLower,
            wireOffsetToDocPos(doc, lineStartBeforeLower)
          )
        ).toBe(false);

        const result = applyDocDelete(
          doc,
          collapsedSelection(wireOffsetToDocPos(doc, lineStartBeforeLower)),
          "delete"
        )!;

        const after = docToWire(result.doc);
        expect(after).toBe(`upper @${agent} xx\n\nlower @${agent} `);
        expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(after.indexOf("lower"));
      });

      it("delete on last blank stop lands lower visual start", () => {
        const wire = sandwichedAfterMiddleRowCleared();
        const doc = wireToDoc(wire);
        const lastStop = listBlankVisualLineStartWires(doc).at(-1)!;

        const result = applyDocDelete(
          doc,
          collapsedSelection(wireOffsetToDocPos(doc, lastStop)),
          "delete"
        )!;
        const after = docToWire(result.doc);
        expect(after).toBe(`upper @${agent} xx\n\nlower @${agent} `);
        expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(after.indexOf("lower"));
      });

      it("delete on line-start \\n of remaining sandwiched blank lands at lower visual start", () => {
        const wire = `upper @${agent} xx\n\nlower @${agent} `;
        const doc = wireToDoc(wire);
        const lineStart = wire.indexOf("lower") - 1;
        expect(wire[lineStart]).toBe("\n");
        expect(
          isEmbeddedBlankBandCollapseProbeWire(doc, lineStart, wireOffsetToDocPos(doc, lineStart))
        ).toBe(false);

        const result = applyDocDelete(
          doc,
          collapsedSelection(wireOffsetToDocPos(doc, lineStart)),
          "delete"
        )!;
        const after = docToWire(result.doc);
        expect(after).toBe(`upper @${agent} xx\nlower @${agent} `);
        expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(after.indexOf("lower"));
      });
    });
  });

  describe("full composite wire", () => {
    const compositeWire = `header @${agent} \n\n\ntail @${agent} `;

    it("backspace on first sandwiched blank before mention tail remounts CRE after on header", () => {
      const wire = compositeWire;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      )!;

      expect(docToWire(result.doc)).toBe(`header @${agent} \n\ntail @${agent} `);
      const headerCre = docToWire(result.doc).indexOf("\n") - 1;
      expect(docToWire(result.doc)[headerCre]).toBe(" ");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(headerCre);
      expect(result.selection.focusAffinity).toBe("after");
    });

    it("delete on second blank before mention tail lands tail visual start", () => {
      const doc = wireToDoc(compositeWire);
      const stops = listBlankVisualLineStartWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, stops[1]!)),
        "delete"
      );

      expect(result).not.toBeNull();
      const resultWire = docToWire(result!.doc);
      expect(resultWire).toBe(`header @${agent} \n\ntail @${agent} `);
      const land = docPosToWireOffset(result!.doc, result!.selection.focus);
      expect(land).toBe(resultWire.indexOf("tail"));
    });
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

  it("lands caret on new blank when breaking from the mention atom", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `prefixx @${agent} `;
    const doc = wireToDoc(wire);
    const onMention = {
      nodeIndex: doc.nodes.findIndex((node) => node.type === "mention"),
      nodeOffset: 0,
    };
    const mentionStartWire = docPosToWireOffset(doc, onMention);

    const result = applyDocLineBreak(doc, collapsedSelection(onMention));

    expect(docToWire(result.doc)).toBe(`prefixx \n@${agent} `);
    expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBeGreaterThan(
      mentionStartWire
    );
  });

  it("lands caret on new blank when breaking from a later mention atom", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wires = [`ab @${agentA} @${agentB} tail`, `header @${agentA} tail @${agentB} suffix`];
    for (const wire of wires) {
      const doc = wireToDoc(wire);
      const onMention = wireOffsetToDocPos(doc, wire.lastIndexOf("@"));
      const mentionStartWire = docPosToWireOffset(doc, onMention);
      const result = applyDocLineBreak(doc, collapsedSelection(onMention));
      expect(result.doc.nodes[result.selection.focus.nodeIndex]?.type).toBe("text");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBeGreaterThan(
        mentionStartWire
      );
    }
  });

  it("consecutive breaks from a mention atom add blank lines before the pill", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `prefixx @${agent} `;
    const doc = wireToDoc(wire);
    const first = applyDocLineBreak(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, wire.indexOf("@")))
    );
    const second = applyDocLineBreak(first.doc, first.selection);

    expect(docToWire(second.doc)).toBe(`prefixx \n\n@${agent} `);
    const textNode = second.doc.nodes[second.selection.focus.nodeIndex];
    expect(textNode?.type).toBe("text");
    if (textNode?.type === "text") {
      expect(second.selection.focus.nodeOffset).toBe(textNode.text.length);
    }
  });

  it("never leaves caret at the pre-break mention wire when breaking from a mention atom", () => {
    const agent = "caliper-aaaaaaa";
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wires = [
      `prefix @${agent} `,
      `prefix @${agent} @${agent} `,
      `ab @${agentA} @${agentB} tail`,
      `pre1 @${agent} pre2 @${agent} `,
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
    const agent = "caliper-aaaaaaa";
    const wire = `prefix @${agent} @${agent} `;
    const doc = wireToDoc(wire);
    const onMention = wireOffsetToDocPos(doc, wire.lastIndexOf("@"));
    const first = applyDocLineBreak(doc, collapsedSelection(onMention));
    const second = applyDocLineBreak(first.doc, first.selection);

    expect(docToWire(second.doc)).toBe(`prefix @${agent} \n\n@${agent} `);
  });

  it("first break after trailing mention-line text lands caret on the new blank", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agentA}  @${agentB} tail`;
    const doc = wireToDoc(wire);
    const caretBefore = wire.length;
    const result = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, caretBefore)));
    expect(docToWire(result.doc)).toBe(`${wire}\n`);
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(
      docToWire(result.doc).length
    );
  });

  it("second break after trailing mention-line text advances monotonically through empty-line stops", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agentA}  @${agentB} tail`;
    const doc = wireToDoc(wire);
    const first = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, wire.length)));
    const firstCaret = docPosToWireOffset(first.doc, first.selection.focus);
    expect(docToWire(first.doc)).toBe(`${wire}\n`);
    expect(firstCaret).toBe(docToWire(first.doc).length);

    const second = applyDocLineBreak(first.doc, first.selection);
    expect(docToWire(second.doc)).toBe(`${wire}\n\n`);
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBe(
      docToWire(second.doc).length
    );
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBeGreaterThan(firstCaret);
  });

  it("first mention-boundary break on prefix row lands caret on new blank", () => {
    const agentA = "caliper-aaaaaaa";
    const header = "header ";
    const doc = wireToDoc(`${header}@${agentA} `);
    const mentionStart = wireOffsetToDocPos(doc, header.length);
    const mentionStartWire = docPosToWireOffset(doc, mentionStart);
    const first = applyDocLineBreak(doc, collapsedSelection(mentionStart));
    expect(docToWire(first.doc)).toBe(`${header}\n@${agentA} `);
    expect(docPosToWireOffset(first.doc, first.selection.focus)).toBeGreaterThan(mentionStartWire);
  });

  it("second break on prefix row advances caret onto the blank run before mention", () => {
    const agentA = "caliper-aaaaaaa";
    const header = "header ";
    const doc = wireToDoc(`${header}@${agentA} `);
    const mentionStart = wireOffsetToDocPos(doc, header.length);
    const first = applyDocLineBreak(doc, collapsedSelection(mentionStart));
    const second = applyDocLineBreak(first.doc, first.selection);
    expect(docToWire(second.doc)).toBe(`${header}\n\n@${agentA} `);
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBe(`${header}\n\n`.length);
  });

  it("first break after multi-pill row end advances caret into newline run on one press", () => {
    const agentA = "caliper-aaaaaaa";
    const pillRowWire = `@${agentA} tail @${agentA} @${agentA} `;
    const doc = wireToDoc(pillRowWire);
    const rowTailWire = pillRowWire.length - 1;
    const first = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, rowTailWire)));
    expect(docToWire(first.doc)).toContain("\n");
    expect(docPosToWireOffset(first.doc, first.selection.focus)).toBe(rowTailWire + 1);
    expect(docPosToWireOffset(first.doc, first.selection.focus)).not.toBe(rowTailWire);
  });

  it("second break after multi-pill row end advances caret off the first-break wire", () => {
    const agentA = "caliper-aaaaaaa";
    const pillRowWire = `@${agentA} tail @${agentA} @${agentA} `;
    const doc = wireToDoc(pillRowWire);
    const rowTailWire = pillRowWire.length - 1;
    const first = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, rowTailWire)));
    const second = applyDocLineBreak(first.doc, first.selection);
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBeGreaterThan(
      docPosToWireOffset(first.doc, first.selection.focus)
    );
  });

  it("first break on substantive tail lands caret on the new empty-line stop", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agentA}  @${agentB} tail`;
    const doc = wireToDoc(wire);
    const tailEnd = wire.length;
    const first = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, tailEnd)));
    expect(docPosToWireOffset(first.doc, first.selection.focus)).toBe(docToWire(first.doc).length);
    const second = applyDocLineBreak(first.doc, first.selection);
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBe(
      docToWire(second.doc).length
    );
    expect(docToWire(second.doc).slice(tailEnd, tailEnd + 2)).toBe("\n\n");
  });

  it("consecutive breaks at later mention with substantive inter-pill gap advance monotonically", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `header @${agentA} tail @${agentB} suffix`;
    const doc = wireToDoc(wire);
    const mentionStart = wire.lastIndexOf("@");
    const first = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, mentionStart)));
    const caretAfterFirst = docPosToWireOffset(first.doc, first.selection.focus);
    expect(caretAfterFirst).toBeGreaterThan(mentionStart);
    const second = applyDocLineBreak(first.doc, first.selection);
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBeGreaterThan(caretAfterFirst);
  });
});

describe("Shift+Enter — caret lands on new blank at content end", () => {
  const agent = "caliper-aaaaaaa";

  function caretAfterBreak(wire: string): number {
    const doc = wireToDoc(wire);
    const result = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, wire.length)));
    return docPosToWireOffset(result.doc, result.selection.focus);
  }

  function trailingEmptyStopAfterBreak(wire: string): number {
    const doc = wireToDoc(wire);
    const result = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, wire.length)));
    return docToWire(result.doc).length;
  }

  it("single mention with whitespace-only post-pill tail", () => {
    const wire = `header @${agent} `;
    expect(caretAfterBreak(wire)).toBe(trailingEmptyStopAfterBreak(wire));
  });

  it("single mention with substantive post-pill tail", () => {
    const wire = `hd @${agent} tail`;
    expect(caretAfterBreak(wire)).toBe(trailingEmptyStopAfterBreak(wire));
  });

  it("two mentions with substantive row tail", () => {
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agent}  @${agentB} tail`;
    expect(caretAfterBreak(wire)).toBe(trailingEmptyStopAfterBreak(wire));
  });

  it("multi-pill row with substantive tail", () => {
    const wire = `@${agent} tail @${agent} @${agent} tail`;
    expect(caretAfterBreak(wire)).toBe(trailingEmptyStopAfterBreak(wire));
  });

  it("sole-char row first break lands on trailing empty-line stop", () => {
    const doc = wireToDoc("d");
    const result = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, 1)));
    expect(docToWire(result.doc)).toBe("d\n");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(2);
    const collapsed = applyDocDelete(result.doc, result.selection, "backspace")!;
    expect(docToWire(collapsed.doc)).toBe("d");
  });

  it("empty doc first break lands on trailing empty-line stop", () => {
    const doc = wireToDoc("");
    const result = applyDocLineBreak(doc, collapsedSelection(docEndPos(doc)));
    expect(docToWire(result.doc)).toBe("\n");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(1);
  });

  it("first through fifth break advance monotonically at substantive suffix tail", () => {
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agent} mid @${agentB} tail`;
    const doc = wireToDoc(wire);
    let state = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, wire.length)));
    const wires = [docPosToWireOffset(state.doc, state.selection.focus)];
    for (let index = 1; index < 5; index++) {
      state = applyDocLineBreak(state.doc, state.selection);
      wires.push(docPosToWireOffset(state.doc, state.selection.focus));
    }
    for (let index = 1; index < wires.length; index++) {
      expect(wires[index]).toBeGreaterThan(wires[index - 1]!);
    }
    expect(wires[wires.length - 1]).toBe(docToWire(state.doc).length);
  });
});

describe("Shift+Enter — suffix band consecutive breaks", () => {
  const agentA = "caliper-aaaaaaa";
  const agentB = "caliper-bbbbbbb";
  const suffixRow = `row @${agentA} mid @${agentB} tail`;

  function breakChainFromRowTail(breakCount: number): number[] {
    const doc = wireToDoc(suffixRow);
    const rowTail = suffixRow.length;
    let state = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, rowTail)));
    const wires = [docPosToWireOffset(state.doc, state.selection.focus)];
    for (let index = 1; index < breakCount; index++) {
      state = applyDocLineBreak(state.doc, state.selection);
      wires.push(docPosToWireOffset(state.doc, state.selection.focus));
    }
    return wires;
  }

  it("third consecutive break advances caret monotonically on suffix row", () => {
    const wires = breakChainFromRowTail(3);
    expect(wires[1]).toBeGreaterThan(wires[0]!);
    expect(wires[2]).toBeGreaterThan(wires[1]!);
  });

  it("fourth consecutive break advances caret monotonically on suffix row", () => {
    const wires = breakChainFromRowTail(4);
    for (let index = 1; index < wires.length; index++) {
      expect(wires[index]).toBeGreaterThan(wires[index - 1]!);
    }
  });

  it("fifth consecutive break advances caret monotonically on suffix row", () => {
    const wires = breakChainFromRowTail(5);
    for (let index = 1; index < wires.length; index++) {
      expect(wires[index]).toBeGreaterThan(wires[index - 1]!);
    }
  });

  it("seventh consecutive break advances caret monotonically on suffix row", () => {
    const wires = breakChainFromRowTail(7);
    for (let index = 1; index < wires.length; index++) {
      expect(wires[index]).toBeGreaterThan(wires[index - 1]!);
    }
  });

  it("prefix band break before mention advances through blank run monotonically", () => {
    const header = "header ";
    const doc = wireToDoc(`${header}@${agentA} `);
    const mentionStart = wireOffsetToDocPos(doc, header.length);
    let state = applyDocLineBreak(doc, collapsedSelection(mentionStart));
    const first = docPosToWireOffset(state.doc, state.selection.focus);
    for (let index = 0; index < 6; index++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    const seventh = docPosToWireOffset(state.doc, state.selection.focus);
    expect(seventh).toBeGreaterThan(first);
    expect(docToWire(state.doc)).toMatch(
      new RegExp(`^${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n{7}@${agentA} `)
    );
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

  it("range delete from doc start through last wire char clears to empty doc", () => {
    const doc = wireToDoc("he\n\n\n");
    const anchor = wireOffsetToDocPos(doc, 0);
    const shortFocus = wireOffsetToDocPos(doc, docToWire(doc).length - 1);
    const result = applyDocDelete(
      doc,
      { anchor, focus: expandSelectionFocusToDocEndIfNeeded(doc, anchor, shortFocus) },
      "backspace"
    )!;
    expect(docToWire(result.doc)).toBe("");
  });

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

  it("places caret for prefix row at text end before left mention after gap separator removed", () => {
    const wire = `prefix @${agentA} @${agentB} `;
    const doc = wireToDoc(wire);
    const gapIdx = interMentionGapIndex(doc, 0);
    const result = deleteLikeEditor(doc, { nodeIndex: gapIdx, nodeOffset: 0 }, "delete");
    expect(result).not.toBeNull();
    expect(docToWire(result!.doc)).toBe(`prefix @${agentA}@${agentB} `);
    const focusNode = result!.doc.nodes[result!.selection.focus.nodeIndex];
    expect(focusNode?.type).toBe("text");
    if (focusNode?.type === "text") {
      expect(focusNode.text).toBe("prefix ");
    }
  });

  it("places caret at right mention start when no prefix row text before gap merge", () => {
    const wire = `@${agentA} @${agentB} `;
    const doc = wireToDoc(wire);
    const gapIdx = interMentionGapIndex(doc, 0);
    const result = deleteLikeEditor(doc, { nodeIndex: gapIdx, nodeOffset: 0 }, "delete");
    expect(result).not.toBeNull();
    expect(docToWire(result!.doc)).toBe(`@${agentA}@${agentB} `);
    const focusNode = result!.doc.nodes[result!.selection.focus.nodeIndex];
    expect(focusNode?.type).toBe("mention");
    if (focusNode?.type === "mention") {
      expect(focusNode.agentId).toBe(agentB);
      expect(result!.selection.focus.nodeOffset).toBe(0);
    }
  });

  it("forward delete after gap merge removes right pill B leaving commit spacer", () => {
    const wire = `@${agentA} @${agentA} @${agentB} `;
    const doc = wireToDoc(wire);
    const gapIdx = interMentionGapIndex(doc, 1);
    const first = deleteLikeEditor(doc, { nodeIndex: gapIdx, nodeOffset: 0 }, "delete");
    expect(first).not.toBeNull();
    expect(docToWire(first!.doc)).toBe(`@${agentA} @${agentA}@${agentB} `);
    const second = deleteLikeEditor(first!.doc, first!.selection.focus, "delete")!;
    expect(docToWire(second.doc)).toBe(`@${agentA} @${agentA} `);
    expect(docToWire(second.doc)).not.toContain(agentB);
  });

  it("after prefix-row gap merge backspace chips prefix from text-end landing", () => {
    const wire = `prefix @${agentA} @${agentB} tail`;
    const doc = wireToDoc(wire);
    const gapIdx = interMentionGapIndex(doc, 0);
    const merged = deleteLikeEditor(doc, { nodeIndex: gapIdx, nodeOffset: 0 }, "delete")!;
    const back = deleteLikeEditor(merged.doc, merged.selection.focus, "backspace")!;
    expect(docToWire(back.doc)).toBe(`prefi @${agentA}@${agentB} tail`);
    expect(docToWire(back.doc)).toContain(agentA);
    expect(docToWire(back.doc)).toContain(agentB);
  });

  it("backspace at spaced mention start glues separator without removing left pill", () => {
    const wire = `@${agentA} @${agentB} `;
    const doc = wireToDoc(wire);
    const bIdx = doc.nodes.findIndex((n) => n.type === "mention" && n.agentId === agentB);
    const back = deleteLikeEditor(doc, { nodeIndex: bIdx, nodeOffset: 0 }, "backspace")!;
    expect(docToWire(back.doc)).toBe(`@${agentA}@${agentB} `);
  });

  it("inter-mention gap merge returns plain doc edit result", () => {
    const wire = `@${agentA} @${agentA} `;
    const doc = wireToDoc(wire);
    const gapIdx = interMentionGapIndex(doc, 0);
    const merged = applyDocDelete(
      doc,
      collapsedSelection({ nodeIndex: gapIdx, nodeOffset: 0 }),
      "delete"
    )!;
    expect(Object.keys(merged).sort()).toEqual(["doc", "selection"]);
  });

  it("forward delete at mention start removes right pill atomically leaving commit spacer", () => {
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
    const result = deleteLikeEditor(doc, { nodeIndex: rightMentionIdx, nodeOffset: 0 }, "delete")!;
    expect(docToWire(result.doc)).toBe(`@${agentA} `);
    expect(docToWire(result.doc)).not.toContain(agentB);
  });

  describe("backspace at mention atom start", () => {
    function mentionStartPos(doc: ReturnType<typeof wireToDoc>, agentId: string) {
      const idx = doc.nodes.findIndex(
        (node) => node.type === "mention" && node.agentId === agentId
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      return { nodeIndex: idx, nodeOffset: 0 };
    }

    it("backspace at mention end deletes the whole mention", () => {
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

    it("backspace at glued adjacent mention start removes left pill atomically", () => {
      const doc = normalizeHandoffNoteDoc({
        nodes: [
          { type: "mention", agentId: agentA },
          { type: "mention", agentId: agentB },
          { type: "text", text: " " },
        ],
      });
      const focus = mentionStartPos(doc, agentB);
      const result = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      expect(docToWire(result.doc)).toBe(`@${agentB} `);
      expect(docToWire(result.doc)).not.toContain(agentA);
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

    it("deletes mention atomically from whitespace-only text tail before mention on same row", () => {
      const wire = `\n\n\n@${agentA}\n\n\nmiddle`;
      const doc = wireToDoc(wire);
      const focus = textEndBeforeMention(doc, agentA);
      const result = applyDocDelete(doc, collapsedSelection(focus), "delete");
      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`\n\n\n\n\n\nmiddle`);
      expect(docToWire(result!.doc)).toContain("middle");
    });
  });
});

describe("insertMentionAtSelection", () => {
  it("commits an active @ query token", () => {
    const doc = wireToDoc("query @");
    const start = wireOffsetToDocPos(doc, 6);
    const end = wireOffsetToDocPos(doc, 7);
    const result = insertMentionAtSelection(doc, "caliper-aaaaaaa", start, end);
    expect(docToWire(result.doc)).toBe("query @caliper-aaaaaaa ");
    expect(result.selection.focusAffinity).toBe("after");
  });

  it("EOF commit lands CRE after on spacer; Shift+Enter keeps spacer above break", () => {
    const agent = "caliper-abc123";
    const committed = insertMentionAtSelection(
      wireToDoc("hi @"),
      agent,
      wireOffsetToDocPos(wireToDoc("hi @"), 3),
      wireOffsetToDocPos(wireToDoc("hi @"), 4)
    );
    expect(docToWire(committed.doc)).toBe(`hi @${agent} `);
    expect(committed.selection.focusAffinity).toBe("after");
    expect(
      docToWire(committed.doc)[docPosToWireOffset(committed.doc, committed.selection.focus)]
    ).toBe(" ");
    const br = applyDocLineBreak(committed.doc, committed.selection)!;
    expect(docToWire(br.doc)).toBe(`hi @${agent} \n`);
  });

  it("EOF commit then two breaks then @ opens mention session (no stranded spacer)", () => {
    const agent = "caliper-abc123";
    const doc = wireToDoc("hi @");
    let state = insertMentionAtSelection(
      doc,
      agent,
      wireOffsetToDocPos(doc, 3),
      wireOffsetToDocPos(doc, 4)
    );
    state = applyDocLineBreak(state.doc, state.selection)!;
    state = applyDocLineBreak(state.doc, state.selection)!;
    expect(docToWire(state.doc)).toBe(`hi @${agent} \n\n`);
    for (const ch of ["d", "h", " ", "@"]) {
      state = applyDocInsertText(state.doc, state.selection, ch);
    }
    expect(docToWire(state.doc)).toBe(`hi @${agent} \n\ndh @`);
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)).not.toBeNull();
  });

  it("mid-blank commit rests on post-mention spacer, not the following content \\n", () => {
    const agent = "caliper-midblank01";
    const before = `mesh @${agent} \n\nmesh @\nwhteh @${agent} `;
    const doc = wireToDoc(before);
    const at = before.indexOf("mesh @\n") + "mesh ".length;
    expect(before[at]).toBe("@");
    const result = insertMentionAtSelection(
      doc,
      agent,
      wireOffsetToDocPos(doc, at),
      wireOffsetToDocPos(doc, at + 1)
    );
    const wire = docToWire(result.doc);
    const focusWire = docPosToWireOffset(result.doc, result.selection.focus);
    expect(wire).toBe(`mesh @${agent} \n\nmesh @${agent} \nwhteh @${agent} `);
    expect(wire[focusWire]).toBe(" ");
    expect(wire[focusWire + 1]).toBe("\n");
    expect(result.selection.focusAffinity).toBe("after");
  });

  it("sole residual \\n after @ pads commit spacer and lands on it (not EOF past break)", () => {
    // Live: fill sandwiched blank then commit — right of @ is a single \\n.
    const agent = "caliper-2eynixtnx";
    const before = "dhd \n\ndhd @\n";
    const doc = wireToDoc(before);
    const at = before.lastIndexOf("@");
    const result = insertMentionAtSelection(
      doc,
      agent,
      wireOffsetToDocPos(doc, at),
      wireOffsetToDocPos(doc, at + 1)
    );
    const wire = docToWire(result.doc);
    const focusWire = docPosToWireOffset(result.doc, result.selection.focus);
    expect(wire).toBe(`dhd \n\ndhd @${agent} \n`);
    expect(wire[focusWire]).toBe(" ");
    expect(wire[focusWire + 1]).toBe("\n");
    expect(focusWire).toBeLessThan(wire.length);
    expect(result.selection.focusAffinity).toBe("after");
  });

  it("trailing @\\n pads commit spacer and lands on it", () => {
    const agent = "caliper-trailblank01";
    const before = "dhd \n\n\n@\n";
    const at = before.lastIndexOf("@");
    const doc = wireToDoc(before);
    const result = insertMentionAtSelection(
      doc,
      agent,
      wireOffsetToDocPos(doc, at),
      wireOffsetToDocPos(doc, at + 1)
    );
    const wire = docToWire(result.doc);
    const focusWire = docPosToWireOffset(result.doc, result.selection.focus);
    expect(wire).toBe(`dhd \n\n\n@${agent} \n`);
    expect(wire[focusWire]).toBe(" ");
    expect(wire[focusWire + 1]).toBe("\n");
    expect(result.selection.focusAffinity).toBe("after");
  });
});

describe("resolveActiveHandoffMentionQueryDoc", () => {
  it("opens an empty query when the caret is on @", () => {
    const doc = wireToDoc("query @");
    const focus = wireOffsetToDocPos(doc, docToWire(doc).length);
    expect(resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus))).toEqual({
      queryStart: wireOffsetToDocPos(doc, 6),
      query: "",
    });
  });

  it("does not reopen when typing after a committed mention", () => {
    const wire = "note @caliper-abc123D ";
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
    const doc = wireToDoc("query @\n");
    const focus = wireOffsetToDocPos(doc, docToWire(doc).length);
    expect(resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus))).toBeNull();
  });

  it("does not treat committed mentions as multiline queries", () => {
    const wire = "query @caliper-abc123 \n";
    const doc = wireToDoc(wire);
    const focus = wireOffsetToDocPos(doc, wire.length);
    expect(resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus))).toBeNull();
  });

  it("does not open when caret rests inside a committed mention", () => {
    const agentId = "caliper-abc123";
    const wire = `header @${agentId}`;
    const doc = wireToDoc(wire);
    const interior = wire.indexOf("abc") + 2;
    const focus = wireOffsetToDocPos(doc, interior);
    expect(resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus))).toBeNull();
  });

  it("does not open when caret rests on committed mention boundary", () => {
    const agentId = "caliper-abc123";
    const wire = `header @${agentId}`;
    const doc = wireToDoc(wire);
    const mentionEnd = wire.length;
    const focus = wireOffsetToDocPos(doc, mentionEnd);
    expect(resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus))).toBeNull();
  });

  it("does not open when caret rests on committed mention-start (row-start after blank)", () => {
    const agentId = "caliper-abc123";
    const wire = `mesh @${agentId} \n\n@${agentId} `;
    const doc = wireToDoc(wire);
    const mentionStart = wire.lastIndexOf(`@${agentId}`);
    const focus = wireOffsetToDocPos(doc, mentionStart);
    const ctx = describeHandoffNoteCursorContext(doc, mentionStart);
    expect(ctx.kind).toBe("mention-boundary");
    if (ctx.kind === "mention-boundary") {
      expect(ctx.edge).toBe("start");
    }
    expect(resolveActiveHandoffMentionQueryDoc(doc, collapsedSelection(focus))).toBeNull();
  });

  it("delete spacer before row-start committed pill does not open session", () => {
    const agentId = "caliper-abc123";
    const before = `mesh @${agentId} \n\n @${agentId} `;
    const doc = wireToDoc(before);
    const spaceWire = before.lastIndexOf(` @${agentId}`);
    expect(before[spaceWire]).toBe(" ");
    const deleted = applyDocDelete(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, spaceWire)),
      "delete"
    )!;
    expect(docToWire(deleted.doc)).toBe(`mesh @${agentId} \n\n@${agentId} `);
    expect(resolveActiveHandoffMentionQueryDoc(deleted.doc, deleted.selection)).toBeNull();
  });

  it("opens empty query when caret rests on @ before a following newline (content-row-end wire)", () => {
    const doc = wireToDoc("top @\nbottom");
    const atWire = "top ".length;
    expect(docToWire(doc)[atWire]).toBe("@");
    const active = resolveActiveHandoffMentionQueryDoc(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, atWire))
    );
    expect(active).not.toBeNull();
    expect(active!.query).toBe("");
    expect(docPosToWireOffset(doc, active!.queryStart)).toBe(atWire);
  });

  it("mid-blank fill then @ opens; @w parses query w", () => {
    const agent = "caliper-n4kyih8l2";
    const wire = `wh @${agent} \n\n\nmes @${agent} `;
    const doc = wireToDoc(wire);
    const probes = listEmbeddedBlankBandProbeWires(doc);
    let state = applyDocInsertText(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, probes[1]!)),
      "e"
    );
    for (const ch of "th ") {
      state = applyDocInsertText(state.doc, state.selection, ch);
    }
    state = applyDocInsertText(state.doc, state.selection, "@");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("");

    state = applyDocInsertText(state.doc, state.selection, "w");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("w");
  });
});

describe("delete caret policy — blank-band family", () => {
  const agentA = "caliper-abc123";
  const agentB = "caliper-bbbbbbb";

  /** Filled row above, two blank bands, filled rows below — mention + spacer on top row. */
  function complexMultiBandWire(): string {
    return `header @${agentA} \n\n\nmiddle\n\n\ntail @${agentB} suffix`;
  }

  function chipSuffixToMentionSpace(wire: string) {
    let doc = wireToDoc(wire);
    let selection = collapsedSelection(wireOffsetToDocPos(doc, wire.length));
    const targetLen = wire.indexOf(`@${agentA}`) + 1 + agentA.length + 1;
    while (docToWire(doc).length > targetLen) {
      const next = applyDocDelete(doc, selection, "backspace");
      expect(next).not.toBeNull();
      doc = next!.doc;
      selection = next!.selection;
    }
    return { doc, selection };
  }

  describe("snapDeleteCaretWire — directional interior snap pairs", () => {
    const wire = `header @${agentA} \n\n\n`;

    it("backspace snaps mention-interior to mention-end by default", () => {
      const doc = wireToDoc(wire);
      const interior = wire.indexOf("@") + 1;
      expect(snapDeleteCaretWire(doc, interior, "backspace")).toBe(`header @${agentA}`.length);
    });

    it("delete snaps mention-interior to mention-start by default", () => {
      const doc = wireToDoc(wire);
      const interior = wire.indexOf("@") + 1;
      expect(snapDeleteCaretWire(doc, interior, "delete")).toBe(wire.indexOf("@"));
    });

    it("probe wire is not rewritten by snap (intent owns CRE landing)", () => {
      const doc = wireToDoc(wire);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      expect(snapDeleteCaretWire(doc, probe, "backspace")).toBe(probe);
      expect(snapDeleteCaretWire(doc, probe, "delete")).toBe(probe);
    });
  });

  describe("mention-terminated probe — backspace collapse vs delete collapse", () => {
    it("backspace at first probe when row ends in mention collapses blank when probe equals mention-end", () => {
      const wire = `header @${agentA}\n\n\n`;
      const doc = wireToDoc(wire);
      const mentionEnd = `header @${agentA}`.length;
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);
      expect(firstProbe).toBe(mentionEnd);

      const collapsed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, firstProbe!)),
        "backspace"
      )!;

      expect(docToWire(collapsed.doc)).toBe(`header @${agentA}\n\n`);
      expect(docToWire(collapsed.doc)).toContain(agentA);
      expect(docPosToWireOffset(collapsed.doc, collapsed.selection.focus)).toBe(mentionEnd);
      expect(describeHandoffNoteCursorContext(collapsed.doc, mentionEnd).kind).toBe(
        "mention-boundary"
      );
    });

    it("backspace at first probe collapses blank when probe follows post-mention spacer", () => {
      const wire = `header @${agentA} \n\n\n`;
      const doc = wireToDoc(wire);
      const mentionEnd = `header @${agentA}`.length;
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);
      expect(firstProbe).toBe(mentionEnd + 1);

      const collapsed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, firstProbe!)),
        "backspace"
      )!;

      // Blank owns the unit — do not step/chip spacer from the probe.
      expect(docToWire(collapsed.doc)).toBe(`header @${agentA} \n\n`);
      // Trailing-only multi-blank: remount CRE/`after` on spacer (next BS chips spacer).
      expect(
        docToWire(collapsed.doc)[docPosToWireOffset(collapsed.doc, collapsed.selection.focus)]
      ).toBe(" ");
      expect(collapsed.selection.focusAffinity).toBe("after");
      expect(wire[mentionEnd]).toBe(" ");
    });

    describe("probe-alias after whitespace chip — lands content row end not delete-probe", () => {
      function chipSpacerBeforeFirstProbe(wire: string) {
        const doc = wireToDoc(wire);
        const probes = listEmbeddedBlankBandProbeWires(doc);
        const spacerWire = probes[0]! - 1;
        expect(wire[spacerWire]).toBe(" ");
        const chipped = applyDocDelete(
          doc,
          collapsedSelection(wireOffsetToDocPos(doc, spacerWire), "after"),
          "backspace"
        )!;
        return { chipped, probes };
      }

      function expectLandsOffDeleteProbeAtContentRowEnd(
        chipped: NonNullable<ReturnType<typeof applyDocDelete>>,
        expectedWire: string
      ) {
        const [probe] = listEmbeddedBlankBandProbeWires(chipped.doc);
        const contentEnd = embeddedBlankBandContentRowEndBeforeProbe(chipped.doc, probe!);
        expect(docToWire(chipped.doc)).toBe(expectedWire);
        expect(
          isEmbeddedBlankBandCollapseProbeWire(
            chipped.doc,
            docPosToWireOffset(chipped.doc, chipped.selection.focus),
            chipped.selection.focus
          )
        ).toBe(false);
        expect(docPosToWireOffset(chipped.doc, chipped.selection.focus)).toBe(contentEnd);
        return contentEnd;
      }

      it("prefix + mention row + spacer", () => {
        const wire = `header header @${agentA} \n\n\n`;
        const { chipped } = chipSpacerBeforeFirstProbe(wire);
        const contentEnd = expectLandsOffDeleteProbeAtContentRowEnd(
          chipped,
          `header header @${agentA}\n\n\n`
        );
        expect(describeHandoffNoteCursorContext(chipped.doc, contentEnd).kind).toBe(
          "mention-boundary"
        );
      });

      it("mention-only row + spacer", () => {
        const wire = `@${agentA} \n\n\n`;
        const { chipped } = chipSpacerBeforeFirstProbe(wire);
        const contentEnd = expectLandsOffDeleteProbeAtContentRowEnd(chipped, `@${agentA}\n\n\n`);
        expect(describeHandoffNoteCursorContext(chipped.doc, contentEnd).kind).toBe(
          "mention-boundary"
        );
      });

      it("plain text tail + spacer", () => {
        const wire = `tail \n\n\n`;
        const { chipped } = chipSpacerBeforeFirstProbe(wire);
        const contentEnd = expectLandsOffDeleteProbeAtContentRowEnd(chipped, `tail\n\n\n`);
        expect(describeHandoffNoteCursorContext(chipped.doc, contentEnd).kind).toBe("text");
      });
    });

    it("delete at first probe when row ends in mention collapses blank below not atomic remove", () => {
      const wire = `header @${agentA}\n\n\n`;
      const doc = wireToDoc(wire);
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);

      const collapsed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, firstProbe!)),
        "delete"
      )!;

      expect(docToWire(collapsed.doc)).toBe(`header @${agentA}\n\n`);
      expect(docToWire(collapsed.doc)).toContain(agentA);
    });

    it("delete at mention node end after spacer chip collapses blank band (look right)", () => {
      const wire = `header @${agentA} \n\n\n`;
      const doc = wireToDoc(wire);
      const spacerWire = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spacerWire), "after"),
        "backspace"
      )!;
      expect(handoffNoteCaretOnAtomicNodeEnd(chipped.doc, chipped.selection.focus)).toBe(true);

      const collapsed = applyDocDelete(chipped.doc, chipped.selection, "delete")!;
      expect(docToWire(collapsed.doc)).toBe(`header @${agentA}\n\n`);
      expect(docToWire(collapsed.doc)).toContain(agentA);
    });

    it("delete at first probe when probe follows spacer collapses blank below not step to mention-end", () => {
      const wire = `header @${agentA} \n\n\n`;
      const doc = wireToDoc(wire);
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);

      const collapsed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, firstProbe!)),
        "delete"
      )!;

      expect(docToWire(collapsed.doc)).toBe(`header @${agentA} \n\n`);
      expect(docToWire(collapsed.doc)).toContain(agentA);
    });
  });

  describe("substantive chip and atomic mention remove", () => {
    it("substantive postfix chip at content caret lands at mention-end off blank-band probe", () => {
      const wire = `header @${agentA} x\n\n\n`;
      const xWire = wire.indexOf("x");
      const doc = wireToDoc(wire);
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, xWire), "after"),
        "backspace"
      )!;
      expect(docToWire(chipped.doc)).toBe(`header @${agentA} \n\n\n`);
      const caretWire = docPosToWireOffset(chipped.doc, chipped.selection.focus);
      expect(caretWire).toBe(`header @${agentA}`.length);
      expect(
        isEmbeddedBlankBandCollapseProbeWire(chipped.doc, caretWire, chipped.selection.focus)
      ).toBe(false);
    });

    it("backspace after postfix chip with trailing spacer removes mention preserving blank run", () => {
      const wire = `header @${agentA} x\n\n\n`;
      const xWire = wire.indexOf("x");
      const doc = wireToDoc(wire);
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, xWire), "after"),
        "backspace"
      )!;
      let state = chipped;
      while (docToWire(state.doc).includes(`@${agentA}`)) {
        const next = applyDocDelete(state.doc, state.selection, "backspace");
        expect(next).not.toBeNull();
        state = next!;
      }
      expect(docToWire(state.doc)).toBe(`header \n\n\n`);
    });

    it("forward delete at mention interior removes mention preserving blank run — simple wire", () => {
      const wire = `header @${agentA} \n\n\n`;
      const doc = wireToDoc(wire);
      const mentionInterior = wire.indexOf("@") + 1;
      const removed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionInterior)),
        "delete"
      )!;
      expect(docToWire(removed.doc)).toBe(`header  \n\n\n`);
      const probes = listEmbeddedBlankBandProbeWires(removed.doc);
      const caretWire = docPosToWireOffset(removed.doc, removed.selection.focus);
      expect(caretWire).toBe(probes[0]! - 1);
      expect(
        isEmbeddedBlankBandCollapseProbeWire(removed.doc, caretWire, removed.selection.focus)
      ).toBe(false);
    });

    it("forward delete at mention interior in multi-band wire preserves blank run", () => {
      const wire = complexMultiBandWire();
      const doc = wireToDoc(wire);
      const mentionInterior = wire.indexOf("@") + 1;
      const removed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionInterior)),
        "delete"
      )!;
      expect(docToWire(removed.doc)).toBe(`header  \n\n\nmiddle\n\n\ntail @${agentB} suffix`);
      expect(docToWire(removed.doc)).not.toContain(agentA);
      expect(docToWire(removed.doc)).toContain(agentB);
      const caretWire = docPosToWireOffset(removed.doc, removed.selection.focus);
      expect(
        isEmbeddedBlankBandCollapseProbeWire(removed.doc, caretWire, removed.selection.focus)
      ).toBe(false);
    });
  });

  describe("glued postfix chip lands mention-end alias off delete-probe", () => {
    /** Row ends with mention then one substantive char immediately before the first probe (no spacer). */
    function gluedPostfixUpperBandWire(postfixChar = "T"): string {
      return `note @${agentA}${postfixChar}\n\n\n`;
    }

    function gluedPostfixSandwichedWire(postfixChar = "T"): string {
      return `note @${agentA}${postfixChar}\n\n\nmiddle\n\n\nlower`;
    }

    function chipGluedPostfixAtContentCaret(wire: string) {
      const doc = wireToDoc(wire);
      const postfixWire = wire.search(/[A-Za-z]\n/);
      expect(postfixWire).toBeGreaterThanOrEqual(0);
      return applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, postfixWire), "after"),
        "backspace"
      )!;
    }

    it("backspace at probe collapses blank without chipping glued postfix", () => {
      const wire = gluedPostfixUpperBandWire();
      const doc = wireToDoc(wire);
      const [probe] = listEmbeddedBlankBandProbeWires(doc);

      const collapsed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probe!)),
        "backspace"
      )!;

      expect(docToWire(collapsed.doc)).toBe(`note @${agentA}T\n\n`);
      expect(docToWire(collapsed.doc)).toContain("T");
    });

    it("backspace at glued postfix content caret chips T and lands mention-node-end alias off delete-probe", () => {
      const wire = gluedPostfixUpperBandWire();
      const mentionEnd = `note @${agentA}`.length;

      const chipped = chipGluedPostfixAtContentCaret(wire);

      expect(docToWire(chipped.doc)).toBe(`note @${agentA}\n\n\n`);
      const caretWire = docPosToWireOffset(chipped.doc, chipped.selection.focus);
      expect(caretWire).toBe(mentionEnd);
      const ctx = describeHandoffNoteCursorContext(chipped.doc, caretWire);
      expect(ctx.kind).toBe("mention-boundary");
      if (ctx.kind === "mention-boundary") {
        expect(ctx.edge).toBe("end");
      }
      expect(
        isEmbeddedBlankBandCollapseProbeWire(chipped.doc, caretWire, chipped.selection.focus)
      ).toBe(false);
    });

    it("backspace after glued postfix chip from mention-end collapses blank not mention remove", () => {
      const chipped = chipGluedPostfixAtContentCaret(gluedPostfixUpperBandWire());
      expect(docToWire(chipped.doc)).toBe(`note @${agentA}\n\n\n`);
      const mentionEnd = `note @${agentA}`.length;

      const collapsed = applyDocDelete(
        chipped.doc,
        collapsedSelection(wireOffsetToDocPos(chipped.doc, mentionEnd)),
        "backspace"
      )!;
      expect(docToWire(collapsed.doc)).toBe(`note @${agentA}\n\n`);
      expect(docToWire(collapsed.doc)).toContain(agentA);
    });

    it("backspace after glued postfix chip removes mention preserving blank run", () => {
      const chipped = chipGluedPostfixAtContentCaret(gluedPostfixUpperBandWire());

      const removed = applyDocDelete(chipped.doc, chipped.selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`note \n\n\n`);
      expect(docToWire(removed.doc)).not.toContain(`@${agentA}`);
    });

    it("delete after glued postfix chip collapses blank band preserving mention", () => {
      const chipped = chipGluedPostfixAtContentCaret(gluedPostfixUpperBandWire());
      const deleted = applyDocDelete(chipped.doc, chipped.selection, "delete")!;
      expect(docToWire(deleted.doc)).toBe(`note @${agentA}\n\n`);
      expect(docToWire(deleted.doc)).toContain(agentA);
    });

    it("delete after glued postfix chip lands cleared content row end not delete-probe", () => {
      const chipped = chipGluedPostfixAtContentCaret(gluedPostfixUpperBandWire());
      const deleted = applyDocDelete(chipped.doc, chipped.selection, "delete")!;
      const caretWire = docPosToWireOffset(deleted.doc, deleted.selection.focus);
      expect(
        isEmbeddedBlankBandCollapseProbeWire(deleted.doc, caretWire, deleted.selection.focus)
      ).toBe(false);
    });

    it("backspace at mention-end when mention already abuts probe collapses blank not mention remove", () => {
      const wire = `note @${agentA}\n\n\n`;
      const doc = wireToDoc(wire);
      const mentionEnd = `note @${agentA}`.length;
      const [probe] = listEmbeddedBlankBandProbeWires(doc);
      expect(probe).toBe(mentionEnd);

      const collapsed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionEnd)),
        "backspace"
      )!;

      expect(docToWire(collapsed.doc)).toBe(`note @${agentA}\n\n`);
      expect(docToWire(collapsed.doc)).toContain(agentA);
    });

    it("mention-only row glued postfix before probe — backspace at probe collapses blank without chipping postfix", () => {
      const wire = `@${agentA}T\n\n\n`;
      const doc = wireToDoc(wire);
      const [probe] = listEmbeddedBlankBandProbeWires(doc);

      const collapsed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probe!)),
        "backspace"
      )!;

      expect(docToWire(collapsed.doc)).toBe(`@${agentA}T\n\n`);
      expect(docToWire(collapsed.doc)).toContain(agentA);
      expect(docToWire(collapsed.doc)).toContain("T");
    });

    it("glued postfix chip at sandwiched upper content caret removes mention without touching lower band", () => {
      const wire = gluedPostfixSandwichedWire();
      const chipped = chipGluedPostfixAtContentCaret(wire);
      expect(docToWire(chipped.doc)).toBe(`note @${agentA}\n\n\nmiddle\n\n\nlower`);
      const ctx = describeHandoffNoteCursorContext(
        chipped.doc,
        docPosToWireOffset(chipped.doc, chipped.selection.focus)
      );
      expect(ctx.kind).toBe("mention-boundary");
      if (ctx.kind === "mention-boundary") {
        expect(ctx.edge).toBe("end");
      }

      const removed = applyDocDelete(chipped.doc, chipped.selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`note \n\n\nmiddle\n\n\nlower`);
      expect(docToWire(removed.doc)).not.toContain(`@${agentA}`);
      expect(docToWire(removed.doc)).toContain("middle");
      expect(docToWire(removed.doc)).toContain("lower");
    });
  });

  describe("prefix before mention — cleared row end then blank collapse", () => {
    function sandwichedPrefixWire(prefix = "T") {
      return `\n\n\n${prefix} @${agentA}\n\n\nmiddle`;
    }

    function deleteLeadingBlankBandToRowStart(wire: string) {
      let doc = wireToDoc(wire);
      let selection = collapsedSelection(wireOffsetToDocPos(doc, 0));
      while (docPosToWireOffset(doc, selection.focus) === 0 && docToWire(doc).startsWith("\n")) {
        const next = applyDocDelete(doc, selection, "delete");
        expect(next).not.toBeNull();
        doc = next!.doc;
        selection = next!.selection;
      }
      return { doc, selection };
    }

    function deleteForwardUntilMentionRemoved(
      doc: ReturnType<typeof wireToDoc>,
      selection: ReturnType<typeof collapsedSelection>
    ) {
      let state = { doc, selection };
      while (docToWire(state.doc).includes(`@${agentA}`)) {
        const next = applyDocDelete(state.doc, state.selection, "delete");
        expect(next).not.toBeNull();
        state = { doc: next!.doc, selection: next!.selection };
      }
      return state;
    }

    it("delete — row visual start with leading blanks lands cleared row end; next delete collapses blank", () => {
      const wire = sandwichedPrefixWire();
      const doc = wireToDoc(wire);
      const rowStart = wire.search(/[^\n]/);

      let replay = { doc, selection: collapsedSelection(wireOffsetToDocPos(doc, rowStart)) };
      let chipped: ReturnType<typeof applyDocDelete> | undefined;
      while (docToWire(replay.doc).includes(`@${agentA}`)) {
        const next = applyDocDelete(replay.doc, replay.selection, "delete")!;
        if (!docToWire(next.doc).includes(`@${agentA}`)) {
          chipped = next;
        }
        replay = { doc: next.doc, selection: next.selection };
      }

      expect(docToWire(replay.doc)).toBe(`\n\n\n\n\n\nmiddle`);
      expectOffDeleteProbeInfrastructure(
        chipped!.doc,
        docPosToWireOffset(chipped!.doc, chipped!.selection.focus),
        chipped!.selection.focus
      );

      const collapsed = applyDocDelete(replay.doc, replay.selection, "delete")!;
      expect(docToWire(collapsed.doc)).toBe(`\n\n\n\n\nmiddle`);
      expect(docToWire(collapsed.doc)).toContain("middle");
    });

    it("delete — leading blank band consumed first then row clear preserves middle band", () => {
      const wire = sandwichedPrefixWire();
      const landed = deleteLeadingBlankBandToRowStart(wire);
      expect(docToWire(landed.doc)).toBe(`T @${agentA}\n\n\nmiddle`);

      const { doc, selection } = deleteForwardUntilMentionRemoved(landed.doc, landed.selection);
      expect(docToWire(doc)).toBe(`\n\n\nmiddle`);
      expect(docToWire(doc)).toContain("middle");
    });

    it("delete — T prefix trailing blank band after row clear", () => {
      const wire = `\n\n\nT @${agentA}\n\n\n`;
      const landed = deleteLeadingBlankBandToRowStart(wire);
      expect(docToWire(landed.doc)).toBe(`T @${agentA}\n\n\n`);

      const { doc } = deleteForwardUntilMentionRemoved(landed.doc, landed.selection);
      expect(docToWire(doc)).toBe(`\n\n\n`);
      expect(docToWire(doc)).not.toContain(agentA);
    });

    it("delete — note prefix with tail after leading blanks consumed", () => {
      const wire = `\n\n\nnote @${agentA} tail`;
      const landed = deleteLeadingBlankBandToRowStart(wire);
      expect(docToWire(landed.doc)).toBe(`note @${agentA} tail`);

      const { doc } = deleteForwardUntilMentionRemoved(landed.doc, landed.selection);
      expect(docToWire(doc)).toBe(" tail");
      expect(docToWire(doc)).not.toContain(agentA);
    });

    it("backspace — mention-only sandwiched row lands cleared row end; next backspace collapses blank", () => {
      const wire = `\n\n\n@${agentA}\n\n\nmiddle`;
      const doc = wireToDoc(wire);
      const mentionInterior = wire.indexOf("@") + 5;

      const removed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionInterior)),
        "backspace"
      )!;
      expect(docToWire(removed.doc)).toBe(`\n\n\n\n\n\nmiddle`);
      expectOffDeleteProbeInfrastructure(
        removed.doc,
        docPosToWireOffset(removed.doc, removed.selection.focus),
        removed.selection.focus
      );

      const collapsed = applyDocDelete(removed.doc, removed.selection, "backspace")!;
      expect(docToWire(collapsed.doc)).toBe(`\n\n\n\n\nmiddle`);
      expect(docToWire(collapsed.doc)).toContain("middle");
    });

    it("backspace — content row end nibble preserves separated bands (control)", () => {
      const wire = sandwichedPrefixWire();
      let doc = wireToDoc(wire);
      let selection = collapsedSelection(wireOffsetToDocPos(doc, wire.indexOf("@")));
      while (docToWire(doc).includes(`@${agentA}`)) {
        const next = applyDocDelete(doc, selection, "backspace")!;
        doc = next.doc;
        selection = next.selection;
      }
      expect(docToWire(doc)).toBe(`\n\n\nmiddle`);
      expect(docToWire(doc)).toContain("middle");
    });

    it("backspace — at populated row visual start does not nip row text", () => {
      const wire = sandwichedPrefixWire();
      const doc = wireToDoc(wire);
      const rowStart = wire.search(/[^\n]/);
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, rowStart)),
        "backspace"
      )!;
      expect(docToWire(result.doc)).toContain("T");
      expect(docToWire(result.doc)).toContain(agentA);
    });

    it("backspace — upper-band spacer chip then mention remove preserves blank run", () => {
      const wire = `header @${agentA} \n\n\nmiddle\n\n\ntail @${agentA} suffix`;
      const doc = wireToDoc(wire);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probe - 1)),
        "backspace"
      )!;
      const removed = applyDocDelete(chipped.doc, chipped.selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`header \n\n\nmiddle\n\n\ntail @${agentA} suffix`);
      expect(docToWire(removed.doc)).toContain(agentA);
    });
  });

  describe("forward delete from row visual start — glued postfix on mention row", () => {
    function gluedPostfixTrailingBandWire(postfixChar = "T"): string {
      return `note @${agentA}${postfixChar}\n\n\n`;
    }

    function gluedPostfixSandwichedRowWire(postfixChar = "T"): string {
      return `note @${agentA}${postfixChar}\n\n\nmiddle`;
    }

    function deleteLeadingBlankBandToRowStart(wire: string) {
      let doc = wireToDoc(wire);
      let selection = collapsedSelection(wireOffsetToDocPos(doc, 0));
      while (docPosToWireOffset(doc, selection.focus) === 0 && docToWire(doc).startsWith("\n")) {
        const next = applyDocDelete(doc, selection, "delete");
        expect(next).not.toBeNull();
        doc = next!.doc;
        selection = next!.selection;
      }
      return {
        doc,
        selection,
        rowStartWire: docPosToWireOffset(doc, selection.focus),
      };
    }

    function deleteForwardUntilMentionRemoved(
      doc: ReturnType<typeof wireToDoc>,
      selection: ReturnType<typeof collapsedSelection>
    ) {
      let state = { doc, selection };
      while (docToWire(state.doc).includes(`@${agentA}`)) {
        const next = applyDocDelete(state.doc, state.selection, "delete");
        expect(next).not.toBeNull();
        state = { doc: next!.doc, selection: next!.selection };
      }
      return state;
    }

    it("after leading blank band delete from populated row visual start removes mention atomically", () => {
      const wire = `\n\n\nnote @${agentA} tail`;
      const { doc, selection, rowStartWire } = deleteLeadingBlankBandToRowStart(wire);
      expect(rowStartWire).toBe(0);
      expect(docToWire(doc)).toBe(`note @${agentA} tail`);

      const { doc: afterMention, selection: afterSelection } = deleteForwardUntilMentionRemoved(
        doc,
        selection
      );
      expect(docToWire(afterMention)).toBe(" tail");
      expect(docPosToWireOffset(afterMention, afterSelection.focus)).toBe(0);
    });

    it("delete from row visual start through glued postfix on trailing blank band leaves postfix on wire", () => {
      const wire = gluedPostfixTrailingBandWire();
      const doc = wireToDoc(wire);
      const { doc: afterMention } = deleteForwardUntilMentionRemoved(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0))
      );
      expect(docToWire(afterMention)).toBe(`T\n\n\n`);
    });

    it("delete from row visual start through glued postfix on sandwiched row leaves postfix and lower row", () => {
      const wire = gluedPostfixSandwichedRowWire();
      const doc = wireToDoc(wire);
      const { doc: afterMention } = deleteForwardUntilMentionRemoved(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0))
      );
      expect(docToWire(afterMention)).toBe(`T\n\n\nmiddle`);
    });

    it("delete after forward nibble rests on glued postfix removes postfix not blank band", () => {
      const wire = gluedPostfixSandwichedRowWire();
      const doc = wireToDoc(wire);
      const { doc: afterMention, selection } = deleteForwardUntilMentionRemoved(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0))
      );
      expect(docToWire(afterMention)).toBe(`T\n\n\nmiddle`);

      const afterPostfix = applyDocDelete(afterMention, selection, "delete")!;
      expect(docToWire(afterPostfix.doc)).toBe(`\n\n\nmiddle`);
      expect(docToWire(afterPostfix.doc)).toContain("middle");
    });

    it("delete at mention-start on glued postfix row removes mention leaving prefix and postfix", () => {
      const wire = gluedPostfixSandwichedRowWire();
      const doc = wireToDoc(wire);
      const mentionStart = wire.indexOf("@");
      const afterMention = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionStart)),
        "delete"
      )!;
      expect(docToWire(afterMention.doc)).toBe(`note T\n\n\nmiddle`);

      const afterPostfix = applyDocDelete(afterMention.doc, afterMention.selection, "delete")!;
      expect(docToWire(afterPostfix.doc)).toBe(`note \n\n\nmiddle`);
      expect(docToWire(afterPostfix.doc)).not.toContain("T");
    });
  });

  describe("sandwiched row — mention gate delete", () => {
    function sandwichedMentionRowWire(prefix = "tail") {
      return `header @${agentA} row\n\n ${prefix} @${agentA} \nlower`;
    }

    function sandwichedMentionOnlyRowWire() {
      return `header @${agentA} row\n\n @${agentA} \nlower`;
    }

    /** Two blank bands with mention-only row sandwiched below the upper band. */
    function complexMultiBandMentionOnlySandwichedRowWire() {
      return `header @${agentA} \n\n\n @${agentA} \nmiddle\n\n\ntail @${agentB} suffix`;
    }

    function sandwichedRowVisualStart(wire: string) {
      let start = listEmbeddedBlankBandProbeWires(wireToDoc(wire))[0]! + 1;
      while (wire[start] === "\n") {
        start += 1;
      }
      return start;
    }

    function mentionStartOnSandwichedRow(wire: string) {
      return wire.indexOf("@", sandwichedRowVisualStart(wire));
    }

    function spaceWireBeforeMentionOnSandwichedRow(wire: string) {
      const mentionAt = mentionStartOnSandwichedRow(wire);
      return wire.lastIndexOf(" ", mentionAt);
    }

    function expectMentionGateAuthority(
      doc: HandoffNoteDoc,
      focus: { nodeIndex: number; nodeOffset: number },
      gateWire: number
    ) {
      expect(doc.nodes[focus.nodeIndex]?.type).toBe("text");
      expect(docPosToWireOffset(doc, focus)).toBe(gateWire);
      expect(isEmbeddedBlankBandCollapseProbeWire(doc, gateWire, focus)).toBe(false);
      expect(describeHandoffNoteCursorContext(doc, gateWire).kind).toBe("mention-boundary");
    }

    it("forward delete whitespace before mention rests on text gate not mention node", () => {
      const wire = sandwichedMentionOnlyRowWire();
      const doc = wireToDoc(wire);
      const spaceWire = spaceWireBeforeMentionOnSandwichedRow(wire);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spaceWire)),
        "delete"
      )!;
      expectMentionGateAuthority(cleared.doc, cleared.selection.focus, spaceWire);
    });

    it("mention-only sandwiched row — forward delete spacer without prior prefix chip", () => {
      const wire = sandwichedMentionOnlyRowWire();
      const doc = wireToDoc(wire);
      const spaceWire = spaceWireBeforeMentionOnSandwichedRow(wire);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spaceWire)),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toMatch(/\n\n@caliper-abc123 \nlower/);
      expectMentionGateAuthority(cleared.doc, cleared.selection.focus, spaceWire);
    });

    it("prefix chip ladder then spacer stays off delete-probe infrastructure", () => {
      const wireStr = sandwichedMentionRowWire("tail");
      let doc = wireToDoc(wireStr);
      let selection = collapsedSelection(
        wireOffsetToDocPos(doc, sandwichedRowVisualStart(wireStr))
      );

      for (const expectedChar of ["t", "a", "i", "l", " ", "@"] as const) {
        const next = applyDocDelete(doc, selection, "delete")!;
        const wire = docToWire(next.doc);
        const fw = docPosToWireOffset(next.doc, next.selection.focus);
        expect(isEmbeddedBlankBandCollapseProbeWire(next.doc, fw, next.selection.focus)).toBe(
          false
        );
        if (expectedChar === " ") {
          expect(wire[fw]).toBe(" ");
        } else if (expectedChar === "@") {
          expect(wire[fw]).toBe("@");
          expectMentionGateAuthority(next.doc, next.selection.focus, fw);
        } else {
          expect(wire[fw]).toBe(expectedChar);
        }
        doc = next.doc;
        selection = next.selection;
      }
    });

    it("backspace at mention start removes spacer and lands on text mention gate", () => {
      const wire = sandwichedMentionOnlyRowWire();
      const doc = wireToDoc(wire);
      const mentionStart = mentionStartOnSandwichedRow(wire);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionStart)),
        "backspace"
      )!;
      expect(docToWire(cleared.doc)).toMatch(/\n\n@caliper-abc123 \nlower/);
      const gateWire = docPosToWireOffset(cleared.doc, cleared.selection.focus);
      expectMentionGateAuthority(cleared.doc, cleared.selection.focus, gateWire);
    });

    it("backspace after prefix chip removes spacer and lands on text mention gate", () => {
      const wireStr = sandwichedMentionRowWire("tail");
      let doc = wireToDoc(wireStr);
      let selection = collapsedSelection(
        wireOffsetToDocPos(doc, sandwichedRowVisualStart(wireStr))
      );
      for (let i = 0; i < 4; i++) {
        const next = applyDocDelete(doc, selection, "delete")!;
        doc = next.doc;
        selection = next.selection;
      }
      const mentionStart = mentionStartOnSandwichedRow(docToWire(doc));
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionStart)),
        "backspace"
      )!;
      const gateWire = docPosToWireOffset(cleared.doc, cleared.selection.focus);
      expectMentionGateAuthority(cleared.doc, cleared.selection.focus, gateWire);
    });

    it("multi-band interchanged wire — forward delete spacer on mention-only sandwiched row", () => {
      const wire = complexMultiBandMentionOnlySandwichedRowWire();
      const doc = wireToDoc(wire);
      const spaceWire = spaceWireBeforeMentionOnSandwichedRow(wire);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spaceWire)),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toContain(`@${agentA}`);
      expect(docToWire(cleared.doc)).toContain("middle");
      expectMentionGateAuthority(cleared.doc, cleared.selection.focus, spaceWire);
    });
  });

  describe("forward chip through mention — prefix row", () => {
    function embeddedRowChipWire() {
      return `head\n\ntext @${agentA} \nlower @${agentA} `;
    }

    function chipCaretWireInPrefixRow(wire: string) {
      const rowPrefix = "text";
      return wire.indexOf(rowPrefix) + 2;
    }

    it("spacer delete before mention with prefix rests on text alias not mention node", () => {
      const wire = `head\n\nte @${agentA} tail`;
      const doc = wireToDoc(wire);
      const mentionAtWire = wire.indexOf("@");
      const spaceWire = wire.lastIndexOf(" ", mentionAtWire);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spaceWire)),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe(`head\n\nte@${agentA} tail`);
      expect(cleared.doc.nodes[cleared.selection.focus.nodeIndex]?.type).toBe("text");
      const mentionAt = docToWire(cleared.doc).indexOf("@", wire.indexOf("\n\n") + 2);
      expect(docPosToWireOffset(cleared.doc, cleared.selection.focus)).toBe(mentionAt);
      expect(
        isEmbeddedBlankBandCollapseProbeWire(cleared.doc, mentionAt, cleared.selection.focus)
      ).toBe(false);
      expect(describeHandoffNoteCursorContext(cleared.doc, mentionAt).kind).toBe(
        "mention-boundary"
      );
    });

    it("forward delete mention remove leaves trailing commit spacer for next Delete", () => {
      const wireStr = embeddedRowChipWire();
      let doc = wireToDoc(wireStr);
      let selection = collapsedSelection(
        wireOffsetToDocPos(doc, chipCaretWireInPrefixRow(wireStr))
      );
      for (let i = 0; i < 3; i++) {
        const next = applyDocDelete(doc, selection, "delete")!;
        doc = next.doc;
        selection = next.selection;
      }
      const removed = applyDocDelete(doc, selection, "delete")!;
      expect(docToWire(removed.doc)).toBe(`head\n\nte \nlower @${agentA} `);
      const caretWire = docPosToWireOffset(removed.doc, removed.selection.focus);
      expect(docToWire(removed.doc)[caretWire]).toBe(" ");
      expect(removed.selection.focusAffinity).toBe("before");
      expect(removed.doc.nodes[removed.selection.focus.nodeIndex]?.type).toBe("text");
      const spacerCleared = applyDocDelete(removed.doc, removed.selection, "delete")!;
      expect(docToWire(spacerCleared.doc)).toBe(`head\n\nte\nlower @${agentA} `);
    });
  });

  describe("complex structure — multi-band filled rows above and below", () => {
    it("backspace at upper-band first probe remounts CRE after on header when sandwiched", () => {
      const wire = complexMultiBandWire();
      const doc = wireToDoc(wire);
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);

      const collapsed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, firstProbe!)),
        "backspace"
      )!;

      const resultWire = docToWire(collapsed.doc);
      expect(resultWire).toBe(`header @${agentA} \n\nmiddle\n\n\ntail @${agentB} suffix`);
      expect(resultWire).toContain(`@${agentA}`);
      const headerCre = resultWire.indexOf("\n") - 1;
      expect(resultWire[headerCre]).toBe(" ");
      expect(docPosToWireOffset(collapsed.doc, collapsed.selection.focus)).toBe(headerCre);
      expect(collapsed.selection.focusAffinity).toBe("after");
    });

    it("delete at upper-band first probe collapses blank below not atomic remove", () => {
      const wire = complexMultiBandWire();
      const doc = wireToDoc(wire);
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);

      const collapsed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, firstProbe!)),
        "delete"
      )!;

      expect(docToWire(collapsed.doc)).toBe(
        `header @${agentA} \n\nmiddle\n\n\ntail @${agentB} suffix`
      );
      expect(docToWire(collapsed.doc)).toContain(agentA);
    });

    it("backspace at lower-band first probe remounts CRE after on middle", () => {
      const wire = complexMultiBandWire();
      const doc = wireToDoc(wire);
      const lowerBand = listEmbeddedBlankBandGroups(doc)[1]!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerBand.probes[0]!)),
        "backspace"
      )!;

      const resultWire = docToWire(result.doc);
      expect(resultWire).toBe(`header @${agentA} \n\n\nmiddle\n\ntail @${agentB} suffix`);
      const middleEnd = resultWire.indexOf("\n", resultWire.indexOf("middle")) - 1;
      expect(resultWire[middleEnd]).toBe("e");
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(middleEnd);
      expect(result.selection.focusAffinity).toBe("after");
    });

    it("delete at lower-band first probe collapses within lower band only", () => {
      const wire = complexMultiBandWire();
      const doc = wireToDoc(wire);
      const lowerBand = listEmbeddedBlankBandGroups(doc)[1]!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerBand.probes[0]!)),
        "delete"
      )!;

      expect(docToWire(result.doc)).toBe(
        `header @${agentA} \n\n\nmiddle\n\ntail @${agentB} suffix`
      );
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(lowerBand.probes[0]!);
    });

    it("backspace after EOF blank chip at mention-end probe removes mention not blank band", () => {
      const wire = `header @${agentA} tail\n\n\n`;
      const doc = wireToDoc(wire);
      const rowEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
      let d = doc;
      let selection = collapsedSelection(wireOffsetToDocPos(doc, rowEnd), "after");
      const stableWire = `header @${agentA} \n\n\n`;

      for (let i = 0; i < 20 && docToWire(d) !== stableWire; i++) {
        const next = applyDocDelete(d, selection, "backspace");
        expect(next).not.toBeNull();
        d = next!.doc;
        selection = next!.selection;
      }
      expect(docToWire(d)).toBe(stableWire);

      const afterSpace = applyDocDelete(d, selection, "backspace")!;
      const mentionEnd = `header @${agentA}`.length;
      expect(docPosToWireOffset(afterSpace.doc, afterSpace.selection.focus)).toBe(mentionEnd);

      const removed = applyDocDelete(afterSpace.doc, afterSpace.selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`header \n\n\n`);
      expect(docToWire(removed.doc)).not.toContain(agentA);
    });
  });

  describe("suffix chip and mention-boundary landing", () => {
    it("backspace through suffix rests at mention-end not interior", () => {
      const wire = `header @${agentA} tail`;
      const { doc, selection } = chipSuffixToMentionSpace(wire);
      const afterSpace = applyDocDelete(doc, selection, "backspace")!;
      const caretWire = docPosToWireOffset(afterSpace.doc, afterSpace.selection.focus);
      expect(caretWire).toBe(`header @${agentA}`.length);
      expect(describeHandoffNoteCursorContext(afterSpace.doc, caretWire).kind).toBe(
        "mention-boundary"
      );
      expect(resolveActiveHandoffMentionQueryDoc(afterSpace.doc, afterSpace.selection)).toBeNull();
    });

    it("trailing spacer backspace after committed mention lands mention-end boundary", () => {
      const wire = `header @${agentA} `;
      const doc = wireToDoc(wire);
      const afterSpace = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, wire.length)),
        "backspace"
      )!;
      const mentionEndWire = `header @${agentA}`.length;
      const caretWire = docPosToWireOffset(afterSpace.doc, afterSpace.selection.focus);
      expect(docToWire(afterSpace.doc)).toBe(`header @${agentA}`);
      expect(caretWire).toBe(mentionEndWire);
      expect(describeHandoffNoteCursorContext(afterSpace.doc, caretWire).kind).toBe(
        "mention-boundary"
      );
    });

    it("mention at row start — backspace at mention-end after spacer chip removes mention", () => {
      const wire = `@${agentA} tail\n\n\n`;
      const doc = wireToDoc(wire);
      const rowEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
      let d = doc;
      let selection = collapsedSelection(wireOffsetToDocPos(doc, rowEnd), "after");
      const stableWire = `@${agentA} \n\n\n`;

      for (let i = 0; i < 20 && docToWire(d) !== stableWire; i++) {
        const next = applyDocDelete(d, selection, "backspace");
        expect(next).not.toBeNull();
        d = next!.doc;
        selection = next!.selection;
      }
      expect(docToWire(d)).toBe(stableWire);

      const afterSpace = applyDocDelete(d, selection, "backspace")!;
      const mentionEnd = `@${agentA}`.length;
      expect(docPosToWireOffset(afterSpace.doc, afterSpace.selection.focus)).toBe(mentionEnd);

      const removed = applyDocDelete(afterSpace.doc, afterSpace.selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`\n\n\n`);
      expect(docToWire(removed.doc)).not.toContain(agentA);
    });
  });
});

describe("mention query insert folds blank continuation lines onto @", () => {
  /** Shift+Enter band under `@`, then Backspace through blanks (no jump) until CRE/`after` on `@`. */
  function replayShiftEnterProgressiveToAtCre() {
    let doc = wireToDoc("note @");
    let focus = wireOffsetToDocPos(doc, docToWire(doc).length);
    let state = applyDocLineBreak(doc, collapsedSelection(focus));
    for (let i = 0; i < 3; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    for (let i = 0; i < 8; i++) {
      const wire = docToWire(state.doc);
      const land = docPosToWireOffset(state.doc, state.selection.focus);
      if (wire[land] === "@" && state.selection.focusAffinity === "after") {
        return state;
      }
      const deleted = applyDocDelete(state.doc, state.selection, "backspace");
      expect(deleted).not.toBeNull();
      state = deleted!;
    }
    return state;
  }

  it("after progressive blank collapse under @ lands CRE after — query active empty", () => {
    const state = replayShiftEnterProgressiveToAtCre();
    expect(docToWire(state.doc)[docPosToWireOffset(state.doc, state.selection.focus)]).toBe("@");
    expect(state.selection.focusAffinity).toBe("after");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)).toEqual({
      queryStart: { nodeIndex: 0, nodeOffset: 5 },
      query: "",
    });
  });

  it("typing at CRE after @ inserts on the @ line (leftover trailing blank stays until focused)", () => {
    let state = replayShiftEnterProgressiveToAtCre();
    state = applyDocInsertText(state.doc, state.selection, "d");
    expect(docToWire(state.doc)).toContain("note @d");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("d");

    state = applyDocInsertText(state.doc, state.selection, "h");
    expect(docToWire(state.doc)).toContain("note @dh");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("dh");
  });

  it("folds the first filter char without requiring partial backspace", () => {
    let doc = wireToDoc("note @");
    let state = applyDocLineBreak(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, docToWire(doc).length))
    );
    state = applyDocInsertText(state.doc, state.selection, "d");
    expect(docToWire(state.doc)).toBe("note @d");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("d");
  });

  it("folds onto an existing query on a repeat multiline cycle", () => {
    let doc = wireToDoc("note @");
    let focus = wireOffsetToDocPos(doc, docToWire(doc).length);
    let state = applyDocLineBreak(doc, collapsedSelection(focus));
    for (let i = 0; i < 3; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    // Progressive blank collapse to CRE after `@` (no jump over remaining empties).
    for (let i = 0; i < 8; i++) {
      const wire = docToWire(state.doc);
      const land = docPosToWireOffset(state.doc, state.selection.focus);
      if (wire[land] === "@" && state.selection.focusAffinity === "after") {
        break;
      }
      state = applyDocDelete(state.doc, state.selection, "backspace")!;
    }
    state = applyDocInsertText(state.doc, state.selection, "f");
    expect(docToWire(state.doc)).toContain("note @f");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("f");

    state = applyDocLineBreak(state.doc, state.selection);
    for (let i = 0; i < 2; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    for (let i = 0; i < 8; i++) {
      const wire = docToWire(state.doc);
      const land = docPosToWireOffset(state.doc, state.selection.focus);
      if (wire[land] === "f" && state.selection.focusAffinity === "after") {
        break;
      }
      state = applyDocDelete(state.doc, state.selection, "backspace")!;
    }
    expect(docToWire(state.doc)[docPosToWireOffset(state.doc, state.selection.focus)]).toBe("f");
    expect(state.selection.focusAffinity).toBe("after");

    state = applyDocInsertText(state.doc, state.selection, "e");
    expect(docToWire(state.doc)).toContain("note @fe");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("fe");
  });
});

/** Progressive trash — handoff-note-arrow-contract.md */
describe("visual-row seats — soft-wrap continuation is a landable seat", () => {
  describe("replacement-epoch Delete remount", () => {
    it("remounts only when the prior content seat vanished on the same hard line", () => {
      const doc = wireToDoc("AAAAAAAAAAC");
      const result = {
        doc,
        selection: collapsedSelection(wireOffsetToDocPos(doc, 10)),
        postLayoutRemount: { kind: "content-seat" as const, priorContentSeatWire: 10 },
      };

      const remounted = resolveHandoffNoteDeletePostLayoutRemount(result, [
        { wire: 0, kind: "content" },
      ]);
      expect(docPosToWireOffset(doc, remounted.selection.focus)).toBe(0);

      const retained = resolveHandoffNoteDeletePostLayoutRemount(result, [
        { wire: 0, kind: "content" },
        { wire: 10, kind: "content" },
      ]);
      expect(docPosToWireOffset(doc, retained.selection.focus)).toBe(10);
    });

    it("retains a spacer exposed by the final text Delete before a mention", () => {
      const before = wireToDoc("AAAAAAAAAAn @caliper-aaaaaaa");
      const provisional = applyDocDeleteWithSeats(
        before,
        collapsedSelection(wireOffsetToDocPos(before, 10)),
        "delete",
        {
          visualRowSeats: [
            { wire: 0, kind: "content" },
            { wire: 10, kind: "content" },
          ],
        }
      )!;

      expect(provisional.postLayoutRemount).toBeUndefined();
      const resolved = resolveHandoffNoteDeletePostLayoutRemount(provisional, [
        { wire: 0, kind: "content" },
        { wire: 11, kind: "content" },
      ]);
      expect(docPosToWireOffset(resolved.doc, resolved.selection.focus)).toBe(10);
    });

    it("retains the commit spacer exposed by atom Delete", () => {
      const before = wireToDoc("AAAAAAAAAA@caliper-aaaaaaa ");
      const provisional = applyDocDeleteWithSeats(
        before,
        collapsedSelection(wireOffsetToDocPos(before, 10)),
        "delete",
        {
          visualRowSeats: [
            { wire: 0, kind: "content" },
            { wire: 10, kind: "content" },
          ],
        }
      )!;

      expect(provisional.postLayoutRemount).toBeUndefined();
      const resolved = resolveHandoffNoteDeletePostLayoutRemount(provisional, [
        { wire: 0, kind: "content" },
      ]);
      expect(docPosToWireOffset(resolved.doc, resolved.selection.focus)).toBe(10);
    });

    it("remounts the replacement continuation when deleting shifts its start forward", () => {
      const doc = wireToDoc("AAAAAAAAAACD");
      const result = {
        doc,
        selection: collapsedSelection(wireOffsetToDocPos(doc, 10)),
        postLayoutRemount: { kind: "content-seat" as const, priorContentSeatWire: 10 },
      };

      const remounted = resolveHandoffNoteDeletePostLayoutRemount(result, [
        { wire: 0, kind: "content" },
        { wire: 11, kind: "content" },
      ]);

      expect(docPosToWireOffset(doc, remounted.selection.focus)).toBe(11);
    });

    it("uses the replacement blank seat when soft-wrap layout interleaves its prior row", () => {
      const agent = "caliper-l5kknwf72";
      const prefix = `dhd @${agent} d @${agent} jdjd @${agent} `;
      const wire = `${prefix}\n\n`;
      const doc = wireToDoc(wire);
      const result = applyDocDeleteWithSeats(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, wire.length)),
        "delete",
        {
          visualRowSeats: [
            { wire: 0, kind: "content" },
            { wire: wire.length - 1, kind: "blank" },
            { wire: prefix.indexOf("jdjd"), kind: "content" },
            { wire: wire.length, kind: "blank" },
          ],
        }
      )!;

      expect(result.postLayoutRemount).toEqual({
        kind: "blank-stop",
        replacementBlankStopWire: prefix.length + 1,
      });
      const resolved = resolveHandoffNoteDeletePostLayoutRemount(result, [
        { wire: 0, kind: "content" },
        { wire: prefix.indexOf("jdjd"), kind: "content" },
        { wire: prefix.length + 1, kind: "blank" },
      ]);
      expect(docPosToWireOffset(result.doc, resolved.selection.focus)).toBe(prefix.length + 1);
    });

    it("keeps Delete's down land on content when the remaining blank sits above", () => {
      const agent = "caliper-aaaaaaa";
      const wire = `header @${agent} \n\n\ntail @${agent} `;
      const doc = wireToDoc(wire);
      const result = applyDocDeleteWithSeats(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 26)),
        "delete",
        {
          visualRowSeats: [
            { wire: 0, kind: "content" },
            { wire: 25, kind: "blank" },
            { wire: 26, kind: "blank" },
            { wire: 27, kind: "content" },
          ],
        }
      )!;

      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(26);
      expect(result.postLayoutRemount).toEqual({
        kind: "blank-stop",
        replacementBlankStopWire: 25,
      });
      const resolved = resolveHandoffNoteDeletePostLayoutRemount(result, [
        { wire: 0, kind: "content" },
        { wire: 25, kind: "blank" },
        { wire: 26, kind: "content" },
      ]);
      expect(docPosToWireOffset(result.doc, resolved.selection.focus)).toBe(26);
    });

    it("never remounts across a hard break", () => {
      const doc = wireToDoc("lead\nm");
      const result = {
        doc,
        selection: collapsedSelection(wireOffsetToDocPos(doc, 5)),
        postLayoutRemount: { kind: "content-seat" as const, priorContentSeatWire: 5 },
      };
      const resolved = resolveHandoffNoteDeletePostLayoutRemount(result, [
        { wire: 0, kind: "content" },
      ]);
      expect(docPosToWireOffset(doc, resolved.selection.focus)).toBe(5);
    });
  });

  it("Delete on trailing blank under a soft-wrap row lands the continuation visual start, not wire 0", () => {
    const wire = "AAAAAAAAAABBBBBBBBBB\n";
    const doc = wireToDoc(wire);
    const probe = listEmbeddedBlankBandProbeWires(doc).at(-1)!;
    const seats = [
      { wire: 0, kind: "content" as const },
      { wire: 10, kind: "content" as const },
      { wire: 21, kind: "blank" as const },
    ];
    const result = applyDocDeleteWithSeats(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, probe)),
      "delete",
      { visualRowSeats: seats }
    )!;
    const land = docPosToWireOffset(result.doc, result.selection.focus);
    expect(land).toBe(10);
    expect(land).not.toBe(0);
  });

  it("Backspace on trailing blank under a soft-wrap row lands CRE on the last content char (after)", () => {
    const wire = "AAAAAAAAAABBBBBBBBBB\n";
    const doc = wireToDoc(wire);
    const probe = listEmbeddedBlankBandProbeWires(doc).at(-1)!;
    const seats = [
      { wire: 0, kind: "content" as const },
      { wire: 10, kind: "content" as const },
      { wire: 21, kind: "blank" as const },
    ];
    const result = applyDocDeleteWithSeats(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, probe)),
      "backspace",
      { visualRowSeats: seats }
    )!;
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(19);
    expect(result.selection.focusAffinity).toBe("after");
  });

  it("hard-break control `lead\\nmid\\n` still lands mid start with wireLineVisualRowSeats", () => {
    const wire = "lead\nmid\n";
    const doc = wireToDoc(wire);
    const probe = listEmbeddedBlankBandProbeWires(doc).at(-1)!;
    const result = applyDocDeleteWithSeats(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, probe)),
      "delete",
      { visualRowSeats: wireLineVisualRowSeats(doc) }
    )!;
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(5);
  });

  it("last Delete chip of soft-wrap continuation remounts first seat visual start on that stroke", () => {
    const wire = "AAAAAAAAAAB";
    const doc = wireToDoc(wire);
    const result = applyDocDeleteWithSeats(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, 10)),
      "delete",
      {
        visualRowSeats: [
          { wire: 0, kind: "content" },
          { wire: 10, kind: "content" },
        ],
      }
    )!;
    expect(docToWire(result.doc)).toBe("AAAAAAAAAA");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(0);
  });

  it("mid soft-wrap continuation chip stays at deletion point (no premature climb)", () => {
    const wire = "AAAAAAAAAABB";
    const doc = wireToDoc(wire);
    const result = applyDocDeleteWithSeats(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, 10)),
      "delete",
      {
        visualRowSeats: [
          { wire: 0, kind: "content" },
          { wire: 10, kind: "content" },
        ],
      }
    )!;
    expect(docToWire(result.doc)).toBe("AAAAAAAAAAB");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(10);
  });

  it("hard-break last char of lower row does not climb across newline to upper start", () => {
    const wire = "lead\nm";
    const doc = wireToDoc(wire);
    const result = applyDocDeleteWithSeats(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, 5)),
      "delete",
      {
        visualRowSeats: [
          { wire: 0, kind: "content" },
          { wire: 5, kind: "content" },
        ],
      }
    )!;
    expect(docToWire(result.doc)).toBe("lead\n");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(5);
  });

  it("Delete alone from soft-wrap continuation start clears the whole hard line", () => {
    let doc = wireToDoc("AAAAAAAAAABBBBBBBBBB");
    let selection = collapsedSelection(wireOffsetToDocPos(doc, 10));
    let seats: { wire: number; kind: "content" | "blank" }[] = [
      { wire: 0, kind: "content" },
      { wire: 10, kind: "content" },
    ];
    let guard = 0;
    while (docToWire(doc).length > 0 && guard++ < 40) {
      const next = applyDocDeleteWithSeats(doc, selection, "delete", { visualRowSeats: seats });
      expect(next).not.toBeNull();
      doc = next!.doc;
      selection = next!.selection;
      const w = docToWire(doc);
      seats =
        w.length > 10
          ? [
              { wire: 0, kind: "content" },
              { wire: 10, kind: "content" },
            ]
          : [{ wire: 0, kind: "content" }];
    }
    expect(docToWire(doc)).toBe("");
  });
});
