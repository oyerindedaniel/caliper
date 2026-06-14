import {
  offsetAtDocPosition,
  resolveDocPosition,
  type HandoffNoteDoc,
} from "./handoff-note-doc.js";
import {
  resolveWireLineColumn,
  type HandoffNoteVerticalArrowDirection,
} from "./handoff-note-wire-lines.js";

export type EmbeddedNewlineRun = {
  textNodeIndex: number;
  textStartWire: number;
  textEndWire: number;
  lastContentWire: number;
  suffixStartWire: number;
  beforeMention: boolean;
  afterMention: boolean;
  atLastContent: boolean;
  inSuffix: boolean;
};

function suffixStartInText(text: string): number {
  let index = text.length;
  while (index > 0 && text[index - 1] === "\n") {
    index--;
  }
  return index;
}

/** `\n` run embedded in a text node after its last non-newline character. */
export function describeEmbeddedNewlineRun(
  doc: HandoffNoteDoc,
  wire: string,
  offset: number
): EmbeddedNewlineRun | null {
  const clamped = Math.max(0, Math.min(offset, wire.length));
  const pos = resolveDocPosition(doc, clamped);
  if (pos === null) {
    return null;
  }

  const node = doc.nodes[pos.nodeIndex];
  if (node?.type !== "text") {
    return null;
  }

  const suffixStartInNode = suffixStartInText(node.text);
  const textStartWire = offsetAtDocPosition(doc, pos.nodeIndex, 0);
  const textEndWire = textStartWire + node.text.length;
  const lastContentInNode = Math.max(0, suffixStartInNode - 1);
  const lastContentWire = textStartWire + lastContentInNode;
  const suffixStartWire = textStartWire + suffixStartInNode;
  const beforeMention = doc.nodes[pos.nodeIndex + 1]?.type === "mention";
  const afterMention = doc.nodes[pos.nodeIndex - 1]?.type === "mention";

  if (suffixStartInNode >= node.text.length) {
    if (!beforeMention && !afterMention) {
      return null;
    }
    return {
      textNodeIndex: pos.nodeIndex,
      textStartWire,
      textEndWire,
      lastContentWire,
      suffixStartWire: textEndWire,
      beforeMention,
      afterMention,
      atLastContent:
        clamped === lastContentWire || (clamped === textEndWire && (beforeMention || afterMention)),
      inSuffix: false,
    };
  }

  return {
    textNodeIndex: pos.nodeIndex,
    textStartWire,
    textEndWire,
    lastContentWire,
    suffixStartWire,
    beforeMention,
    afterMention,
    atLastContent:
      clamped === lastContentWire || (clamped === textEndWire && (beforeMention || afterMention)),
    inSuffix: clamped >= suffixStartWire && clamped < textEndWire && wire[clamped] === "\n",
  };
}

function hasFollowingMentionOnSameWireRow(wire: string, mentionStart: number): boolean {
  const { lineEnd } = resolveWireLineColumn(wire, mentionStart);
  for (let index = mentionStart + 1; index <= lineEnd; index++) {
    if (wire[index] === "@") {
      return true;
    }
  }
  return false;
}

export function resolveEmbeddedNewlineVerticalStep(
  doc: HandoffNoteDoc,
  wire: string,
  offset: number,
  direction: HandoffNoteVerticalArrowDirection
): { offset: number; branch: string } | null {
  const run = describeEmbeddedNewlineRun(doc, wire, offset);
  if (run === null) {
    return null;
  }

  if (direction === "down") {
    if (!run.atLastContent && !run.inSuffix) {
      return null;
    }
    const next = offset + 1;
    if (next <= wire.length && wire[next] === "\n") {
      return { offset: next, branch: "embedded-newline-down" };
    }
    return null;
  }

  if (direction === "up") {
    if (run.inSuffix) {
      if (offset === run.suffixStartWire) {
        return { offset: run.lastContentWire, branch: "embedded-newline-up-from-suffix-start" };
      }
      return { offset: offset - 1, branch: "embedded-newline-up" };
    }
    return null;
  }

  return null;
}

export function resolveAfterPillRowBlankUpStep(
  doc: HandoffNoteDoc,
  wire: string,
  offset: number
): { offset: number; branch: string } | null {
  const pos = resolveDocPosition(doc, offset);
  if (pos === null) {
    return null;
  }
  const node = doc.nodes[pos.nodeIndex];
  if (node?.type !== "text" || doc.nodes[pos.nodeIndex - 1]?.type !== "mention") {
    return null;
  }
  const leadingNewlineInNode = node.text.search("\n");
  if (leadingNewlineInNode < 0 || !/^\s*\n{2,}/.test(node.text)) {
    return null;
  }

  const nodeStart = offsetAtDocPosition(doc, pos.nodeIndex, 0);
  const newlineRunStart = nodeStart + leadingNewlineInNode;
  const firstBlankBelowOffset = newlineRunStart + 1;
  if (offset !== firstBlankBelowOffset) {
    return null;
  }

  const pillRowStart = pillRowStartBeforeOffset(wire, newlineRunStart);
  if (pillRowStart < 0) {
    return null;
  }
  return { offset: pillRowStart, branch: "after-pill-row-blank-up" };
}

function pillRowStartBeforeOffset(wire: string, nodeStart: number): number {
  let lineStart = nodeStart;
  while (lineStart > 0 && wire[lineStart - 1] === "\n") {
    lineStart--;
  }
  lineStart = wire.lastIndexOf("\n", Math.max(0, lineStart - 1)) + 1;
  const pillRowStart = wire.indexOf("@", lineStart);
  if (pillRowStart < 0 || pillRowStart >= nodeStart) {
    return -1;
  }
  return pillRowStart;
}

