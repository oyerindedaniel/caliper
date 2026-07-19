import {
  docLength,
  docToWire,
  offsetAtDocPosition,
  resolveDocPosition,
  type HandoffNoteDoc,
  type HandoffNoteNode,
} from "./handoff-note-doc.js";
import {
  resolveEmbeddedBlankBandVerticalMove,
  resolveVerticalArrowWireMove,
  type VerticalNavLineSpan,
} from "./handoff-note-vertical-nav.js";
import {
  resolveWireLineColumn,
  type HandoffNoteVerticalArrowDirection,
} from "./handoff-note-wire-lines.js";

export type HandoffNoteDocPos = {
  nodeIndex: number;
  nodeOffset: number;
};

/**
 * When focus sits on a content char immediately before `\n`, wire alone cannot tell
 * visual-start / deletion-point from content-row-end. `before` = deletion point (insert
 * at the char, paint offset 0); `after` = content row end (insert after char, paint text-tail).
 */
export type HandoffNoteCaretAffinity = "before" | "after";

export type HandoffNoteSelection = {
  anchor: HandoffNoteDocPos;
  focus: HandoffNoteDocPos;
  focusAffinity?: HandoffNoteCaretAffinity;
};

export type DocPosBias = "start" | "end";

/** Wire/token length of a doc node (text chars, or atomic `1 + agentId.length`). */
export function nodeTokenLength(node: HandoffNoteNode): number {
  return node.type === "text" ? node.text.length : 1 + node.agentId.length;
}

/** Non-text doc node — mention today; other atom kinds extend here. */
export function isAtomicNode(
  node: HandoffNoteNode | undefined
): node is Exclude<HandoffNoteNode, { type: "text" }> {
  return node != null && node.type !== "text";
}

export function collapsedSelection(
  pos: HandoffNoteDocPos,
  focusAffinity?: HandoffNoteCaretAffinity
): HandoffNoteSelection {
  if (focusAffinity === undefined) {
    return { anchor: { ...pos }, focus: { ...pos } };
  }
  return { anchor: { ...pos }, focus: { ...pos }, focusAffinity };
}

/** True when focus wire is a content char with a following `\n` (sole/last-char ambiguity). */
export function isCaretOnContentCharBeforeBreak(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos
): boolean {
  const wireText = docToWire(doc);
  const wire = docPosToWireOffset(doc, pos);
  if (wire < 0 || wire >= wireText.length || wireText[wire] === "\n") {
    return false;
  }
  return wire + 1 < wireText.length && wireText[wire + 1] === "\n";
}

/**
 * Past the ambiguous last content char — unit-ahead / insert-after starts at the following `\n`.
 * Callers decide when (insert: not `before`; delete: explicit `after`).
 */
export function docPosAfterContentCharBeforeBreak(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos
): HandoffNoteDocPos {
  if (!isCaretOnContentCharBeforeBreak(doc, pos)) {
    return pos;
  }
  return wireOffsetToDocPos(doc, docPosToWireOffset(doc, pos) + 1);
}

/**
 * Affinity gate shared by Backspace (unit behind) and Delete (unit ahead) on the
 * ambiguous last content char before `\n`.
 *
 * - Delete + `after`: advance `focus` past the char so the intent chain sees unit ahead
 *   (break / blank / join). No `contentCharUnit` — downstream owns the ahead unit.
 * - Backspace + `after`: `focus` stays; `contentCharUnit` is that char (unit behind).
 * - `before` / omit: `focus` stays; no `contentCharUnit` (Delete nips the char via the
 *   chain; Backspace uses generic unit-behind).
 *
 * Insert is intentionally separate: omit defaults to append-after, while Delete omit
 * keeps the char as unit ahead.
 */
export type DirectionalUnitFocus = {
  focus: HandoffNoteDocPos;
  /** Half-open wire range when this keystroke's unit is exactly that content char. */
  contentCharUnit?: { startWire: number; endWire: number };
};

export function resolveDirectionalUnitFocus(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  focusAffinity: HandoffNoteCaretAffinity | undefined,
  direction: "backspace" | "delete"
): DirectionalUnitFocus {
  const normalized = normalizeDocPos(doc, focus);
  if (direction === "delete") {
    if (focusAffinity === "after") {
      return {
        focus: normalizeDocPos(doc, docPosAfterContentCharBeforeBreak(doc, normalized)),
      };
    }
    return { focus: normalized };
  }
  if (focusAffinity === "after" && isCaretOnContentCharBeforeBreak(doc, normalized)) {
    const startWire = docPosToWireOffset(doc, normalized);
    return {
      focus: normalized,
      contentCharUnit: { startWire, endWire: startWire + 1 },
    };
  }
  return { focus: normalized };
}

