import { sanitizeMentionPasteWire } from "./handoff-note-paste.js";
import { resolveHorizontalBleedWireMove } from "./handoff-note-vertical-nav.js";
import { type HandoffNoteVerticalArrowDirection } from "./handoff-note-wire-lines.js";

export type HandoffNoteTextNode = {
  type: "text";
  text: string;
};

export type HandoffNoteMentionNode = {
  type: "mention";
  agentId: string;
};

export type HandoffNoteNode = HandoffNoteTextNode | HandoffNoteMentionNode;

export type HandoffNoteDoc = {
  nodes: HandoffNoteNode[];
};

export const HANDOFF_AGENT_ID_PATTERN = "caliper-[a-z0-9]+";
export const HANDOFF_MENTION_PATTERN = new RegExp(`@(${HANDOFF_AGENT_ID_PATTERN})`, "g");

const EMPTY_DOC: HandoffNoteDoc = { nodes: [] };

function coalesceTextNodes(nodes: HandoffNoteNode[]): HandoffNoteNode[] {
  const merged: HandoffNoteNode[] = [];
  for (const node of nodes) {
    if (node.type !== "text") {
      merged.push(node);
      continue;
    }
    if (!node.text) {
      continue;
    }
    const last = merged[merged.length - 1];
    if (last?.type === "text") {
      last.text += node.text;
      continue;
    }
    merged.push({ type: "text", text: node.text });
  }
  return merged;
}

export function parseHandoffNoteWire(wire: string): HandoffNoteNode[] {
  const nodes: HandoffNoteNode[] = [];
  let lastIndex = 0;

  for (const match of wire.matchAll(HANDOFF_MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push({ type: "text", text: wire.slice(lastIndex, index) });
    }
    nodes.push({ type: "mention", agentId: match[1]! });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < wire.length) {
    nodes.push({ type: "text", text: wire.slice(lastIndex) });
  }

  return coalesceTextNodes(nodes);
}

export function wireToDoc(wire: string): HandoffNoteDoc {
  if (!wire) {
    return { nodes: [] };
  }
  return canonicalizeHandoffNoteDocFromWire({ nodes: parseHandoffNoteWire(wire) });
}

export function docToWire(doc: HandoffNoteDoc): string {
  let wire = "";
  for (const node of doc.nodes) {
    if (node.type === "text") {
      wire += node.text;
      continue;
    }
    wire += `@${node.agentId}`;
  }
  return wire;
}

export function docLength(doc: HandoffNoteDoc): number {
  return docToWire(doc).length;
}

export function isEmptyDoc(doc: HandoffNoteDoc): boolean {
  return doc.nodes.length === 0 || docToWire(doc).length === 0;
}

export function createTextDoc(text: string): HandoffNoteDoc {
  if (!text) {
    return { nodes: [] };
  }
  return { nodes: [{ type: "text", text }] };
}

export function emptyHandoffNoteDoc(): HandoffNoteDoc {
  return EMPTY_DOC;
}

export type HandoffNoteEdit = "backspace" | "delete";

export type HandoffNoteArrowDirection = "left" | "right";

export type HandoffNoteNavDirection = HandoffNoteArrowDirection | HandoffNoteVerticalArrowDirection;

const ARROW_KEY_TO_DIRECTION = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
} as const satisfies Record<string, HandoffNoteNavDirection>;

type ArrowKey = keyof typeof ARROW_KEY_TO_DIRECTION;

function arrowKeyOf(source: KeyboardEvent | string): string {
  return typeof source === "string" ? source : source.key;
}

function isArrowKey(key: string): key is ArrowKey {
  return key in ARROW_KEY_TO_DIRECTION;
}

function matchesArrow(key: string, directions?: readonly HandoffNoteNavDirection[]): boolean {
  if (!isArrowKey(key)) {
    return false;
  }
  if (!directions || directions.length === 0) {
    return true;
  }
  return directions.includes(ARROW_KEY_TO_DIRECTION[key]);
}

