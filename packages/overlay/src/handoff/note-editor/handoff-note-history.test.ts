import { describe, expect, it, vi, afterEach } from "vitest";
import { collapsedSelection, docEndPos, wireOffsetToDocPos, wireToDoc } from "@caliper/core";
import {
  createHandoffNoteHistory,
  isRedoKeyboardEvent,
  isUndoKeyboardEvent,
} from "./handoff-note-history.js";

function snapshot(wire: string, cursor: number) {
  const doc = wireToDoc(wire);
  return {
    doc,
    selection: collapsedSelection(
      cursor === wire.length ? docEndPos(doc) : wireOffsetToDocPos(doc, cursor)
    ),
  };
}

describe("handoff-note-history", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("undoes and redoes a single mutation", () => {
    const history = createHandoffNoteHistory();
    const empty = snapshot("", 0);
    const typed = snapshot("hi", 2);

    history.recordBefore(empty);
    const undone = history.undo(typed);
    expect(undone).toEqual(empty);
    expect(history.canRedo()).toBe(true);

    const redone = history.redo(empty);
    expect(redone).toEqual(typed);
    expect(history.canUndo()).toBe(true);
  });

  it("coalesces rapid typing into one undo step", () => {
    vi.useFakeTimers();
    const history = createHandoffNoteHistory();
    const s0 = snapshot("", 0);
    const s1 = snapshot("h", 1);

    history.recordBefore(s0);
    vi.advanceTimersByTime(50);
    history.recordBefore(s1);
    expect(history.canUndo()).toBe(true);

    const undone = history.undo(snapshot("hi", 2));
    expect(undone).toEqual(s0);
  });

  it("does not coalesce when mention count changes", () => {
    vi.useFakeTimers();
    const history = createHandoffNoteHistory();
    const empty = snapshot("", 0);
    const plain = snapshot("hi ", 3);
    const withMention = snapshot("hi @caliper-abc123", 18);

    history.recordBefore(empty);
    vi.advanceTimersByTime(500);
    history.recordBefore(plain);

    expect(history.undo(withMention)).toEqual(plain);
    expect(history.canRedo()).toBe(true);
    expect(history.undo(plain)).toEqual(empty);
  });

  it("skips recording while composing", () => {
    const history = createHandoffNoteHistory();
    history.setComposing(true);
    history.recordBefore(snapshot("", 0));
    expect(history.canUndo()).toBe(false);
  });

  it("clears redo stack when a new edit is recorded after undo", () => {
    const history = createHandoffNoteHistory();
    const a = snapshot("a", 1);
    const b = snapshot("ab", 2);
    const c = snapshot("abc", 3);

    history.recordBefore(snapshot("", 0));
    history.undo(b);
    history.recordBefore(a);
    expect(history.canRedo()).toBe(false);

    history.recordBefore(b);
    const redone = history.redo(c);
    expect(redone).toBeNull();
  });

  it("detects undo/redo keyboard shortcuts", () => {
    expect(isUndoKeyboardEvent(new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }))).toBe(
      true
    );
    expect(
      isRedoKeyboardEvent(new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: true, key: "z" }))
    ).toBe(true);
    expect(isRedoKeyboardEvent(new KeyboardEvent("keydown", { ctrlKey: true, key: "y" }))).toBe(
      true
    );
  });
});
