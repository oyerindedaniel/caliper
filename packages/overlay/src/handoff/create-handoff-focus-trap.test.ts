import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { wireToDoc } from "@caliper/core";
import { wireHandoffFocusTrap, createHandoffFocusTrap } from "./create-handoff-focus-trap.js";
import {
  getHandoffNoteEditorTabStops,
  renderHandoffNoteDoc,
} from "./note-editor/handoff-note-dom.js";

describe("wireHandoffFocusTrap", () => {
  let panel: HTMLDivElement;
  let popover: HTMLDivElement;
  let editor: HTMLDivElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    panel = document.createElement("div");
    popover = document.createElement("div");
    editor = document.createElement("div");
    editor.contentEditable = "true";
    panel.append(editor, popover);
    document.body.append(panel);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    panel.remove();
  });

  it("cycles Tab across mention pills when the mention popover is closed", () => {
    const agent = "caliper-abc123";
    renderHandoffNoteDoc(editor, wireToDoc(`@${agent} mid @${agent}`), {
      colorByAgentId: new Map([[agent, "#f00"]]),
    });

    cleanup = wireHandoffFocusTrap({
      enabled: () => true,
      mentionOpen: () => false,
      panelRoot: () => panel,
      popoverRoot: () => popover,
      editorRoot: () => editor,
    });

    const tabStops = getHandoffNoteEditorTabStops(editor);
    expect(tabStops).toHaveLength(3);
    const firstPill = tabStops[1]!;
    const secondPill = tabStops[2]!;

    secondPill.focus();
    expect(document.activeElement).toBe(secondPill);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(firstPill);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(secondPill);
  });

  it("cycles Tab within popover options while the mention popover is open", () => {
    const first = document.createElement("button");
    first.type = "button";
    first.textContent = "one";
    const second = document.createElement("button");
    second.type = "button";
    second.textContent = "two";
    popover.replaceChildren(first, second);

    cleanup = wireHandoffFocusTrap({
      enabled: () => true,
      mentionOpen: () => true,
      panelRoot: () => panel,
      popoverRoot: () => popover,
      editorRoot: () => editor,
    });

    first.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(second);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(first);
  });

  it("wraps Tab from the last popover option to the first", () => {
    const first = document.createElement("button");
    first.type = "button";
    const second = document.createElement("button");
    second.type = "button";
    popover.replaceChildren(first, second);

    cleanup = wireHandoffFocusTrap({
      enabled: () => true,
      mentionOpen: () => true,
      panelRoot: () => panel,
      popoverRoot: () => popover,
      editorRoot: () => editor,
    });

    second.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(first);
  });
});

describe("createHandoffFocusTrap", () => {
  let panel: HTMLDivElement;
  let popover: HTMLDivElement;
  let editor: HTMLDivElement;
  let disposeRoot: (() => void) | undefined;

  beforeEach(() => {
    panel = document.createElement("div");
    popover = document.createElement("div");
    editor = document.createElement("div");
    editor.contentEditable = "true";
    const first = document.createElement("button");
    first.type = "button";
    const second = document.createElement("button");
    second.type = "button";
    popover.replaceChildren(first, second);
    panel.append(editor, popover);
    document.body.append(panel);
  });

  afterEach(() => {
    disposeRoot?.();
    disposeRoot = undefined;
    panel.remove();
  });

  it("wraps Tab from the last popover option after mentionOpen toggles on", () => {
    disposeRoot = createRoot((dispose) => {
      const [enabled, setEnabled] = createSignal(false);
      const [mentionOpen, setMentionOpen] = createSignal(false);

      createHandoffFocusTrap({
        enabled,
        mentionOpen,
        panelRoot: () => panel,
        popoverRoot: () => popover,
        editorRoot: () => editor,
      });

      setEnabled(true);
      setMentionOpen(true);
      return dispose;
    });

    const [first, second] = popover.querySelectorAll("button");
    second!.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(first);
  });
});