/**
 * Affinity only when last-char-before-`\n` is ambiguous; otherwise omit (no disambiguation).
 * `deletion-point` → before; `content-row-end` → after.
 */
export function caretAffinityForAmbiguousBreak(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  intent: "deletion-point" | "content-row-end"
): HandoffNoteCaretAffinity | undefined {
  if (!isCaretOnContentCharBeforeBreak(doc, pos)) {
    return undefined;
  }
  return intent === "deletion-point" ? "before" : "after";
}

export function collapsedSelectionWithIntent(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  intent: "deletion-point" | "content-row-end"
): HandoffNoteSelection {
  const normalized = normalizeDocPos(doc, pos);
  return collapsedSelection(normalized, caretAffinityForAmbiguousBreak(doc, normalized, intent));
}

/** Keep affinity only while focus remains on the ambiguous last char before `\n`. */
export function focusAffinityIfAmbiguousBreak(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  focusAffinity?: HandoffNoteCaretAffinity
): HandoffNoteCaretAffinity | undefined {
  if (focusAffinity === undefined || !isCaretOnContentCharBeforeBreak(doc, focus)) {
    return undefined;
  }
  return focusAffinity;
}

/**
 * Collapsed selection at `focus`, carrying affinity from `source` when both share the
 * same wire and that wire is still char-before-break (Delete / paint-normalized focus).
 */
export function collapsedSelectionCarryingAffinity(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  source: HandoffNoteSelection
): HandoffNoteSelection {
  const sameWire = docPosToWireOffset(doc, focus) === docPosToWireOffset(doc, source.focus);
  return collapsedSelection(
    focus,
    sameWire ? focusAffinityIfAmbiguousBreak(doc, focus, source.focusAffinity) : undefined
  );
}

/**
 * After DOM repair: prefer live-recovered affinity on the same wire, else prior authority.
 * Drops affinity when focus is no longer the ambiguous char-before-break.
 */
export function collapsedSelectionReconcilingAffinity(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  live: HandoffNoteSelection,
  prior: HandoffNoteSelection
): HandoffNoteSelection {
  const focusWire = docPosToWireOffset(doc, focus);
  let candidate: HandoffNoteCaretAffinity | undefined;
  if (docPosToWireOffset(doc, live.focus) === focusWire) {
    candidate = live.focusAffinity;
  } else if (docPosToWireOffset(doc, prior.focus) === focusWire) {
    candidate = prior.focusAffinity;
  }
  return collapsedSelection(focus, focusAffinityIfAmbiguousBreak(doc, focus, candidate));
}

export function docPosEqual(a: HandoffNoteDocPos, b: HandoffNoteDocPos): boolean {
  return a.nodeIndex === b.nodeIndex && a.nodeOffset === b.nodeOffset;
}

export function selectionsEqual(a: HandoffNoteSelection, b: HandoffNoteSelection): boolean {
  return (
    docPosEqual(a.anchor, b.anchor) &&
    docPosEqual(a.focus, b.focus) &&
    (a.focusAffinity ?? "after") === (b.focusAffinity ?? "after")
  );
}

export function cloneDocPos(pos: HandoffNoteDocPos): HandoffNoteDocPos {
  return { nodeIndex: pos.nodeIndex, nodeOffset: pos.nodeOffset };
}

export function cloneSelection(selection: HandoffNoteSelection): HandoffNoteSelection {
  if (selection.focusAffinity === undefined) {
    return {
      anchor: cloneDocPos(selection.anchor),
      focus: cloneDocPos(selection.focus),
    };
  }
  return {
    anchor: cloneDocPos(selection.anchor),
    focus: cloneDocPos(selection.focus),
    focusAffinity: selection.focusAffinity,
  };
}

export function cloneDoc(doc: HandoffNoteDoc): HandoffNoteDoc {
  return {
    nodes: doc.nodes.map((node) =>
      node.type === "text"
        ? { type: "text", text: node.text }
        : { type: "mention", agentId: node.agentId }
    ),
  };
}

export function docEndPos(doc: HandoffNoteDoc): HandoffNoteDocPos {
  if (doc.nodes.length === 0) {
    return { nodeIndex: 0, nodeOffset: 0 };
  }
  const lastIndex = doc.nodes.length - 1;
  const last = doc.nodes[lastIndex]!;
  return { nodeIndex: lastIndex, nodeOffset: nodeTokenLength(last) };
}

/**
 * Select-all and native range ends often map to the last wire character (e.g. trailing `\n`
 * probe) instead of doc end — extend so delete clears the full document.
 */
