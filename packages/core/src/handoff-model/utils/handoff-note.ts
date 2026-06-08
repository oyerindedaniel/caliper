/** Matches ids from `generateId("caliper")` → `caliper-<alphanumeric>`. */
export const HANDOFF_AGENT_ID_PATTERN = "caliper-[a-z0-9]+";

const MENTION_PATTERN = new RegExp(`@(${HANDOFF_AGENT_ID_PATTERN})`, "g");

/** Strip `@` prefix from agent-id mentions before sending note to the agent. */
export function resolveHandoffNote(note: string): string {
  return note.replace(MENTION_PATTERN, "$1");
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