export const isArrow = Object.assign(
  (source: KeyboardEvent | string) => matchesArrow(arrowKeyOf(source)),
  {
    horc: (source: KeyboardEvent | string) => matchesArrow(arrowKeyOf(source), ["left", "right"]),
    ver: (source: KeyboardEvent | string) => matchesArrow(arrowKeyOf(source), ["up", "down"]),
    left: (source: KeyboardEvent | string) => matchesArrow(arrowKeyOf(source), ["left"]),
    right: (source: KeyboardEvent | string) => matchesArrow(arrowKeyOf(source), ["right"]),
    up: (source: KeyboardEvent | string) => matchesArrow(arrowKeyOf(source), ["up"]),
    down: (source: KeyboardEvent | string) => matchesArrow(arrowKeyOf(source), ["down"]),
    direction(source: KeyboardEvent | string): HandoffNoteNavDirection | null {
      const key = arrowKeyOf(source);
      return isArrowKey(key) ? ARROW_KEY_TO_DIRECTION[key] : null;
    },
    horcDirection(source: KeyboardEvent | string): HandoffNoteArrowDirection | null {
      const direction = isArrow.direction(source);
      return direction === "left" || direction === "right" ? direction : null;
    },
    verDirection(source: KeyboardEvent | string): HandoffNoteVerticalArrowDirection | null {
      const direction = isArrow.direction(source);
      return direction === "up" || direction === "down" ? direction : null;
    },
  }
);

export type HandoffNoteCursorContext =
  | { kind: "text" }
  | { kind: "mention-boundary"; start: number; end: number; edge: "start" | "end" }
  | { kind: "mention-interior"; start: number; end: number; agentId: string };

export function describeHandoffNoteCursorContext(
  doc: HandoffNoteDoc,
  index: number
): HandoffNoteCursorContext {
  let offset = 0;

  for (const node of doc.nodes) {
    if (node.type === "text") {
      const end = offset + node.text.length;
      if (index < end) {
        return { kind: "text" };
      }
      offset = end;
      continue;
    }

    const start = offset;
    const end = offset + 1 + node.agentId.length;
    if (index === start || index === end) {
      return { kind: "mention-boundary", start, end, edge: index === start ? "start" : "end" };
    }
    if (index > start && index < end) {
      return { kind: "mention-interior", start, end, agentId: node.agentId };
    }
    offset = end;
  }

  return { kind: "text" };
}

export function resolveHandoffNoteArrowMove(
  doc: HandoffNoteDoc,
  cursor: number,
  direction: HandoffNoteArrowDirection
): { cursor: number; handled: boolean } {
  const bleed = resolveHorizontalBleedWireMove(doc, cursor, direction);
  if (bleed === null || bleed.offset === cursor) {
    return { cursor, handled: false };
  }
  return { cursor: bleed.offset, handled: true };
}

export function snapHandoffNoteCursorOutOfMentionInterior(
  doc: HandoffNoteDoc,
  index: number,
  fromIndex?: number
): number {
  const context = describeHandoffNoteCursorContext(doc, index);
  if (context.kind !== "mention-interior") {
    return index;
  }
  if (fromIndex !== undefined) {
    return fromIndex > index ? context.start : context.end;
  }
  return context.end;
}

export function resolveHandoffWireCursor(
  doc: HandoffNoteDoc,
  cursor: number,
  fromIndex?: number
): number {
  const clamped = Math.max(0, Math.min(cursor, docLength(doc)));
  return snapHandoffNoteCursorOutOfMentionInterior(doc, clamped, fromIndex);
}

export function resolveHandoffNoteMentionEdit(
  doc: HandoffNoteDoc,
  cursor: number,
  edit: HandoffNoteEdit
): { doc: HandoffNoteDoc; cursor: number } | null {
  const len = docLength(doc);
  if (edit === "backspace" && cursor <= 0) {
    return null;
  }
  if (edit === "delete" && cursor >= len) {
    return null;
  }

  let offset = 0;
  for (const node of doc.nodes) {
    if (node.type === "text") {
      offset += node.text.length;
      continue;
    }

    const start = offset;
    const end = offset + 1 + node.agentId.length;
    const inRange =
      edit === "backspace" ? cursor > start && cursor <= end : cursor >= start && cursor < end;

    if (inRange) {
      return {
        doc: deleteDocWireRange(doc, start, end),
        cursor: start,
      };
    }
    offset = end;
  }

  return null;
}

/**
 * Map a wire-string offset to a node index and offset inside that node.
 * Boundary offsets between nodes resolve to the start of the next node (same as textarea index at `@`).
 */
