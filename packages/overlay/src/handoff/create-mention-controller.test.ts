import type { HandoffRegistryItem } from "@caliper/core";
import {
  applyDocDelete,
  applyDocInsertText,
  applyDocLineBreak,
  docPosToWireOffset,
  docToWire,
  wireOffsetToCollapsedSelection,
  wireOffsetToDocPos,
  wireToDoc,
} from "@caliper/core";
import { describe, expect, it } from "vitest";
import {
  createMentionController,
  resolveActiveMentionReplaceEnd,
} from "./create-mention-controller.js";
import type { HandoffNoteEditorHost } from "./note-editor/create-handoff-note-editor.js";

const REGISTRY_ITEM = {
  agentId: "caliper-abc123",
  fingerprint: { selector: "caliper-abc123", tag: "button", timestamp: 0, text: "Submit" },
} as unknown as HandoffRegistryItem;

function embeddedBlankMentionQueryFixture() {
  const agentId = "caliper-aaaaaaa";
  const wire = `head \n\n\n\nbodyxx\n\n\n@@${agentId} `;
  const doc = wireToDoc(wire);
  const queryWire = wire.indexOf("@@");
  return { wire, doc, agentId, queryWire };
}

describe("resolveActiveMentionReplaceEnd", () => {
  it("consumes @ when the caret sits on the trigger", () => {
    const wire = "query @";
    const doc = wireToDoc(wire);
    const queryStart = wireOffsetToDocPos(doc, 6);
    const session = { open: true, queryStart, query: "" };
    const focus = wireOffsetToDocPos(doc, 6);
    expect(docPosToWireOffset(doc, resolveActiveMentionReplaceEnd(session, doc, focus))).toBe(7);
    expect(wire.slice(6, 7)).toBe("@");
  });

  it("consumes @query when the caret is after the filter", () => {
    const wire = "query @ab";
    const doc = wireToDoc(wire);
    const queryStart = wireOffsetToDocPos(doc, 6);
    const session = { open: true, queryStart, query: "ab" };
    const focus = wireOffsetToDocPos(doc, 9);
    expect(docPosToWireOffset(doc, resolveActiveMentionReplaceEnd(session, doc, focus))).toBe(9);
    expect(wire.slice(6, 9)).toBe("@ab");
  });

  it("extends through the query when the caret lagged behind anchor measurement", () => {
    const wire = "query @ab";
    const doc = wireToDoc(wire);
    const queryStart = wireOffsetToDocPos(doc, 6);
    const session = { open: true, queryStart, query: "ab" };
    const focus = wireOffsetToDocPos(doc, 6);
    expect(docPosToWireOffset(doc, resolveActiveMentionReplaceEnd(session, doc, focus))).toBe(9);
  });

  it("does not extend through a committed mention when selection jumped past the query", () => {
    const { wire, doc, queryWire } = embeddedBlankMentionQueryFixture();
    const queryStart = wireOffsetToDocPos(doc, queryWire);
    const session = { open: true, queryStart, query: "" };
    const staleFocus = wireOffsetToDocPos(doc, wire.length - 1);
    expect(docPosToWireOffset(doc, resolveActiveMentionReplaceEnd(session, doc, staleFocus))).toBe(
      queryWire + 1
    );
    expect(wire.slice(queryWire, queryWire + 1)).toBe("@");
  });

  it("returns focus when the session is closed", () => {
    const doc = wireToDoc("abcd");
    const focus = wireOffsetToDocPos(doc, 4);
    expect(
      resolveActiveMentionReplaceEnd({ open: false, queryStart: null, query: "" }, doc, focus)
    ).toEqual(focus);
  });
});

