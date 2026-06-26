import { describe, expect, it } from "vitest";
import {
  applyDocDelete,
  applyDocInsertText,
  applyDocLineBreak,
  insertMentionAtSelection,
  snapDeleteCaretWire,
  spliceDocSelection,
} from "./handoff-note-doc-edits.js";
import {
  collapsedSelection,
  docPosEqual,
  docPosToWireOffset,
  resolveDocVerticalArrowMove,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import {
  docToWire,
  describeHandoffNoteCursorContext,
  normalizeHandoffNoteDoc,
  wireToDoc,
} from "./handoff-note-doc.js";
import {
  embeddedBlankBandContentRowEndBeforeProbe,
  isEmbeddedBlankBandDeleteProbeWire,
  listEmbeddedBlankBandGroups,
  listEmbeddedBlankBandProbeWires,
} from "./handoff-note-embedded-newlines.js";
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
    const wire = `pre1 @${agentId} `;
    const doc = wireToDoc(wire);
    const focus = wireOffsetToDocPos(doc, `pre1 @${agentId}`.length);
    const result = applyDocInsertText(doc, collapsedSelection(focus), "@");
    expect(docToWire(result.doc)).toBe(`pre1 @${agentId} @ `);
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

  it("inserts on the blank row after arrow lands on an embedded probe wire", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header @${agent} \n\n\ntail`;
    const doc = wireToDoc(wire);
    const probes = listEmbeddedBlankBandProbeWires(doc);
    expect(probes).toHaveLength(2);

    const onSecondBlank = wireOffsetToDocPos(doc, probes[1]!);
    const result = applyDocInsertText(doc, collapsedSelection(onSecondBlank), "x");

    expect(docToWire(result.doc)).toBe(`header @${agent} \n\nx\ntail`);
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(probes[1]! + 2);
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

describe("EOF trailing blank band — Shift+Enter caret on probe", () => {
  function stateAfterEofBreaks(prefix: string, count: number) {
    const doc = wireToDoc(prefix);
    let state = { doc, selection: collapsedSelection(wireOffsetToDocPos(doc, prefix.length)) };
    for (let i = 0; i < count; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    return state;
  }

  it("second consecutive EOF break lands caret on last blank probe not past wire end", () => {
    const state = stateAfterEofBreaks("header", 2);
    const probes = listEmbeddedBlankBandProbeWires(state.doc);
    const caret = docPosToWireOffset(state.doc, state.selection.focus);

    expect(probes).toEqual([6, 7]);
    expect(caret).toBe(probes[1]!);
    expect(caret).toBeLessThan(docToWire(state.doc).length);
  });

  it("third consecutive EOF break advances caret monotonically through blank probes", () => {
    const state = stateAfterEofBreaks("header", 3);
    const probes = listEmbeddedBlankBandProbeWires(state.doc);
    const caret = docPosToWireOffset(state.doc, state.selection.focus);

    expect(probes).toEqual([6, 7, 8]);
    expect(caret).toBe(probes[2]!);
  });

  it("type after two EOF breaks fills lower blank row", () => {
    const state = stateAfterEofBreaks("header", 2);
    const result = applyDocInsertText(state.doc, state.selection, "d");

    expect(docToWire(result.doc)).toBe("header\n\nd");
    expect(listEmbeddedBlankBandProbeWires(result.doc)).toEqual([6]);
  });

  it("backspace on lower blank without typing collapses one trailing blank row", () => {
    const state = stateAfterEofBreaks("header", 2);
    const probes = listEmbeddedBlankBandProbeWires(state.doc);
    expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(probes[1]!);

    const result = applyDocDelete(state.doc, state.selection, "backspace")!;

    expect(docToWire(result.doc)).toBe("header\n");
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(probes[0]!);
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
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe("header".length - 1);
  });

  it("backspace on typed EOF row removes content then collapses blank not header", () => {
    const state = stateAfterEofBreaks("header", 2);
    const filled = applyDocInsertText(state.doc, state.selection, "d");

    const chipped = applyDocDelete(filled.doc, filled.selection, "backspace")!;

    expect(docToWire(chipped.doc)).toBe("header\n\n");

    const collapsed = applyDocDelete(chipped.doc, chipped.selection, "backspace")!;

    expect(docToWire(collapsed.doc)).toBe("header\n");
    expect(docPosToWireOffset(collapsed.doc, collapsed.selection.focus)).toBe(7);
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

  it("mention row — two EOF breaks land on probe; type fills blank; backspace preserves pill", () => {
    const agent = "caliper-aaaaaaa";
    const prefix = `row @${agent} `;
    const state = stateAfterEofBreaks(prefix, 2);
    const probes = listEmbeddedBlankBandProbeWires(state.doc);
    expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(probes[1]!);

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

  it("sandwiched tail below band — EOF breaks after tail land on trailing band probes", () => {
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
    expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(
      probesAfter[probesAfter.length - 1]!
    );
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

  function expectOffDeleteProbeInfrastructure(
    doc: ReturnType<typeof wireToDoc>,
    focusWire: number,
    chipBeforeBlankBand?: boolean
  ): void {
    expect(isEmbeddedBlankBandDeleteProbeWire(doc, focusWire, { chipBeforeBlankBand })).toBe(false);
  }

  describe("content row end — two-phase chip then collapse", () => {
    it("sole-char delete before band leaves caret off blank-band delete-probe infrastructure", () => {
      const doc = wireToDoc(`h\n\n\ntail`);
      const headerEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, headerEnd)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`\n\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        result!.doc,
        docPosToWireOffset(result!.doc, result!.selection.focus),
        result!.chipBeforeBlankBand
      );
    });

    it("backspace on two-char row before blank band lands after remaining sole char", () => {
      const doc = wireToDoc(`dh\n\n`);
      const beforeH = 1;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, beforeH)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`d\n\n`);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(1);
      expect(result!.chipBeforeBlankBand).toBeUndefined();
    });

    it("multi-band chip on sole char before blank band leaves caret off delete-probe infrastructure", () => {
      const wire = "header \n\n\nmiddle\n\n\nd\n\n\nlower";
      const doc = wireToDoc(wire);
      const dPos = wire.lastIndexOf("d");

      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, dPos)),
        "backspace"
      )!;

      expect(docToWire(chipped.doc)).toBe("header \n\n\nmiddle\n\n\n\n\n\nlower");
      expect(chipped.chipBeforeBlankBand).toBe(true);
      expectOffDeleteProbeInfrastructure(
        chipped.doc,
        docPosToWireOffset(chipped.doc, chipped.selection.focus),
        chipped.chipBeforeBlankBand
      );
    });

    it("next backspace after multi-band chip collapses one blank from emptied content row", () => {
      const wire = "header \n\n\nmiddle\n\n\nd\n\n\nlower";
      const doc = wireToDoc(wire);
      const dPos = wire.lastIndexOf("d");
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, dPos)),
        "backspace"
      )!;

      const collapsed = applyDocDelete(chipped.doc, chipped.selection, "backspace", {
        chipBeforeBlankBand: chipped.chipBeforeBlankBand,
      })!;

      expect(docToWire(collapsed.doc)).toBe("header \n\n\nmiddle\n\n\n\n\nlower");
    });

    it("next backspace after sole-char clear collapses one leading blank only", () => {
      const doc = wireToDoc(`h\n\n\ntail`);
      const headerEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, headerEnd)),
        "backspace"
      )!;
      expect(docToWire(cleared.doc)).toBe(`\n\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        cleared.doc,
        docPosToWireOffset(cleared.doc, cleared.selection.focus),
        cleared.chipBeforeBlankBand
      );

      const collapsed = applyDocDelete(cleared.doc, cleared.selection, "backspace", {
        chipBeforeBlankBand: cleared.chipBeforeBlankBand,
      })!;
      expect(docToWire(collapsed.doc)).toBe(`\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        collapsed.doc,
        docPosToWireOffset(collapsed.doc, collapsed.selection.focus),
        collapsed.chipBeforeBlankBand
      );
    });

    it("single-blank band enters collapse infrastructure immediately after chip", () => {
      const doc = wireToDoc(`h\n\ntail`);
      const headerEnd = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;

      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, headerEnd)),
        "backspace"
      )!;

      expect(docToWire(cleared.doc)).toBe(`\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        cleared.doc,
        docPosToWireOffset(cleared.doc, cleared.selection.focus),
        cleared.chipBeforeBlankBand
      );
    });

    it("nibbling row content before band lands on char wire so next backspace chips without provenance", () => {
      let doc = wireToDoc(`hd\n\n\ntail`);
      let state = collapsedSelection(wireOffsetToDocPos(doc, 1));

      const mid = applyDocDelete(doc, state, "backspace")!;
      expect(docToWire(mid.doc)).toBe(`h\n\n\ntail`);
      expect(mid.chipBeforeBlankBand).toBeUndefined();
      expect(docPosToWireOffset(mid.doc, mid.selection.focus)).toBe(0);

      const cleared = applyDocDelete(mid.doc, mid.selection, "backspace")!;
      expect(docToWire(cleared.doc)).toBe(`\n\n\ntail`);
      expect(cleared.chipBeforeBlankBand).toBe(true);
    });

    it("sandwiched partial chip lands char wire; explicit probe at same offset collapses", () => {
      const doc1 = wireToDoc("h\n\n\ntail");
      const probe = listEmbeddedBlankBandProbeWires(doc1)[0]!;
      const explicit = wireOffsetToDocPos(doc1, probe);

      const doc = wireToDoc("hd\n\n\ntail");
      const mid = applyDocDelete(doc, collapsedSelection(wireOffsetToDocPos(doc, 1)), "backspace")!;

      expect(docToWire(mid.doc)).toBe("h\n\n\ntail");
      expect(docPosToWireOffset(mid.doc, mid.selection.focus)).not.toBe(probe);
      expect(docPosEqual(explicit, mid.selection.focus)).toBe(false);

      const cleared = applyDocDelete(mid.doc, mid.selection, "backspace")!;
      expect(docToWire(cleared.doc)).toBe("\n\n\ntail");

      const once = applyDocDelete(doc1, collapsedSelection(explicit), "backspace")!;
      expect(docToWire(once.doc)).toBe("h\n\ntail");
    });

    it("forward delete sole-char clear before band arms chip without landing on delete-probe", () => {
      const doc = wireToDoc(`h\n\n\ntail`);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0)),
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe(`\n\n\ntail`);
      expect(cleared.chipBeforeBlankBand).toBe(true);
      expectOffDeleteProbeInfrastructure(
        cleared.doc,
        docPosToWireOffset(cleared.doc, cleared.selection.focus),
        cleared.chipBeforeBlankBand
      );
    });

    it("next delete after sole-char clear collapses one leading blank only", () => {
      const doc = wireToDoc(`h\n\n\ntail`);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0)),
        "delete"
      )!;
      const collapsed = applyDocDelete(cleared.doc, cleared.selection, "delete", {
        chipBeforeBlankBand: cleared.chipBeforeBlankBand,
      })!;
      expect(docToWire(collapsed.doc)).toBe(`\n\ntail`);
      expect(docPosToWireOffset(collapsed.doc, collapsed.selection.focus)).toBe(0);
    });

    it("chip-then-collapse ladder — each delete nip lands on remaining band head", () => {
      const tail = "tail";
      let state = applyDocDelete(
        wireToDoc(`h\n\n\n${tail}`),
        collapsedSelection(wireOffsetToDocPos(wireToDoc(`h\n\n\n${tail}`), 0)),
        "delete"
      )!;
      expect(state.chipBeforeBlankBand).toBe(true);

      const shapes = [`\n\n${tail}`, `\n${tail}`, tail] as const;
      for (const expectedWire of shapes) {
        state = applyDocDelete(state.doc, state.selection, "delete", {
          chipBeforeBlankBand: state.chipBeforeBlankBand,
        })!;
        expect(docToWire(state.doc)).toBe(expectedWire);
        expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(0);
      }
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
        state = applyDocDelete(state.doc, state.selection, "backspace", {
          chipBeforeBlankBand: state.chipBeforeBlankBand,
        })!;
        expect(docToWire(state.doc)).toBe(expectedWire);
        expect(docPosToWireOffset(state.doc, state.selection.focus)).toBe(0);
      }
    });

    it("delete at last probe when another blank remains lands at band head", () => {
      const tail = "tail";
      const doc = wireToDoc(`\n\n\n${tail}`);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[1]!)),
        "delete"
      )!;
      expect(docToWire(result!.doc)).toBe(`\n\n${tail}`);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(0);
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
      let selection = collapsedSelection(wireOffsetToDocPos(doc, rowEnd));
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
      let state = collapsedSelection(wireOffsetToDocPos(doc, 1));

      const mid = applyDocDelete(doc, state, "backspace")!;
      expect(docToWire(mid.doc)).toBe(`h\n\n\ntail`);
      expectOffDeleteProbeInfrastructure(mid.doc, docPosToWireOffset(mid.doc, mid.selection.focus));

      const cleared = applyDocDelete(mid.doc, mid.selection, "backspace")!;
      expect(docToWire(cleared.doc)).toBe(`\n\n\ntail`);
      expectOffDeleteProbeInfrastructure(
        cleared.doc,
        docPosToWireOffset(cleared.doc, cleared.selection.focus),
        cleared.chipBeforeBlankBand
      );
    });
  });

  describe("multi-band — band-scoped step and collapse", () => {
    it("backspace on sandwiched lower-band first probe collapses within lower band only", () => {
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
      expect(docToWire(result!.doc)).toBe(`header \n\n\nmiddle\n\nlower`);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(lowerBand.probes[0]!);
    });

    it("backspace on lower-band interior probe collapses within lower band only", () => {
      const wire = multiBandWire();
      const doc = wireToDoc(wire);
      const lowerBand = listEmbeddedBlankBandGroups(doc)[1]!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerBand.probes[1]!)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`header \n\n\nmiddle\n\nlower`);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(lowerBand.probes[0]!);
    });

    it("delete on upper-band last probe before middle lands at middle visual start", () => {
      const wire = multiBandWire();
      const doc = wireToDoc(wire);
      const upperBand = listEmbeddedBlankBandGroups(doc)[0]!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, upperBand.probes.at(-1)!)),
        "delete"
      );

      expect(result).not.toBeNull();
      const resultWire = docToWire(result!.doc);
      expect(resultWire).toBe(`header \n\nmiddle\n\n\nlower`);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(
        resultWire.indexOf("middle")
      );
    });

    it("delete on lower-band last probe before lower lands at lower visual start", () => {
      const wire = multiBandWire();
      const doc = wireToDoc(wire);
      const lowerBand = listEmbeddedBlankBandGroups(doc)[1]!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerBand.probes.at(-1)!)),
        "delete"
      );

      expect(result).not.toBeNull();
      const resultWire = docToWire(result!.doc);
      expect(resultWire).toBe(`header \n\n\nmiddle\n\nlower`);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(
        resultWire.indexOf("lower")
      );
    });
  });

  describe("backspace", () => {
    it("on first sandwiched blank collapses one blank row instead of stepping to header end", () => {
      const wire = blankBandSuffixWire();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`header @${agent} \n\ntail`);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(probes[0]!);
    });

    it("on second blank with blank above removes one blank-row newline and lands on remaining blank", () => {
      const wire = blankBandSuffixWire();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[1]!)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`header @${agent} \n\ntail`);
      const [remainingBlank] = listEmbeddedBlankBandProbeWires(result!.doc);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(remainingBlank);
    });

    it("after collapsing first sandwiched blank removes another blank on next backspace", () => {
      const wire = blankBandSuffixWire();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const once = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      )!;
      expect(docToWire(once.doc)).toBe(`header @${agent} \n\ntail`);

      const twice = applyDocDelete(once.doc, once.selection, "backspace")!;
      const resultWire = docToWire(twice.doc);
      expect(resultWire).toBe(`header @${agent} \ntail`);
      expect(docPosToWireOffset(twice.doc, twice.selection.focus)).toBe(
        resultWire.indexOf("\n") - 1
      );
    });

    it("backspace at single-char header row end before blank band removes the character", () => {
      const wire = `h\n\n\ntail`;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      expect(probes[0]).toBe(1);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]! - 1)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`\n\n\ntail`);
    });

    it("after collapsing sandwiched blanks reaches single-char header then chips it", () => {
      const wire = `h\n\n\ntail`;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const once = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      )!;
      expect(docToWire(once.doc)).toBe(`h\n\ntail`);

      const twice = applyDocDelete(once.doc, once.selection, "backspace")!;
      expect(docToWire(twice.doc)).toBe(`h\ntail`);
      expect(docPosToWireOffset(twice.doc, twice.selection.focus)).toBe(0);
    });

    it("after clearing single-char header backspace on lower blank removes one blank-row newline", () => {
      let doc = wireToDoc(`h\n\n\ntail`);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0)),
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

    it("after deleting sole header character repeated backspace collapses blank band to lower start", () => {
      let doc = wireToDoc(`h\n\n\nlower`);
      let state = collapsedSelection(wireOffsetToDocPos(doc, 0));
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
      const sandwichedProbe = listEmbeddedBlankBandGroups(doc).find((g) => g.probes.length === 1)!
        .probes[0]!;

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

    it("on second blank before lower content removes blank-row newline and lands on lower row start", () => {
      const wire = blankBandSuffixWire();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[1]!)),
        "delete"
      );

      expect(result).not.toBeNull();
      const resultWire = docToWire(result!.doc);
      expect(resultWire).toBe(`header @${agent} \n\ntail`);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(
        resultWire.indexOf("tail")
      );
    });

    it("delete on sandwiched single probe between filled rows lands at lower row visual start", () => {
      const wire = "header \n\n\nmiddle\n\ntail";
      const doc = wireToDoc(wire);
      const sandwichedProbe = listEmbeddedBlankBandGroups(doc).find((g) => g.probes.length === 1)!
        .probes[0]!;

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

    it("delete at bottom of blank band with nothing below is a no-op", () => {
      const wire = `header @${agent} \n\n`;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      expect(
        applyDocDelete(
          doc,
          collapsedSelection(wireOffsetToDocPos(doc, probes[probes.length - 1]!)),
          "delete"
        )
      ).toBeNull();
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
  });

  describe("full composite wire", () => {
    const compositeWire = `header @${agent} \n\n\ntail @${agent} `;

    it("backspace on first sandwiched blank before mention tail collapses one blank row", () => {
      const wire = compositeWire;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(`header @${agent} \n\ntail @${agent} `);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(probes[0]!);
    });

    it("delete on second blank before mention tail lands at tail row start", () => {
      const doc = wireToDoc(compositeWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[1]!)),
        "delete"
      );

      expect(result).not.toBeNull();
      const resultWire = docToWire(result!.doc);
      expect(resultWire).toBe(`header @${agent} \n\ntail @${agent} `);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(
        resultWire.indexOf("tail")
      );
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
    const probes = listEmbeddedBlankBandProbeWires(result.doc);
    expect(docToWire(result.doc)).toBe(`${wire}\n`);
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(probes[probes.length - 1]!);
  });

  it("second break after trailing mention-line text advances monotonically through blank probes", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agentA}  @${agentB} tail`;
    const doc = wireToDoc(wire);
    const first = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, wire.length)));
    const firstProbes = listEmbeddedBlankBandProbeWires(first.doc);
    const firstCaret = docPosToWireOffset(first.doc, first.selection.focus);
    expect(docToWire(first.doc)).toBe(`${wire}\n`);
    expect(firstCaret).toBe(firstProbes[firstProbes.length - 1]!);

    const second = applyDocLineBreak(first.doc, first.selection);
    const secondProbes = listEmbeddedBlankBandProbeWires(second.doc);
    expect(docToWire(second.doc)).toBe(`${wire}\n\n`);
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBe(
      secondProbes[secondProbes.length - 1]!
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

  it("first break on substantive tail lands caret on the new blank probe", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agentA}  @${agentB} tail`;
    const doc = wireToDoc(wire);
    const tailEnd = wire.length;
    const first = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, tailEnd)));
    const firstProbes = listEmbeddedBlankBandProbeWires(first.doc);
    expect(docPosToWireOffset(first.doc, first.selection.focus)).toBe(
      firstProbes[firstProbes.length - 1]!
    );
    const second = applyDocLineBreak(first.doc, first.selection);
    const secondProbes = listEmbeddedBlankBandProbeWires(second.doc);
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBe(
      secondProbes[secondProbes.length - 1]!
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

  function lastProbeAfterBreak(wire: string): number {
    const doc = wireToDoc(wire);
    const result = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, wire.length)));
    const probes = listEmbeddedBlankBandProbeWires(result.doc);
    return probes[probes.length - 1]!;
  }

  it("single mention with whitespace-only post-pill tail", () => {
    const wire = `header @${agent} `;
    expect(caretAfterBreak(wire)).toBe(lastProbeAfterBreak(wire));
  });

  it("single mention with substantive post-pill tail", () => {
    const wire = `hd @${agent} tail`;
    expect(caretAfterBreak(wire)).toBe(lastProbeAfterBreak(wire));
  });

  it("two mentions with substantive row tail", () => {
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agent}  @${agentB} tail`;
    expect(caretAfterBreak(wire)).toBe(lastProbeAfterBreak(wire));
  });

  it("multi-pill row with substantive tail", () => {
    const wire = `@${agent} tail @${agent} @${agent} tail`;
    expect(caretAfterBreak(wire)).toBe(lastProbeAfterBreak(wire));
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
    const probes = listEmbeddedBlankBandProbeWires(state.doc);
    expect(wires[wires.length - 1]).toBe(probes[probes.length - 1]!);
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

    it("deletes mention atomically from whitespace-only text tail before mention on same row", () => {
      const wire = `\n\n\n@${agentA}\n\n\nmiddle`;
      const doc = wireToDoc(wire);
      const focus = textEndBeforeMention(doc, agentA);
      const result = applyDocDelete(doc, collapsedSelection(focus), "delete");
      expect(result).not.toBeNull();
      expect(result!.chipBeforeBlankBand).toBe(true);
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

    it("preserveMentionInterior keeps interior for backspace; delete still snaps to mention-start", () => {
      const doc = wireToDoc(wire);
      const interior = wire.indexOf("@") + 1;
      expect(
        snapDeleteCaretWire(doc, interior, "backspace", { preserveMentionInterior: true })
      ).toBe(interior);
      expect(snapDeleteCaretWire(doc, interior, "delete", { preserveMentionInterior: true })).toBe(
        wire.indexOf("@")
      );
    });

    it("mentionRemoved at probe lands semantic content row end for backspace and delete", () => {
      const doc = wireToDoc(wire);
      const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
      const semanticEnd = embeddedBlankBandContentRowEndBeforeProbe(doc, probe);
      expect(snapDeleteCaretWire(doc, probe, "backspace", { mentionRemoved: true })).toBe(
        semanticEnd
      );
      expect(snapDeleteCaretWire(doc, probe, "delete", { mentionRemoved: true })).toBe(semanticEnd);
    });
  });

  describe("mention-terminated probe — backspace step/collapse vs delete collapse", () => {
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

    it("backspace at first probe steps to mention-end when probe follows post-mention spacer", () => {
      const wire = `header @${agentA} \n\n\n`;
      const doc = wireToDoc(wire);
      const mentionEnd = `header @${agentA}`.length;
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);
      expect(firstProbe).toBe(mentionEnd + 1);

      const stepped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, firstProbe!)),
        "backspace"
      )!;

      expect(docToWire(stepped.doc)).toBe(wire);
      expect(docPosToWireOffset(stepped.doc, stepped.selection.focus)).toBe(mentionEnd);
      expect(describeHandoffNoteCursorContext(stepped.doc, mentionEnd).kind).toBe(
        "mention-boundary"
      );
    });

    describe("probe-alias after whitespace chip — lands content row end not delete-probe", () => {
      function chipSpacerBeforeFirstProbe(wire: string) {
        const doc = wireToDoc(wire);
        const probes = listEmbeddedBlankBandProbeWires(doc);
        const spacerWire = probes[0]! - 1;
        expect(wire[spacerWire]).toBe(" ");
        const chipped = applyDocDelete(
          doc,
          collapsedSelection(wireOffsetToDocPos(doc, spacerWire)),
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
          isEmbeddedBlankBandDeleteProbeWire(
            chipped.doc,
            docPosToWireOffset(chipped.doc, chipped.selection.focus)
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

    it("delete at mention node end after spacer chip is no-op without collapsing blank band", () => {
      const wire = `header @${agentA} \n\n\n`;
      const doc = wireToDoc(wire);
      const spacerWire = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spacerWire)),
        "backspace"
      )!;

      expect(applyDocDelete(chipped.doc, chipped.selection, "delete")).toBeNull();
      expect(docToWire(chipped.doc)).toBe(`header @${agentA}\n\n\n`);
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
    it("substantive postfix chip at probe lands at mention-end off blank-band probe", () => {
      const wire = `header @${agentA} x\n\n\n`;
      const afterX = wire.indexOf("x") + 1;
      const doc = wireToDoc(wire);
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, afterX)),
        "backspace"
      )!;
      expect(docToWire(chipped.doc)).toBe(`header @${agentA} \n\n\n`);
      const caretWire = docPosToWireOffset(chipped.doc, chipped.selection.focus);
      expect(caretWire).toBe(`header @${agentA}`.length);
      expect(isEmbeddedBlankBandDeleteProbeWire(chipped.doc, caretWire)).toBe(false);
    });

    it("backspace after postfix chip with trailing spacer removes mention preserving blank run", () => {
      const wire = `header @${agentA} x\n\n\n`;
      const afterX = wire.indexOf("x") + 1;
      const doc = wireToDoc(wire);
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, afterX)),
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
      expect(isEmbeddedBlankBandDeleteProbeWire(removed.doc, caretWire)).toBe(false);
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
      expect(isEmbeddedBlankBandDeleteProbeWire(removed.doc, caretWire)).toBe(false);
    });
  });

  describe("substantive chip leaves mention abutting probe — mention-interior landing", () => {
    /** Row ends with mention then one substantive char immediately before the first probe (no spacer). */
    function gluedPostfixUpperBandWire(postfixChar = "T"): string {
      return `note @${agentA}${postfixChar}\n\n\n`;
    }

    function gluedPostfixSandwichedWire(postfixChar = "T"): string {
      return `note @${agentA}${postfixChar}\n\n\nmiddle\n\n\nlower`;
    }

    it("backspace at probe chips glued postfix and lands mention-interior off delete-probe", () => {
      const wire = gluedPostfixUpperBandWire();
      const doc = wireToDoc(wire);
      const [probe] = listEmbeddedBlankBandProbeWires(doc);
      const mentionEnd = `note @${agentA}`.length;

      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probe!)),
        "backspace"
      )!;

      expect(docToWire(chipped.doc)).toBe(`note @${agentA}\n\n\n`);
      const caretWire = docPosToWireOffset(chipped.doc, chipped.selection.focus);
      expect(caretWire).not.toBe(mentionEnd);
      expect(describeHandoffNoteCursorContext(chipped.doc, caretWire).kind).toBe(
        "mention-interior"
      );
      expect(isEmbeddedBlankBandDeleteProbeWire(chipped.doc, caretWire)).toBe(false);
    });

    it("backspace at content row end after glued postfix chips T same as at probe", () => {
      const wire = gluedPostfixUpperBandWire();
      const doc = wireToDoc(wire);
      const [probe] = listEmbeddedBlankBandProbeWires(doc);
      const afterPostfix = wire.indexOf("T") + 1;
      expect(afterPostfix).toBe(probe);

      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, afterPostfix)),
        "backspace"
      )!;

      expect(docToWire(chipped.doc)).toBe(`note @${agentA}\n\n\n`);
      expect(
        describeHandoffNoteCursorContext(
          chipped.doc,
          docPosToWireOffset(chipped.doc, chipped.selection.focus)
        ).kind
      ).toBe("mention-interior");
    });

    it("backspace after glued postfix chip from mention-end collapses blank not mention remove", () => {
      const wire = gluedPostfixUpperBandWire();
      const doc = wireToDoc(wire);
      const [probe] = listEmbeddedBlankBandProbeWires(doc);
      const mentionEnd = `note @${agentA}`.length;

      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probe!)),
        "backspace"
      )!;
      expect(docToWire(chipped.doc)).toBe(`note @${agentA}\n\n\n`);

      const collapsed = applyDocDelete(
        chipped.doc,
        collapsedSelection(wireOffsetToDocPos(chipped.doc, mentionEnd)),
        "backspace"
      )!;
      expect(docToWire(collapsed.doc)).toBe(`note @${agentA}\n\n`);
      expect(docToWire(collapsed.doc)).toContain(agentA);
    });

    it("backspace after glued postfix chip removes mention preserving blank run", () => {
      const wire = gluedPostfixUpperBandWire();
      const doc = wireToDoc(wire);
      const [probe] = listEmbeddedBlankBandProbeWires(doc);

      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probe!)),
        "backspace"
      )!;

      const removed = applyDocDelete(chipped.doc, chipped.selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`note \n\n\n`);
      expect(docToWire(removed.doc)).not.toContain(`@${agentA}`);
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

    it("glued postfix chip at sandwiched upper-band probe removes mention without touching lower band", () => {
      const wire = gluedPostfixSandwichedWire();
      const doc = wireToDoc(wire);
      const [upperProbe] = listEmbeddedBlankBandProbeWires(doc);

      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, upperProbe!)),
        "backspace"
      )!;
      expect(docToWire(chipped.doc)).toBe(`note @${agentA}\n\n\nmiddle\n\n\nlower`);
      expect(
        describeHandoffNoteCursorContext(
          chipped.doc,
          docPosToWireOffset(chipped.doc, chipped.selection.focus)
        ).kind
      ).toBe("mention-interior");

      const removed = applyDocDelete(chipped.doc, chipped.selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`note \n\n\nmiddle\n\n\nlower`);
      expect(docToWire(removed.doc)).not.toContain(`@${agentA}`);
      expect(docToWire(removed.doc)).toContain("middle");
      expect(docToWire(removed.doc)).toContain("lower");
    });
  });

  describe("prefix before mention — row clear and chipBeforeBlankBand", () => {
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

    it("delete — row visual start with leading blanks arms chip on mention remove", () => {
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
      expect(chipped!.chipBeforeBlankBand).toBe(true);
      expect(
        isEmbeddedBlankBandDeleteProbeWire(
          chipped!.doc,
          docPosToWireOffset(chipped!.doc, chipped!.selection.focus),
          { chipBeforeBlankBand: chipped!.chipBeforeBlankBand }
        )
      ).toBe(false);

      const collapsed = applyDocDelete(replay.doc, replay.selection, "delete", {
        chipBeforeBlankBand: chipped!.chipBeforeBlankBand,
      })!;
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

    it("backspace — mention-only sandwiched row arms chip on atomic mention remove", () => {
      const wire = `\n\n\n@${agentA}\n\n\nmiddle`;
      const doc = wireToDoc(wire);
      const mentionInterior = wire.indexOf("@") + 5;

      const removed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, mentionInterior)),
        "backspace"
      )!;
      expect(docToWire(removed.doc)).toBe(`\n\n\n\n\n\nmiddle`);
      expect(removed.chipBeforeBlankBand).toBe(true);
      expect(
        isEmbeddedBlankBandDeleteProbeWire(
          removed.doc,
          docPosToWireOffset(removed.doc, removed.selection.focus),
          { chipBeforeBlankBand: removed.chipBeforeBlankBand }
        )
      ).toBe(false);

      const collapsed = applyDocDelete(removed.doc, removed.selection, "backspace", {
        chipBeforeBlankBand: removed.chipBeforeBlankBand,
      })!;
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

  describe("complex structure — multi-band filled rows above and below", () => {
    it("backspace at upper-band first probe collapses one blank when band is sandwiched", () => {
      const wire = complexMultiBandWire();
      const doc = wireToDoc(wire);
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);

      const collapsed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, firstProbe!)),
        "backspace"
      )!;

      expect(docToWire(collapsed.doc)).toBe(
        `header @${agentA} \n\nmiddle\n\n\ntail @${agentB} suffix`
      );
      expect(docToWire(collapsed.doc)).toContain(`@${agentA}`);
      expect(docPosToWireOffset(collapsed.doc, collapsed.selection.focus)).toBe(firstProbe!);
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

    it("backspace at lower-band first probe collapses within lower band only", () => {
      const wire = complexMultiBandWire();
      const doc = wireToDoc(wire);
      const lowerBand = listEmbeddedBlankBandGroups(doc)[1]!;

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerBand.probes[0]!)),
        "backspace"
      )!;

      expect(docToWire(result.doc)).toBe(
        `header @${agentA} \n\n\nmiddle\n\ntail @${agentB} suffix`
      );
      expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(lowerBand.probes[0]!);
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
      let selection = collapsedSelection(wireOffsetToDocPos(doc, rowEnd));
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
      let selection = collapsedSelection(wireOffsetToDocPos(doc, rowEnd));
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
  function replayShiftEnterPartialBackspace() {
    let doc = wireToDoc("note @");
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
    expect(docToWire(state.doc)).toBe("note @\n");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)).toBeNull();
  });

  it("folds filter chars onto the @ line and reopens the query", () => {
    let state = replayShiftEnterPartialBackspace();
    state = applyDocInsertText(state.doc, state.selection, "d");
    expect(docToWire(state.doc)).toBe("note @d");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("d");

    state = applyDocInsertText(state.doc, state.selection, "h");
    expect(docToWire(state.doc)).toBe("note @dh");
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
    for (let i = 0; i < 3; i++) {
      state = applyDocDelete(state.doc, state.selection, "backspace")!;
    }
    state = applyDocInsertText(state.doc, state.selection, "f");
    expect(docToWire(state.doc)).toBe("note @f");

    state = applyDocLineBreak(state.doc, state.selection);
    for (let i = 0; i < 2; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    for (let i = 0; i < 2; i++) {
      state = applyDocDelete(state.doc, state.selection, "backspace")!;
    }
    expect(docToWire(state.doc)).toBe("note @f\n");

    state = applyDocInsertText(state.doc, state.selection, "e");
    expect(docToWire(state.doc)).toBe("note @fe");
    expect(resolveActiveHandoffMentionQueryDoc(state.doc, state.selection)?.query).toBe("fe");
  });
});