export function resolveDocPosition(
  doc: HandoffNoteDoc,
  offset: number
): { nodeIndex: number; nodeOffset: number } | null {
  const length = docLength(doc);
  const clamped = Math.max(0, Math.min(offset, length));

  if (doc.nodes.length === 0) {
    return { nodeIndex: 0, nodeOffset: 0 };
  }

  let cursor = 0;
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    const nodeLength = node.type === "text" ? node.text.length : 1 + node.agentId.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + nodeLength;

    if (clamped > nodeStart && clamped < nodeEnd) {
      return { nodeIndex, nodeOffset: clamped - nodeStart };
    }
    if (clamped === nodeStart) {
      return { nodeIndex, nodeOffset: 0 };
    }
    if (clamped === nodeEnd) {
      if (nodeIndex === doc.nodes.length - 1) {
        return { nodeIndex, nodeOffset: nodeLength };
      }
      cursor = nodeEnd;
      continue;
    }
    cursor = nodeEnd;
  }

  return null;
}

/** Map node index + in-node offset to a wire-string offset. */
export function offsetAtDocPosition(
  doc: HandoffNoteDoc,
  nodeIndex: number,
  nodeOffset: number
): number {
  let offset = 0;
  for (let index = 0; index < doc.nodes.length; index++) {
    const node = doc.nodes[index]!;
    if (index === nodeIndex) {
      if (node.type === "text") {
        return offset + Math.max(0, Math.min(nodeOffset, node.text.length));
      }
      const tokenLength = 1 + node.agentId.length;
      return offset + Math.max(0, Math.min(nodeOffset, tokenLength));
    }
    offset += node.type === "text" ? node.text.length : 1 + node.agentId.length;
  }
  return offset;
}

function nodeWireLength(node: HandoffNoteNode): number {
  return node.type === "text" ? node.text.length : 1 + node.agentId.length;
}

/**
 * Delete wire range [start, end) on the doc node list.
 * Mention atoms delete in full when the range touches any part of them.
 */
export function deleteDocWireRange(
  doc: HandoffNoteDoc,
  start: number,
  end: number
): HandoffNoteDoc {
  const len = docLength(doc);
  const a = Math.max(0, Math.min(Math.min(start, end), len));
  const b = Math.max(0, Math.min(Math.max(start, end), len));
  if (a === b) {
    return { nodes: [...doc.nodes] };
  }

  const result: HandoffNoteNode[] = [];
  let offset = 0;

  for (const node of doc.nodes) {
    const nodeLen = nodeWireLength(node);
    const nodeStart = offset;
    const nodeEnd = offset + nodeLen;

    if (nodeEnd <= a || nodeStart >= b) {
      result.push(node);
    } else if (node.type === "text") {
      const leftEnd = Math.max(nodeStart, a);
      const rightStart = Math.min(nodeEnd, b);
      const left = node.text.slice(0, leftEnd - nodeStart);
      const right = node.text.slice(rightStart - nodeStart);
      if (left) {
        result.push({ type: "text", text: left });
      }
      if (right) {
        result.push({ type: "text", text: right });
      }
    }

    offset = nodeEnd;
  }

  return { nodes: coalesceTextNodes(result) };
}

/** Insert doc nodes at a wire offset without serializing the whole document to wire. */
export function insertDocNodesAt(
  doc: HandoffNoteDoc,
  offset: number,
  insertNodes: HandoffNoteNode[]
): HandoffNoteDoc {
  if (insertNodes.length === 0) {
    return { nodes: [...doc.nodes] };
  }

  const len = docLength(doc);
  const clamped = Math.max(0, Math.min(offset, len));
  const pos = resolveDocPosition(doc, clamped);
  if (!pos) {
    return { nodes: coalesceTextNodes([...doc.nodes, ...insertNodes]) };
  }

  const { nodeIndex, nodeOffset } = pos;
  const node = doc.nodes[nodeIndex];

  if (!node) {
    return { nodes: coalesceTextNodes([...insertNodes, ...doc.nodes]) };
  }

  if (node.type === "text") {
    const left = node.text.slice(0, nodeOffset);
    const right = node.text.slice(nodeOffset);
    const rebuilt: HandoffNoteNode[] = [
      ...doc.nodes.slice(0, nodeIndex),
      ...(left ? [{ type: "text" as const, text: left }] : []),
      ...insertNodes,
      ...(right ? [{ type: "text" as const, text: right }] : []),
      ...doc.nodes.slice(nodeIndex + 1),
    ];
    return { nodes: coalesceTextNodes(rebuilt) };
  }

  if (nodeOffset <= 0) {
    return {
      nodes: coalesceTextNodes([
        ...doc.nodes.slice(0, nodeIndex),
        ...insertNodes,
        ...doc.nodes.slice(nodeIndex),
      ]),
    };
  }

  return {
    nodes: coalesceTextNodes([
      ...doc.nodes.slice(0, nodeIndex + 1),
      ...insertNodes,
      ...doc.nodes.slice(nodeIndex + 1),
    ]),
  };
}

