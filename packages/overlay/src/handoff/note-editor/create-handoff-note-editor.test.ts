import {
  collapsedSelection,
  describeHandoffNoteCursorContext,
  isEmbeddedBlankBandDeleteProbeWire,
  listEmbeddedBlankBandProbeWires,
  wireOffsetToDocPos,
  wireToDoc,
} from "@caliper/core";
import { describe, expect, it, beforeEach } from "vitest";
import { createHandoffNoteEditor } from "./create-handoff-note-editor.js";
import { handoffNoteSelectionSnapshot } from "../handoff-note-debug.js";
import { readMentionNodeIndex } from "./handoff-note-dom.js";
import {
  dispatchSelectionChange,
  readDomWireCursor,
  selectionAtWire,
  setSelectionAtWire,
  strandSelectionInMentionPill,
} from "./handoff-note-test-helpers.js";

function mountEditorHost() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const changes: string[] = [];
  const editor = createHandoffNoteEditor({
    getColorByAgentId: () =>
      new Map([
        ["caliper-abc123", "#f00"],
        ["caliper-aaaaaaa", "#f00"],
      ]),
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
    const agentId = "caliper-abc123";
    host.editor.setDocFromWire(`Hi @${agentId} there`, `Hi @${agentId} there`.length);
    const doc = host.editor.getDoc();
    const mentionIndex = doc.nodes.findIndex((node) => node.type === "mention");
    host.editor.applyDoc(
      doc,
      collapsedSelection({ nodeIndex: mentionIndex, nodeOffset: 1 + agentId.length })
    );

    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
    const handled = host.editor.handleKeyDown(event);
    expect(handled).toBe(true);
    expect(host.editor.getWire()).toBe("Hi  there");
  });

  it("keydown backspace on trailing spacer after mention paints caret outside pill", () => {
    const agentId = "caliper-abc123";
    const wire = `header @${agentId} `;
    host.editor.setDocFromWire(wire, wire.length);
    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
    expect(host.editor.handleKeyDown(event)).toBe(true);
    expect(host.editor.getWire()).toBe(`header @${agentId}`);
    expect(handoffNoteSelectionSnapshot(host.root).anchorInMentionPill).toBe(false);
    expect(
      describeHandoffNoteCursorContext(host.editor.getDoc(), host.editor.getCursor()).kind
    ).toBe("mention-boundary");
  });

  it("keydown delete before mention paints caret outside pill", () => {
    const agentId = "caliper-abc123";
    const wire = `header @${agentId} tail`;
    const atHeaderEnd = "header ".length;
    host.editor.setDocFromWire(wire, atHeaderEnd);
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true });
    expect(host.editor.handleKeyDown(event)).toBe(true);
    expect(handoffNoteSelectionSnapshot(host.root).anchorInMentionPill).toBe(false);
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
    const agentId = "caliper-aaaaaaa";
    const nextDoc = {
      nodes: [
        { type: "text" as const, text: "pre1 " },
        { type: "mention" as const, agentId },
        { type: "text" as const, text: "pre2 @ " },
      ],
    };
    host.editor.applyDoc(nextDoc, selectionAtWire(nextDoc, `pre1 @${agentId}pre2 @ `.length));

    const liveDoc = host.editor.getDoc();
    const atOffset = host.editor.getWire().lastIndexOf("@");
    host.editor.insertMentionAtomAt(
      agentId,
      wireOffsetToDocPos(liveDoc, atOffset),
      wireOffsetToDocPos(liveDoc, atOffset + 1)
    );

    expect(host.editor.getDoc().nodes).toEqual([
      { type: "text", text: "pre1 " },
      { type: "mention", agentId },
      { type: "text", text: "pre2 " },
      { type: "mention", agentId },
      { type: "text", text: " " },
    ]);
    expect(host.editor.getWire()).toBe(`pre1 @${agentId}pre2 @${agentId} `);
  });

  it("inserts a mention atom when the caret is on @", () => {
    const prefix = "query @";
    host.editor.setDocFromWire(prefix, prefix.length - 1, { resetHistory: true });
    expect(host.editor.getCursor()).toBe(prefix.length - 1);

    const doc = host.editor.getDoc();
    host.editor.insertMentionAtomAt(
      "caliper-aaaaaaa",
      wireOffsetToDocPos(doc, 6),
      wireOffsetToDocPos(doc, 7)
    );

    expect(host.editor.getWire()).toBe("query @caliper-aaaaaaa ");
    expect(host.editor.getWire()).not.toMatch(/@\s+@/);
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
    const agentId = "caliper-abc123";
    const wire = `Hi @${agentId} there`;
    host.editor.setDocFromWire(wire, wire.length, { resetHistory: true });
    const doc = host.editor.getDoc();
    const mentionIndex = doc.nodes.findIndex((node) => node.type === "mention");
    host.editor.applyDoc(
      doc,
      collapsedSelection({ nodeIndex: mentionIndex, nodeOffset: 1 + agentId.length })
    );

    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
    expect(host.editor.handleKeyDown(event)).toBe(true);
    expect(host.editor.getWire()).toBe("Hi  there");

    expect(host.editor.undo()).toBe(true);
    expect(host.editor.getWire()).toBe(wire);
  });

  it("compositionEnd reconciles browser DOM into wire shape and preserves caret", () => {
    host.editor.setDocFromWire("hel", 3, { resetHistory: true });
    host.editor.handleCompositionStart();

    const textNode = host.root.firstChild as Text;
    textNode.textContent = "hello\nworld";
    const selection = host.root.ownerDocument.getSelection()!;
    const range = host.root.ownerDocument.createRange();
    range.setStart(textNode, "hello\nworld".length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    host.changes.length = 0;
    host.editor.handleCompositionEnd();

    expect(host.editor.isComposing()).toBe(false);
    expect(host.editor.getWire()).toBe("hello\nworld");
    expect(host.editor.getCursor()).toBe("hello\nworld".length);
    expect(host.changes).toEqual(["hello\nworld"]);
  });

  it("does not emit wire when presentation is refreshed only", () => {
    host.editor.setDocFromWire("@caliper-abc123", 0);
    host.changes.length = 0;
    host.editor.refreshPresentation();
    expect(host.changes).toEqual([]);
  });

  it("refreshPresentation preserves live caret", () => {
    const wire = "prefix @";
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
      onWireChange: () => {
        innerEditor.refreshPresentation();
      },
    });
    innerEditor = editor;
    editor.setRoot(root);
    editor.setDocFromWire("label ", 6, { resetHistory: true });

    editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "@",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(editor.getWire()).toBe("label @");
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
    const agentId = "caliper-aaaaaaa";
    const multilineWire = `HEAD \n\n\n\n@${agentId} `;
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

    expect(host.editor.getWire()).toBe(`HEAD \n\n\n\nD@${agentId} `);
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

    expect(host.editor.getWire()).toBe(`HEAD \n\n\n\nDyy@${agentId} `);
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

  it("first line break after trailing mention-line text lands caret on the new blank", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const prefix = `row @${agentA}  @${agentB} `;
    const wire = `${prefix}tail`;
    const docShape = {
      nodes: [
        { type: "text" as const, text: "row " },
        { type: "mention" as const, agentId: agentA },
        { type: "text" as const, text: "  " },
        { type: "mention" as const, agentId: agentB },
        { type: "text" as const, text: " tail" },
      ],
    };

    host.editor.applyDoc(docShape, selectionAtWire(docShape, wire.length));

    const lineBreak = () =>
      new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        bubbles: true,
        cancelable: true,
      });

    host.editor.handleBeforeInput(lineBreak());
    expect(host.editor.getWire()).toBe(`${wire}\n`);
    const firstProbes = listEmbeddedBlankBandProbeWires(host.editor.getDoc());
    expect(host.editor.getCursor()).toBe(firstProbes[firstProbes.length - 1]!);

    host.editor.handleBeforeInput(lineBreak());
    expect(host.editor.getWire()).toBe(`${wire}\n\n`);
    const secondProbes = listEmbeddedBlankBandProbeWires(host.editor.getDoc());
    expect(host.editor.getCursor()).toBe(secondProbes[secondProbes.length - 1]!);
  });

  it("first line break after single mention with substantive post-pill text lands on blank", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `hd @${agent} tail`;
    host.editor.setDocFromWire(wire, wire.length);

    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(host.editor.getWire()).toBe(`${wire}\n`);
    const probes = listEmbeddedBlankBandProbeWires(host.editor.getDoc());
    expect(host.editor.getCursor()).toBe(probes[probes.length - 1]!);
  });

  it("first line break after mention with whitespace-only post-pill tail lands on blank", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header @${agent} `;
    host.editor.setDocFromWire(wire, wire.length);

    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(host.editor.getWire()).toBe(`${wire}\n`);
    const probes = listEmbeddedBlankBandProbeWires(host.editor.getDoc());
    expect(host.editor.getCursor()).toBe(probes[probes.length - 1]!);
  });

  it("consecutive line breaks at later mention with substantive inter-pill gap land on new blank", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `header @${agentA} tail @${agentB} suffix`;
    const mentionStart = wire.lastIndexOf("@");
    host.editor.setDocFromWire(wire, mentionStart);

    const lineBreak = () =>
      new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        bubbles: true,
        cancelable: true,
      });

    host.editor.handleBeforeInput(lineBreak());
    const caretAfterFirst = host.editor.getCursor();
    expect(caretAfterFirst).toBeGreaterThan(mentionStart);

    host.editor.handleBeforeInput(lineBreak());
    expect(host.editor.getCursor()).toBeGreaterThan(caretAfterFirst);
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

    strandSelectionInMentionPill(host.root);
    dispatchSelectionChange(host.root);
    expect(host.editor.getCursor()).toBe(mentionStart - 1);

    const prefixEnd = "hhshhs ".length - 1;
    setSelectionAtWire(host.root, host.editor.getDoc(), prefixEnd, prefixEnd);
    host.editor.insertDocText("x");
    expect(host.editor.getWire()).toBe(`hhshhsx \n\n\n\n\n@${agentId} `);
    expect(host.editor.getCursor()).toBe(prefixEnd + 1);
  });

  it("selectionchange repairs pill-stranded caret without input and preserves edit authority", () => {
    const agentId = "caliper-abc123";
    const wire = `ab @${agentId} cd`;
    const mentionStart = "ab ".length;
    host.editor.setDocFromWire(wire, mentionStart);

    expect(
      host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })
      )
    ).toBe(true);
    expect(host.editor.getCursor()).toBe(mentionStart - 1);

    strandSelectionInMentionPill(host.root);
    dispatchSelectionChange(host.root);
    expect(host.editor.getCursor()).toBe(mentionStart - 1);

    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "x",
        bubbles: true,
        cancelable: true,
      })
    );
    expect(host.editor.getWire()).toBe(`abx @${agentId} cd`);
    expect(host.editor.getCursor()).toBe(mentionStart);
  });

  it("handleInput does not reconcile selection after handled beforeInput", () => {
    host.editor.setDocFromWire("hello", 5);
    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "!",
        bubbles: true,
        cancelable: true,
      })
    );
    const cursorAfterEdit = host.editor.getCursor();
    expect(cursorAfterEdit).toBe(6);

    host.editor.handleInput();
    expect(host.editor.getCursor()).toBe(cursorAfterEdit);
    expect(host.editor.getWire()).toBe("hello!");
  });

  it("ignores selectionchange when selection is outside the editor root", () => {
    host.editor.setDocFromWire("Hi @caliper-abc123 there", "Hi @caliper-abc123 there".length);
    const cursorBefore = host.editor.getCursor();

    const outside = document.createElement("div");
    const outsideText = document.createTextNode("outside");
    outside.appendChild(outsideText);
    document.body.appendChild(outside);
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.setStart(outsideText, 3);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    dispatchSelectionChange(host.root);
    expect(host.editor.getCursor()).toBe(cursorBefore);

    outside.remove();
  });

  it("does not reconcile selectionchange while composing", () => {
    const agentId = "caliper-abc123";
    const wire = `ab @${agentId}`;
    const mentionStart = "ab ".length;
    host.editor.setDocFromWire(wire, mentionStart);
    host.editor.handleKeyDown(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })
    );

    host.editor.handleCompositionStart();
    strandSelectionInMentionPill(host.root);
    dispatchSelectionChange(host.root);
    expect(host.editor.getCursor()).toBe(mentionStart - 1);

    host.editor.handleCompositionEnd();
  });

  it("reconciles non-collapsed DOM ranges via selectionchange", () => {
    host.editor.setDocFromWire("hello world", "hello world".length);
    const end = "hello world".length;
    setSelectionAtWire(host.root, host.editor.getDoc(), 0, end);
    dispatchSelectionChange(host.root);

    expect(host.editor.getSelectionWire()).toBe("hello world");
    expect(host.editor.getCursor()).toBe(end);
  });

  it("selectionchange follows intentional caret moves to mention boundaries", () => {
    const agentId = "caliper-abc123";
    const wire = `ab @${agentId} cd`;
    const mentionStart = "ab ".length;
    host.editor.setDocFromWire(wire, wire.length);

    setSelectionAtWire(host.root, host.editor.getDoc(), mentionStart);
    dispatchSelectionChange(host.root);
    expect(host.editor.getCursor()).toBe(mentionStart);
  });

  describe("selectionchange — click ingress", () => {
    const agentId = "caliper-aaaaaaa";
    const twoPillWire = `prefix @${agentId} @${agentId} \n\n lower `;
    const suffixWire = `header @${agentId} row\n\n\nlower `;

    it("accepts valid DOM text on multi-pill row without probe snap", () => {
      const doc = wireToDoc(twoPillWire);
      const prefixEnd = "prefix".length;

      host.editor.setDocFromWire(twoPillWire, 0, { resetHistory: true });
      setSelectionAtWire(host.root, doc, prefixEnd, prefixEnd);
      dispatchSelectionChange(host.root);

      expect(host.editor.getCursor()).toBe(prefixEnd);
      expect(readDomWireCursor(host.root, host.editor.getDoc())).toBe(prefixEnd);
      expect(host.editor.getCursor()).not.toBe(listEmbeddedBlankBandProbeWires(doc)[0]! - 1);
    });

    it("accepts blank probe when click targets probe band", () => {
      const doc = wireToDoc(suffixWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerEnd = probes[0]! - 1;
      const [firstProbe] = probes;

      host.editor.setDocFromWire(suffixWire, headerEnd, { resetHistory: true });
      setSelectionAtWire(host.root, doc, firstProbe!, firstProbe!);
      dispatchSelectionChange(host.root);

      expect(host.editor.getCursor()).toBe(firstProbe);
      expect(readDomWireCursor(host.root, host.editor.getDoc())).toBe(firstProbe);
    });

    it("does not snap mis-hit probe to content row end when prior was on row interior", () => {
      const doc = wireToDoc(suffixWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerEnd = probes[0]! - 1;
      const [firstProbe] = probes;

      host.editor.setDocFromWire(suffixWire, 0, { resetHistory: true });
      setSelectionAtWire(host.root, doc, firstProbe!, firstProbe!);
      dispatchSelectionChange(host.root);

      expect(host.editor.getCursor()).toBe(firstProbe);
      expect(host.editor.getCursor()).not.toBe(headerEnd);
    });

    describe("probe-alias after whitespace chip — click from blank band then backspace", () => {
      function assertSpacerChipDoesNotPaintDeleteProbe(
        wire: string,
        expectedWireAfter: string,
        expectedCursorWire: number,
        expectMentionBoundary: boolean
      ) {
        const doc = wireToDoc(wire);
        const probes = listEmbeddedBlankBandProbeWires(doc);
        const spacerWire = probes[0]! - 1;
        const lastProbe = probes[probes.length - 1]!;

        host.editor.setDocFromWire(wire, lastProbe, { resetHistory: true });
        setSelectionAtWire(host.root, doc, spacerWire, spacerWire);
        dispatchSelectionChange(host.root);
        expect(host.editor.getCursor()).toBe(spacerWire);

        const handled = host.editor.handleKeyDown(
          new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
        );
        expect(handled).toBe(true);
        expect(host.editor.getWire()).toBe(expectedWireAfter);
        expect(
          isEmbeddedBlankBandDeleteProbeWire(host.editor.getDoc(), host.editor.getCursor())
        ).toBe(false);
        expect(handoffNoteSelectionSnapshot(host.root).anchorInMentionPill).toBe(false);
        expect(host.editor.getCursor()).toBe(expectedCursorWire);
        if (expectMentionBoundary) {
          expect(
            describeHandoffNoteCursorContext(host.editor.getDoc(), host.editor.getCursor()).kind
          ).toBe("mention-boundary");
        }
      }

      it("prefix + mention row + spacer", () => {
        const agentId = "caliper-aaaaaaa";
        assertSpacerChipDoesNotPaintDeleteProbe(
          `header header @${agentId} \n\n\n`,
          `header header @${agentId}\n\n\n`,
          `header header @${agentId}`.length,
          true
        );
      });

      it("mention-only row + spacer", () => {
        const agentId = "caliper-aaaaaaa";
        assertSpacerChipDoesNotPaintDeleteProbe(
          `@${agentId} \n\n\n`,
          `@${agentId}\n\n\n`,
          `@${agentId}`.length,
          true
        );
      });

      it("plain text tail + spacer", () => {
        assertSpacerChipDoesNotPaintDeleteProbe(
          `tail \n\n\n`,
          `tail\n\n\n`,
          `tail`.length - 1,
          false
        );
      });

      it("next backspace at mention node end removes mention not blank band", () => {
        const agentId = "caliper-aaaaaaa";
        const wire = `header @${agentId} \n\n\n`;
        const doc = wireToDoc(wire);
        const probes = listEmbeddedBlankBandProbeWires(doc);
        const spacerWire = probes[0]! - 1;
        const lastProbe = probes[probes.length - 1]!;

        host.editor.setDocFromWire(wire, lastProbe, { resetHistory: true });
        setSelectionAtWire(host.root, doc, spacerWire, spacerWire);
        dispatchSelectionChange(host.root);

        expect(
          host.editor.handleKeyDown(
            new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
          )
        ).toBe(true);
        expect(host.editor.getWire()).toBe(`header @${agentId}\n\n\n`);

        expect(
          host.editor.handleKeyDown(
            new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
          )
        ).toBe(true);
        expect(host.editor.getWire()).toBe(`header \n\n\n`);
        expect(host.editor.getWire()).not.toContain(agentId);
      });
    });
  });

  it("restores regressed DOM authority on edit ingress via beforeInput sync", () => {
    const agentId = "caliper-abc123";
    const wire = `ab @${agentId} cd`;
    host.editor.setDocFromWire(wire, wire.length);
    const authority = host.editor.getCursor();

    setSelectionAtWire(host.root, host.editor.getDoc(), "ab ".length);
    host.editor.handleBeforeInput(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "x",
        bubbles: true,
        cancelable: true,
      })
    );
    expect(host.editor.getWire()).toBe(`ab @${agentId} cdx`);
    expect(host.editor.getCursor()).toBe(authority + 1);
  });

  it("selectMentionNode highlights only the clicked pill instance", () => {
    const agent = "caliper-abc123";
    const wire = `@${agent} text @${agent} `;
    host.editor.setDocFromWire(wire, 0, { resetHistory: true });
    const pills = [...host.root.querySelectorAll<HTMLSpanElement>("span[data-handoff-mention]")];
    const secondIndex = readMentionNodeIndex(pills[1]!);
    host.editor.selectMentionNode(secondIndex!);
    expect(pills[0]!.className).not.toContain("handoff-mention-pill-highlighted");
    expect(pills[1]!.className).toContain("handoff-mention-pill-highlighted");
  });

  it("arrow from selected mention exits vertically to row start and horizontally to pill end", () => {
    const agent = "caliper-abc123";
    const wire = `notes here\n@${agent} tail`;
    host.editor.setDocFromWire(wire, 0, { resetHistory: true });
    const mentionNode = host.editor.getDoc().nodes.findIndex((node) => node.type === "mention");
    const rowStart = wire.indexOf("\n") + 1;
    const pillEnd = wire.indexOf("@") + `@${agent}`.length;

    host.editor.selectMentionNode(mentionNode);
    expect(
      host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
      )
    ).toBe(true);
    expect(host.editor.getCursor()).toBe(rowStart);

    host.editor.selectMentionNode(mentionNode);
    expect(
      host.editor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })
      )
    ).toBe(true);
    expect(host.editor.getCursor()).toBe(pillEnd);
  });

  it("skips pill arrow exit while the mention popover is open", () => {
    const agent = "caliper-abc123";
    const popoverEditor = createHandoffNoteEditor({
      getColorByAgentId: () => new Map([[agent, "#f00"]]),
      isMentionPopoverOpen: () => true,
      onWireChange: () => {},
    });
    const root = document.createElement("div");
    document.body.appendChild(root);
    popoverEditor.setRoot(root);
    popoverEditor.setDocFromWire(`@${agent} tail`, 0, { resetHistory: true });
    popoverEditor.selectMentionNode(0);
    expect(
      popoverEditor.handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
      )
    ).toBe(false);
    expect(popoverEditor.getSelectedMentionNodeIndex()).toBe(0);
  });
});