export function expandSelectionFocusToDocEndIfNeeded(
  doc: HandoffNoteDoc,
  anchor: HandoffNoteDocPos,
  focus: HandoffNoteDocPos
): HandoffNoteDocPos {
  if (docPosEqual(anchor, focus)) {
    return focus;
  }
  const anchorWire = docPosToWireOffset(doc, anchor);
  const focusWire = docPosToWireOffset(doc, focus);
  const len = docLength(doc);
  if (anchorWire > 0 || focusWire >= len) {
    return focus;
  }
  const end = docEndPos(doc);
  if (docPosEqual(focus, end)) {
    return focus;
  }
  if (focusWire + 1 === len) {
    return end;
  }
  return focus;
}

export function docPosToWireOffset(doc: HandoffNoteDoc, pos: HandoffNoteDocPos): number {
  return offsetAtDocPosition(doc, pos.nodeIndex, pos.nodeOffset);
}

export function docSelectionToWire(doc: HandoffNoteDoc, selection: HandoffNoteSelection): string {
  const anchor = normalizeDocPos(doc, selection.anchor);
  const focus = normalizeDocPos(doc, selection.focus);
  const start = docPosToWireOffset(doc, anchor);
  const end = docPosToWireOffset(doc, focus);
  const wire = docToWire(doc);
  return wire.slice(Math.min(start, end), Math.max(start, end));
}

export function wireOffsetToDocPos(doc: HandoffNoteDoc, offset: number): HandoffNoteDocPos {
  const resolved = resolveDocPosition(doc, offset);
  return resolved ?? docEndPos(doc);
}

export function normalizeDocPos(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  options?: { bias?: DocPosBias; from?: HandoffNoteDocPos }
): HandoffNoteDocPos {
  if (doc.nodes.length === 0) {
    return { nodeIndex: 0, nodeOffset: 0 };
  }

  const nodeIndex = Math.max(0, Math.min(pos.nodeIndex, doc.nodes.length - 1));
  const node = doc.nodes[nodeIndex]!;

  if (node.type === "text") {
    return {
      nodeIndex,
      nodeOffset: Math.max(0, Math.min(pos.nodeOffset, node.text.length)),
    };
  }

  const tokenLength = nodeTokenLength(node);
  if (pos.nodeOffset <= 0) {
    return { nodeIndex, nodeOffset: 0 };
  }
  if (pos.nodeOffset >= tokenLength) {
    return { nodeIndex, nodeOffset: tokenLength };
  }

  if (options?.from) {
    const fromWire = docPosToWireOffset(doc, options.from);
    const wire = docPosToWireOffset(doc, pos);
    const start = wire - pos.nodeOffset;
    const end = start + tokenLength;
    if (fromWire === wire) {
      return { nodeIndex, nodeOffset: pos.nodeOffset };
    }
    if (fromWire === start) {
      return { nodeIndex, nodeOffset: tokenLength };
    }
    if (fromWire === end) {
      if (wire === end - 1) {
        return { nodeIndex, nodeOffset: wire - start };
      }
      return { nodeIndex, nodeOffset: 0 };
    }
    if (fromWire > end) {
      return { nodeIndex, nodeOffset: tokenLength };
    }
    if (fromWire < start) {
      return { nodeIndex, nodeOffset: 0 };
    }
    return { nodeIndex, nodeOffset: fromWire > wire ? 0 : tokenLength };
  }

  if (options?.bias === "start") {
    return { nodeIndex, nodeOffset: 0 };
  }
  if (options?.bias === "end") {
    return { nodeIndex, nodeOffset: tokenLength };
  }

  return { nodeIndex, nodeOffset: pos.nodeOffset };
}

export function normalizeSelection(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  options?: { from?: HandoffNoteDocPos }
): HandoffNoteSelection {
  const fromOpt = options?.from ? { from: options.from } : undefined;
  const focus = normalizeDocPos(doc, selection.focus, fromOpt);
  const normalized: HandoffNoteSelection = {
    anchor: normalizeDocPos(doc, selection.anchor, fromOpt),
    focus,
  };
  const focusAffinity = focusAffinityIfAmbiguousBreak(doc, focus, selection.focusAffinity);
  if (focusAffinity !== undefined) {
    normalized.focusAffinity = focusAffinity;
  }
  return normalized;
}

export function wireOffsetToCollapsedSelection(
  doc: HandoffNoteDoc,
  offset: number,
  fromOffset?: number
): HandoffNoteSelection {
  const from = fromOffset !== undefined ? wireOffsetToDocPos(doc, fromOffset) : undefined;
  const focus = normalizeDocPos(doc, wireOffsetToDocPos(doc, offset), { from });
  return collapsedSelection(focus);
}

