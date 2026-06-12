import {
  docLength,
  docToWire,
  describeHandoffNoteCursorContext,
  offsetAtDocPosition,
  resolveDocPosition,
  type HandoffNoteArrowDirection,
  type HandoffNoteDoc,
  type HandoffNoteEdit,
  type HandoffNoteNode,
} from "./handoff-note-doc.js";

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

export function resolveDocArrowMove(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  direction: HandoffNoteArrowDirection
): { pos: HandoffNoteDocPos; handled: boolean } {
  const wire = docPosToWireOffset(doc, pos);
  const context = describeHandoffNoteCursorContext(doc, wire);

  if (context.kind === "mention-interior") {
    const nextWire = direction === "left" ? context.start : context.end;
    return {
      pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, nextWire)),
      handled: true,
    };
  }

  if (context.kind === "mention-boundary") {
    if (direction === "left" && context.edge === "end") {
      return {
        pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, context.start)),
        handled: true,
      };
    }
    if (direction === "right" && context.edge === "start") {
      return {
        pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, context.end)),
        handled: true,
      };
    }
    if (direction === "left" && context.edge === "start" && context.start > 0) {
      return {
        pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, context.start - 1)),
        handled: true,
      };
    }
    if (direction === "right" && context.edge === "end" && context.end < docLength(doc)) {
      return {
        pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, context.end + 1)),
        handled: true,
      };
    }
  }

  const delta = direction === "left" ? -1 : 1;
  const nextWire = wire + delta;
  if (nextWire < 0 || nextWire > docLength(doc)) {
    return { pos, handled: false };
  }

  const nextContext = describeHandoffNoteCursorContext(doc, nextWire);
  if (nextContext.kind === "mention-interior") {
    const snapped = direction === "left" ? nextContext.start : nextContext.end;
    return {
      pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, snapped)),
      handled: true,
    };
  }

  return { pos, handled: false };
}

export type HandoffNoteVerticalArrowDirection = "up" | "down";

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

function isEmptyWireLine(wire: string, lineStart: number, lineEnd: number): boolean {
  for (let index = lineStart; index <= lineEnd; index++) {
    const char = wire[index];
    if (char !== undefined && char !== "\n") {
      return false;
    }
  }
  return true;
}

function resolveWireLineColumn(
  wire: string,
  offset: number
): { lineIndex: number; column: number; lineStart: number } {
  const clamped = Math.max(0, Math.min(offset, wire.length));
  const lineStarts = wireLineStarts(wire);
  for (let lineIndex = lineStarts.length - 1; lineIndex >= 0; lineIndex--) {
    const lineStart = lineStarts[lineIndex]!;
    const lineContentEnd =
      lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1]! - 1 : wire.length;
    if (clamped >= lineStart && clamped <= lineContentEnd) {
      return { lineIndex, column: clamped - lineStart, lineStart };
    }
  }
  return { lineIndex: 0, column: clamped, lineStart: 0 };
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
  if (!wire.includes("\n")) {
    return { pos, handled: false };
  }

  const offset = docPosToWireOffset(doc, pos);
  const { lineIndex, column } = resolveWireLineColumn(wire, offset);
  const lineStarts = wireLineStarts(wire);
  const targetLineIndex = direction === "up" ? lineIndex - 1 : lineIndex + 1;
  if (targetLineIndex < 0 || targetLineIndex >= lineStarts.length) {
    return { pos, handled: false };
  }

  const currentLineStart = lineStarts[lineIndex]!;
  const currentLineEnd = wireLineEnd(lineStarts, lineIndex, wire.length);
  const targetLineStart = lineStarts[targetLineIndex]!;
  const targetLineEnd = wireLineEnd(lineStarts, targetLineIndex, wire.length);
  let targetOffset: number;
  if (direction === "up" && isEmptyWireLine(wire, currentLineStart, currentLineEnd)) {
    targetOffset = currentLineStart - 1;
  } else if (
    direction === "up" &&
    offset === currentLineEnd &&
    !isEmptyWireLine(wire, currentLineStart, currentLineEnd)
  ) {
    targetOffset = offset - 1;
  } else if (direction === "down" && isEmptyWireLine(wire, targetLineStart, targetLineEnd)) {
    if (
      !isEmptyWireLine(wire, currentLineStart, currentLineEnd) &&
      offset > currentLineStart &&
      offset < currentLineEnd
    ) {
      targetOffset = offset + 1;
    } else if (
      offset === currentLineStart &&
      !isEmptyWireLine(wire, currentLineStart, currentLineEnd) &&
      describeHandoffNoteCursorContext(doc, offset).kind === "mention-boundary"
    ) {
      targetOffset = offset + 1;
    } else {
      targetOffset = targetLineStart;
    }
  } else {
    const targetColumn = Math.min(column, targetLineEnd - targetLineStart);
    targetOffset = targetLineStart + targetColumn;
  }

  const context = describeHandoffNoteCursorContext(doc, targetOffset);
  if (context.kind === "mention-interior") {
    targetOffset = direction === "up" ? context.start : context.end;
  }

  let targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, targetOffset), { from: pos });
  targetPos = snapVerticalArrowLanding(doc, targetPos, direction, targetLineStart);

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
