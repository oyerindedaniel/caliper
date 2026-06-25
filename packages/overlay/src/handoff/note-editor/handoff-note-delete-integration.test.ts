/**
 * Delete / backspace integration — editor pipeline (beforeInput + keydown).
 * Core doc policy: handoff-note-doc-edits.test.ts
 * Overlay ingress: handoff-note-arrow-contract.md (blank-band delete)
 */
import { listEmbeddedBlankBandProbeWires, wireToDoc } from "@caliper/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandoffNoteEditor, type HandoffNoteEditor } from "./create-handoff-note-editor.js";
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
});
