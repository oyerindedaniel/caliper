import { wireOffsetToDocPos } from "@caliper/core";
import { describe, expect, it, beforeEach } from "vitest";
import { createHandoffNoteEditor } from "./create-handoff-note-editor.js";
import {
  dispatchSelectionChange,
  selectionAtWire,
  setSelectionAtWire,
} from "./handoff-note-test-helpers.js";

function mountEditorHost() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const changes: string[] = [];
  const editor = createHandoffNoteEditor({
    getColorByAgentId: () => new Map([["caliper-abc123", "#f00"]]),
    onWireChange: (wire) => changes.push(wire),
  });
  editor.setRoot(root);
  return { root, editor, changes };
}

describe("createHandoffNoteEditor", () => {
  let host: ReturnType<typeof mountEditorHost>;

  beforeEach(() => {
    host = mountEditorHost();
  });

  it("loads wire and emits on user edits", () => {
    host.editor.setDocFromWire("hello", 5);
    expect(host.changes).toEqual(["hello"]);
    host.editor.insertDocText("!");
    expect(host.editor.getWire()).toBe("hello!");
    expect(host.changes).toEqual(["hello", "hello!"]);
  });

  it("applies mention backspace on a mention", () => {
    host.editor.setDocFromWire("Hi @caliper-abc123 there", "Hi @caliper-abc123 there".length);
    const mentionEnd = "Hi @caliper-abc123".length;
    host.editor.applyDoc(host.editor.getDoc(), selectionAtWire(host.editor.getDoc(), mentionEnd));

    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
    const handled = host.editor.handleKeyDown(event);
    expect(handled).toBe(true);
    expect(host.editor.getWire()).toBe("Hi  there");
  });

  it("jumps over a mention with arrow keys from its start", () => {
    const mentionStart = "Hi ".length;
    const mentionEnd = mentionStart + "@caliper-abc123".length;
    host.editor.setDocFromWire("Hi @caliper-abc123 there", mentionStart);

    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true });
    expect(host.editor.handleKeyDown(event)).toBe(true);
    expect(host.editor.getCursor()).toBe(mentionEnd);
  });

  it("does not re-import wire when parent echoes the same doc and selection", () => {
    host.editor.setDocFromWire("hello", 3, { resetHistory: true });
    const renderCountBefore = host.root.querySelectorAll("*").length;
    host.editor.setDocFromWire("hello", 3);
    expect(host.editor.getWire()).toBe("hello");
    expect(host.editor.getCursor()).toBe(3);
    expect(host.root.querySelectorAll("*").length).toBe(renderCountBefore);
  });

  it("undoes and redoes a typed edit", () => {
    host.editor.setDocFromWire("", 0, { resetHistory: true });
    host.editor.insertDocText("hi");
    expect(host.editor.getWire()).toBe("hi");
    expect(host.editor.undo()).toBe(true);
    expect(host.editor.getWire()).toBe("");
    expect(host.editor.redo()).toBe(true);
    expect(host.editor.getWire()).toBe("hi");
  });

  it("collapses doubled mention clipboard on paste", () => {
    const agentA = "caliper-nfyjfcdjk";
    const agentB = "caliper-81nzvlqbv";
    host.editor.setDocFromWire("", 0, { resetHistory: true });
    host.editor.insertDocText(`@${agentA} @${agentB} ${agentA} ${agentB} `);
    expect(host.editor.getWire()).toBe(`@${agentA} @${agentB}`);
    expect(host.editor.getWire()).not.toContain(`${agentA} ${agentB}`);
  });

  it("undoes and redoes a paste with mention tokens", () => {
    const wire = "@caliper-abc123 ";
    host.editor.setDocFromWire("", 0, { resetHistory: true });
    host.editor.insertDocText(wire);
    expect(host.editor.getWire()).toBe(wire);
    expect(host.editor.undo()).toBe(true);
    expect(host.editor.getWire()).toBe("");
    expect(host.editor.redo()).toBe(true);
    expect(host.editor.getWire()).toBe(wire);
  });

  it("inserts a second mention after text following a committed tag", () => {
    const agentId = "caliper-zn4u0ymbt";
    const nextDoc = {
      nodes: [
        { type: "text" as const, text: "dhhd " },
        { type: "mention" as const, agentId },
        { type: "text" as const, text: "dhhdh @ " },
      ],
    };
    host.editor.applyDoc(nextDoc, selectionAtWire(nextDoc, `dhhd @${agentId}dhhdh @ `.length));

    const liveDoc = host.editor.getDoc();
    const atOffset = host.editor.getWire().lastIndexOf("@");
    host.editor.insertMentionAtomAt(
      agentId,
      wireOffsetToDocPos(liveDoc, atOffset),
      wireOffsetToDocPos(liveDoc, atOffset + 1)
    );

    expect(host.editor.getDoc().nodes).toEqual([
      { type: "text", text: "dhhd " },
      { type: "mention", agentId },
      { type: "text", text: "dhhdh " },
      { type: "mention", agentId },
      { type: "text", text: " " },
    ]);
    expect(host.editor.getWire()).toBe(`dhhd @${agentId}dhhdh @${agentId} `);
  });

  it("inserts a mention atom when the caret is on @", () => {
    const prefix = "dhhdd @";
    host.editor.setDocFromWire(prefix, prefix.length - 1, { resetHistory: true });
    expect(host.editor.getCursor()).toBe(prefix.length - 1);

    const doc = host.editor.getDoc();
    host.editor.insertMentionAtomAt(
      "caliper-qbd2kuqrg",
      wireOffsetToDocPos(doc, 6),
      wireOffsetToDocPos(doc, 7)
    );

    expect(host.editor.getWire()).toBe("dhhdd @caliper-qbd2kuqrg ");
    expect(host.editor.getWire()).not.toMatch(/@\s+@/);
  });

  it("arrow up moves from a later line pill start to the previous line pill start", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `dhhdhd @${agentA} \n@${agentA} @${agentB} \n@${agentA} `;
    const line3Mention = wire.lastIndexOf("@");
    const line2Mention = wire.indexOf("@", wire.indexOf("\n") + 1);

    host.editor.setDocFromWire(wire, line3Mention, { resetHistory: true });
    const handled = host.editor.handleKeyDown(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })
    );
    expect(handled).toBe(true);
    expect(host.editor.getCursor()).toBe(line2Mention);
  });

  it("types on a blank line after arrow down without corrupting a mention below", () => {
    const agent = "caliper-qyuw2w0jq";
    const wire = `djd @${agent} d@${agent} ddjjdggdg\n\n\n @${agent} @${agent} `;
    const typingInText = wire.indexOf("ddjjdggdg") + 4;
    host.editor.setDocFromWire(wire, typingInText, { resetHistory: true });

    expect(
      host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
      )
    ).toBe(true);
    host.editor.insertDocText("d");

    expect(host.editor.getWire()).toMatch(new RegExp(`\\n @${agent} @${agent} $`));
    expect(host.editor.getWire()).not.toMatch(new RegExp(` d@${agent} @${agent}`));
  });

  it("arrow up steps through shift-enter blank lines before reaching text above", () => {
    const wire = "dggdg\n\n\n tail";
    const firstBlankLine = "dggdg\n".length;
    const lineEndAboveBlanks = "dggdg".length;
    host.editor.setDocFromWire(wire, firstBlankLine, { resetHistory: true });

    expect(
      host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })
      )
    ).toBe(true);
    expect(host.editor.getCursor()).toBe(lineEndAboveBlanks);
    expect(host.editor.getCursor()).not.toBe(0);
  });

  it("arrow down from a pill row line start enters the row instead of jumping to blanks below", () => {
    const agent = "caliper-jli3vwpry";
    const wire = `dhhd @${agent} \n\n\n\n\n@${agent} @${agent} \n\n\nddnnd`;
    const pillRowSuffix = `@${agent} @${agent} `;
    const pillRowStart = wire.indexOf(pillRowSuffix);
    const firstBlankBelowPillRow = wire.indexOf(pillRowSuffix) + pillRowSuffix.length + 1;
    const firstMentionEnd = pillRowStart + `@${agent}`.length;

    host.editor.setDocFromWire(wire, pillRowStart, { resetHistory: true });
    expect(
      host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
      )
    ).toBe(true);
    expect(host.editor.getCursor()).toBe(firstMentionEnd);
    expect(host.editor.getCursor()).not.toBe(firstBlankBelowPillRow);
  });

  it("arrow up from a newline ending a pill row steps back instead of jumping to a distant blank", () => {
    const agent = "caliper-jli3vwpry";
    const wire = `dhhd @${agent} \n\n\n\n\n@${agent} @${agent} \n\n\nddnnd`;
    const pillRowSuffix = `@${agent} @${agent} `;
    const pillRowEndingNewline = wire.indexOf(pillRowSuffix) + pillRowSuffix.length;
    const distantBlankBlock = wire.indexOf("\n\n\n\n\n") + 4;

    host.editor.setDocFromWire(wire, pillRowEndingNewline, { resetHistory: true });
    expect(
      host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })
      )
    ).toBe(true);
    expect(host.editor.getCursor()).toBe(pillRowEndingNewline - 1);
    expect(host.editor.getCursor()).not.toBe(distantBlankBlock);
  });

  it("arrow down moves from a line pill start to the next line pill start", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `dhhdhd @${agentA} \n@${agentA} @${agentB} \n@${agentA} `;
    const line2Mention = wire.indexOf("@", wire.indexOf("\n") + 1);
    const line3Mention = wire.lastIndexOf("@");

    host.editor.setDocFromWire(wire, line2Mention, { resetHistory: true });
    const handled = host.editor.handleKeyDown(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
    );
    expect(handled).toBe(true);
    expect(host.editor.getCursor()).toBe(line3Mention);
  });

  it("forward delete in an inter-mention gap changes wire via keydown", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `@${agentA} @${agentB} `;
    const gapWire = wire.indexOf(` @${agentB}`);

    host.editor.setDocFromWire(wire, gapWire, { resetHistory: true });
    expect(host.editor.getWire()).toBe(wire);

    const handled = host.editor.handleKeyDown(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
    );
    expect(handled).toBe(true);
    expect(host.editor.getWire()).toBe(`@${agentA}@${agentB} `);

    const second = host.editor.handleKeyDown(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
    );
    expect(second).toBe(false);
    expect(host.editor.getWire()).toBe(`@${agentA}@${agentB} `);
  });

  it("undoes mention deletion", () => {
    const wire = "Hi @caliper-abc123 there";
    host.editor.setDocFromWire(wire, wire.length, { resetHistory: true });
    const mentionEnd = "Hi @caliper-abc123".length;
    host.editor.applyDoc(host.editor.getDoc(), selectionAtWire(host.editor.getDoc(), mentionEnd));

    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
    expect(host.editor.handleKeyDown(event)).toBe(true);
    expect(host.editor.getWire()).toBe("Hi  there");

    expect(host.editor.undo()).toBe(true);
    expect(host.editor.getWire()).toBe(wire);
  });

  it("does not emit wire when presentation is refreshed only", () => {
    host.editor.setDocFromWire("@caliper-abc123", 0);
    host.changes.length = 0;
    host.editor.refreshPresentation();
    expect(host.changes).toEqual([]);
  });

  it("refreshPresentation preserves live caret", () => {
    const wire = "DHDHD @";
    host.editor.setDocFromWire(wire, wire.length);
    host.editor.refreshPresentation();
    expect(host.editor.getCursor()).toBe(wire.length);
  });

  it("doc-first insert does not let refreshPresentation steal caret after @", () => {
    let innerEditor!: ReturnType<typeof createHandoffNoteEditor>;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createHandoffNoteEditor({
      getColorByAgentId: () => new Map(),
      getHighlightedAgentId: () => "caliper-highlight",
      onWireChange: () => {
        innerEditor.refreshPresentation();
      },
    });
    innerEditor = editor;
    editor.setRoot(root);
    editor.setDocFromWire("DHDHD ", 6, { resetHistory: true });

    editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "@",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(editor.getWire()).toBe("DHDHD @");
    expect(editor.getCursor()).toBe(7);
  });

  it("resizes the editor host when beforeInput applies a doc insert without an input event", () => {
    const wire = "dd @caliper-abc123 ";
    const mentionStart = "dd ".length;
    host.editor.setDocFromWire(wire, mentionStart);
    host.root.style.height = "20px";
    Object.defineProperty(host.root, "scrollHeight", { get: () => 48, configurable: true });

    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(host.editor.getWire()).toBe("dd \n@caliper-abc123 ");
    expect(host.root.style.height).toBe("48px");
  });

  it("inserts text at mention start via doc model when the browser would enter the pill", () => {
    const agentId = "caliper-rrrhd9muz";
    const multilineWire = `DHD \n\n\n\n@${agentId} `;
    const mentionStart = multilineWire.indexOf("@");

    host.editor.setDocFromWire(multilineWire, mentionStart);
    expect(host.editor.getCursor()).toBe(mentionStart);

    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "D",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(host.editor.getWire()).toBe(`DHD \n\n\n\nD@${agentId} `);
    expect(host.editor.getCursor()).toBe(mentionStart + 1);

    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "y",
        bubbles: true,
        cancelable: true,
      })
    );
    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "y",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(host.editor.getWire()).toBe(`DHD \n\n\n\nDyy@${agentId} `);
    expect(host.editor.getCursor()).toBe(mentionStart + 3);
  });

  it("inserts plain text via beforeInput without DOM reconciliation", () => {
    host.editor.setDocFromWire("hello", 5, { resetHistory: true });
    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "!",
        bubbles: true,
        cancelable: true,
      })
    );
    expect(host.editor.getWire()).toBe("hello!");
    expect(host.editor.getCursor()).toBe(6);
  });

  it("advances caret when line breaking before a later atomic mention", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `ab @${agentA} @${agentB} tail`;
    host.editor.applyDoc(
      {
        nodes: [
          { type: "text", text: "ab " },
          { type: "mention", agentId: agentA },
          { type: "text", text: " " },
          { type: "mention", agentId: agentB },
          { type: "text", text: " tail" },
        ],
      },
      selectionAtWire(
        {
          nodes: [
            { type: "text", text: "ab " },
            { type: "mention", agentId: agentA },
            { type: "text", text: " " },
            { type: "mention", agentId: agentB },
            { type: "text", text: " tail" },
          ],
        },
        wire.length
      )
    );

    const mentionStart = host.editor.getWire().lastIndexOf("@");
    setSelectionAtWire(host.root, host.editor.getDoc(), mentionStart);
    dispatchSelectionChange(host.root);
    const caretBefore = host.editor.getSelectionState().focus;

    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(host.editor.getWire()).toBe(`ab @${agentA} \n@${agentB} tail`);
    expect(host.editor.getSelectionState().focus).not.toEqual(caretBefore);
    expect(host.editor.getDoc().nodes[host.editor.getSelectionState().focus.nodeIndex]?.type).toBe(
      "text"
    );
    expect(host.editor.getCursor()).not.toBe(mentionStart);
    expect(host.editor.getCursor()).toBeGreaterThan(mentionStart);
  });

  it("appends text in the text node after line breaks before a later mention", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `ab @${agentA} @${agentB} tail`;
    const docShape = {
      nodes: [
        { type: "text" as const, text: "ab " },
        { type: "mention" as const, agentId: agentA },
        { type: "text" as const, text: " " },
        { type: "mention" as const, agentId: agentB },
        { type: "text" as const, text: " tail" },
      ],
    };

    host.editor.applyDoc(docShape, selectionAtWire(docShape, wire.length));

    const mentionStart = host.editor.getWire().lastIndexOf("@");
    setSelectionAtWire(host.root, host.editor.getDoc(), mentionStart);
    dispatchSelectionChange(host.root);

    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        bubbles: true,
        cancelable: true,
      })
    );
    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        bubbles: true,
        cancelable: true,
      })
    );
    const caretBefore = host.editor.getSelectionState().focus;

    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "d",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(host.editor.getWire()).toBe(`ab @${agentA} \n\nd@${agentB} tail`);
    expect(host.editor.getSelectionState().focus.nodeIndex).toBe(caretBefore.nodeIndex);
    expect(host.editor.getDoc().nodes[host.editor.getSelectionState().focus.nodeIndex]?.type).toBe(
      "text"
    );
  });

  it("applies the next edit at editor authority when DOM selection regressed earlier", () => {
    const agentId = "caliper-abc123";
    const doc = {
      nodes: [
        { type: "text" as const, text: "ab " },
        { type: "mention" as const, agentId },
        { type: "text" as const, text: " cd" },
      ],
    };
    const wire = "ab @caliper-abc123 cd";
    host.editor.applyDoc(doc, selectionAtWire(doc, wire.length));

    setSelectionAtWire(host.root, host.editor.getDoc(), "ab ".length);
    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "x",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(host.editor.getWire()).toBe("ab @caliper-abc123 cdx");
    expect(host.editor.getCursor()).toBe("ab @caliper-abc123 cdx".length);
  });

  it("inserts second mention after multiline via doc model", () => {
    const agentA = "caliper-roly0omlb";
    const agentB = "caliper-trzuwweoc";
    const prefix = `hhh \n\n\n\n`;
    const nextDoc = {
      nodes: [
        { type: "text" as const, text: `${prefix}@` },
        { type: "mention" as const, agentId: agentA },
        { type: "text" as const, text: " " },
      ],
    };
    host.editor.applyDoc(nextDoc, selectionAtWire(nextDoc, prefix.length + 1));

    const liveDoc = host.editor.getDoc();
    const queryStart = wireOffsetToDocPos(liveDoc, prefix.length);
    host.editor.insertMentionAtomAt(
      agentB,
      queryStart,
      wireOffsetToDocPos(liveDoc, prefix.length + 1)
    );

    expect(host.editor.getWire()).toBe(`${prefix}@${agentB} @${agentA} `);
    expect(host.editor.getDoc().nodes.filter((node) => node.type === "mention")).toHaveLength(2);
  });

  it("steps left from a mention after multiline newlines and repairs a pill-stranded caret", () => {
    const agentId = "caliper-ia61v9wf0";
    const multilineWire = `hhshhs \n\n\n\n\n@${agentId} `;
    const mentionStart = multilineWire.indexOf("@");

    host.editor.setDocFromWire(multilineWire, mentionStart);
    expect(
      host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })
      )
    ).toBe(true);
    expect(host.editor.getCursor()).toBe(mentionStart - 1);

    const pill = host.root.querySelector("span[data-handoff-mention]")!;
    const pillText = pill.firstChild as Text;
    const selection = host.root.ownerDocument.getSelection()!;
    const range = host.root.ownerDocument.createRange();
    range.setStart(pillText, 3);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    host.editor.handleInput();
    expect(host.editor.getCursor()).toBe(mentionStart - 1);

    const prefixEnd = "hhshhs ".length - 1;
    setSelectionAtWire(host.root, host.editor.getDoc(), prefixEnd, prefixEnd);
    host.editor.insertDocText("x");
    expect(host.editor.getWire()).toBe(`hhshhsx \n\n\n\n\n@${agentId} `);
    expect(host.editor.getCursor()).toBe(prefixEnd + 1);
  });
});
