/** Matches ids from `generateId("caliper")` → `caliper-<alphanumeric>`. */
export const HANDOFF_AGENT_ID_PATTERN = "caliper-[a-z0-9]+";

const MENTION_PATTERN = new RegExp(`@(${HANDOFF_AGENT_ID_PATTERN})`, "g");

export type HandoffNoteSegment =
  | { type: "text"; value: string }
  | { type: "mention"; agentId: string };

/** Split note text into plain spans and `@caliper-*` mention tokens. */
export function parseHandoffNoteSegments(note: string): HandoffNoteSegment[] {
  const segments: HandoffNoteSegment[] = [];
  let lastIndex = 0;

  for (const match of note.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: note.slice(lastIndex, index) });
    }
    segments.push({ type: "mention", agentId: match[1]! });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < note.length) {
    segments.push({ type: "text", value: note.slice(lastIndex) });
  }

  return segments;
}

export type HandoffNoteAtomicEdit = "backspace" | "delete";

export type HandoffNoteArrowDirection = "left" | "right";

export type HandoffNoteCursorContext =
  | { kind: "text" }
  | { kind: "mention-boundary"; start: number; end: number; edge: "start" | "end" }
  | { kind: "mention-interior"; start: number; end: number; agentId: string };

/** Classify a raw textarea index against parsed `@caliper-*` mention spans. */
export function describeHandoffNoteCursorContext(
  note: string,
  index: number
): HandoffNoteCursorContext {
  let offset = 0;

  for (const segment of parseHandoffNoteSegments(note)) {
    if (segment.type === "text") {
      const end = offset + segment.value.length;
      if (index < end) {
        return { kind: "text" };
      }
      offset = end;
      continue;
    }

    const start = offset;
    const end = offset + 1 + segment.agentId.length;
    if (index === start || index === end) {
      return { kind: "mention-boundary", start, end, edge: index === start ? "start" : "end" };
    }
    if (index > start && index < end) {
      return { kind: "mention-interior", start, end, agentId: segment.agentId };
    }
    offset = end;
  }

  return { kind: "text" };
}

/**
 * Jump the caret over `@caliper-*` tokens instead of stepping through raw characters.
 * Returns `handled: true` when the caller should preventDefault and set selection.
 */
export function resolveHandoffNoteArrowMove(
  note: string,
  cursor: number,
  direction: HandoffNoteArrowDirection
): { cursor: number; handled: boolean } {
  const current = describeHandoffNoteCursorContext(note, cursor);

  if (current.kind === "mention-interior") {
    return {
      cursor: direction === "left" ? current.start : current.end,
      handled: true,
    };
  }

  if (current.kind === "mention-boundary") {
    if (direction === "left" && current.edge === "end") {
      return { cursor: current.start, handled: true };
    }
    if (direction === "right" && current.edge === "start") {
      return { cursor: current.end, handled: true };
    }
  }

  const delta = direction === "left" ? -1 : 1;
  const next = cursor + delta;
  if (next < 0 || next > note.length) {
    return { cursor, handled: false };
  }

  const nextContext = describeHandoffNoteCursorContext(note, next);
  if (nextContext.kind === "mention-interior") {
    return {
      cursor: direction === "left" ? nextContext.start : nextContext.end,
      handled: true,
    };
  }

  return { cursor, handled: false };
}

/** Move a raw index out of `@caliper-*` interiors using the prior caret position when known. */
export function snapHandoffNoteCursorOutOfMentionInterior(
  note: string,
  index: number,
  fromIndex?: number
): number {
  const context = describeHandoffNoteCursorContext(note, index);
  if (context.kind !== "mention-interior") {
    return index;
  }
  if (fromIndex !== undefined) {
    return fromIndex > index ? context.start : context.end;
  }
  return context.end;
}

/**
 * Remove a complete `@caliper-*` mention in one edit.
 * Backspace targets the character before the cursor (`cursor > start && cursor <= end`).
 * Delete targets the character at the cursor (`cursor >= start && cursor < end`).
 */
export function resolveHandoffNoteAtomicEdit(
  note: string,
  cursor: number,
  edit: HandoffNoteAtomicEdit
): { note: string; cursor: number } | null {
  if (edit === "backspace" && cursor <= 0) {
    return null;
  }
  if (edit === "delete" && cursor >= note.length) {
    return null;
  }

  let offset = 0;
  for (const segment of parseHandoffNoteSegments(note)) {
    if (segment.type === "text") {
      offset += segment.value.length;
      continue;
    }

    const start = offset;
    const end = offset + 1 + segment.agentId.length;
    const inRange =
      edit === "backspace" ? cursor > start && cursor <= end : cursor >= start && cursor < end;

    if (inRange) {
      return {
        note: note.slice(0, start) + note.slice(end),
        cursor: start,
      };
    }
    offset = end;
  }

  return null;
}

/** Compact id label for inline mention pills. */
export function formatHandoffAgentIdPill(agentId: string): string {
  return agentId.replace(/^caliper-/, "");
}

/** Strip `@` prefix from agent-id mentions before sending note to the agent. */
export function resolveHandoffNote(note: string): string {
  return note.replace(MENTION_PATTERN, "$1");
}

/** True when a pending composer note has no submit-worthy content. */
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

/** Collapse whitespace for label queries like `@the boy` → `theboy`. */
export function normalizeHandoffFilterQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, "");
}

/** True when `@query` is a full registered agent id (not a partial filter). */
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
