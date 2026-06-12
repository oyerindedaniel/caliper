import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { HandoffNoteEditor as HandoffNoteEditorApi } from "./create-handoff-note-editor.js";
import { HandoffNoteEditor } from "./handoff-note-editor.jsx";
import { setSelectionAtWire } from "./handoff-note-test-helpers.js";

describe("HandoffNoteEditor", () => {
  afterEach(() => {
    cleanup();
    document.body.textContent = "";
  });

  it("keeps caret after shift-enter beside a mention when parent re-renders on wire change", () => {
    const agentId = "caliper-dccgrev90";
    const [wire, setWire] = createSignal(`dhdhdh @${agentId}`);
    const [noteRevision, setNoteRevision] = createSignal(0);
    let editor: HandoffNoteEditorApi | undefined;

    const pendingNote = () => {
      noteRevision();
      return wire();
    };

    render(() => (
      <HandoffNoteEditor
        wire={pendingNote}
        colorByAgentId={() => new Map([[agentId, "#f00"]])}
        highlightedAgentId={() => null}
        onWireChange={(nextWire) => {
          setWire(nextWire);
          setNoteRevision((revision) => revision + 1);
        }}
        onResize={() => {
          noteRevision();
        }}
        onEditorReady={(ready) => {
          editor = ready;
        }}
      />
    ));

    editor!.setDocFromWire(`dhdhdh @${agentId}`, 7);
    setSelectionAtWire(editor!.getRoot()!, editor!.getDoc(), 7, 7);
    expect(editor!.getCursor()).toBe(7);

    const lineBreak = () =>
      new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        bubbles: true,
        cancelable: true,
      });

    editor!.handleBeforeInput(lineBreak());
    expect(editor!.getWire()).toBe(`dhdhdh \n@${agentId}`);
    expect(editor!.getCursor()).toBe(6);

    editor!.handleBeforeInput(lineBreak());
    expect(editor!.getWire()).toBe(`dhdhdh \n\n@${agentId}`);
    expect(editor!.getCursor()).toBe(9);
  });

  it("does not re-sync caret when prop wire echoes editor output", () => {
    const [wire, setWire] = createSignal("");
    let editor: HandoffNoteEditorApi | undefined;

    render(() => (
      <HandoffNoteEditor
        wire={wire}
        colorByAgentId={() => new Map()}
        onWireChange={(nextWire) => setWire(nextWire)}
        onEditorReady={(ready) => {
          editor = ready;
        }}
      />
    ));

    editor!.setDocFromWire("hello", 3);
    expect(wire()).toBe("hello");
    expect(editor!.getCursor()).toBe(3);
  });
});