describe("createMentionController mention session", () => {
  function mockEditor(wire: string, cursor: number): HandoffNoteEditorHost {
    const doc = wireToDoc(wire);
    const selection = wireOffsetToCollapsedSelection(doc, cursor);
    return {
      getWire: () => wire,
      getCursor: () => cursor,
      getDoc: () => doc,
      getSelectionState: () => selection,
      insertMentionAtomAt: () => {},
      focus: () => {},
      getAnchorRectAtOffset: () => null,
    };
  }

  it("commits only the active @query when the live caret jumped on popover pick", () => {
    let inserted: { agentId: string; start: number; end: number } | undefined;
    const { wire, doc, queryWire } = embeddedBlankMentionQueryFixture();
    const selection = wireOffsetToCollapsedSelection(doc, wire.length - 1);
    const editor: HandoffNoteEditorHost = {
      getWire: () => wire,
      getCursor: () => wire.length - 1,
      getDoc: () => doc,
      getSelectionState: () => selection,
      insertMentionAtomAt: (agentId, start, end) => {
        inserted = {
          agentId,
          start: docPosToWireOffset(doc, start),
          end: docPosToWireOffset(doc, end),
        };
      },
      focus: () => {},
      getAnchorRectAtOffset: () => null,
    };

    const controller = createMentionController({
      getItems: () => [REGISTRY_ITEM],
      onNoteChange: () => {},
      onHighlight: () => {},
    });

    controller.handleInput(mockEditor(wire, queryWire + 1));
    expect(controller.isOpen()).toBe(true);

    controller.commitMention(editor, REGISTRY_ITEM.agentId);

    expect(inserted).toEqual({
      agentId: REGISTRY_ITEM.agentId,
      start: queryWire,
      end: queryWire + 1,
    });
  });

  it("does not reopen when typing after a committed mention", () => {
    const controller = createMentionController({
      getItems: () => [REGISTRY_ITEM],
      onNoteChange: () => {},
      onHighlight: () => {},
    });

    const wire = "note @caliper-abc123D ";
    controller.handleInput(mockEditor(wire, wire.length - 1));

    expect(controller.isOpen()).toBe(false);
  });

  it("closes mention session on Shift+Enter after @", () => {
    const controller = createMentionController({
      getItems: () => [REGISTRY_ITEM],
      onNoteChange: () => {},
      onHighlight: () => {},
    });

    const doc = wireToDoc("query @");
    const selection = wireOffsetToCollapsedSelection(doc, docToWire(doc).length);
    controller.handleInput({
      getWire: () => docToWire(doc),
      getCursor: () => docToWire(doc).length,
      getDoc: () => doc,
      getSelectionState: () => selection,
      insertMentionAtomAt: () => {},
      focus: () => {},
      getAnchorRectAtOffset: () => null,
    });
    expect(controller.isOpen()).toBe(true);

    const state = applyDocLineBreak(doc, selection);
    controller.handleInput({
      getWire: () => docToWire(state.doc),
      getCursor: () => docToWire(state.doc).length,
      getDoc: () => state.doc,
      getSelectionState: () => state.selection,
      insertMentionAtomAt: () => {},
      focus: () => {},
      getAnchorRectAtOffset: () => null,
    });

    expect(controller.isOpen()).toBe(false);
  });

  it("reopens mention session when filter typing resumes after blank lines", () => {
    const controller = createMentionController({
      getItems: () => [REGISTRY_ITEM],
      onNoteChange: () => {},
      onHighlight: () => {},
    });

    let doc = wireToDoc("note @");
    let selection = wireOffsetToCollapsedSelection(doc, docToWire(doc).length);
    let state = applyDocLineBreak(doc, selection);
    for (let i = 0; i < 3; i++) {
      state = applyDocLineBreak(state.doc, state.selection);
    }
    for (let i = 0; i < 3; i++) {
      state = applyDocDelete(state.doc, state.selection, "backspace")!;
    }

    controller.handleInput({
      getWire: () => docToWire(state.doc),
      getCursor: () => docToWire(state.doc).length,
      getDoc: () => state.doc,
      getSelectionState: () => state.selection,
      insertMentionAtomAt: () => {},
      focus: () => {},
      getAnchorRectAtOffset: () => null,
    });
    expect(controller.isOpen()).toBe(false);

    state = applyDocInsertText(state.doc, state.selection, "d");
    controller.handleInput({
      getWire: () => docToWire(state.doc),
      getCursor: () => docToWire(state.doc).length,
      getDoc: () => state.doc,
      getSelectionState: () => state.selection,
      insertMentionAtomAt: () => {},
      focus: () => {},
      getAnchorRectAtOffset: () => null,
    });

    expect(controller.isOpen()).toBe(true);
    expect(controller.getSession().query).toBe("d");
  });

  it("reopens with extended query after a repeat multiline cycle", () => {
    const controller = createMentionController({
      getItems: () => [REGISTRY_ITEM],
      onNoteChange: () => {},
      onHighlight: () => {},
    });

    let doc = wireToDoc("query @f\n");
    const selection = wireOffsetToCollapsedSelection(doc, docToWire(doc).length);
    expect(controller.isOpen()).toBe(false);

    const state = applyDocInsertText(doc, selection, "e");
    controller.handleInput({
      getWire: () => docToWire(state.doc),
      getCursor: () => docToWire(state.doc).length,
      getDoc: () => state.doc,
      getSelectionState: () => state.selection,
      insertMentionAtomAt: () => {},
      focus: () => {},
      getAnchorRectAtOffset: () => null,
    });

    expect(controller.isOpen()).toBe(true);
    expect(controller.getSession().query).toBe("fe");
  });
});

describe("mention list keyboard ownership", () => {
  function mockEditor(wire: string, cursor: number): HandoffNoteEditorHost {
    const doc = wireToDoc(wire);
    const selection = wireOffsetToCollapsedSelection(doc, cursor);
    return {
      getWire: () => wire,
      getCursor: () => cursor,
      getDoc: () => doc,
      getSelectionState: () => selection,
      insertMentionAtomAt: () => {},
      focus: () => {},
      getAnchorRectAtOffset: () => null,
    };
  }

  function keydown(key: string): KeyboardEvent {
    return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  }

  it("captures arrow keys when the filtered list has items", () => {
    const wire = "note @";
    const controller = createMentionController({
      getItems: () => [REGISTRY_ITEM],
      onNoteChange: () => {},
      onHighlight: () => {},
    });
    controller.handleInput(mockEditor(wire, wire.length));

    const event = keydown("ArrowDown");
    expect(controller.handleKeyDown(mockEditor(wire, wire.length), event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("releases arrow keys and closes the session when the filtered list is empty", () => {
    const wire = "note @zzznomatch";
    const controller = createMentionController({
      getItems: () => [REGISTRY_ITEM],
      onNoteChange: () => {},
      onHighlight: () => {},
    });
    controller.handleInput(mockEditor(wire, wire.length));
    expect(controller.getFilteredItems()).toHaveLength(0);
    expect(controller.isOpen()).toBe(true);

    const up = keydown("ArrowUp");
    expect(controller.handleKeyDown(mockEditor(wire, wire.length), up)).toBe(false);
    expect(up.defaultPrevented).toBe(false);
    expect(controller.isOpen()).toBe(false);
  });
});
