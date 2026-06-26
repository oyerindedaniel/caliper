/**
 * Delete / backspace integration — editor pipeline (beforeInput + keydown).
 * Core doc policy: handoff-note-doc-edits.test.ts
 * Overlay ingress: handoff-note-arrow-contract.md (blank-band delete)
 */
import {
  describeHandoffNoteCursorContext,
  listEmbeddedBlankBandProbeWires,
  wireOffsetToDocPos,
  wireToDoc,
} from "@caliper/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandoffNoteEditor, type HandoffNoteEditor } from "./create-handoff-note-editor.js";
import { resolveDomPointAtDocPos } from "./handoff-note-dom-points.js";
import { invalidateHandoffNoteLayoutCache } from "./handoff-note-layout-map.js";
import {
  dispatchSelectionChange,
  readDomWireCursor,
  setDomCaretAtTextStart,
} from "./handoff-note-test-helpers.js";

const AGENT_A = "caliper-abc123";

function mountEditorHost() {
  const root = document.createElement("div");
  root.style.width = "480px";
  document.body.appendChild(root);
  Object.defineProperty(root, "clientWidth", { configurable: true, value: 480 });
  const colorByAgentId = new Map([[AGENT_A, "#06f"]]);
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
  expect(readDomWireCursor(root, editor.getDoc())).toBe(wire);
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
    it("forward delete — each nip lands on band head with DOM parity", () => {
      const tail = "tail";
      host.editor.setDocFromWire(`h\n\n\n${tail}`, 0, { resetHistory: true });
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
      host.editor.setDocFromWire(`h\n\n\n${tail}`, 0, { resetHistory: true });
      expect(pressDelete(host.editor)).toBe(true);

      for (const expectedWire of [`\n\n${tail}`, `\n${tail}`, tail]) {
        expect(pressBackspace(host.editor)).toBe(true);
        expect(host.editor.getWire()).toBe(expectedWire);
        expectCaretParity(host.editor, host.root, 0);
      }
    });

    it("delete at last probe when another blank remains lands at band head", () => {
      const tail = "tail";
      const wire = `\n\n\n${tail}`;
      const probes = listEmbeddedBlankBandProbeWires(wireToDoc(wire));
      host.editor.setDocFromWire(wire, probes[1]!, { resetHistory: true });

      expect(pressDelete(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`\n\n${tail}`);
      expectCaretParity(host.editor, host.root, 0);
    });
  });

  describe("prefix before mention — row clear and chipBeforeBlankBand", () => {
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

  describe("glued postfix before mention — backspace at upper-band probe", () => {
    function sandwichedGluedWire() {
      return `note @${AGENT_A}T\n\n\nmiddle`;
    }

    it("control — trailing band only chips postfix at probe", () => {
      const wire = `note @${AGENT_A}T\n\n\n`;
      host.editor.setDocFromWire(wire, listEmbeddedBlankBandProbeWires(wireToDoc(wire))[0]!, {
        resetHistory: true,
      });
      expect(pressBackspace(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`note @${AGENT_A}\n\n\n`);
    });

    it("sandwiched row — backspace at probe chips postfix not blank collapse", () => {
      const wire = sandwichedGluedWire();
      const probe = listEmbeddedBlankBandProbeWires(wireToDoc(wire))[0]!;
      host.editor.setDocFromWire(wire, probe, { resetHistory: true });
      expect(pressBackspace(host.editor)).toBe(true);
      expect(host.editor.getWire()).toBe(`note @${AGENT_A}\n\n\nmiddle`);
      expect(host.editor.getWire()).toContain("middle");
    });
  });

  describe("postfix chip before trailing blank band — DOM paint", () => {
    function prefixMentionPostfixBeforeBand(postfix = "x") {
      return `header @${AGENT_A} ${postfix}\n\n\n`;
    }

    it("last substantive char chip paints caret after spacer not mention-edge", () => {
      const wire = prefixMentionPostfixBeforeBand();
      const doc = wireToDoc(wire);
      const [probe] = listEmbeddedBlankBandProbeWires(doc);
      const rowEnd = probe! - 1;

      host.editor.setDocFromWire(wire, rowEnd, { resetHistory: true });
      expect(pressBackspace(host.editor)).toBe(true);

      expect(host.editor.getWire()).toBe(`header @${AGENT_A} \n\n\n`);
      const chippedDoc = host.editor.getDoc();
      const authorityWire = host.editor.getCursor();
      expect(describeHandoffNoteCursorContext(chippedDoc, authorityWire).kind).toBe(
        "mention-boundary"
      );
      expect(readDomWireCursor(host.root, chippedDoc)).toBe(authorityWire);

      const point = resolveDomPointAtDocPos(
        host.root,
        chippedDoc,
        wireOffsetToDocPos(chippedDoc, authorityWire)
      );
      expect(point?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(point?.offset).toBeGreaterThan(0);
    });
  });
});
