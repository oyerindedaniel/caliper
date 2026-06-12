import { docToWire, parseHandoffNoteWire } from "./handoff-note-doc.js";

/**
 * Browser cut/copy often appends plain agent-id labels after @mention wire tokens.
 * Collapse that echo tail before wire→doc ingress.
 */
export function sanitizeMentionPasteWire(wire: string): string {
  if (!wire) {
    return wire;
  }

  const nodes = parseHandoffNoteWire(wire);
  const mentionIds = new Set<string>();
  for (const node of nodes) {
    if (node.type === "mention") {
      mentionIds.add(node.agentId);
    }
  }
  if (mentionIds.size === 0) {
    return wire;
  }

  const trimmed = [...nodes];
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    if (last?.type !== "text" || !last.text.trim()) {
      break;
    }
    const parts = last.text.trim().split(/\s+/);
    if (parts.every((part) => mentionIds.has(part))) {
      trimmed.pop();
      continue;
    }
    break;
  }

  return docToWire({ nodes: trimmed });
}
