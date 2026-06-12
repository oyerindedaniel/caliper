import {
  collapsedSelection,
  docPosToWireOffset,
  normalizeDocPos,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
} from "@caliper/core";
import {
  getDocAnchorRect,
  readDocCursor,
  readDocSelection,
  setDocSelection,
} from "./handoff-note-selection.js";

/** Test-only: fire `selectionchange` so the editor host syncs internal caret from DOM. */
export function dispatchSelectionChange(root: HTMLElement): void {
  root.ownerDocument.dispatchEvent(new Event("selectionchange"));
}

/** Test-only helper: place the DOM caret at a wire offset via doc positions. */
export function setSelectionAtWire(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  start: number,
  end = start,
  options?: { fromOffset?: number; source?: string }
): void {
  const from =
    options?.fromOffset !== undefined ? wireOffsetToDocPos(doc, options.fromOffset) : undefined;
  setDocSelection(
    root,
    doc,
    {
      anchor: normalizeDocPos(doc, wireOffsetToDocPos(doc, start), { from }),
      focus: normalizeDocPos(doc, wireOffsetToDocPos(doc, end), { from }),
    },
    { from, source: options?.source }
  );
}

export function readDomWireCursor(root: HTMLElement, doc: HandoffNoteDoc): number {
  return docPosToWireOffset(doc, readDocCursor(root, doc));
}

export function readDomWireSelection(
  root: HTMLElement,
  doc: HandoffNoteDoc
): { start: number; end: number } {
  const { anchor, focus } = readDocSelection(root, doc);
  const start = docPosToWireOffset(doc, anchor);
  const end = docPosToWireOffset(doc, focus);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function selectionAtWire(doc: HandoffNoteDoc, offset: number) {
  return collapsedSelection(wireOffsetToDocPos(doc, offset));
}

export function getAnchorRectAtWire(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  offset: number
): DOMRect | null {
  return getDocAnchorRect(root, doc, wireOffsetToDocPos(doc, offset));
}
