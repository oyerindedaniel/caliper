import {
  describeHandoffNoteCursorContext,
  docLength,
  docToWire,
  type HandoffNoteDoc,
} from "./handoff-note-doc.js";
import { type HandoffNoteVerticalArrowDirection } from "./handoff-note-wire-lines.js";

export type { HandoffNoteVerticalArrowDirection } from "./handoff-note-wire-lines.js";

export type VerticalNavLineSpan = {
  start: number;
  end: number;
};

export type VerticalNavWireMove = {
  offset: number;
  branch: string;
};

function isEmptyWireLine(wire: string, lineStart: number, lineEnd: number): boolean {
  for (let index = lineStart; index <= lineEnd; index++) {
    const char = wire[index];
    if (char !== undefined && char !== "\n") {
      return false;
    }
  }
  return true;
}

function preserveColumnOnTargetLine(
  doc: HandoffNoteDoc,
  direction: HandoffNoteVerticalArrowDirection,
  column: number,
  targetLineStart: number,
  targetLineEnd: number
): number {
  const targetColumn = Math.min(column, targetLineEnd - targetLineStart);
  const projected = targetLineStart + targetColumn;
  return snapMentionInterior(doc, projected, direction);
}

function snapMentionInterior(
  doc: HandoffNoteDoc,
  offset: number,
  direction: HandoffNoteVerticalArrowDirection
): number {
  const context = describeHandoffNoteCursorContext(doc, offset);
  if (context.kind === "mention-interior") {
    return direction === "up" ? context.start : context.end;
  }
  return offset;
}

/** Clash-style bleed: at vertical extreme, step horizontally (left/up, right/down). */
export function resolveHorizontalBleedWireMove(
  doc: HandoffNoteDoc,
  offset: number,
  direction: "left" | "right"
): VerticalNavWireMove | null {
  const wire = docToWire(doc);
  const context = describeHandoffNoteCursorContext(doc, offset);

  if (context.kind === "mention-interior") {
    const next = direction === "left" ? context.start : context.end;
    if (next === offset) {
      return null;
    }
    return { offset: next, branch: `boundary-bleed-${direction}` };
  }

  if (context.kind === "mention-boundary") {
    if (direction === "left" && context.edge === "end") {
      return { offset: context.start, branch: "boundary-bleed-left" };
    }
    if (direction === "right" && context.edge === "start") {
      return { offset: context.end, branch: "boundary-bleed-right" };
    }
    if (direction === "left" && context.edge === "start" && context.start > 0) {
      return { offset: context.start - 1, branch: "boundary-bleed-left" };
    }
    if (direction === "right" && context.edge === "end" && context.end < docLength(doc)) {
      return { offset: context.end + 1, branch: "boundary-bleed-right" };
    }
  }

  const delta = direction === "left" ? -1 : 1;
  const next = offset + delta;
  if (next < 0 || next > wire.length) {
    return null;
  }
  const nextContext = describeHandoffNoteCursorContext(doc, next);
  if (nextContext.kind === "mention-interior") {
    const snapped = direction === "left" ? nextContext.start : nextContext.end;
    return { offset: snapped, branch: `boundary-bleed-${direction}` };
  }
  if (next === offset) {
    return null;
  }
  return { offset: next, branch: `boundary-bleed-${direction}` };
}

/** Cross-span move between adjacent wire or visual lines. */
export function resolveVerticalArrowCrossLineMove(
  doc: HandoffNoteDoc,
  wire: string,
  offset: number,
  direction: HandoffNoteVerticalArrowDirection,
  column: number,
  current: VerticalNavLineSpan,
  target: VerticalNavLineSpan
): VerticalNavWireMove | null {
  const currentLineStart = current.start;
  const currentLineEnd = current.end;
  const targetLineStart = target.start;
  const targetLineEnd = target.end;
  let targetOffset: number;
  let branch: string;

  if (direction === "up" && isEmptyWireLine(wire, currentLineStart, currentLineEnd)) {
    targetOffset = preserveColumnOnTargetLine(
      doc,
      direction,
      column,
      targetLineStart,
      targetLineEnd
    );
    branch = "empty-line-up";
  } else if (direction === "down" && isEmptyWireLine(wire, targetLineStart, targetLineEnd)) {
    targetOffset = preserveColumnOnTargetLine(
      doc,
      direction,
      column,
      targetLineStart,
      targetLineEnd
    );
    branch = "empty-target-column";
  } else {
    targetOffset = preserveColumnOnTargetLine(
      doc,
      direction,
      column,
      targetLineStart,
      targetLineEnd
    );
    branch = "cross-line-column";
  }

  if (targetOffset === offset) {
    return null;
  }
  return { offset: targetOffset, branch };
}

export function resolveVerticalArrowWireMove(
  doc: HandoffNoteDoc,
  offset: number,
  direction: HandoffNoteVerticalArrowDirection,
  column: number,
  current: VerticalNavLineSpan,
  target: VerticalNavLineSpan | null
): VerticalNavWireMove | null {
  const wire = docToWire(doc);

  if (target === null) {
    const bleedDirection = direction === "up" ? "left" : "right";
    return resolveHorizontalBleedWireMove(doc, offset, bleedDirection);
  }

  return resolveVerticalArrowCrossLineMove(doc, wire, offset, direction, column, current, target);
}

/** Visual row start on target band: X-closest layout sample (not min-wire mention jump). */
export function resolveVerticalArrowRowStartLanding(
  doc: HandoffNoteDoc,
  direction: HandoffNoteVerticalArrowDirection,
  targetSamples: { wire: number; left: number }[],
  goalColumn: number
): VerticalNavWireMove | null {
  if (targetSamples.length === 0) {
    return null;
  }

  let best = targetSamples[0]!;
  for (const sample of targetSamples) {
    if (Math.abs(sample.left - goalColumn) < Math.abs(best.left - goalColumn)) {
      best = sample;
    }
  }

  const landing = snapMentionInterior(doc, best.wire, direction);
  const branch =
    landing === best.wire ? "visual-row-start-column" : "visual-row-start-mentionInterior";
  return { offset: landing, branch };
}

/** DOM/measured landing on a target visual band (X-match + mention snap). */
export function resolveVerticalArrowVisualLanding(
  doc: HandoffNoteDoc,
  direction: HandoffNoteVerticalArrowDirection,
  targetSamples: { wire: number; left: number }[],
  currentLeft: number,
  options: {
    fromMentionStart: boolean;
  }
): VerticalNavWireMove | null {
  if (targetSamples.length === 0) {
    return null;
  }

  const lineStartWire = Math.min(...targetSamples.map((sample) => sample.wire));
  if (options.fromMentionStart) {
    return { offset: lineStartWire, branch: "target-row-start" };
  }

  let best = targetSamples[0]!;
  for (const sample of targetSamples) {
    if (Math.abs(sample.left - currentLeft) < Math.abs(best.left - currentLeft)) {
      best = sample;
    }
  }

  const landing = snapMentionInterior(doc, best.wire, direction);
  const branch = landing === best.wire ? "dom-column" : "dom-mentionInterior";
  return { offset: landing, branch };
}