export function redirectEmbeddedNewlineVerticalLanding(
  doc: HandoffNoteDoc,
  wire: string,
  fromOffset: number,
  landingOffset: number,
  direction: HandoffNoteVerticalArrowDirection
): number {
  if (direction !== "up") {
    return landingOffset;
  }

  const prefixRun = prefixEmbeddedRunBeforeOffset(doc, wire, fromOffset);
  if (prefixRun === null || fromOffset < prefixRun.textEndWire) {
    return landingOffset;
  }

  const rowStart = prefixRun.textEndWire;
  if (landingOffset === rowStart) {
    return firstMentionEndBeforeOffset(doc, rowStart);
  }

  if (
    isInterMentionGapWireOffset(doc, fromOffset) &&
    fromOffset >= rowStart &&
    landingOffset >= prefixRun.suffixStartWire &&
    landingOffset < rowStart
  ) {
    return firstMentionEndBeforeOffset(doc, rowStart);
  }

  const afterPillRowStart = afterPillRowBlankLanding(doc, wire, fromOffset, landingOffset);
  if (afterPillRowStart !== null) {
    return afterPillRowStart;
  }

  return landingOffset;
}

function prefixEmbeddedRunBeforeOffset(
  doc: HandoffNoteDoc,
  wire: string,
  offset: number
): EmbeddedNewlineRun | null {
  let best: EmbeddedNewlineRun | null = null;
  let bestStart = -1;

  for (let index = 0; index < doc.nodes.length; index++) {
    const node = doc.nodes[index]!;
    if (node.type !== "mention") {
      continue;
    }
    const start = offsetAtDocPosition(doc, index, 0);
    if (offset < start || start <= bestStart) {
      continue;
    }
    const prefixRun = describeEmbeddedNewlineRun(doc, wire, start - 1);
    if (prefixRun?.beforeMention && start === prefixRun.textEndWire) {
      const blankRunLength = start - prefixRun.suffixStartWire;
      if (blankRunLength >= 2) {
        best = prefixRun;
        bestStart = start;
      }
    }
  }

  return best;
}

function firstMentionEndBeforeOffset(doc: HandoffNoteDoc, mentionStart: number): number {
  for (let index = 0; index < doc.nodes.length; index++) {
    const node = doc.nodes[index]!;
    if (node.type !== "mention") {
      continue;
    }
    const start = offsetAtDocPosition(doc, index, 0);
    if (start !== mentionStart) {
      continue;
    }
    return start + node.agentId.length;
  }
  return mentionStart;
}

function afterPillRowBlankLanding(
  doc: HandoffNoteDoc,
  wire: string,
  fromOffset: number,
  landingOffset: number
): number | null {
  const step = resolveAfterPillRowBlankUpStep(doc, wire, fromOffset);
  if (step === null || landingOffset === step.offset) {
    return null;
  }
  return step.offset;
}

function isInterMentionGapWireOffset(doc: HandoffNoteDoc, offset: number): boolean {
  const pos = resolveDocPosition(doc, offset);
  if (pos === null) {
    return false;
  }
  const node = doc.nodes[pos.nodeIndex];
  if (node?.type !== "text") {
    return false;
  }
  return (
    doc.nodes[pos.nodeIndex - 1]?.type === "mention" &&
    doc.nodes[pos.nodeIndex + 1]?.type === "mention"
  );
}

type MentionBoundaryContext = {
  kind: "mention-boundary";
  start: number;
  end: number;
  edge: "start" | "end";
};

function describeMentionBoundaryAt(
  doc: HandoffNoteDoc,
  wire: string,
  offset: number
): MentionBoundaryContext | null {
  let cursor = 0;
  for (const node of doc.nodes) {
    if (node.type === "text") {
      cursor += node.text.length;
      continue;
    }
    const start = cursor;
    const end = cursor + 1 + node.agentId.length;
    if (offset === start) {
      return { kind: "mention-boundary", start, end, edge: "start" };
    }
    if (offset === end) {
      return { kind: "mention-boundary", start, end, edge: "end" };
    }
    cursor = end;
  }
  return null;
}

export function resolveEmbeddedNewlineHorizontalStep(
  doc: HandoffNoteDoc,
  wire: string,
  offset: number,
  direction: "left" | "right"
): { offset: number; branch: string } | null {
  if (direction !== "left") {
    return null;
  }

  const context = describeMentionBoundaryAt(doc, wire, offset);
  if (context?.kind !== "mention-boundary" || context.edge !== "start") {
    return null;
  }

  const prior = offset - 1;
  if (prior < 0 || wire[prior] !== "\n") {
    return null;
  }

  const run = describeEmbeddedNewlineRun(doc, wire, prior);
  if (run === null || !run.beforeMention || !run.inSuffix) {
    return null;
  }

  if (offset - run.suffixStartWire < 2) {
    return null;
  }

  if (!hasFollowingMentionOnSameWireRow(wire, offset)) {
    return null;
  }

  return { offset: run.lastContentWire, branch: "embedded-newline-left-from-mention-start" };
}

export function resolveEmbeddedNewlineUpFromMentionStart(
  doc: HandoffNoteDoc,
  wire: string,
  offset: number
): { offset: number; branch: string } | null {
  const context = describeMentionBoundaryAt(doc, wire, offset);
  if (context?.edge !== "start") {
    return null;
  }

  const prefixRun = prefixEmbeddedRunBeforeOffset(doc, wire, offset);
  if (prefixRun === null || offset !== prefixRun.textEndWire) {
    return null;
  }

  const hasPriorMention = doc.nodes
    .slice(0, prefixRun.textNodeIndex)
    .some((node) => node.type === "mention");
  if (hasPriorMention) {
    return null;
  }

  return {
    offset: prefixRun.lastContentWire,
    branch: "embedded-newline-up-from-mention-start",
  };
}