/**
 * Replace wire-string range [start, end) with `insertion`.
 * Operates on the doc node list so mention boundaries from the CE DOM are preserved.
 */
export function spliceDocWireRange(
  doc: HandoffNoteDoc,
  start: number,
  end: number,
  insertion: string
): HandoffNoteDoc {
  const deleted = deleteDocWireRange(doc, start, end);
  const insertNodes = insertion ? wireToDoc(sanitizeMentionPasteWire(insertion)).nodes : [];
  const offset = Math.max(0, Math.min(Math.min(start, end), docLength(deleted)));
  return insertDocNodesAt(deleted, offset, insertNodes);
}

/** Insert a mention atom at wire offset, replacing any partial `@query` range when provided. */
export function insertMentionAt(
  doc: HandoffNoteDoc,
  agentId: string,
  replaceStart: number,
  replaceEnd: number
): HandoffNoteDoc {
  const before = spliceDocWireRange(doc, replaceStart, replaceEnd, "");
  const startPos = resolveDocPosition(before, replaceStart);
  if (!startPos) {
    return wireToDoc(docToWire(before) + `@${agentId} `);
  }

  const nextNodes = [...before.nodes];
  const mentionNode: HandoffNoteMentionNode = { type: "mention", agentId };

  // Commit spacer is a space. A following `\n` is a row break — not an existing spacer.
  const padAfterMention = (right: string): HandoffNoteNode[] => {
    if (right.startsWith(" ")) {
      return [];
    }
    return [{ type: "text", text: " " }];
  };

  const finishInsert = (nodes: HandoffNoteNode[]): HandoffNoteDoc =>
    normalizeHandoffNoteDoc({ nodes });

  const at = startPos.nodeIndex;
  const node = nextNodes[at];
  if (!node) {
    nextNodes.push(mentionNode, { type: "text", text: " " });
    return finishInsert(nextNodes);
  }

  if (node.type === "text") {
    const left = node.text.slice(0, startPos.nodeOffset);
    const right = node.text.slice(startPos.nodeOffset);
    return finishInsert([
      ...nextNodes.slice(0, at),
      ...(left ? [{ type: "text" as const, text: left }] : []),
      mentionNode,
      ...padAfterMention(right),
      ...(right ? [{ type: "text" as const, text: right }] : []),
      ...nextNodes.slice(at + 1),
    ]);
  }

  // Wire offset at a mention atom start commits `@query` typed before the pill — insert
  // the new atom ahead of the existing one (same rule as insertDocNodesAt).
  if (startPos.nodeOffset <= 0) {
    return finishInsert([
      ...nextNodes.slice(0, at),
      mentionNode,
      { type: "text", text: " " },
      ...nextNodes.slice(at),
    ]);
  }

  return finishInsert([
    ...nextNodes.slice(0, at),
    mentionNode,
    { type: "text", text: " " },
    ...nextNodes.slice(at + 1),
  ]);
}

export function docsEqual(a: HandoffNoteDoc, b: HandoffNoteDoc): boolean {
  return docToWire(a) === docToWire(b);
}

/** Canonical doc shape after edits — coalesce text fragments only. */
export function normalizeHandoffNoteDoc(doc: HandoffNoteDoc): HandoffNoteDoc {
  return { nodes: coalesceTextNodes([...doc.nodes]) };
}

/** Wire ingress — coalesce text and insert separators between adjacent mention atoms. */
export function canonicalizeHandoffNoteDocFromWire(doc: HandoffNoteDoc): HandoffNoteDoc {
  return separateAdjacentMentions(normalizeHandoffNoteDoc(doc));
}

/** Insert a space text node between adjacent mention atoms so wire offsets stay unambiguous. */
export function separateAdjacentMentions(doc: HandoffNoteDoc): HandoffNoteDoc {
  if (doc.nodes.length < 2) {
    return { nodes: [...doc.nodes] };
  }

  const nodes: HandoffNoteNode[] = [];
  for (const node of doc.nodes) {
    const prev = nodes[nodes.length - 1];
    if (prev?.type === "mention" && node.type === "mention") {
      nodes.push({ type: "text", text: " " });
    }
    nodes.push(node);
  }
  return { nodes: coalesceTextNodes(nodes) };
}