export function docSelectionToWireRange(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection
): { start: number; end: number } {
  const start = docPosToWireOffset(doc, selection.anchor);
  const end = docPosToWireOffset(doc, selection.focus);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function wireLineStarts(wire: string): number[] {
  const starts = [0];
  for (let index = 0; index < wire.length; index++) {
    if (wire[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function wireLineEnd(lineStarts: number[], lineIndex: number, wireLength: number): number {
  return lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1]! - 1 : wireLength;
}

export function isInterMentionAtomStart(doc: HandoffNoteDoc, pos: HandoffNoteDocPos): boolean {
  const node = doc.nodes[pos.nodeIndex];
  if (node?.type !== "mention" || pos.nodeOffset !== 0) {
    return false;
  }
  return doc.nodes[pos.nodeIndex - 1]?.type === "mention";
}

/** Up-landing only: snap off glued mention-atom start to segment start. Shared by arrows and layout ingress. */
export function snapInterMentionAtomLanding(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  lineStartWire?: number
): HandoffNoteDocPos {
  if (direction !== "up" || !isInterMentionAtomStart(doc, pos)) {
    return pos;
  }
  const wire = docToWire(doc);
  const offset = docPosToWireOffset(doc, pos);
  const segmentStart = lineStartWire ?? wire.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  if (!wire.includes("\n") && segmentStart === 0) {
    return pos;
  }
  return normalizeDocPos(doc, wireOffsetToDocPos(doc, segmentStart), { from: pos });
}

export function resolveDocVerticalArrowMove(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection
): { pos: HandoffNoteDocPos; handled: boolean } {
  const wire = docToWire(doc);
  const offset = docPosToWireOffset(doc, pos);
  const { column } = resolveWireLineColumn(wire, Math.min(offset, Math.max(0, wire.length)));

  const embeddedMove = resolveEmbeddedBlankBandVerticalMove(doc, offset, direction, column);
  if (embeddedMove !== null) {
    let targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, embeddedMove.offset), {
      from: pos,
    });
    targetPos = snapInterMentionAtomLanding(doc, targetPos, direction);
    if (!docPosEqual(targetPos, pos)) {
      return { pos: targetPos, handled: true };
    }
  }

  const { lineIndex, lineStart, lineEnd } = resolveWireLineColumn(
    wire,
    Math.min(offset, Math.max(0, wire.length))
  );
  const lineStarts = wire.includes("\n") ? wireLineStarts(wire) : [0];
  const targetLineIndex = direction === "up" ? lineIndex - 1 : lineIndex + 1;

  const current: VerticalNavLineSpan = { start: lineStart, end: lineEnd };
  const target: VerticalNavLineSpan | null =
    targetLineIndex >= 0 && targetLineIndex < lineStarts.length
      ? {
          start: lineStarts[targetLineIndex]!,
          end: wireLineEnd(lineStarts, targetLineIndex, wire.length),
        }
      : null;

  const move = resolveVerticalArrowWireMove(doc, offset, direction, column, current, target);
  if (move === null) {
    return { pos, handled: false };
  }

  let targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, move.offset), { from: pos });
  targetPos = snapInterMentionAtomLanding(doc, targetPos, direction, target?.start);

  if (docPosEqual(targetPos, pos)) {
    return { pos, handled: false };
  }
  return { pos: targetPos, handled: true };
}

export function docsStructurallyEqual(a: HandoffNoteDoc, b: HandoffNoteDoc): boolean {
  if (a.nodes.length !== b.nodes.length) {
    return false;
  }
  for (let index = 0; index < a.nodes.length; index++) {
    const left = a.nodes[index]!;
    const right = b.nodes[index]!;
    if (left.type !== right.type) {
      return false;
    }
    if (left.type === "text" && right.type === "text" && left.text !== right.text) {
      return false;
    }
    if (left.type === "mention" && right.type === "mention" && left.agentId !== right.agentId) {
      return false;
    }
  }
  return true;
}

export function mentionCountInDoc(doc: HandoffNoteDoc): number {
  return doc.nodes.filter((node) => node.type === "mention").length;
}

/** Map doc position to the rendered child index (skips empty text nodes, same as render). */
export function docPosToRenderedChildIndex(doc: HandoffNoteDoc, nodeIndex: number): number {
  let rendered = 0;
  for (let index = 0; index < doc.nodes.length; index++) {
    const node = doc.nodes[index]!;
    if (node.type === "text" && !node.text) {
      if (index === nodeIndex) {
        return rendered;
      }
      continue;
    }
    if (index === nodeIndex) {
      return rendered;
    }
    rendered++;
  }
  return rendered;
}

export function renderedChildCount(doc: HandoffNoteDoc): number {
  return doc.nodes.filter((node) => node.type !== "text" || node.text).length;
}
