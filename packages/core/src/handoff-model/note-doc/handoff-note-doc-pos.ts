import {
  docToWire,
  offsetAtDocPosition,
  resolveDocPosition,
  type HandoffNoteArrowDirection,
  type HandoffNoteDoc,
  type HandoffNoteNode,
} from "./handoff-note-doc.js";
import {
  redirectEmbeddedNewlineVerticalLanding,
  resolveAfterPillRowBlankUpStep,
  resolveEmbeddedNewlineUpFromMentionStart,
  resolveEmbeddedNewlineVerticalStep,
} from "./handoff-note-embedded-newlines.js";
import {
  resolveHorizontalBleedWireMove,
  resolveVerticalArrowWireMove,
  type HandoffNoteVerticalArrowDirection,
  type VerticalNavLineSpan,
} from "./handoff-note-vertical-nav.js";
import { resolveWireLineColumn } from "./handoff-note-wire-lines.js";

export type HandoffNoteDocPos = {
  nodeIndex: number;
  nodeOffset: number;
};

export type HandoffNoteSelection = {
  anchor: HandoffNoteDocPos;
  focus: HandoffNoteDocPos;
};

export type DocPosBias = "start" | "end";

function nodeTokenLength(node: HandoffNoteNode): number {
  return node.type === "text" ? node.text.length : 1 + node.agentId.length;
}

export function collapsedSelection(pos: HandoffNoteDocPos): HandoffNoteSelection {
  return { anchor: { ...pos }, focus: { ...pos } };
}

export function docPosEqual(a: HandoffNoteDocPos, b: HandoffNoteDocPos): boolean {
  return a.nodeIndex === b.nodeIndex && a.nodeOffset === b.nodeOffset;
}

export function selectionsEqual(a: HandoffNoteSelection, b: HandoffNoteSelection): boolean {
  return docPosEqual(a.anchor, b.anchor) && docPosEqual(a.focus, b.focus);
}

export function cloneDocPos(pos: HandoffNoteDocPos): HandoffNoteDocPos {
  return { nodeIndex: pos.nodeIndex, nodeOffset: pos.nodeOffset };
}

export function cloneSelection(selection: HandoffNoteSelection): HandoffNoteSelection {
  return {
    anchor: cloneDocPos(selection.anchor),
    focus: cloneDocPos(selection.focus),
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
      const mid = tokenLength / 2;
      return { nodeIndex, nodeOffset: pos.nodeOffset < mid ? 0 : tokenLength };
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

  const mid = tokenLength / 2;
  return { nodeIndex, nodeOffset: pos.nodeOffset < mid ? 0 : tokenLength };
}

export function normalizeSelection(
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  options?: { from?: HandoffNoteDocPos }
): HandoffNoteSelection {
  const from = options?.from ?? selection.focus;
  return {
    anchor: normalizeDocPos(doc, selection.anchor, { from }),
    focus: normalizeDocPos(doc, selection.focus, { from }),
  };
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

export function resolveDocHorizontalArrowMove(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  direction: HandoffNoteArrowDirection
): { pos: HandoffNoteDocPos; handled: boolean } {
  const wire = docPosToWireOffset(doc, pos);
  const bleed = resolveHorizontalBleedWireMove(doc, wire, direction);
  if (bleed === null || bleed.offset === wire) {
    return { pos, handled: false };
  }

  const targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, bleed.offset), { from: pos });
  if (docPosEqual(targetPos, pos)) {
    return { pos, handled: false };
  }
  return { pos: targetPos, handled: true };
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

export function snapVerticalArrowLanding(
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
  const { lineIndex, column, lineStart, lineEnd } = resolveWireLineColumn(
    wire,
    Math.min(offset, Math.max(0, wire.length))
  );
  const lineStarts = wire.includes("\n") ? wireLineStarts(wire) : [0];
  const targetLineIndex = direction === "up" ? lineIndex - 1 : lineIndex + 1;

  const trailingStep = resolveEmbeddedNewlineVerticalStep(doc, wire, offset, direction);
  if (trailingStep !== null) {
    let targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, trailingStep.offset), {
      from: pos,
    });
    targetPos = snapVerticalArrowLanding(doc, targetPos, direction);
    if (!docPosEqual(targetPos, pos)) {
      return { pos: targetPos, handled: true };
    }
  }

  if (direction === "up") {
    const afterPillRowStep = resolveAfterPillRowBlankUpStep(doc, wire, offset);
    if (afterPillRowStep !== null) {
      const targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, afterPillRowStep.offset), {
        from: pos,
      });
      if (!docPosEqual(targetPos, pos)) {
        return { pos: targetPos, handled: true };
      }
    }

    const mentionStartStep = resolveEmbeddedNewlineUpFromMentionStart(doc, wire, offset);
    if (mentionStartStep !== null) {
      const targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, mentionStartStep.offset), {
        from: pos,
      });
      if (!docPosEqual(targetPos, pos)) {
        return { pos: targetPos, handled: true };
      }
    }
  }

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

  const landingOffset = redirectEmbeddedNewlineVerticalLanding(
    doc,
    wire,
    offset,
    move.offset,
    direction
  );

  let targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, landingOffset), { from: pos });
  targetPos = snapVerticalArrowLanding(doc, targetPos, direction, target?.start);

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
