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
import { listEmbeddedBlankBandProbeWires } from "./handoff-note-embedded-newlines.js";
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

describe("embedded blank-band delete contract", () => {
  const agent = "caliper-aaaaaaa";

  function blankBandSuffixWire(lower = "tail"): string {
    return `header @${agent} \n\n\n${lower}`;
  }

  function headerRowEndWire(wire: string, probes: number[]): number {
    return probes[0]! - 1;
  }

  describe("backspace", () => {
    it("on first blank with content above moves caret to header row end without mutating wire", () => {
      const wire = blankBandSuffixWire();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerEnd = headerRowEndWire(wire, probes);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(wire);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(headerEnd);
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

    it("after stepping to header row end removes trailing header space on next backspace", () => {
      const wire = blankBandSuffixWire();
      let doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const stepped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      )!;
      expect(docToWire(stepped.doc)).toBe(wire);

      const nibbled = applyDocDelete(stepped.doc, stepped.selection, "backspace")!;
      expect(docToWire(nibbled.doc)).toBe(`header @${agent}\n\n\ntail`);
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

    it("after §69 step from first blank to single-char header row end removes header on next backspace", () => {
      const wire = `h\n\n\ntail`;
      let doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);

      const stepped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      )!;
      expect(docToWire(stepped.doc)).toBe(wire);
      expect(docPosToWireOffset(stepped.doc, stepped.selection.focus)).toBe(probes[0]! - 1);

      const nibbled = applyDocDelete(stepped.doc, stepped.selection, "backspace")!;
      expect(docToWire(nibbled.doc)).toBe(`\n\n\ntail`);
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

    it("backspace on first blank with mention tail preserves wire and lands at header row end", () => {
      const doc = wireToDoc(compositeWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerEnd = headerRowEndWire(compositeWire, probes);

      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, probes[0]!)),
        "backspace"
      );

      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe(compositeWire);
      expect(docPosToWireOffset(result!.doc, result!.selection.focus)).toBe(headerEnd);
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
    expect(docToWire(result.doc)).toBe(`${wire}\n`);
    expect(docPosToWireOffset(result.doc, result.selection.focus)).toBe(caretBefore + 1);
  });

  it("second break after trailing mention-line text advances monotonically through blanks", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agentA}  @${agentB} tail`;
    const doc = wireToDoc(wire);
    const first = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, wire.length)));
    expect(docPosToWireOffset(first.doc, first.selection.focus)).toBe(wire.length + 1);
    const second = applyDocLineBreak(first.doc, first.selection);
    expect(docToWire(second.doc)).toBe(`${wire}\n\n`);
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBe(wire.length + 2);
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

  it("first break on substantive tail lands caret on the new blank", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agentA}  @${agentB} tail`;
    const doc = wireToDoc(wire);
    const tailEnd = wire.length;
    const first = applyDocLineBreak(doc, collapsedSelection(wireOffsetToDocPos(doc, tailEnd)));
    expect(docPosToWireOffset(first.doc, first.selection.focus)).toBe(tailEnd + 1);
    const second = applyDocLineBreak(first.doc, first.selection);
    expect(docPosToWireOffset(second.doc, second.selection.focus)).toBe(tailEnd + 2);
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

  it("single mention with whitespace-only post-pill tail", () => {
    const wire = `header @${agent} `;
    expect(caretAfterBreak(wire)).toBe(wire.length + 1);
  });

  it("single mention with substantive post-pill tail", () => {
    const wire = `hd @${agent} tail`;
    expect(caretAfterBreak(wire)).toBe(wire.length + 1);
  });

  it("two mentions with substantive row tail", () => {
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agent}  @${agentB} tail`;
    expect(caretAfterBreak(wire)).toBe(wire.length + 1);
  });

  it("multi-pill row with substantive tail", () => {
    const wire = `@${agent} tail @${agent} @${agent} tail`;
    expect(caretAfterBreak(wire)).toBe(wire.length + 1);
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
    expect(wires[0]).toBe(wire.length + 1);
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
