import {
  docPosToWireOffset,
  docToWire,
  resolveWireLineColumn,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";
import { mentionWireLength } from "./handoff-note-dom.js";
import { resolvePaintContextAtWire } from "./handoff-note-dom-points.js";

export function resolveSelectedMentionArrowExit(
  doc: HandoffNoteDoc,
  nodeIndex: number,
  direction: "up" | "down" | "left" | "right"
): HandoffNoteDocPos | null {
  const node = doc.nodes[nodeIndex];
  if (node?.type !== "mention") {
    return null;
  }

  if (direction === "left" || direction === "right") {
    return { nodeIndex, nodeOffset: mentionWireLength(node.agentId) };
  }

  const wire = docToWire(doc);
  const mentionStart = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
  const { lineStart } = resolveWireLineColumn(wire, mentionStart);
  return resolvePaintContextAtWire(doc, lineStart).paintPos;
}
