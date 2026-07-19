import { describe, expect, it } from "vitest";
import { applyDocDelete, applyDocInsertText } from "./handoff-note-doc-edits.js";
import {
  collapsedSelection,
  collapsedSelectionWithIntent,
  docPosToWireOffset,
  resolveDirectionalUnitFocus,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import { docToWire, wireToDoc } from "./handoff-note-doc.js";
import {
  handoffNoteCaretOnAtomicNodeEnd,
  handoffNoteCaretOnAtomicNodeStart,
  handoffNoteIsAtomicEndProbeAlias,
  resolveHandoffNoteDeleteIntent,
} from "./handoff-note-delete-intent.js";
import {
  isEmbeddedBlankBandDeleteProbeWire,
  listEmbeddedBlankBandGroups,
  listEmbeddedBlankBandProbeWires,
} from "./handoff-note-embedded-newlines.js";

describe("handoff note delete intent — contract authority before handler chain", () => {
  const agent = "caliper-abc123";

  function chipSpacerBeforeFirstProbe(wire: string) {
    const doc = wireToDoc(wire);
    const probes = listEmbeddedBlankBandProbeWires(doc);
    const spacerWire = probes[0]! - 1;
    // CRE Backspace: affinity `after` — unit behind is the spacer char.
    const chipped = applyDocDelete(
      doc,
      collapsedSelection(wireOffsetToDocPos(doc, spacerWire), "after"),
      "backspace"
    )!;
    return { doc: chipped.doc, selection: chipped.selection, probes };
  }

  describe("backspace — mention node end beats blank collapse at probe alias", () => {
    it("prefix + mention row + spacer — next backspace removes mention", () => {
      const wire = `header @${agent} \n\n\n`;
      const { doc, selection } = chipSpacerBeforeFirstProbe(wire);
      const focus = selection.focus;
      expect(handoffNoteCaretOnAtomicNodeEnd(doc, focus)).toBe(true);
      expect(handoffNoteIsAtomicEndProbeAlias(doc, focus)).toBe(true);

      const removed = applyDocDelete(doc, selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`header \n\n\n`);
      expect(docToWire(removed.doc)).not.toContain(agent);
    });

    it("mention-only row + spacer — next backspace removes mention", () => {
      const wire = `@${agent} \n\n\n`;
      const { doc, selection } = chipSpacerBeforeFirstProbe(wire);
      expect(handoffNoteCaretOnAtomicNodeEnd(doc, selection.focus)).toBe(true);

      const removed = applyDocDelete(doc, selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`\n\n\n`);
      expect(docToWire(removed.doc)).not.toContain(agent);
    });

    it("plain tail + spacer — next backspace chips row text not blank band", () => {
      const wire = `tail \n\n\n`;
      const { doc, selection } = chipSpacerBeforeFirstProbe(wire);
      expect(handoffNoteCaretOnAtomicNodeEnd(doc, selection.focus)).toBe(false);

      const chipped = applyDocDelete(doc, selection, "backspace")!;
      expect(docToWire(chipped.doc)).toBe(`tai\n\n\n`);
    });

    it("probe wire in text node without spacer — collapses blank not mention", () => {
      const wire = `header @${agent}\n\n\n`;
      const doc = wireToDoc(wire);
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);
      const focus = wireOffsetToDocPos(doc, firstProbe!);
      expect(handoffNoteCaretOnAtomicNodeEnd(doc, focus)).toBe(false);

      const collapsed = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      expect(docToWire(collapsed.doc)).toBe(`header @${agent}\n\n`);
      expect(docToWire(collapsed.doc)).toContain(agent);
    });
  });

  describe("glued postfix substantive chip — probe alias landing", () => {
    function gluedPostfixUpperBandWire(postfix = "T") {
      return `note @${agent}${postfix}\n\n\n`;
    }

    function chipGluedPostfixAtContentCaret(wire: string) {
      const doc = wireToDoc(wire);
      const postfixWire = wire.search(/[A-Za-z]\n/);
      expect(postfixWire).toBeGreaterThanOrEqual(0);
      // CRE Backspace: unit behind is the postfix char.
      return applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, postfixWire), "after"),
        "backspace"
      )!;
    }

    it("substantive chip lands mention-node-end alias off delete-probe infrastructure", () => {
      const chipped = chipGluedPostfixAtContentCaret(gluedPostfixUpperBandWire());
      expect(handoffNoteCaretOnAtomicNodeEnd(chipped.doc, chipped.selection.focus)).toBe(true);
      expect(
        isEmbeddedBlankBandDeleteProbeWire(
          chipped.doc,
          docPosToWireOffset(chipped.doc, chipped.selection.focus),
          chipped.selection.focus
        )
      ).toBe(false);
    });

    it("delete after substantive chip collapses blank preserving mention-end alias", () => {
      const chipped = chipGluedPostfixAtContentCaret(gluedPostfixUpperBandWire());
      const deleted = applyDocDelete(chipped.doc, chipped.selection, "delete")!;
      expect(docToWire(deleted.doc)).toBe(`note @${agent}\n\n`);
      expect(handoffNoteCaretOnAtomicNodeEnd(deleted.doc, deleted.selection.focus)).toBe(true);
      expect(
        isEmbeddedBlankBandDeleteProbeWire(
          deleted.doc,
          docPosToWireOffset(deleted.doc, deleted.selection.focus),
          deleted.selection.focus
        )
      ).toBe(false);
    });
  });

  describe("delete — content row end mirror at probe alias", () => {
    it("mention node end at probe alias — delete collapses blank band (look right)", () => {
      const wire = `header @${agent} \n\n\n`;
      const { doc, selection } = chipSpacerBeforeFirstProbe(wire);
      expect(handoffNoteCaretOnAtomicNodeEnd(doc, selection.focus)).toBe(true);

      const collapsed = applyDocDelete(doc, selection, "delete")!;
      expect(docToWire(collapsed.doc)).toBe(`header @${agent}\n\n`);
      expect(docToWire(collapsed.doc)).toContain(agent);
    });

    it("delete probe in text node past spacer — still collapses blank below", () => {
      const wire = `header @${agent} \n\n\n`;
      const doc = wireToDoc(wire);
      const [firstProbe] = listEmbeddedBlankBandProbeWires(doc);
      const focus = wireOffsetToDocPos(doc, firstProbe!);
      expect(handoffNoteCaretOnAtomicNodeEnd(doc, focus)).toBe(false);

      const collapsed = applyDocDelete(doc, collapsedSelection(focus), "delete")!;
      expect(docToWire(collapsed.doc)).toBe(`header @${agent} \n\n`);
      expect(docToWire(collapsed.doc)).toContain(agent);
    });

    it("mention node start at row visual start — forward delete removes mention", () => {
      const wire = `header @${agent} \n\n\n`;
      const doc = wireToDoc(wire);
      const mentionStart = wire.indexOf("@");
      const focus = wireOffsetToDocPos(doc, mentionStart);
      expect(handoffNoteCaretOnAtomicNodeStart(doc, focus)).toBe(true);

      const removed = applyDocDelete(doc, collapsedSelection(focus), "delete")!;
      expect(docToWire(removed.doc)).not.toContain(agent);
    });
  });

  /**
   * Sole/last content char before `\n` is wire-ambiguous with content-row-end.
   * Delete landing owns `focusAffinity: before` (deletion point); insert must not bump.
   */
  describe("deletion-point affinity — sole residue before \\n", () => {
    function expectDeleteThenInsert(args: {
      wire: string;
      focusWire: number;
      direction: "delete" | "backspace";
      wireAfter: string;
      typed: string;
      affinity?: "before";
    }) {
      const doc = wireToDoc(args.wire);
      const removed = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, args.focusWire)),
        args.direction
      )!;
      expect(docToWire(removed.doc)).toBe(args.wireAfter);
      if (args.affinity) {
        expect(removed.selection.focusAffinity).toBe(args.affinity);
      }
      expect(docToWire(applyDocInsertText(removed.doc, removed.selection, "x").doc)).toBe(
        args.typed
      );
    }

    it("delete row-start mention mid-blank inserts before leftover commit space", () => {
      const wire = `whe\n\n@${agent} \nmean`;
      expectDeleteThenInsert({
        wire,
        focusWire: wire.indexOf("@"),
        direction: "delete",
        wireAfter: `whe\n\n \nmean`,
        typed: `whe\n\nx \nmean`,
        affinity: "before",
      });
    });

    it("backspace mention-end mid-blank inserts before leftover commit space", () => {
      const wire = `whe\n\n@${agent} \nmean`;
      expectDeleteThenInsert({
        wire,
        focusWire: wire.indexOf("@") + `@${agent}`.length,
        direction: "backspace",
        wireAfter: `whe\n\n \nmean`,
        typed: `whe\n\nx \nmean`,
        affinity: "before",
      });
    });

    it("delete mention before trailing blank band inserts before leftover space", () => {
      const wire = `header\n\n@${agent} \n\n`;
      expectDeleteThenInsert({
        wire,
        focusWire: wire.indexOf("@"),
        direction: "delete",
        wireAfter: `header\n\n \n\n`,
        typed: `header\n\nx \n\n`,
        affinity: "before",
      });
    });

    it("backspace ordinary text leaving sole space inserts before that space", () => {
      expectDeleteThenInsert({
        wire: `a \nmean`,
        focusWire: 1,
        direction: "backspace",
        wireAfter: ` \nmean`,
        typed: `x \nmean`,
        affinity: "before",
      });
    });

    it("backspace leaving sole char before break inserts before that char", () => {
      expectDeleteThenInsert({
        wire: `ab\nmean`,
        focusWire: 1,
        direction: "backspace",
        wireAfter: `b\nmean`,
        typed: `xb\nmean`,
        affinity: "before",
      });
    });

    it("delete doc-start mention EOF space inserts before leftover space", () => {
      expectDeleteThenInsert({
        wire: `@${agent} `,
        focusWire: 0,
        direction: "delete",
        wireAfter: ` `,
        typed: `x `,
      });
    });

    it("prefixed mention delete inserts at leftover commit-space deletion point", () => {
      const wire = `hi @${agent} \nmean`;
      expectDeleteThenInsert({
        wire,
        focusWire: wire.indexOf("@"),
        direction: "delete",
        wireAfter: `hi  \nmean`,
        typed: `hi x \nmean`,
        affinity: "before",
      });
    });
  });

  describe("resolveDirectionalUnitFocus — shared Backspace/Delete affinity gate", () => {
    it("after: Delete advances focus to break; Backspace keeps focus and names content-char unit", () => {
      const doc = wireToDoc("whe\n\nm");
      const focus = wireOffsetToDocPos(doc, 2);
      const del = resolveDirectionalUnitFocus(doc, focus, "after", "delete");
      expect(docPosToWireOffset(doc, del.focus)).toBe(3);
      expect(del.contentCharUnit).toBeUndefined();
      const bs = resolveDirectionalUnitFocus(doc, focus, "after", "backspace");
      expect(docPosToWireOffset(doc, bs.focus)).toBe(2);
      expect(bs.contentCharUnit).toEqual({ startWire: 2, endWire: 3 });
    });

    it("before / omit: both keys keep focus; neither emits contentCharUnit", () => {
      const doc = wireToDoc("whe\n\nm");
      const focus = wireOffsetToDocPos(doc, 2);
      for (const aff of ["before", undefined] as const) {
        for (const dir of ["backspace", "delete"] as const) {
          const resolved = resolveDirectionalUnitFocus(doc, focus, aff, dir);
          expect(docPosToWireOffset(doc, resolved.focus)).toBe(2);
          expect(resolved.contentCharUnit).toBeUndefined();
        }
      }
    });
  });

  /**
   * Content-row-end (`focusAffinity: after`) on last char before `\n`: Delete acts on the
   * unit ahead (blank / join), not another chip of that char. Omit / `before` still nip.
   */
  describe("content-row-end affinity — Delete unit ahead", () => {
    it("affinity before on last char before blank: Delete nips that char", () => {
      const doc = wireToDoc("whed\n\nm");
      const sel = collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, 3), "deletion-point");
      expect(sel.focusAffinity).toBe("before");
      expect(docToWire(applyDocDelete(doc, sel, "delete")!.doc)).toBe("whe\n\nm");
    });

    it("affinity after on last char before blank: Delete collapses blank, keeps row text", () => {
      const doc = wireToDoc("whe\n\nm");
      const sel = collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, 2), "content-row-end");
      expect(sel.focusAffinity).toBe("after");
      expect(listEmbeddedBlankBandProbeWires(doc)).toContain(3);
      const result = applyDocDelete(doc, sel, "delete")!;
      expect(docToWire(result.doc)).toBe("whe\nm");
    });

    it("after row-chip landing (content-row-end), next Delete does not eat prior char", () => {
      const doc = wireToDoc("whed\n\nm");
      const afterChip = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 3)),
        "delete"
      )!;
      expect(docToWire(afterChip.doc)).toBe("whe\n\nm");
      expect(afterChip.selection.focusAffinity).toBe("after");
      const second = applyDocDelete(afterChip.doc, afterChip.selection, "delete")!;
      expect(docToWire(second.doc)).toBe("whe\nm");
    });

    it("affinity after before substantive \\n: Delete joins rows", () => {
      const doc = wireToDoc("whe\nm");
      expect(listEmbeddedBlankBandProbeWires(doc)).toEqual([]);
      const sel = collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, 2), "content-row-end");
      expect(docToWire(applyDocDelete(doc, sel, "delete")!.doc)).toBe("whem");
    });

    it("Backspace at content-row-end still nips last char", () => {
      const doc = wireToDoc("whe\n\nm");
      const sel = collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, 2), "content-row-end");
      expect(docToWire(applyDocDelete(doc, sel, "backspace")!.doc)).toBe("wh\n\nm");
    });

    it("affinity before on last char before blank: Backspace nips prior char not focused char", () => {
      const doc = wireToDoc("whe\n\nm");
      const sel = collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, 2), "deletion-point");
      expect(sel.focusAffinity).toBe("before");
      expect(docToWire(applyDocDelete(doc, sel, "backspace")!.doc)).toBe("we\n\nm");
    });

    it("omit affinity on last char before blank: Backspace matches before (nips prior)", () => {
      const doc = wireToDoc("whe\n\nm");
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 2)),
        "backspace"
      )!;
      expect(docToWire(result.doc)).toBe("we\n\nm");
    });

    it("omit affinity on last char before blank: Delete still nips that char", () => {
      const doc = wireToDoc("whe\n\nm");
      const result = applyDocDelete(doc, collapsedSelection(wireOffsetToDocPos(doc, 2)), "delete")!;
      expect(docToWire(result.doc)).toBe("wh\n\nm");
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
        collapsedSelection(wireOffsetToDocPos(doc, spacerWire), "after"),
        "backspace"
      )!;
      return { doc: chipped.doc, selection: chipped.selection };
    }

    it("upper band — backspace at mention node end removes top mention only", () => {
      const { doc, selection } = chipSpacerBeforeUpperBandProbe(complexMultiBandWire());
      expect(handoffNoteCaretOnAtomicNodeEnd(doc, selection.focus)).toBe(true);
      expect(handoffNoteIsAtomicEndProbeAlias(doc, selection.focus)).toBe(true);

      const removed = applyDocDelete(doc, selection, "backspace")!;
      expect(docToWire(removed.doc)).toBe(`header \n\n\nmiddle\n\n\ntail @${agentB} suffix`);
      expect(docToWire(removed.doc)).not.toContain(agent);
      expect(docToWire(removed.doc)).toContain(agentB);
    });

    it("upper band — delete at mention node end collapses upper blank band", () => {
      const { doc, selection } = chipSpacerBeforeUpperBandProbe(complexMultiBandWire());
      expect(handoffNoteCaretOnAtomicNodeEnd(doc, selection.focus)).toBe(true);

      const collapsed = applyDocDelete(doc, selection, "delete")!;
      expect(docToWire(collapsed.doc)).toBe(
        `header @${agent}\n\nmiddle\n\n\ntail @${agentB} suffix`
      );
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
        collapsedSelection(wireOffsetToDocPos(doc, lowerBandSpacer), "after"),
        "backspace"
      )!;
      expect(handoffNoteCaretOnAtomicNodeEnd(chipped.doc, chipped.selection.focus)).toBe(true);

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
      expect(handoffNoteCaretOnAtomicNodeEnd(doc, focus)).toBe(false);

      const collapsed = applyDocDelete(doc, collapsedSelection(focus), "delete")!;
      expect(docToWire(collapsed.doc)).toBe(
        `header @${agent} \n\n\nmiddle\n\n\ntail @${agentB} \n\n`
      );
      expect(docToWire(collapsed.doc)).toContain(agentB);
    });
  });

  describe("leftover spacer before blank band — unit behind vs ahead", () => {
    it("visual-start before: Backspace noops on sole leftover space", () => {
      const doc = wireToDoc(" \n\nmd");
      const focus = wireOffsetToDocPos(doc, 0);
      const result = applyDocDelete(doc, collapsedSelection(focus, "before"), "backspace");
      expect(result).toBeNull();
      expect(docToWire(doc)).toBe(" \n\nmd");
    });

    it("visual-start before: Backspace noops on sole substantive char (same as spacer)", () => {
      const doc = wireToDoc("d\n\nmd");
      expect(
        applyDocDelete(doc, collapsedSelection(wireOffsetToDocPos(doc, 0), "before"), "backspace")
      ).toBeNull();
      expect(docToWire(doc)).toBe("d\n\nmd");
    });

    it("visual-start before: Delete clears sole leftover space (unit ahead)", () => {
      const doc = wireToDoc(" \n\nmd");
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0), "before"),
        "delete"
      )!;
      expect(docToWire(result.doc)).toBe("\n\nmd");
    });

    it("content-row-end after: Backspace removes sole leftover space (unit behind)", () => {
      const doc = wireToDoc(" \n\nmd");
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, 0), "after"),
        "backspace"
      )!;
      expect(docToWire(result.doc)).toBe("\n\nmd");
    });

    it("visual-start before on multi-char row: Backspace nips char behind, not spacer ahead", () => {
      const doc = wireToDoc("tail \n\n\n");
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const spacerWire = probes[0]! - 1;
      expect(docToWire(doc)[spacerWire]).toBe(" ");
      const result = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spacerWire), "before"),
        "backspace"
      )!;
      expect(docToWire(result.doc)).toBe("tai \n\n\n");
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

    it("substantive text between mentions at offset 0 backspace removes the left pill", () => {
      // Glued wire `@idmesh` parses as one mention — build the real node shape via spacer chip.
      const spaced = `Hi @${agent} mesh @${agent} there`;
      let doc = wireToDoc(spaced);
      const spaceIdx = spaced.indexOf(" mesh");
      let state = applyDocDelete(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, spaceIdx + 1)),
        "backspace"
      )!;
      doc = state.doc;
      const focus = state.selection.focus;
      expect(doc.nodes[focus.nodeIndex]?.type).toBe("text");
      expect(focus.nodeOffset).toBe(0);
      expect(doc.nodes[focus.nodeIndex - 1]?.type).toBe("mention");
      expect(doc.nodes[focus.nodeIndex + 1]?.type).toBe("mention");

      state = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      const after = docToWire(state.doc);
      expect(after).toContain("mesh");
      expect(after).not.toContain(`${agent}mesh`);
      expect(after).not.toContain(`${agent}esh`);
      expect(after.match(new RegExp(`@${agent}`, "g"))).toHaveLength(1);
    });

    it("glued postfix after spacer chip: backspace at text@0 removes the pill, not first char", () => {
      const spaced = `whe @${agent} d @${agent} mesh @${agent} `;
      let doc = wireToDoc(spaced);
      const spaceIdx = spaced.lastIndexOf(" mesh");
      let focus = wireOffsetToDocPos(doc, spaceIdx + 1);
      let state = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      expect(docToWire(state.doc)).toContain(`@${agent}mesh`);
      doc = state.doc;
      focus = state.selection.focus;
      expect(doc.nodes[focus.nodeIndex]?.type).toBe("text");
      expect(focus.nodeOffset).toBe(0);

      state = applyDocDelete(doc, collapsedSelection(focus), "backspace")!;
      const after = docToWire(state.doc);
      expect(after).not.toContain(`${agent}esh`);
      expect(after).not.toContain(`${agent}mesh`);
      expect(after).toContain("mesh");
      expect(after.match(new RegExp(`@${agent}`, "g"))).toHaveLength(2);
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

    it("delete at sandwiched line-start \\n uses forward splice not line-start collapse", () => {
      const wire = `upper @${agent} xx\n\n\nlower @${agent} `;
      const doc = wireToDoc(wire);
      const lineStartBeforeLower = wire.indexOf("lower") - 1;
      const intent = resolveHandoffNoteDeleteIntent(
        doc,
        collapsedSelection(wireOffsetToDocPos(doc, lineStartBeforeLower)),
        "delete"
      );
      expect(intent?.kind).toBe("result");
      if (intent?.kind === "result") {
        expect(docPosToWireOffset(intent.result.doc, intent.result.selection.focus)).toBe(
          docToWire(intent.result.doc).indexOf("lower")
        );
        expect(docPosToWireOffset(intent.result.doc, intent.result.selection.focus)).not.toBe(0);
      }
    });
  });
});
