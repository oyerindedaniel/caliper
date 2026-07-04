import {
  describeHandoffNoteCursorContext,
  docLength,
  docToWire,
  type HandoffNoteDoc,
} from "./handoff-note-doc.js";
import {
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

function visualRowIndexForOffset(doc: HandoffNoteDoc, offset: number): number {
  const wire = docToWire(doc);
  const anchors = listVisualRowAnchorWires(doc);
  const probes = new Set(listEmbeddedBlankBandProbeWires(doc));

  for (let index = anchors.length - 1; index >= 0; index--) {
    const anchor = anchors[index]!;
    if (offset < anchor) {
      continue;
    }
    const nextAnchor = anchors[index + 1];
    if (nextAnchor === undefined) {
      return index;
    }
    if (
      probes.has(anchor) &&
      offset > anchor &&
      offset < nextAnchor &&
      wire[offset] === "\n" &&
      nextAnchor === offset + 1 &&
      !probes.has(nextAnchor)
    ) {
      return index + 1;
    }
    if (offset >= anchor && offset < nextAnchor) {
      return index;
    }
  }
  return 0;
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
  const rowIndex = visualRowIndexForOffset(doc, offset);
  const targetRowIndex = direction === "up" ? rowIndex - 1 : rowIndex + 1;
  const goalColumn = probeSet.has(offset) ? 0 : column;

  if (targetRowIndex < 0 || targetRowIndex >= anchors.length) {
    const bleedDirection = direction === "up" ? "left" : "right";
    return resolveHorizontalBleedWireMove(doc, offset, bleedDirection);
  }

  const targetAnchor = anchors[targetRowIndex]!;
  const nextAnchor = anchors[targetRowIndex + 1];
  const targetLineEnd = visualRowSpanEnd(wire, targetAnchor, nextAnchor);

  if (probeSet.has(targetAnchor)) {
    const snapped = snapMentionInterior(doc, targetAnchor, direction);
    if (snapped === offset) {
      return null;
    }
    return { offset: snapped, branch: "blank-band-probe-row" };
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
    const distance = Math.abs(sample.left - goalColumn);
    const bestDistance = Math.abs(best.left - goalColumn);
    if (distance < bestDistance || (distance === bestDistance && sample.wire < best.wire)) {
      best = sample;
    }
  }

  const landing = snapMentionInterior(doc, best.wire, direction);
  const branch =
    landing === best.wire ? "visual-row-start-column" : "visual-row-start-mentionInterior";
  return { offset: landing, branch };
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

  const landing = snapMentionInterior(doc, substantiveStart, direction);
  const branch =
    landing === substantiveStart
      ? "visual-line-start-minWire"
      : "visual-line-start-mentionInterior";
  return { offset: landing, branch };
}
