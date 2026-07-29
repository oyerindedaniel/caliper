/**
 * Delete / backspace integration — editor pipeline (beforeInput + keydown).
 * Core doc policy: handoff-note-doc-edits.test.ts
 * Overlay ingress: handoff-note-arrow-contract.md (blank-band delete)
 */
import {
  collapsedSelection,
  collapsedSelectionWithIntent,
  describeHandoffNoteCursorContext,
  docPosToWireOffset,
  isEmbeddedBlankBandProbeWire,
  listEmbeddedBlankBandProbeWires,
  wireOffsetToDocPos,
  wireToDoc,
} from "@caliper/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandoffNoteEditor, type HandoffNoteEditor } from "./create-handoff-note-editor.js";
import { isHandoffLineStartAnchorElement } from "./handoff-note-dom.js";
import { domPointToDocPos, resolveDomPointAtDocPos } from "./handoff-note-dom-points.js";
import { invalidateHandoffNoteLayoutCache } from "./handoff-note-layout-map.js";
import {
  dispatchSelectionChange,
  readDomWireCursor,
  setDomCaretAtTextStart,
  setSelectionAtWire,
} from "./handoff-note-test-helpers.js";

const AGENT_A = "caliper-abc123";
const AGENT_B = "caliper-bbbbbbb";

function mountEditorHost() {
  const root = document.createElement("div");
  root.style.width = "480px";
  document.body.appendChild(root);
  Object.defineProperty(root, "clientWidth", { configurable: true, value: 480 });
  const colorByAgentId = new Map([
    [AGENT_A, "#06f"],
    [AGENT_B, "#f60"],
  ]);
  const editor = createHandoffNoteEditor({
    getColorByAgentId: () => colorByAgentId,
    onWireChange: () => {},
  });
  editor.setRoot(root);
  return { root, editor };
}

function pressDelete(editor: HandoffNoteEditor): boolean {
  return editor.handleKeyDown(
    new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
  );
}

function pressBackspace(editor: HandoffNoteEditor): boolean {
  return editor.handleKeyDown(
    new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
  );
}

function expectCaretParity(editor: HandoffNoteEditor, root: HTMLElement, wire: number): void {
  expect(editor.getCursor()).toBe(wire);
  const domWire = readDomWireCursor(root, editor.getDoc());
  if (domWire === wire) {
    return;
  }
  // Rule 4 alias: authority on a non-probe `\n` may paint the prior content text tail,
  // which reads back as the last character wire (handoff-note-arrow-contract.md).
  const doc = editor.getDoc();
  const text = editor.getWire();
  const contentRowEnd =
    text[wire] === "\n" &&
    !isEmbeddedBlankBandProbeWire(doc, wire) &&
    domWire === wire - 1 &&
    text[domWire] !== undefined &&
    text[domWire] !== "\n";
  expect(contentRowEnd, `domWire ${domWire} vs authority ${wire}`).toBe(true);
}

function firstSubstantiveTextNode(root: HTMLElement): Text {
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0) {
      return node as Text;
    }
  }
  throw new Error("expected substantive text node");
}

