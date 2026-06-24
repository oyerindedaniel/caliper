import {
  HANDOFF_MENTION_PATTERN,
  describeHandoffNoteCursorContext,
  docToWire,
  parseHandoffNoteWire,
  type HandoffNoteDoc,
} from "../note-doc/handoff-note-doc.js";
import {
  docPosToWireOffset,
  normalizeDocPos,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
  wireOffsetToDocPos,
} from "../note-doc/handoff-note-doc-pos.js";

export type HandoffAgentIdPillVariant = "compact" | "full";

export function formatHandoffAgentIdPill(
  agentId: string,
  variant: HandoffAgentIdPillVariant = "compact"
): string {
  if (variant === "full") {
    return agentId;
  }
  return agentId.replace(/^caliper-/, "");
}

export function resolveHandoffNote(note: string): string {
  return note.replace(HANDOFF_MENTION_PATTERN, "$1");
}

/** Rebuild editor wire (`@caliper-…` pills) from a resolved commit note + item ids. */
export function handoffResolvedNoteToWire(note: string, agentIds: readonly string[]): string {
  if (agentIds.length === 0) {
    return note;
  }
  let wire = note;
  const unique = [...new Set(agentIds)].sort((left, right) => right.length - left.length);
  for (const agentId of unique) {
    if (!agentId) {
      continue;
    }
    const escaped = agentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    wire = wire.replace(new RegExp(escaped, "g"), `@${agentId}`);
  }
  return wire;
}

export function isHandoffPendingNoteEmpty(note: string): boolean {
  return !resolveHandoffNote(note).trim();
}

export function handoffItemLabel(fingerprint: {
  text?: string;
  tag?: string;
  marker?: string;
  tagName?: string;
  selector: string;
}): string {
  const text = fingerprint.text?.trim();
  if (text) {
    return text.length > 24 ? `${text.slice(0, 24)}…` : text;
  }
  const marker = fingerprint.marker?.trim();
  if (marker) {
    return marker.length > 24 ? `${marker.slice(0, 24)}…` : marker;
  }
  if (fingerprint.tagName) {
    return fingerprint.tagName;
  }
  return fingerprint.selector.replace(/^caliper-/, "").slice(0, 12);
}

type ActiveHandoffMentionQuery = {
  queryStart: number;
  query: string;
};

export type ActiveHandoffDocMentionQuery = {
  queryStart: HandoffNoteDocPos;
  query: string;
};

function isQueryInsideCommittedMention(note: string, queryStart: number, cursor: number): boolean {
  let offset = 0;
  for (const node of parseHandoffNoteWire(note)) {
    if (node.type === "text") {
      offset += node.text.length;
      continue;
    }

    const start = offset;
    const end = offset + 1 + node.agentId.length;
    if (queryStart === start && cursor >= end) {
      return true;
    }
    offset = end;
  }
  return false;
}

function pickBestMentionQueryCandidate(
  note: string,
  cursor: number,
  candidates: ActiveHandoffMentionQuery[]
): ActiveHandoffMentionQuery | null {
  let best: ActiveHandoffMentionQuery | null = null;
  for (const candidate of candidates) {
    if (isQueryInsideCommittedMention(note, candidate.queryStart, cursor)) {
      continue;
    }
    if (!best || candidate.queryStart > best.queryStart) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Popover session parse: same-line `@query` or typed continuation after newlines.
 * Blank lines alone after `@` are not an active session — Shift+Enter closes the popover.
 */
function resolveActiveHandoffMentionQuery(
  note: string,
  cursor: number
): ActiveHandoffMentionQuery | null {
  const beforeCursor = note.slice(0, cursor);
  const candidates: ActiveHandoffMentionQuery[] = [];

  const sameLine = beforeCursor.match(/@([^\s@]*)$/);
  if (sameLine?.index !== undefined) {
    candidates.push({ queryStart: sameLine.index, query: sameLine[1] ?? "" });
  }

  const continued = beforeCursor.match(/@(\n+)([^\s@]+)$/);
  if (continued?.index !== undefined) {
    candidates.push({ queryStart: continued.index, query: continued[2] ?? "" });
  }

  return pickBestMentionQueryCandidate(note, cursor, candidates);
}

/** Insert redirect: fold filter chars across newlines onto the `@` line (blank or existing query). */
export function resolveMentionQueryMultilineInsert(
  note: string,
  cursor: number
): ActiveHandoffMentionQuery | null {
  const beforeCursor = note.slice(0, cursor);
  const withNewlines = beforeCursor.match(/@([^\s@]*)(\n+)([^\s@]*)$/);
  if (withNewlines?.index === undefined) {
    return null;
  }

  return pickBestMentionQueryCandidate(note, cursor, [
    {
      queryStart: withNewlines.index,
      query: (withNewlines[1] ?? "") + (withNewlines[3] ?? ""),
    },
  ]);
}

/** Doc-native `@query` session parse; wire conversion stays inside core only. */
export function resolveActiveHandoffMentionQueryDoc(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection
): ActiveHandoffDocMentionQuery | null {
  const focus = normalizeDocPos(doc, selection.focus);
  const focusWire = docPosToWireOffset(doc, focus);
  const wire = docToWire(doc);
  const caretContext = describeHandoffNoteCursorContext(doc, focusWire);
  if (caretContext.kind === "mention-interior") {
    return null;
  }
  if (caretContext.kind === "mention-boundary" && caretContext.edge === "end") {
    return null;
  }
  const active = resolveActiveHandoffMentionQuery(wire, focusWire);
  if (!active) {
    return null;
  }
  return {
    queryStart: normalizeDocPos(doc, wireOffsetToDocPos(doc, active.queryStart)),
    query: active.query,
  };
}

export function normalizeHandoffFilterQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, "");
}

export function isExactHandoffMentionQuery(query: string, agentIds: Iterable<string>): boolean {
  if (!query) {
    return false;
  }
  const token = `@${query}`;
  for (const agentId of agentIds) {
    if (`@${agentId}` === token) {
      return true;
    }
  }
  return false;
}

export function filterHandoffItems<
  T extends { agentId: string; fingerprint: Parameters<typeof handoffItemLabel>[0] },
>(items: T[], query: string): T[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return items;
  }
  const compact = normalizeHandoffFilterQuery(trimmed);
  const lowered = trimmed.toLowerCase();
  return items.filter((item) => {
    const label = handoffItemLabel(item.fingerprint);
    const compactLabel = normalizeHandoffFilterQuery(label);
    const agentId = item.agentId.toLowerCase();
    return (
      compactLabel.includes(compact) ||
      agentId.includes(lowered) ||
      agentId.replace(/\s+/g, "").includes(compact)
    );
  });
}
