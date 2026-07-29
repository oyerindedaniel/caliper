import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireToDoc } from "@caliper/core";
import { createHandoffKeyboardController } from "./handoff-keyboard.js";
import { createHandoffRegistry } from "@caliper/core";
import { renderHandoffNoteDoc } from "./note-editor/handoff-note-dom.js";

describe("createHandoffKeyboardController", () => {
  let registry: ReturnType<typeof createHandoffRegistry>;
  let editor: HTMLDivElement;
  let target: HTMLDivElement;

  beforeEach(() => {
    registry = createHandoffRegistry();
    editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    target = document.createElement("div");
    target.textContent = "handoff target";
    document.body.append(editor, target);
  });

  afterEach(() => {
    editor.remove();
    target.remove();
  });

  const controller = () =>
    createHandoffKeyboardController({
      registry,
      commands: {
        activate: "Alt",
        freeze: " ",
        select: "Control",
        clear: "Escape",
        calculator: { top: "t", right: "r", bottom: "b", left: "l", distance: "g" },
        projection: { top: "w", left: "a", bottom: "s", right: "d" },
        ruler: "r",
        selectionHoldDuration: 250,
        handoff: { open: "Enter", restore: "" },
      },
      isMentionOpen: () => false,
    });

  it("rehydrates last committed handoff when Enter is pressed with no live picks", () => {
    const localRegistry = createHandoffRegistry(() => target);
    localRegistry.toggle(target);
    localRegistry.setPendingNote("ship @caliper-abc123 ");
    const committed = localRegistry.commitSession();
    expect(committed).not.toBeNull();
    expect(localRegistry.getItems()).toHaveLength(0);

    const handle = createHandoffKeyboardController({
      registry: localRegistry,
      commands: {
        activate: "Alt",
        freeze: " ",
        select: "Control",
        clear: "Escape",
        calculator: { top: "t", right: "r", bottom: "b", left: "l", distance: "g" },
        projection: { top: "w", left: "a", bottom: "s", right: "d" },
        ruler: "r",
        selectionHoldDuration: 250,
        handoff: { open: "Enter", restore: "" },
      },
      isMentionOpen: () => false,
    });
    const handled = handle(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );

    expect(handled).toBe(true);
    expect(localRegistry.isInputOpen()).toBe(true);
    expect(localRegistry.getPendingNote()).toBe("ship @caliper-abc123 ");
    expect(localRegistry.getItems()).toHaveLength(1);
  });

  it("Enter on a focused mention pill highlights instead of committing", () => {
    const agent = "caliper-abc123";
    registry.toggle(target);
    registry.setPendingNote(`tag @${agent} `);
    registry.setInputOpen(true);
    renderHandoffNoteDoc(editor, wireToDoc(`tag @${agent} `), {
      colorByAgentId: new Map([[agent, "#f00"]]),
    });
    document.body.append(editor);

    const pill = editor.querySelector<HTMLSpanElement>("span[data-handoff-mention]");
    expect(pill).toBeTruthy();
    pill!.focus();

    const setHighlighted = vi.spyOn(registry, "setHighlightedAgentId");
    const handle = controller();
    const handled = handle(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );

    expect(handled).toBe(true);
    expect(setHighlighted).toHaveBeenCalledWith(agent);
    expect(registry.isInputOpen()).toBe(true);
    editor.remove();
  });

  it("Enter in the note editor commits and clears live session", () => {
    registry.toggle(target);
    registry.setPendingNote("done @caliper-abc123 ");
    registry.setInputOpen(true);
    editor.focus();

    const handle = controller();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: editor });
    handle(event);

    expect(registry.getItems()).toHaveLength(0);
    expect(registry.isInputOpen()).toBe(false);
    expect(registry.getLastCommitted()?.wireNote).toBe("done @caliper-abc123 ");
  });
});
