import { applyDocDelete } from "./handoff-note-doc-edits.js";
import { resolveHandoffNoteDeleteIntent } from "./handoff-note-delete-intent.js";
import type { HandoffNoteSelection } from "./handoff-note-doc-pos.js";
import type { HandoffNoteDoc, HandoffNoteEdit } from "./handoff-note-doc.js";
import {
  listBlankVisualLineStartWires,
  listVisualRowAnchorWires,
  type HandoffNoteVisualRowSeat,
} from "./handoff-note-embedded-newlines.js";

/** Wire-line seat lattice for headless tests (hard breaks only — no soft-wrap rows). */
export function wireLineVisualRowSeats(doc: HandoffNoteDoc): HandoffNoteVisualRowSeat[] {
  const blankStops = new Set(listBlankVisualLineStartWires(doc));
  return listVisualRowAnchorWires(doc).map((wire) => ({
    wire,
    kind: blankStops.has(wire) ? "blank" : "content",
  }));
}

export function applyDocDeleteWithWireLineSeats(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  direction: HandoffNoteEdit
) {
  return applyDocDelete(doc, selection, direction, {
    visualRowSeats: wireLineVisualRowSeats(doc),
  });
}

export function resolveHandoffNoteDeleteIntentWithWireLineSeats(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  direction: HandoffNoteEdit
) {
  return resolveHandoffNoteDeleteIntent(doc, selection, direction, wireLineVisualRowSeats(doc));
}