describe("handoff note delete integration (keydown + ingress)", () => {
  let host: ReturnType<typeof mountEditorHost>;

  beforeEach(() => {
    host = mountEditorHost();
  });

  afterEach(() => {
    invalidateHandoffNoteLayoutCache();
    host.root.remove();
  });

  describe("prefix-only blank band — chip then collapse ladder", () => {
    /** Sole `h` before blanks is wire-ambiguous; chip-first needs deletion-point (`before`). */
    function placeDeletionPointOnSolePrefix(wire: string) {
      const doc = wireToDoc(wire);
      const sel = collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, 0), "deletion-point");
      host.editor.applyDoc(doc, sel);
    }

    it("forward delete — each nip lands on band head with DOM parity", () => {
      const tail = "tail";
      placeDeletionPointOnSolePrefix(`h\n\n\n${tail}`);
      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\n\n${tail}`);

      for (const expectedWire of [`\n\n${tail}`, `\n${tail}`, tail]) {
        expect(pressDelete(host.editor)).toBe(true);
        expect(host.editor.getWire()).toBe(expectedWire);
        expectCaretParity(host.editor, host.root, 0);
      }
    });

    it("backspace mirror — chip then collapse lands on band head each nip", () => {
      const tail = "tail";
      placeDeletionPointOnSolePrefix(`h\n\n\n${tail}`);
      expect(pressDelete(host.editor)).toBe(true);

      for (const expectedWire of [`\n\n${tail}`, `\n${tail}`, tail]) {
        expect(pressBackspace(host.editor)).toBe(true);
        expect(host.editor.getWire()).toBe(expectedWire);
        expectCaretParity(host.editor, host.root, 0);
      }
    });

    it("setDocFromWire sole prefix omits CRE — Delete nips the char not blank", () => {
      const tail = "tail";
      host.editor.setDocFromWire(`h\n\n\n${tail}`, 0, { resetHistory: true });
      expect(host.editor.getSelectionState().focusAffinity).toBeUndefined();
      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\n\n${tail}`);
    });

    it("explicit content-row-end on sole prefix — Delete collapses blank first (keeps h)", () => {
      const tail = "tail";
      const wire = `h\n\n\n${tail}`;
      const doc = wireToDoc(wire);
      host.editor.applyDoc(
        doc,
        collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, 0), "content-row-end")
      );
      expect(host.editor.getSelectionState().focusAffinity).toBe("after");
      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`h\n\n${tail}`);
    });

    it("delete at last probe when another blank remains lands next blank below not band head", () => {
      const tail = "tail";
      const wire = `\n\n\n${tail}`;
      const probes = listEmbeddedBlankBandProbeWires(wireToDoc(wire));
      host.editor.setDocFromWire(wire, probes[1]!, { resetHistory: true });

      expect(pressDelete(host.editor)).toBe(true);
      const next = host.editor.getWire();
      expect(next).toBe(`\n\n${tail}`);
      const contentAt = next.indexOf(tail);
      // Next visual row below collapsed probe is still empty before content.
      expectCaretParity(host.editor, host.root, contentAt - 1);
      expect(next[contentAt - 1]).toBe("\n");
      expect(host.editor.getCursor()).not.toBe(0);
    });
  });

  describe("whitespace-filled blank graduates to content", () => {
    it("Delete at space-row visual start nips space; empty blank above stays", () => {
      const wire = "dh\n\n      \nmen";
      const firstSpace = wire.indexOf(" ");
      host.editor.setDocFromWire(wire, firstSpace, { resetHistory: true });
      expect(listEmbeddedBlankBandProbeWires(host.editor.getDoc())).toEqual([2]);
      expect(isEmbeddedBlankBandProbeWire(host.editor.getDoc(), firstSpace)).toBe(false);

      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe("dh\n\n     \nmen");
      expect(listEmbeddedBlankBandProbeWires(host.editor.getDoc())).toEqual([2]);
      expectCaretParity(host.editor, host.root, firstSpace);
    });
  });

  describe("prefix before mention — row clear and blank-band preservation", () => {
    function tier1Wire() {
      return `\n\n\nT @${AGENT_A}\n\n\nmiddle`;
    }

    it("control — delete through leading blanks then row start clears mention preserving middle band", () => {
      host.editor.setDocFromWire(tier1Wire(), 0, { resetHistory: true });
      while (host.editor.getWire().startsWith("\n") && host.editor.getCursor() === 0) {
        expect(pressDelete(host.editor)).toBe(true);
      }
      expect(host.editor.getWire()).toBe(`T @${AGENT_A}\n\n\nmiddle`);

      const rowText = firstSubstantiveTextNode(host.root);
      setDomCaretAtTextStart(host.root, rowText);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(0);

      while (host.editor.getWire().includes(`@${AGENT_A}`)) {
        expect(pressDelete(host.editor)).toBe(true);
      }
      expect(host.editor.getWire()).toBe(`\n\n\nmiddle`);
      expect(host.editor.getWire()).toContain("middle");
      expectCaretParity(host.editor, host.root, 0);
    });

    it("delete — click row visual start with leading blanks arms chip then one blank collapse", () => {
      const wire = tier1Wire();
      host.editor.setDocFromWire(wire, wire.search(/[^\n]/), { resetHistory: true });
      const rowText = firstSubstantiveTextNode(host.root);
      setDomCaretAtTextStart(host.root, rowText);
      dispatchSelectionChange(host.root);
      expect(host.editor.getCursor()).toBe(wire.search(/[^\n]/));

      while (host.editor.getWire().includes(`@${AGENT_A}`)) {
        expect(pressDelete(host.editor)).toBe(true);
      }
      expect(host.editor.getWire()).not.toContain(AGENT_A);
      expect(host.editor.getWire()).toContain("middle");

      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\n\n\n\nmiddle`);
      expect(host.editor.getWire()).toContain("middle");
    });

    it("whitespace-only row — mention remove arms chip then one blank collapse", () => {
      const wire = `\n\n\n @${AGENT_A}\n\n\nmiddle`;
      host.editor.setDocFromWire(wire, wire.indexOf("@"), { resetHistory: true });
      while (host.editor.getWire().includes(`@${AGENT_A}`)) {
        expect(pressDelete(host.editor)).toBe(true);
      }
      expect(host.editor.getWire()).toBe(`\n\n\n \n\n\nmiddle`);
      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\n\n\n\n\nmiddle`);
      expect(host.editor.getWire()).toContain("middle");
      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\n\n\n\nmiddle`);
    });
  });

  describe("sandwiched row — mention gate delete", () => {
    function sandwichedMentionRowWire(prefix = "tail") {
      return `header @${AGENT_A} row\n\n ${prefix} @${AGENT_A} \nlower`;
    }

    function sandwichedMentionOnlyRowWire() {
      return `header @${AGENT_A} row\n\n @${AGENT_A} \nlower`;
    }

    function complexMultiBandMentionOnlySandwichedRowWire() {
      return `header @${AGENT_A} \n\n\n @${AGENT_A} \nmiddle\n\n\ntail @${AGENT_B} suffix`;
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

    function expectMentionGateDomPaint(
      root: HTMLElement,
      doc: ReturnType<typeof wireToDoc>,
      focus: { nodeIndex: number; nodeOffset: number },
      gateWire: number
    ) {
      expect(doc.nodes[focus.nodeIndex]?.type).toBe("text");
      expect(isEmbeddedBlankBandProbeWire(doc, gateWire)).toBe(false);
      expect(describeHandoffNoteCursorContext(doc, gateWire).kind).toBe("mention-boundary");

      const point = resolveDomPointAtDocPos(root, doc, focus);
      // Row-start mention after wire-break: ZWSP line-start anchor (selection-capable), not root/BR.
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(isHandoffLineStartAnchorElement(point?.node.parentNode)).toBe(true);
      expect(docPosToWireOffset(doc, domPointToDocPos(root, doc, point!.node, point!.offset))).toBe(
        gateWire
      );
    }

    it("forward delete through prefix then spacer keeps DOM parity at mention gate", () => {
      const wireStr = sandwichedMentionRowWire("tail");
      host.editor.setDocFromWire(wireStr, sandwichedRowVisualStart(wireStr), {
        resetHistory: true,
      });
      expect(pressDelete(host.editor)).toBe(true);
      expect(pressDelete(host.editor)).toBe(true);
      expect(pressDelete(host.editor)).toBe(true);
      expect(pressDelete(host.editor)).toBe(true);
      expect(pressDelete(host.editor)).toBe(true);
      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toContain(`@${AGENT_A}`);
      const caretWire = docPosToWireOffset(
        host.editor.getDoc(),
        host.editor.getSelectionState().focus
      );
      expectCaretParity(host.editor, host.root, caretWire);
      expectMentionGateDomPaint(
        host.root,
        host.editor.getDoc(),
        host.editor.getSelectionState().focus,
        caretWire
      );
    });

    it("mention-only row — forward delete spacer keeps DOM parity", () => {
      const wire = sandwichedMentionOnlyRowWire();
      const spaceWire = spaceWireBeforeMentionOnSandwichedRow(wire);
      host.editor.setDocFromWire(wire, spaceWire, { resetHistory: true });
      expect(pressDelete(host.editor)).toBe(true);
      const caretWire = docPosToWireOffset(
        host.editor.getDoc(),
        host.editor.getSelectionState().focus
      );
      expectCaretParity(host.editor, host.root, caretWire);
      expectMentionGateDomPaint(
        host.root,
        host.editor.getDoc(),
        host.editor.getSelectionState().focus,
        caretWire
      );
    });

    it("backspace at mention start after spacer keeps DOM parity", () => {
      const wire = sandwichedMentionOnlyRowWire();
      const mentionStart = mentionStartOnSandwichedRow(wire);
      host.editor.setDocFromWire(wire, mentionStart, { resetHistory: true });
      expect(pressBackspace(host.editor)).toBe(true);
      const caretWire = docPosToWireOffset(
        host.editor.getDoc(),
        host.editor.getSelectionState().focus
      );
      expectCaretParity(host.editor, host.root, caretWire);
      expectMentionGateDomPaint(
        host.root,
        host.editor.getDoc(),
        host.editor.getSelectionState().focus,
        caretWire
      );
    });

    it("multi-band interchanged wire — forward delete spacer keeps DOM parity", () => {
      const wire = complexMultiBandMentionOnlySandwichedRowWire();
      const spaceWire = spaceWireBeforeMentionOnSandwichedRow(wire);
      host.editor.setDocFromWire(wire, spaceWire, { resetHistory: true });
      expect(pressDelete(host.editor)).toBe(true);
      const caretWire = docPosToWireOffset(
        host.editor.getDoc(),
        host.editor.getSelectionState().focus
      );
      expectCaretParity(host.editor, host.root, caretWire);
      expectMentionGateDomPaint(
        host.root,
        host.editor.getDoc(),
        host.editor.getSelectionState().focus,
        caretWire
      );
    });
  });

  describe("forward chip through mention — prefix row", () => {
    function embeddedRowChipWire() {
      return `head\n\ntext @${AGENT_A} \nlower @${AGENT_A} `;
    }

    function chipCaretWireInPrefixRow(wire: string) {
      return wire.indexOf("text") + 2;
    }

    it("forward chip through mention remove leaves commit spacer; next Delete clears it", () => {
      const wireStr = embeddedRowChipWire();
      const chipCaret = chipCaretWireInPrefixRow(wireStr);
      host.editor.setDocFromWire(wireStr, chipCaret, { resetHistory: true });
      expect(pressDelete(host.editor)).toBe(true);
      expect(pressDelete(host.editor)).toBe(true);
      expect(pressDelete(host.editor)).toBe(true);
      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`head\n\nte \nlower @${AGENT_A} `);
      const caretWire = docPosToWireOffset(
        host.editor.getDoc(),
        host.editor.getSelectionState().focus
      );
      expect(host.editor.getWire()[caretWire]).toBe(" ");
      expect(host.editor.getSelectionState().focusAffinity).toBe("before");
      expectCaretParity(host.editor, host.root, caretWire);
      expect(
        host.editor.getDoc().nodes[host.editor.getSelectionState().focus.nodeIndex]?.type
      ).toBe("text");
      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`head\n\nte\nlower @${AGENT_A} `);
    });
  });

  describe("glued postfix before mention — backspace at upper-band probe", () => {
    function sandwichedGluedWire() {
      return `note @${AGENT_A}T\n\n\nmiddle`;
    }

    it("control — trailing band only collapses blank at probe without chipping postfix", () => {
      const wire = `note @${AGENT_A}T\n\n\n`;
      host.editor.setDocFromWire(wire, listEmbeddedBlankBandProbeWires(wireToDoc(wire))[0]!, {
        resetHistory: true,
      });
      expect(pressBackspace(host.editor)).toBe(true);
      // Blank-row unit: probe owns the blank; chip glued postfix from content caret only.
      expect(host.editor.getWire()).toBe(`note @${AGENT_A}T\n\n`);
      expect(host.editor.getWire()).toContain("T");
    });

    it("sandwiched row — backspace at probe collapses blank not glued postfix chip", () => {
      const wire = sandwichedGluedWire();
      const probe = listEmbeddedBlankBandProbeWires(wireToDoc(wire))[0]!;
      host.editor.setDocFromWire(wire, probe, { resetHistory: true });
      expect(pressBackspace(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`note @${AGENT_A}T\n\nmiddle`);
      expect(host.editor.getWire()).toContain("T");
      expect(host.editor.getWire()).toContain("middle");
    });
  });

  describe("trailing-only blank collapse — CRE after remount", () => {
    it("keydown: first collapse under content remounts after; next chips", () => {
      host.editor.setDocFromWire("\n\ndna\n\n");
      const doc = host.editor.getDoc();
      const head = listEmbeddedBlankBandProbeWires(doc).find((w) => w > 4)!;
      host.editor.applyDoc(doc, collapsedSelection(wireOffsetToDocPos(doc, head)));

      expect(pressBackspace(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe("\n\ndna\n");
      expect(host.editor.getWire()[host.editor.getCursor()]).toBe("a");
      expect(host.editor.getSelectionState().focusAffinity).toBe("after");

      expect(pressBackspace(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe("\n\ndn\n");
    });

    it("keydown: chip emptied lower row then collapse remounts after on upper", () => {
      host.editor.setDocFromWire("\n\ndna\nwet\n");
      const doc = host.editor.getDoc();
      const tWire = host.editor.getWire().lastIndexOf("t");
      host.editor.applyDoc(
        doc,
        collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, tWire), "content-row-end")
      );
      for (let i = 0; i < 3; i++) {
        expect(pressBackspace(host.editor)).toBe(true);
      }
      expect(host.editor.getWire()).toBe("\n\ndna\n\n");
      expect(pressBackspace(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe("\n\ndna\n");
      expect(host.editor.getWire()[host.editor.getCursor()]).toBe("a");
      expect(host.editor.getSelectionState().focusAffinity).toBe("after");
      expect(pressBackspace(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe("\n\ndn\n");
    });
  });

  describe("postfix chip before trailing blank band — DOM paint", () => {
    function prefixMentionPostfixBeforeBand(postfix = "x") {
      return `header @${AGENT_A} ${postfix}\n\n\n`;
    }

    it("last substantive char chip paints caret on spacer text not mention-edge", () => {
      const wire = prefixMentionPostfixBeforeBand();
      const doc = wireToDoc(wire);
      const [probe] = listEmbeddedBlankBandProbeWires(doc);
      const rowEnd = probe! - 1;

      // Chip requires established CRE (`after`); omit is on-char / unit-behind.
      host.editor.applyDoc(
        doc,
        collapsedSelectionWithIntent(doc, wireOffsetToDocPos(doc, rowEnd), "content-row-end")
      );
      expect(pressBackspace(host.editor)).toBe(true);

      expect(host.editor.getWire()).toBe(`header @${AGENT_A} \n\n\n`);
      const chippedDoc = host.editor.getDoc();
      const authorityWire = host.editor.getCursor();
      expect(describeHandoffNoteCursorContext(chippedDoc, authorityWire).kind).toBe(
        "mention-boundary"
      );
      expect(readDomWireCursor(host.root, chippedDoc)).toBe(authorityWire);
      expect(host.editor.getSelectionState().focusAffinity).toBe("after");

      const point = resolveDomPointAtDocPos(
        host.root,
        chippedDoc,
        wireOffsetToDocPos(chippedDoc, authorityWire),
        { focusAffinity: "after" }
      );
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(point?.node.textContent?.[0]).toBe(" ");
      // Sole spacer CRE paints text-tail; following break owns break paint.
      expect(point?.offset).toBe(1);
      const mentionEl = host.root.querySelector("[data-handoff-mention]");
      expect(mentionEl?.contains(point!.node) ?? false).toBe(false);
    });
  });

  describe("selection delete — doc end ingress", () => {
    function deleteSelectionViaBeforeInput(): void {
      host.editor.handleBeforeInput(
        new InputEvent("beforeinput", {
          inputType: "deleteContentBackward",
          bubbles: true,
          cancelable: true,
        })
      );
    }

    it("range ending on last wire char clears to empty doc", () => {
      const wire = "he\n\n\n";
      host.editor.setDocFromWire(wire, wire.length, { resetHistory: true });
      setSelectionAtWire(host.root, host.editor.getDoc(), 0, wire.length - 1);
      dispatchSelectionChange(host.root);
      deleteSelectionViaBeforeInput();
      expect(host.editor.getWire()).toBe("");
    });
  });
});
