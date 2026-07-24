import {
  describeHandoffNoteCursorContext,
  docToWire,
  type HandoffNoteDoc,
} from "./handoff-note-doc.js";
import {
  listBlankVisualLineStartWires,
  listEmbeddedBlankBandProbeWires,
  listVisualRowAnchorWires,
} from "./handoff-note-embedded-newlines.js";
import {
  resolveWireLineColumn,
  type HandoffNoteVerticalArrowDirection,
} from "./handoff-note-wire-lines.js";

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

function landWithMentionSnap(
  doc: HandoffNoteDoc,
  candidate: number,
  direction: HandoffNoteVerticalArrowDirection,
  columnBranch: string,
  mentionInteriorBranch: string
): VerticalNavWireMove {
  const landing = snapMentionInterior(doc, candidate, direction);
  return {
    offset: landing,
    branch: landing === candidate ? columnBranch : mentionInteriorBranch,
  };
}

type MentionBoundaryContext = Extract<
  ReturnType<typeof describeHandoffNoteCursorContext>,
  { kind: "mention-boundary" }
>;

function mentionBoundaryBleedOffset(
  context: MentionBoundaryContext,
  direction: "left" | "right",
  wireLength: number
): number | null {
  if (direction === "left" && context.edge === "end") {
    return context.start;
  }
  if (direction === "right" && context.edge === "start") {
    return context.end;
  }
  if (direction === "left" && context.edge === "start" && context.start > 0) {
    return context.start - 1;
  }
  if (direction === "right" && context.edge === "end" && context.end < wireLength) {
    return context.end + 1;
  }
  return null;
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
    const next = mentionBoundaryBleedOffset(context, direction, wire.length);
    if (next !== null) {
      return { offset: next, branch: `boundary-bleed-${direction}` };
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

/** Largest anchor index with `anchors[index] <= offset`. */
function visualRowAnchorIndexForOffset(anchors: readonly number[], offset: number): number {
  let lo = 0;
  let hi = anchors.length - 1;
  let index = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid]! <= offset) {
      index = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return index;
}

function visualRowIndexForOffset(doc: HandoffNoteDoc, offset: number): number {
  const wire = docToWire(doc);
  const anchors = listVisualRowAnchorWires(doc);
  const blankStops = new Set(listBlankVisualLineStartWires(doc));
  if (anchors.length === 0) {
    return 0;
  }

  const index = visualRowAnchorIndexForOffset(anchors, offset);
  const anchor = anchors[index]!;
  const nextAnchor = anchors[index + 1];
  if (nextAnchor === undefined) {
    return index;
  }
  // Caret on a `\n` between a blank line-start and the next substantive row start belongs
  // to the lower content row (that `\n` is line-start storage for content, not an extra blank).
  if (
    blankStops.has(anchor) &&
    offset > anchor &&
    offset < nextAnchor &&
    wire[offset] === "\n" &&
    nextAnchor === offset + 1 &&
    !blankStops.has(nextAnchor)
  ) {
    return index + 1;
  }
  if (offset >= anchor && offset < nextAnchor) {
    return index;
  }
  return index;
}

function visualRowSpanEnd(wire: string, anchor: number, nextAnchor: number | undefined): number {
  if (nextAnchor === undefined) {
    return wire.length;
  }
  return Math.max(anchor, nextAnchor - 1);
}

/** Visual-row Up/Down when embedded blank-band probes exist (contract blank-band section). */
export function resolveEmbeddedBlankBandVerticalMove(
  doc: HandoffNoteDoc,
  offset: number,
  direction: HandoffNoteVerticalArrowDirection,
  column: number
): VerticalNavWireMove | null {
  const probes = listEmbeddedBlankBandProbeWires(doc);
  if (probes.length === 0) {
    return null;
  }

  const wire = docToWire(doc);
  const anchors = listVisualRowAnchorWires(doc);
  if (anchors.length < 2) {
    return null;
  }

  const probeSet = new Set(probes);
  const blankStops = new Set(listBlankVisualLineStartWires(doc));
  const rowIndex = visualRowIndexForOffset(doc, offset);
  const targetRowIndex = direction === "up" ? rowIndex - 1 : rowIndex + 1;
  const goalColumn = blankStops.has(offset) ? 0 : column;

  if (targetRowIndex < 0 || targetRowIndex >= anchors.length) {
    const bleedDirection = direction === "up" ? "left" : "right";
    return resolveHorizontalBleedWireMove(doc, offset, bleedDirection);
  }

  const targetAnchor = anchors[targetRowIndex]!;
  const nextAnchor = anchors[targetRowIndex + 1];
  const targetLineEnd = visualRowSpanEnd(wire, targetAnchor, nextAnchor);

  if (blankStops.has(targetAnchor)) {
    const snapped = snapMentionInterior(doc, targetAnchor, direction);
    if (snapped === offset) {
      return null;
    }
    return {
      offset: snapped,
      branch: probeSet.has(targetAnchor) ? "blank-band-probe-row" : "blank-line-slot",
    };
  }

  const targetOffset = preserveColumnOnTargetLine(
    doc,
    direction,
    goalColumn,
    targetAnchor,
    targetLineEnd
  );
  if (targetOffset === offset) {
    return null;
  }
  return { offset: targetOffset, branch: "visual-row-column" };
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
  const targetOffset = preserveColumnOnTargetLine(doc, direction, column, target.start, target.end);
  const branch =
    direction === "up" && isEmptyWireLine(wire, current.start, current.end)
      ? "empty-line-up"
      : direction === "down" && isEmptyWireLine(wire, target.start, target.end)
        ? "empty-target-column"
        : "cross-line-column";

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
    const distance = Math.abs(sample.left - goalColumn);
    const bestDistance = Math.abs(best.left - goalColumn);
    if (distance < bestDistance || (distance === bestDistance && sample.wire < best.wire)) {
      best = sample;
    }
  }

  return landWithMentionSnap(
    doc,
    best.wire,
    direction,
    "visual-row-start-column",
    "visual-row-start-mentionInterior"
  );
}

/** Leftmost wire on a visual band — blank-band exit to content row visual line start. */
export function resolveVerticalArrowMinWireLineStart(
  doc: HandoffNoteDoc,
  direction: HandoffNoteVerticalArrowDirection,
  targetSamples: { wire: number; left: number }[]
): VerticalNavWireMove | null {
  if (targetSamples.length === 0) {
    return null;
  }

  const anchorWire = Math.min(...targetSamples.map((sample) => sample.wire));
  const wire = docToWire(doc);
  const { lineStart } = resolveWireLineColumn(wire, anchorWire);
  let substantiveStart = lineStart;
  while (substantiveStart < wire.length && wire[substantiveStart] === "\n") {
    substantiveStart++;
  }

  return landWithMentionSnap(
    doc,
    substantiveStart,
    direction,
    "visual-line-start-minWire",
    "visual-line-start-mentionInterior"
  );
}
