import { describe, expect, it } from "vitest";
import { applyDocDelete } from "./handoff-note-doc-edits.js";
import {
  collapsedSelection,
  docPosToWireOffset,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import { docToWire, wireToDoc } from "./handoff-note-doc.js";
import {
  handoffNoteCaretOnMentionNodeEnd,
  handoffNoteCaretOnMentionNodeStart,
  handoffNoteIsMentionEndProbeAliasWire,
} from "./handoff-note-delete-intent.js";
import {
  listEmbeddedBlankBandGroups,
  listEmbeddedBlankBandProbeWires,
} from "./handoff-note-embedded-newlines.js";

describe("handoff note delete intent — contract authority before handler chain", () => {
  const agent = "caliper-abc123";

  function chipSpacerBeforeFirstProbe(wire: string) {
    const doc = wireToDoc(wire);
    const probes = listEmbeddedBlankBandProbeWires(doc);
    const spacerWire = probes[0]! - 1;
    const chipped = applyDocDelete(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, spacerWire)),
      "backspace"
    )!;
    return { doc: chipped.doc, selection: chipped.selection, probes };
  }

  describe("backspace — mention node end beats blank collapse at probe alias", () => {
    it("prefix + mention row + spacer — next backspace removes mention", () => {
      const wire = `header @${agent} \n\n\n`;
      const { doc, selection } = chipSpacerBeforeFirstProbe(wire);
      const focus = selection.focus;
      expect(handoffNoteCaretOnMentionNodeEnd(doc, focus)).toBe(true);
      expect(handoffNoteIsMentionEndProbeAliasWire(doc, docPosToWireOffset(doc, focus))).toBe(true);

      const removed = applyDocDelete(doc, selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`header \n\n\n`);
      expect(docToWire(removed.doc)).not.toContain(agent);
    });

    it("mention-only row + spacer — next backspace removes mention", () => {
      const wire = `@${agent} \n\n\n`;
      const { doc, selection } = chipSpacerBeforeFirstProbe(wire);
      expect(handoffNoteCaretOnMentionNodeEnd(doc, selection.focus)).toBe(true);

      const removed = applyDocDelete(doc, selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`\n\n\n`);
      expect(docToWire(removed.doc)).not.toContain(agent);
    });

    it("plain tail + spacer — next backspace chips row text not blank band", () => {
      const wire = `tail \n\n\n`;
      const { doc, selection } = chipSpacerBeforeFirstProbe(wire);
      expect(handoffNoteCaretOnMentionNodeEnd(doc, selection.focus)).toBe(false);

      const chipped = applyDocDelete(doc, selection, "backspace")!;
      expect(docToWire(chipped.doc)).toBe(`tai\n\n\n`);
    });

    it("probe wire in text node without spacer — collapses blank not mention", () => {
      const wire = `header @${agent}\n\n\n`;
      const doc = wireToDoc(wire);
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);
      const focus = wireOffsetToDocPos(doc, firstProbe!);
      expect(handoffNoteCaretOnMentionNodeEnd(doc, focus)).toBe(false);

      const collapsed = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      expect(docToWire(collapsed.doc)).toBe(`header @${agent}\n\n`);
      expect(docToWire(collapsed.doc)).toContain(agent);
    });
  });

  describe("delete — content row end mirror at probe alias", () => {
    it("mention node end at probe alias — no-op without collapsing blank band", () => {
      const wire = `header @${agent} \n\n\n`;
      const { doc, selection } = chipSpacerBeforeFirstProbe(wire);
      expect(handoffNoteCaretOnMentionNodeEnd(doc, selection.focus)).toBe(true);

      expect(applyDocDelete(doc, selection, "delete")).toBeNull();
      expect(docToWire(doc)).toBe(`header @${agent}\n\n\n`);
    });

    it("delete probe in text node past spacer — still collapses blank below", () => {
      const wire = `header @${agent} \n\n\n`;
      const doc = wireToDoc(wire);
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);
      const focus = wireOffsetToDocPos(doc, firstProbe!);
      expect(handoffNoteCaretOnMentionNodeEnd(doc, focus)).toBe(false);

      const collapsed = applyDocDelete(doc, collapsedSelection(focus), "delete")!;
      expect(docToWire(collapsed.doc)).toBe(`header @${agent} \n\n`);
      expect(docToWire(collapsed.doc)).toContain(agent);
    });

    it("mention node start at row visual start — forward delete removes mention", () => {
      const wire = `header @${agent} \n\n\n`;
      const doc = wireToDoc(wire);
      const mentionStart = wire.indexOf("@");
      const focus = wireOffsetToDocPos(doc, mentionStart);
      expect(handoffNoteCaretOnMentionNodeStart(doc, focus)).toBe(true);

      const removed = applyDocDelete(doc, collapsedSelection(focus), "delete")!;
      expect(docToWire(removed.doc)).not.toContain(agent);
    });
  });

  describe("multi-band wire — probe alias disambiguation", () => {
    const agentB = "caliper-bbbbbbb";

    function complexMultiBandWire() {
      return `header @${agent} \n\n\nmiddle\n\n\ntail @${agentB} suffix`;
    }

    function complexMultiBandWireLowerTrailingBand() {
      return `header @${agent} \n\n\nmiddle\n\n\ntail @${agentB} \n\n\n`;
    }

    function chipSpacerBeforeUpperBandProbe(wire: string) {
      const doc = wireToDoc(wire);
      const spacerWire = listEmbeddedBlankBandProbeWires(doc)[0]! - 1;
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spacerWire)),
        "backspace"
      )!;
      return { doc: chipped.doc, selection: chipped.selection };
    }

    it("upper band — backspace at mention node end removes top mention only", () => {
      const { doc, selection } = chipSpacerBeforeUpperBandProbe(complexMultiBandWire());
      expect(handoffNoteCaretOnMentionNodeEnd(doc, selection.focus)).toBe(true);
      expect(
        handoffNoteIsMentionEndProbeAliasWire(doc, docPosToWireOffset(doc, selection.focus))
      ).toBe(true);

      const removed = applyDocDelete(doc, selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`header \n\n\nmiddle\n\n\ntail @${agentB} suffix`);
      expect(docToWire(removed.doc)).not.toContain(agent);
      expect(docToWire(removed.doc)).toContain(agentB);
    });

    it("upper band — delete at mention node end is no-op without collapsing upper band", () => {
      const { doc, selection } = chipSpacerBeforeUpperBandProbe(complexMultiBandWire());
      expect(handoffNoteCaretOnMentionNodeEnd(doc, selection.focus)).toBe(true);

      expect(applyDocDelete(doc, selection, "delete")).toBeNull();
      expect(docToWire(doc)).toBe(`header @${agent}\n\n\nmiddle\n\n\ntail @${agentB} suffix`);
    });

    function spacerBeforeBandFirstProbe(doc: ReturnType<typeof wireToDoc>, probeWire: number) {
      return probeWire - 1;
    }

    function lowerTrailingBandSpacerWire(doc: ReturnType<typeof wireToDoc>) {
      const groups = listEmbeddedBlankBandGroups(doc);
      const lastGroup = groups[groups.length - 1]!;
      return spacerBeforeBandFirstProbe(doc, lastGroup.probes[0]!);
    }

    it("lower band trailing row — backspace at mention node end removes lower mention only", () => {
      const { doc, selection } = chipSpacerBeforeUpperBandProbe(
        complexMultiBandWireLowerTrailingBand()
      );
      const lowerBandSpacer = lowerTrailingBandSpacerWire(doc);
      const chipped = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lowerBandSpacer)),
        "backspace"
      )!;
      expect(handoffNoteCaretOnMentionNodeEnd(chipped.doc, chipped.selection.focus)).toBe(true);

      const removed = applyDocDelete(chipped.doc, chipped.selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`header @${agent}\n\n\nmiddle\n\n\ntail \n\n\n`);
      expect(docToWire(removed.doc)).toContain(agent);
      expect(docToWire(removed.doc)).not.toContain(agentB);
    });

    it("lower band — delete at text-node probe past spacer still collapses within lower band", () => {
      const wire = complexMultiBandWireLowerTrailingBand();
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const lowerFirstProbe = probes[probes.length - 3]!;
      const focus = wireOffsetToDocPos(doc, lowerFirstProbe);
      expect(handoffNoteCaretOnMentionNodeEnd(doc, focus)).toBe(false);

      const collapsed = applyDocDelete(doc, collapsedSelection(focus), "delete")!;
      expect(docToWire(collapsed.doc)).toBe(
        `header @${agent} \n\n\nmiddle\n\n\ntail @${agentB} \n\n`
      );
      expect(docToWire(collapsed.doc)).toContain(agentB);
    });
  });

  describe("forward delete — tail boundary at visual start", () => {
    it("clears lone whitespace at doc visual start (post-mention spacer residue)", () => {
      const doc = wireToDoc(" ");
      const result = applyDocDelete(doc, collapsedSelection(wireOffsetToDocPos(doc, 0)), "delete");
      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe("");
    });

    it("clears lone substantive char at doc visual start", () => {
      const doc = wireToDoc("d");
      const result = applyDocDelete(doc, collapsedSelection(wireOffsetToDocPos(doc, 0)), "delete");
      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe("");
    });

    it("nips last char when caret is at its visual start", () => {
      const doc = wireToDoc("hello");
      const result = applyDocDelete(doc, collapsedSelection(wireOffsetToDocPos(doc, 4)), "delete");
      expect(result).not.toBeNull();
      expect(docToWire(result!.doc)).toBe("hell");
    });

    it("no-op at doc end when nothing remains ahead", () => {
      const doc = wireToDoc("d");
      expect(
        applyDocDelete(doc, collapsedSelection(wireOffsetToDocPos(doc, 1)), "delete")
      ).toBeNull();
    });

    it("clears post-mention trailing spacer after forward delete removes pill from visual start", () => {
      const wire = `@${agent} `;
      const doc = wireToDoc(wire);
      const afterMentionDelete = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0)),
        "delete"
      )!;
      expect(docToWire(afterMentionDelete.doc)).toBe(" ");
      const cleared = applyDocDelete(
        afterMentionDelete.doc,
        afterMentionDelete.selection,
        "delete"
      )!;
      expect(docToWire(cleared.doc)).toBe("");
    });
  });

  describe("resolveHandoffNoteDeleteIntent — disambiguation", () => {
    it("inter-mention gap offset 0 backspace does not atomically remove a mention", () => {
      const wire = `Hi @${agent} @${agent} there`;
      const doc = wireToDoc(wire);
      const gapNode = doc.nodes.findIndex(
        (node, i) =>
          node.type === "text" &&
          doc.nodes[i - 1]?.type === "mention" &&
          doc.nodes[i + 1]?.type === "mention"
      );
      const focus = { nodeIndex: gapNode, nodeOffset: 0 };
      const removed = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      expect(docToWire(removed.doc).match(new RegExp(`@${agent}`, "g"))).toHaveLength(2);
    });

    it("embedded-newline text between mentions is not an inter-mention gap for forward delete", () => {
      const wire = `header @${agent} row\n\n @${agent} lower`;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(wireToDoc(wire));
      let rowStart = probes[0]! + 1;
      while (wire[rowStart] === "\n") {
        rowStart += 1;
      }
      const mentionAt = wire.indexOf("@", rowStart);
      const spaceWire = wire.lastIndexOf(" ", mentionAt);
      const cleared = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spaceWire)),
        "delete"
      )!;
      expect(doc.nodes[cleared.selection.focus.nodeIndex]?.type).toBe("text");
      expect(docToWire(cleared.doc)).toMatch(/\n\n@caliper-abc123 lower/);
    });
  });
});
