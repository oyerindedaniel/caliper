import {
  docPosToWireOffset,
  type HandoffNoteDocPos,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import {
  describeHandoffNoteCursorContext,
  docToWire,
  offsetAtDocPosition,
  spliceDocWireRange,
  type HandoffNoteDoc,
  type HandoffNoteEdit,
} from "./handoff-note-doc.js";

export type EmbeddedBlankBandDeleteBranch =
  | "backspace-content-above"
  | "backspace-blank-above"
  | "backspace-collapse-empty-above"
  | "backspace-line-start-collapse"
  | "delete-blank-below"
  | "delete-lower-row";

export type EmbeddedBlankBandDeleteMove = {
  doc: HandoffNoteDoc;
  caretWire: number;
  branch: EmbeddedBlankBandDeleteBranch;
  /** When false, selection lands on content-row/mention alias not raw probe wire (mention-interior delete). */
  probeInfrastructureLanding?: boolean;
};

export type EmbeddedBlankBandGroup = {
  probes: number[];
};

export type EmbeddedBlankBandProbeContext = {
  group: EmbeddedBlankBandGroup;
  indexInGroup: number;
};

function wireLineStartOffsets(wire: string): number[] {
  const starts = [0];
  for (let index = 0; index < wire.length; index++) {
    if (wire[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function isBlankBandSegment(segment: string): boolean {
  return segment.length === 0 || /^\s*$/.test(segment);
}

/** True when substantive content sits on the row immediately above `probeWire`. */
export function embeddedBlankBandHasSubstantiveRowAbove(wire: string, probeWire: number): boolean {
  if (probeWire <= 0) {
    return false;
  }
  const lineStart = wire.lastIndexOf("\n", probeWire - 1) + 1;
  const segment = wire.slice(lineStart, probeWire);
  return segment.length > 0 && /\S/.test(segment);
}

/** True when the blank band has a filled content row above its first probe (header row). */
export function embeddedBlankBandHasSubstantiveContentAboveBand(
  wire: string,
  probes: number[]
): boolean {
  const firstProbe = probes[0];
  if (firstProbe === undefined) {
    return false;
  }
  return embeddedBlankBandHasSubstantiveRowAbove(wire, firstProbe);
}

/** First wire offset of substantive content (skips leading `\n` run and whitespace-only segments). */
export function embeddedBlankBandSubstantiveContentStartWire(doc: HandoffNoteDoc): number {
  const wire = docToWire(doc);
  const lineStarts = wireLineStartOffsets(wire);
  for (const start of lineStarts) {
    const lineEnd = wire.indexOf("\n", start);
    const segment = wire.slice(start, lineEnd === -1 ? wire.length : lineEnd);
    if (segment.length > 0 && /\S/.test(segment)) {
      return start;
    }
  }
  return wire.length;
}

/** Consecutive blank-band probe runs separated by substantive wire rows. */
export function listEmbeddedBlankBandGroups(doc: HandoffNoteDoc): EmbeddedBlankBandGroup[] {
  const wire = docToWire(doc);
  const probes = listEmbeddedBlankBandProbeWires(doc);
  if (probes.length === 0) {
    return [];
  }

  const groups: EmbeddedBlankBandGroup[] = [];
  let current: number[] = [];

  for (const probe of probes) {
    if (current.length === 0) {
      current.push(probe);
      continue;
    }
    const prevProbe = current[current.length - 1]!;
    const between = wire.slice(prevProbe + 1, probe);
    if (between.length > 0 && /\S/.test(between)) {
      groups.push({ probes: current });
      current = [probe];
    } else {
      current.push(probe);
    }
  }
  if (current.length > 0) {
    groups.push({ probes: current });
  }
  return groups;
}

export function embeddedBlankBandProbeContext(
  doc: HandoffNoteDoc,
  probeWire: number
): EmbeddedBlankBandProbeContext | null {
  for (const group of listEmbeddedBlankBandGroups(doc)) {
    const indexInGroup = group.probes.indexOf(probeWire);
    if (indexInGroup >= 0) {
      return { group, indexInGroup };
    }
  }
  return null;
}

/**
 * Semantic content row end immediately above a blank-band probe.
 * Physical `probeWire - 1` may sit inside a mention atom; landing policy uses mention-end instead.
 */
export function embeddedBlankBandContentRowEndBeforeProbe(
  doc: HandoffNoteDoc,
  probeWire: number
): number {
  const wire = docToWire(doc);
  const lineStart = probeWire <= 0 ? 0 : wire.lastIndexOf("\n", probeWire - 1) + 1;
  const segment = wire.slice(lineStart, probeWire);
  if (segment.length === 0 || !/\S/.test(segment)) {
    return lineStart;
  }
  const physicalEnd = probeWire - 1;
  const context = describeHandoffNoteCursorContext(doc, physicalEnd);
  if (context.kind === "mention-interior") {
    return context.end;
  }
  // Sole substantive char: probeWire - 1 is visual start (before the char); content row end
  // for backspace nibbling is after that char (probeWire). Multi-char rows keep physicalEnd.
  if (segment.length === 1) {
    return probeWire;
  }
  return physicalEnd;
}

/**
 * Caret landing after chipping the last character before a probe.
 * Whitespace-only chips use semantic row end; substantive chips that leave mention
 * abutting the probe land via docPosAfterContentRowChipBeforeProbe (mention-node-end alias).
 */
function embeddedBlankBandChipEndBeforeProbe(
  doc: HandoffNoteDoc,
  probeWire: number,
  deletedChar: string
): number {
  const landing = embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire);
  if (/^\s$/.test(deletedChar)) {
    return landing;
  }
  if (landing !== probeWire) {
    return landing;
  }
  const physicalEnd = probeWire - 1;
  if (
    physicalEnd >= 0 &&
    describeHandoffNoteCursorContext(doc, physicalEnd).kind === "mention-interior"
  ) {
    return physicalEnd;
  }
  return landing;
}

/** After removing charWire, mention substantive content abuts the probe (not plain row text). */
function embeddedBlankBandSubstantiveChipLeavesMentionAbuttingProbe(
  doc: HandoffNoteDoc,
  charWire: number
): boolean {
  const wire = docToWire(doc);
  if (charWire < 0 || charWire + 1 >= wire.length || wire[charWire] === "\n") {
    return false;
  }
  if (/^\s$/.test(wire[charWire]!)) {
    return false;
  }
  const nextDoc = spliceDocWireRange(doc, charWire, charWire + 1, "");
  const probeWire = charWire;
  if (!embeddedBlankBandSubstantiveContentAbutsProbe(nextDoc, probeWire)) {
    return false;
  }
  const physicalEnd = probeWire - 1;
  if (physicalEnd < 0) {
    return false;
  }
  const ctx = describeHandoffNoteCursorContext(nextDoc, physicalEnd);
  return ctx.kind === "mention-interior" || (ctx.kind === "mention-boundary" && ctx.edge === "end");
}

/** Doc pos authority at a probe wire — mention-end or content-row-end, not probe infrastructure paint. */
function caretRestsOnEmbeddedBlankBandProbeAlias(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  probeWire: number
): boolean {
  if (!embeddedBlankBandSubstantiveContentAbutsProbe(doc, probeWire)) {
    return false;
  }
  const node = doc.nodes[focus.nodeIndex];
  const focusWire = docPosToWireOffset(doc, focus);
  if (node?.type === "mention" && focus.nodeOffset >= 1 + node.agentId.length) {
    return focusWire === probeWire;
  }
  const wire = docToWire(doc);
  const lineStart = probeWire <= 0 ? 0 : wire.lastIndexOf("\n", probeWire - 1) + 1;
  const segment = wire.slice(lineStart, probeWire);
  if (segment.length === 1 && /\S/.test(segment)) {
    // Sole-char row: content row end shares probeWire with blank infrastructure — alias is text-tail doc pos.
    if (focusWire !== probeWire) {
      return false;
    }
    const tailPos = wireOffsetToDocPos(doc, probeWire);
    return focus.nodeIndex === tailPos.nodeIndex && focus.nodeOffset === tailPos.nodeOffset;
  }
  const semanticEnd = embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire);
  return focusWire === semanticEnd && focusWire !== probeWire;
}

/**
 * Populated sole-char content row end at a probe aliases the probe wire to text-tail doc pos.
 * Backspace row-chips via the char wire immediately before the probe, not probe infrastructure.
 */
function embeddedBlankBandBackspaceRowChipCharWire(
  doc: HandoffNoteDoc,
  focusWire: number,
  focus: HandoffNoteDocPos
): number {
  if (focusWire <= 0 || !isEmbeddedBlankBandProbeWire(doc, focusWire)) {
    return focusWire;
  }
  if (!caretRestsOnEmbeddedBlankBandProbeAlias(doc, focus, focusWire)) {
    return focusWire;
  }
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type !== "text") {
    return focusWire;
  }
  const wire = docToWire(doc);
  const lineStart = focusWire <= 0 ? 0 : wire.lastIndexOf("\n", focusWire - 1) + 1;
  const segment = wire.slice(lineStart, focusWire);
  if (segment.length === 1 && /\S/.test(segment)) {
    return focusWire - 1;
  }
  return focusWire;
}

/**
 * Content-row edit adjacent to a blank band. This is intentionally separate from
 * blank-band collapse so delete intent can ask "does content win?" before
 * treating the same wire as blank infrastructure.
 */
export function resolveContentRowDeleteBeforeEmbeddedBlankBand(
  doc: HandoffNoteDoc,
  focusWire: number,
  direction: HandoffNoteEdit,
  focus: HandoffNoteDocPos
): EmbeddedBlankBandDeleteMove | null {
  const directChipWire =
    direction === "backspace"
      ? embeddedBlankBandBackspaceRowChipCharWire(doc, focusWire, focus)
      : focusWire;
  const directChip = resolveRowChipBeforeEmbeddedBlankProbe(doc, directChipWire);
  if (directChip) {
    return directChip;
  }

  if (direction !== "backspace" || !isEmbeddedBlankBandDeleteProbeWire(doc, focusWire, focus)) {
    return null;
  }

  const context = embeddedBlankBandProbeContext(doc, focusWire);
  if (!context) {
    return null;
  }
  if (
    context.indexInGroup !== 0 ||
    !embeddedBlankBandHasSubstantiveRowAbove(docToWire(doc), focusWire)
  ) {
    return null;
  }

  const wire = docToWire(doc);
  const charWire = focusWire - 1;
  const deletedChar = wire[charWire];
  if (
    charWire >= 0 &&
    deletedChar !== "\n" &&
    deletedChar !== undefined &&
    !/^\s$/.test(deletedChar) &&
    describeHandoffNoteCursorContext(doc, charWire).kind !== "mention-interior" &&
    !embeddedBlankBandMentionOnlyContentRowAbove(doc, focusWire)
  ) {
    const rowChip = resolveRowChipBeforeEmbeddedBlankProbe(doc, charWire);
    if (
      rowChip &&
      (!embeddedBlankBandIsSandwichedBlankRow(doc, focusWire) ||
        embeddedBlankBandSubstantiveChipLeavesMentionAbuttingProbe(doc, charWire))
    ) {
      return rowChip;
    }
  }

  if (embeddedBlankBandIsSandwichedBlankRow(doc, focusWire)) {
    return null;
  }
  if (embeddedBlankBandMentionOnlyContentRowAbove(doc, focusWire)) {
    return null;
  }

  const landing = embeddedBlankBandContentRowEndBeforeProbe(doc, focusWire);
  if (landing === focusWire) {
    return null;
  }
  return {
    doc,
    caretWire: landing,
    branch: "backspace-content-above",
  };
}

/**
 * After Shift+Enter extends a trailing blank band at doc EOF, land on the new blank's
 * probe wire so the next insert fills that visual row (not wire.length past the band).
 */
export function resolveEmbeddedBlankBandEofLineBreakCaretWire(
  doc: HandoffNoteDoc,
  resolvedWire: number
): number {
  const wire = docToWire(doc);
  if (resolvedWire !== wire.length) {
    return resolvedWire;
  }
  const groups = listEmbeddedBlankBandGroups(doc);
  const lastGroup = groups[groups.length - 1];
  if (!lastGroup || lastGroup.probes.length === 0) {
    return resolvedWire;
  }
  if (embeddedBlankBandHasSubstantiveRowBelowGroup(wire, lastGroup)) {
    return resolvedWire;
  }
  const lastProbe = lastGroup.probes[lastGroup.probes.length - 1]!;
  if (embeddedBlankBandSubstantiveContentAbutsProbe(doc, lastProbe)) {
    const lineStart = lastProbe <= 0 ? 0 : wire.lastIndexOf("\n", lastProbe - 1) + 1;
    const segment = wire.slice(lineStart, lastProbe);
    if (segment.length === 1 && /\S/.test(segment)) {
      return resolvedWire;
    }
  }
  if (!embeddedBlankBandHasSubstantiveContentAboveBand(wire, lastGroup.probes)) {
    return resolvedWire;
  }
  return lastProbe;
}

/** True when substantive content sits on the row immediately below the band's last probe. */
function embeddedBlankBandHasSubstantiveRowBelowGroup(
  wire: string,
  group: EmbeddedBlankBandGroup
): boolean {
  const lastProbe = group.probes[group.probes.length - 1]!;
  const start = substantiveRowStartBelowProbe(wire, lastProbe);
  if (start >= wire.length) {
    return false;
  }
  const lineEnd = wire.indexOf("\n", start);
  const segment = wire.slice(start, lineEnd === -1 ? wire.length : lineEnd);
  return segment.length > 0 && /\S/.test(segment);
}

/** Row segment above probe has no substantive text (content row cleared). */
export function embeddedBlankBandRowAboveProbeIsEmpty(
  doc: HandoffNoteDoc,
  probeWire: number
): boolean {
  const wire = docToWire(doc);
  const lineStart = probeWire <= 0 ? 0 : wire.lastIndexOf("\n", probeWire - 1) + 1;
  const segment = wire.slice(lineStart, probeWire);
  return segment.length === 0 || !/\S/.test(segment);
}

/**
 * Last probe in a multi-probe band with substantive tail — empty row above is still
 * blank-band delete infrastructure, not a cleared substantive content row.
 */
function isBlankBandInteriorTailProbe(doc: HandoffNoteDoc, probeWire: number): boolean {
  const context = embeddedBlankBandProbeContext(doc, probeWire);
  if (!context) {
    return false;
  }
  const { indexInGroup, group } = context;
  if (indexInGroup <= 0 || indexInGroup !== group.probes.length - 1) {
    return false;
  }
  if (!embeddedBlankBandRowAboveProbeIsEmpty(doc, probeWire)) {
    return false;
  }
  return embeddedBlankBandHasSubstantiveRowBelowGroup(docToWire(doc), group);
}

/**
 * Last probe in an EOF-only trailing band (no substantive row below) — still delete
 * infrastructure when navigating via Shift+Enter, not cleared content row end.
 */
function isBlankBandEofTailProbe(doc: HandoffNoteDoc, probeWire: number): boolean {
  const context = embeddedBlankBandProbeContext(doc, probeWire);
  if (!context) {
    return false;
  }
  const { indexInGroup, group } = context;
  if (indexInGroup <= 0 || indexInGroup !== group.probes.length - 1) {
    return false;
  }
  if (!embeddedBlankBandRowAboveProbeIsEmpty(doc, probeWire)) {
    return false;
  }
  return !embeddedBlankBandHasSubstantiveRowBelowGroup(docToWire(doc), group);
}

/** Caret rests on cleared content-row end gate before probe — structural, not a prior-key flag. */
export function handoffNoteCaretAtClearedContentRowEndBeforeProbe(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  probeWire: number
): boolean {
  if (!isEmbeddedBlankBandProbeWire(doc, probeWire)) {
    return false;
  }
  if (!embeddedBlankBandRowAboveProbeIsEmpty(doc, probeWire)) {
    return false;
  }
  if (isBlankBandInteriorTailProbe(doc, probeWire) || isBlankBandEofTailProbe(doc, probeWire)) {
    return false;
  }
  const focusWire = docPosToWireOffset(doc, focus);
  const wire = docToWire(doc);
  const lineStart = probeWire <= 0 ? 0 : wire.lastIndexOf("\n", probeWire - 1) + 1;
  const semanticEnd = embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire);
  return (
    focusWire === lineStart ||
    focusWire === semanticEnd ||
    caretRestsOnEmbeddedBlankBandProbeAlias(doc, focus, probeWire)
  );
}

/**
 * Empty content row end: caret on the line-start `\n` of a cleared content row,
 * not blank-band delete infrastructure.
 */
export function embeddedBlankBandAtEmptyContentRowEnd(
  doc: HandoffNoteDoc,
  caretWire: number,
  focus?: HandoffNoteDocPos
): boolean {
  const wire = docToWire(doc);
  if (
    focus &&
    isEmbeddedBlankBandProbeWire(doc, caretWire) &&
    handoffNoteCaretAtClearedContentRowEndBeforeProbe(doc, focus, caretWire)
  ) {
    return true;
  }
  if (embeddedBlankBandContentRowEndBeforeProbe(doc, caretWire) !== caretWire) {
    return false;
  }
  if (!isEmbeddedBlankBandProbeWire(doc, caretWire)) {
    return caretWire >= 0 && caretWire < wire.length && wire[caretWire] === "\n";
  }
  if (embeddedBlankBandSubstantiveContentAbutsProbe(doc, caretWire)) {
    return false;
  }
  const context = embeddedBlankBandProbeContext(doc, caretWire);
  if (!context) {
    return false;
  }
  const { indexInGroup, group } = context;
  if (group.probes.length === 1) {
    if (embeddedBlankBandHasSubstantiveContentAboveBand(wire, group.probes)) {
      return false;
    }
    if (!embeddedBlankBandHasSubstantiveRowBelowGroup(wire, group)) {
      return true;
    }
    return caretWire === group.probes[0]!;
  }
  if (
    indexInGroup === 0 &&
    !embeddedBlankBandHasSubstantiveRowAbove(wire, caretWire) &&
    indexInGroup < group.probes.length - 1
  ) {
    return true;
  }
  return false;
}

/** True when caret rests on blank-band infrastructure for delete/collapse (not empty content row end). */
export function isEmbeddedBlankBandDeleteProbeWire(
  doc: HandoffNoteDoc,
  wire: number,
  focus?: HandoffNoteDocPos
): boolean {
  if (!isEmbeddedBlankBandProbeWire(doc, wire)) {
    return false;
  }
  if (
    focus &&
    embeddedBlankBandSubstantiveContentAbutsProbe(doc, wire) &&
    caretRestsOnEmbeddedBlankBandProbeAlias(doc, focus, wire)
  ) {
    return false;
  }
  return !embeddedBlankBandAtEmptyContentRowEnd(doc, wire, focus);
}

function substantiveRowStartBelowProbe(wire: string, afterProbeWire: number): number {
  let start = afterProbeWire;
  while (start < wire.length && wire[start] === "\n") {
    start += 1;
  }
  return start;
}

/** After removing a band-edge blank, land on the next probe below or substantive visual start. */
function embeddedBlankBandDeleteEndLanding(
  nextDoc: HandoffNoteDoc,
  priorWire: string,
  nextWire: string,
  deletedProbeWire: number,
  group: EmbeddedBlankBandGroup
): number {
  const range = embeddedBlankBandProbeRange(nextWire, group);
  const remaining = listEmbeddedBlankBandProbeWires(nextDoc).filter(
    (probe) => probe >= range.start && probe < range.end
  );

  if (embeddedBlankBandHasSubstantiveRowBelowGroup(priorWire, group)) {
    if (embeddedBlankBandHasSubstantiveContentAboveBand(priorWire, group.probes)) {
      return substantiveRowStartBelowProbe(nextWire, deletedProbeWire);
    }
    if (remaining.length > 0) {
      return remaining[0]!;
    }
  }

  if (nextWire[deletedProbeWire] === "\n") {
    return deletedProbeWire;
  }
  return substantiveRowStartBelowProbe(nextWire, deletedProbeWire);
}

function collapseBlankBandEmptyRowEndLanding(
  priorDoc: HandoffNoteDoc,
  nextDoc: HandoffNoteDoc,
  deletedProbeWire: number,
  context: EmbeddedBlankBandProbeContext
): number {
  const priorWire = docToWire(priorDoc);
  const nextWire = docToWire(nextDoc);
  const { indexInGroup, group } = context;

  if (indexInGroup < group.probes.length - 1) {
    return collapseBlankBandDeleteLanding(nextDoc, deletedProbeWire, context);
  }

  if (embeddedBlankBandHasSubstantiveRowBelowGroup(priorWire, group)) {
    return embeddedBlankBandDeleteEndLanding(nextDoc, priorWire, nextWire, deletedProbeWire, group);
  }

  return collapseBlankBandDeleteLanding(nextDoc, deletedProbeWire, context);
}

function embeddedBlankBandProbeRange(
  wire: string,
  group: EmbeddedBlankBandGroup
): { start: number; end: number } {
  return {
    start: group.probes[0]!,
    end: substantiveRowStartBelowProbe(wire, group.probes[group.probes.length - 1]!),
  };
}

function collapseBlankBandBackspaceLanding(
  nextDoc: HandoffNoteDoc,
  deletedProbeWire: number,
  context: EmbeddedBlankBandProbeContext,
  priorDoc: HandoffNoteDoc
): number {
  const nextWire = docToWire(nextDoc);
  const priorWire = docToWire(priorDoc);
  const { indexInGroup, group } = context;

  if (indexInGroup > 0) {
    const targetProbe = group.probes[indexInGroup - 1]!;
    return deletedProbeWire < targetProbe ? targetProbe - 1 : targetProbe;
  }

  const range = embeddedBlankBandProbeRange(nextWire, group);
  const inBand = listEmbeddedBlankBandProbeWires(nextDoc).filter(
    (probe) => probe >= range.start && probe < range.end
  );
  if (inBand.length > 0) {
    return inBand[0]!;
  }

  if (
    embeddedBlankBandHasSubstantiveRowAbove(priorWire, deletedProbeWire) &&
    embeddedBlankBandHasSubstantiveRowBelowGroup(priorWire, group)
  ) {
    if (indexInGroup > 0) {
      return group.probes[indexInGroup - 1]!;
    }
    const lineStart =
      deletedProbeWire <= 0 ? 0 : priorWire.lastIndexOf("\n", deletedProbeWire - 1) + 1;
    const segment = priorWire.slice(lineStart, deletedProbeWire);
    if (segment.length === 1 && /\S/.test(segment)) {
      return lineStart;
    }
    return embeddedBlankBandContentRowEndBeforeProbe(priorDoc, deletedProbeWire);
  }

  return substantiveRowStartBelowProbe(nextWire, deletedProbeWire);
}

function collapseBlankBandDeleteLanding(
  nextDoc: HandoffNoteDoc,
  deletedProbeWire: number,
  context: EmbeddedBlankBandProbeContext
): number {
  const nextWire = docToWire(nextDoc);
  const { indexInGroup, group } = context;

  if (indexInGroup < group.probes.length - 1) {
    const targetProbe = group.probes[indexInGroup + 1]!;
    return deletedProbeWire < targetProbe ? targetProbe - 1 : targetProbe;
  }

  if (indexInGroup > 0) {
    return group.probes[indexInGroup - 1]!;
  }

  return substantiveRowStartBelowProbe(nextWire, deletedProbeWire);
}

function isSubstantiveLineStart(wire: string, start: number): boolean {
  const lineEnd = wire.indexOf("\n", start);
  const segment = wire.slice(start, lineEnd === -1 ? wire.length : lineEnd);
  return segment.length > 0 && /\S/.test(segment);
}

/** Visual row anchors: line starts plus one probe wire per empty visual row. */
export function listVisualRowAnchorWires(doc: HandoffNoteDoc): number[] {
  const wire = docToWire(doc);
  const probeList = listEmbeddedBlankBandProbeWires(doc);
  if (probeList.length === 0) {
    return wireLineStartOffsets(wire);
  }
  const probes = new Set(probeList);
  const anchors: number[] = [0];
  for (const probe of probeList) {
    anchors.push(probe);
  }
  for (const start of wireLineStartOffsets(wire)) {
    if (start === 0 || probes.has(start)) {
      continue;
    }
    if (!isSubstantiveLineStart(wire, start)) {
      continue;
    }
    if (!anchors.includes(start)) {
      anchors.push(start);
    }
  }
  return anchors.sort((left, right) => left - right);
}

/** Blank probe on the same paint band as content above — storage `\n` before the next substantive row. */
export function isInlineSuffixBlankProbeWire(doc: HandoffNoteDoc, probeWire: number): boolean {
  const wire = docToWire(doc);
  const lineStart = wire.lastIndexOf("\n", probeWire - 1) + 1;
  const beforeBreak = wire.slice(lineStart, probeWire);
  if (beforeBreak.length === 0 || /^\s*$/.test(beforeBreak)) {
    return false;
  }
  const afterBreak = wire.slice(probeWire + 1);
  const nextNewline = afterBreak.indexOf("\n");
  const nextSegment = nextNewline === -1 ? afterBreak : afterBreak.slice(0, nextNewline);
  return nextSegment.length > 0 && /\S/.test(nextSegment);
}

/** Wire offsets where the caret rests on an embedded `\n` blank band. */
export function listEmbeddedBlankBandProbeWires(doc: HandoffNoteDoc): number[] {
  const wire = docToWire(doc);
  const parts = wire.split("\n");
  const probes: number[] = [];
  let wireOffset = 0;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index]!;
    const nextPart = parts[index + 1]!;
    const newlineOffset = wireOffset + part.length;
    wireOffset = newlineOffset + 1;
    if (isBlankBandSegment(nextPart)) {
      probes.push(newlineOffset);
    }
  }
  return probes;
}

export function docTextNodeHasEmbeddedNewline(doc: HandoffNoteDoc, nodeIndex: number): boolean {
  const node = doc.nodes[nodeIndex];
  return node?.type === "text" && node.text.includes("\n");
}

export function isEmbeddedBlankBandProbeWire(doc: HandoffNoteDoc, wire: number): boolean {
  return listEmbeddedBlankBandProbeWires(doc).includes(wire);
}

/** Substantive row content sits immediately before the probe with no spacer char in between. */
export function embeddedBlankBandSubstantiveContentAbutsProbe(
  doc: HandoffNoteDoc,
  probeWire: number
): boolean {
  if (!isEmbeddedBlankBandProbeWire(doc, probeWire)) {
    return false;
  }
  const wire = docToWire(doc);
  if (wire[probeWire] !== "\n") {
    return false;
  }
  const charBefore = probeWire - 1;
  if (charBefore < 0) {
    return false;
  }
  const ch = wire[charBefore];
  if (ch === undefined || /\s/.test(ch)) {
    return false;
  }
  const lineStart = probeWire <= 0 ? 0 : wire.lastIndexOf("\n", probeWire - 1) + 1;
  const segment = wire.slice(lineStart, probeWire);
  return segment.length > 0 && /\S/.test(segment);
}

/**
 * Doc position for the caret after a content-row chip immediately before a probe.
 * Wire offset alone is ambiguous on sole-char sandwiched rows: probe wire and char wire
 * share an index but encode different caret authority. Landing must pick the doc pos that
 * matches backspace nibbling intent, not the probe-infrastructure paint at the same wire.
 */
export function docPosAfterContentRowChipBeforeProbe(
  doc: HandoffNoteDoc,
  probeWire: number,
  rowEmptied: boolean
): HandoffNoteDocPos {
  if (!rowEmptied) {
    const wire = docToWire(doc);
    const lineStart = probeWire <= 0 ? 0 : wire.lastIndexOf("\n", probeWire - 1) + 1;
    const segment = wire.slice(lineStart, probeWire);
    if (segment.length === 1 && /\S/.test(segment)) {
      const charWire = probeWire - 1;
      const charContext = describeHandoffNoteCursorContext(doc, charWire);
      if (charContext.kind === "mention-interior" || charContext.kind === "mention-boundary") {
        const mentionLanding = docPosAtEmbeddedBlankBandProbeAliasLanding(doc, probeWire);
        if (mentionLanding) {
          return mentionLanding;
        }
      }
      return wireOffsetToDocPos(doc, embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire));
    }
  }
  const mentionLanding = docPosAtEmbeddedBlankBandProbeAliasLanding(doc, probeWire);
  if (mentionLanding) {
    return mentionLanding;
  }
  return wireOffsetToDocPos(doc, embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire));
}

/**
 * Probe wire aliases semantic content row end after a whitespace chip — authority
 * belongs on the mention atom end or row tail, not blank-band zwsp infrastructure.
 */
export function docPosAtEmbeddedBlankBandProbeAliasLanding(
  doc: HandoffNoteDoc,
  probeWire: number
): HandoffNoteDocPos | null {
  if (!embeddedBlankBandSubstantiveContentAbutsProbe(doc, probeWire)) {
    return null;
  }
  const semanticWire = embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire);
  const semanticContext = describeHandoffNoteCursorContext(doc, semanticWire);
  if (semanticContext.kind === "mention-boundary" && semanticContext.edge === "end") {
    let offset = 0;
    for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
      const node = doc.nodes[nodeIndex]!;
      if (node.type === "text") {
        offset += node.text.length;
        continue;
      }
      if (offset === semanticContext.start) {
        return { nodeIndex, nodeOffset: 1 + node.agentId.length };
      }
      offset += 1 + node.agentId.length;
    }
  }
  return wireOffsetToDocPos(doc, semanticWire);
}

/**
 * Mention-start wire aliases to the preceding text-node tail (not the mention atom).
 * Used for forward-delete whitespace landing and DOM paint at mention boundaries.
 */
export function docPosAtMentionStartTextAlias(
  doc: HandoffNoteDoc,
  mentionStartWire: number
): HandoffNoteDocPos | null {
  const context = describeHandoffNoteCursorContext(doc, mentionStartWire);
  if (context.kind !== "mention-boundary" || context.edge !== "start") {
    return null;
  }

  let offset = 0;
  let mentionNodeIndex = -1;
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    const nodeStart = offset;
    if (node.type === "mention" && nodeStart === mentionStartWire) {
      mentionNodeIndex = nodeIndex;
      break;
    }
    offset += node.type === "text" ? node.text.length : 1 + node.agentId.length;
  }
  if (mentionNodeIndex <= 0) {
    return null;
  }

  const prev = doc.nodes[mentionNodeIndex - 1];
  if (prev?.type !== "text") {
    return null;
  }

  return { nodeIndex: mentionNodeIndex - 1, nodeOffset: prev.text.length };
}

/** Row above mention start has non-whitespace prefix on the same line. */
export function rowHasSubstantivePrefixBeforeMention(
  doc: HandoffNoteDoc,
  mentionStartWire: number
): boolean {
  const wire = docToWire(doc);
  const lineStart = mentionStartWire <= 0 ? 0 : wire.lastIndexOf("\n", mentionStartWire - 1) + 1;
  const prefix = wire.slice(lineStart, mentionStartWire);
  return prefix.length > 0 && /\S/.test(prefix);
}

/**
 * Mention-start wire sits immediately after substantive text with no separator
 * (chip ladder consumed the pre-mention spacer). Distinct from rows that still
 * carry `prefix @mention` spacing before atomic interior remove.
 */
export function mentionStartGluedToPrefixInWire(
  doc: HandoffNoteDoc,
  mentionStartWire: number
): boolean {
  const wire = docToWire(doc);
  if (mentionStartWire <= 0) {
    return false;
  }
  const before = wire[mentionStartWire - 1];
  return before !== undefined && before !== " " && before !== "\n" && /\S/.test(before);
}

/**
 * After forward-delete mention remove on a prefixed row, absorb the single
 * mention-adjacent spacer left at mention-start wire so the chip frontier
 * does not rest on phantom whitespace.
 */
export function docAfterForwardMentionRemoveAbsorbAdjacentSpacer(
  doc: HandoffNoteDoc,
  mentionStartWire: number
): { doc: HandoffNoteDoc; caretWire: number } {
  const wire = docToWire(doc);
  if (wire[mentionStartWire] !== " ") {
    return { doc, caretWire: mentionStartWire };
  }
  const lineEndIdx = wire.indexOf("\n", mentionStartWire);
  const lineEnd = lineEndIdx === -1 ? wire.length : lineEndIdx;
  const afterSpace = wire.slice(mentionStartWire + 1, lineEnd);
  if (afterSpace.length > 0 && /\S/.test(afterSpace)) {
    return { doc, caretWire: mentionStartWire };
  }
  return {
    doc: spliceDocWireRange(doc, mentionStartWire, mentionStartWire + 1, ""),
    caretWire: mentionStartWire,
  };
}

export function embeddedBlankBandMentionOnlyContentRowAbove(
  doc: HandoffNoteDoc,
  probeWire: number
): boolean {
  const wire = docToWire(doc);
  const rowEnd = probeWire - 1;
  if (rowEnd < 0) {
    return false;
  }
  const rowEndContext = describeHandoffNoteCursorContext(doc, rowEnd);
  if (rowEndContext.kind !== "mention-interior" && rowEndContext.kind !== "mention-boundary") {
    return false;
  }
  const lineStart = probeWire <= 0 ? 0 : wire.lastIndexOf("\n", probeWire - 1) + 1;
  const prefix = wire.slice(lineStart, rowEndContext.start);
  return !/\S/.test(prefix);
}

/** Typing at a blank-band probe wire rests on the `\n`; insert after it, not before. */
export function insertDocPosAfterEmbeddedBlankProbe(
  doc: HandoffNoteDoc,
  pos: { nodeIndex: number; nodeOffset: number }
): { nodeIndex: number; nodeOffset: number } {
  const wire = offsetAtDocPosition(doc, pos.nodeIndex, pos.nodeOffset);
  if (!isEmbeddedBlankBandProbeWire(doc, wire)) {
    return pos;
  }
  const node = doc.nodes[pos.nodeIndex];
  if (node?.type !== "text") {
    return pos;
  }
  return {
    nodeIndex: pos.nodeIndex,
    nodeOffset: Math.min(pos.nodeOffset + 1, node.text.length),
  };
}

/** Text-led lower visual row after an embedded blank band (exit `\n` through line end). */
export type EmbeddedTextLedLowerRowSpan = {
  exitNewlineWire: number;
  lineStartWire: number;
  lineEndWire: number;
};

export function embeddedTextLedLowerRowSpanAfterBlankBand(
  doc: HandoffNoteDoc
): EmbeddedTextLedLowerRowSpan | null {
  const text = docToWire(doc);
  const probes = listEmbeddedBlankBandProbeWires(doc);
  if (probes.length === 0) {
    return null;
  }

  const searchFrom = probes[probes.length - 1]! + 1;
  for (let wire = searchFrom; wire < text.length; wire++) {
    if (text[wire] !== "\n") {
      continue;
    }
    if (isEmbeddedBlankBandProbeWire(doc, wire)) {
      continue;
    }
    const lineEnd = text.indexOf("\n", wire + 1);
    const segment = text.slice(wire + 1, lineEnd === -1 ? text.length : lineEnd);
    if (segment.length === 0 || !/\S/.test(segment) || segment[0] === "@") {
      continue;
    }
    return {
      exitNewlineWire: wire,
      lineStartWire: wire + 1,
      lineEndWire: lineEnd === -1 ? text.length : lineEnd,
    };
  }
  return null;
}

export function isWireOnEmbeddedTextLedLowerRowAfterBlankBand(
  doc: HandoffNoteDoc,
  wire: number
): boolean {
  const span = embeddedTextLedLowerRowSpanAfterBlankBand(doc);
  if (!span) {
    return false;
  }
  return wire >= span.exitNewlineWire && wire < span.lineEndWire;
}

/** Blank row sandwiched between substantive rows above and below the band. */
export function embeddedBlankBandIsSandwichedBlankRow(
  doc: HandoffNoteDoc,
  probeWire: number
): boolean {
  const context = embeddedBlankBandProbeContext(doc, probeWire);
  if (!context) {
    return false;
  }
  const wire = docToWire(doc);
  return (
    embeddedBlankBandHasSubstantiveRowAbove(wire, probeWire) &&
    embeddedBlankBandHasSubstantiveRowBelowGroup(wire, context.group)
  );
}

/** Backspace/delete at blank-band probe wires — caret policy plus wire splice. */
export function resolveEmbeddedBlankBandDelete(
  doc: HandoffNoteDoc,
  focusWire: number,
  direction: HandoffNoteEdit,
  focus?: HandoffNoteDocPos,
  options?: { mentionEndCollapse?: boolean }
): EmbeddedBlankBandDeleteMove | null {
  if (!options?.mentionEndCollapse && !isEmbeddedBlankBandDeleteProbeWire(doc, focusWire, focus)) {
    return null;
  }

  const context = embeddedBlankBandProbeContext(doc, focusWire);
  if (!context) {
    return null;
  }

  const caretContext = describeHandoffNoteCursorContext(doc, focusWire);
  if (caretContext.kind === "mention-interior") {
    return null;
  }
  if (
    !options?.mentionEndCollapse &&
    caretContext.kind === "mention-boundary" &&
    !isEmbeddedBlankBandDeleteProbeWire(doc, focusWire, focus)
  ) {
    return null;
  }

  const { indexInGroup } = context;
  const wire = docToWire(doc);

  if (direction === "backspace") {
    const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
    return {
      doc: nextDoc,
      caretWire: collapseBlankBandBackspaceLanding(nextDoc, focusWire, context, doc),
      branch: indexInGroup === 0 ? "backspace-collapse-empty-above" : "backspace-blank-above",
    };
  }

  if (focusWire + 1 >= wire.length) {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  if (indexInGroup < context.group.probes.length - 1) {
    return {
      doc: nextDoc,
      caretWire: collapseBlankBandDeleteLanding(nextDoc, focusWire, context),
      branch: "delete-blank-below",
    };
  }

  const nextWire = docToWire(nextDoc);
  if (embeddedBlankBandHasSubstantiveRowBelowGroup(wire, context.group)) {
    return {
      doc: nextDoc,
      caretWire: embeddedBlankBandDeleteEndLanding(
        nextDoc,
        wire,
        nextWire,
        focusWire,
        context.group
      ),
      branch: "delete-lower-row",
    };
  }

  return {
    doc: nextDoc,
    caretWire: collapseBlankBandDeleteLanding(nextDoc, focusWire, context),
    branch: "delete-lower-row",
  };
}

/**
 * Mention delete that clears substantive content on a row above a sandwiched
 * blank band — arms chipBeforeBlankBand and lands on cleared-row visual start
 * (band groups may merge on wire).
 */
export function resolveMentionDeleteRowClearChip(
  priorDoc: HandoffNoteDoc,
  focusWire: number,
  nextDoc: HandoffNoteDoc
): { caretWire: number } | null {
  const priorWire = docToWire(priorDoc);
  const lineStart = focusWire <= 0 ? 0 : priorWire.lastIndexOf("\n", focusWire - 1) + 1;
  const lineEndIdx = priorWire.indexOf("\n", lineStart);
  if (lineEndIdx === -1) {
    return null;
  }
  const lineSegment = priorWire.slice(lineStart, lineEndIdx);
  if (!/\S/.test(lineSegment)) {
    return null;
  }

  const nextWire = docToWire(nextDoc);
  const nextLineEndIdx = nextWire.indexOf("\n", lineStart);
  const nextLineEnd = nextLineEndIdx === -1 ? nextWire.length : nextLineEndIdx;
  const nextSegment = nextWire.slice(lineStart, nextLineEnd);
  if (nextSegment.length > 0 && /\S/.test(nextSegment)) {
    return null;
  }

  if (!isEmbeddedBlankBandProbeWire(priorDoc, lineEndIdx)) {
    return null;
  }
  const context = embeddedBlankBandProbeContext(priorDoc, lineEndIdx);
  if (!context) {
    return null;
  }
  if (!embeddedBlankBandHasSubstantiveRowBelowGroup(priorWire, context.group)) {
    return null;
  }

  return { caretWire: lineStart };
}

/**
 * Content row chip — remove one character on the row immediately before a blank-band probe.
 * `focusWire` is the removed char; probe is at `focusWire + 1`.
 * Called from `applyDocDelete` (caret on char) and from the blank-band step branch
 * (backspace on probe when semantic landing equals the char behind).
 */
function resolveRowChipBeforeEmbeddedBlankProbe(
  doc: HandoffNoteDoc,
  focusWire: number
): EmbeddedBlankBandDeleteMove | null {
  const wire = docToWire(doc);
  if (focusWire < 0 || focusWire + 1 >= wire.length) {
    return null;
  }
  if (!isEmbeddedBlankBandProbeWire(doc, focusWire + 1)) {
    return null;
  }
  if (wire[focusWire] === "\n") {
    return null;
  }
  if (describeHandoffNoteCursorContext(doc, focusWire).kind === "mention-interior") {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  const probeAfterDelete = focusWire;
  const deletedChar = wire[focusWire]!;
  const caretWire = embeddedBlankBandChipEndBeforeProbe(nextDoc, probeAfterDelete, deletedChar);
  return {
    doc: nextDoc,
    caretWire,
    branch: "backspace-content-above",
  };
}

/**
 * Delete from band head awaiting input: removes one blank-row `\n`
 * and lands on the next probe below or lower substantive visual start.
 */
export function resolveDeleteFromEmptyContentRowEnd(
  doc: HandoffNoteDoc,
  focusWire: number,
  focus?: HandoffNoteDocPos
): EmbeddedBlankBandDeleteMove | null {
  if (!embeddedBlankBandAtEmptyContentRowEnd(doc, focusWire, focus)) {
    return null;
  }
  const wire = docToWire(doc);
  if (focusWire < 0 || focusWire >= wire.length || wire[focusWire] !== "\n") {
    return null;
  }
  if (!isEmbeddedBlankBandProbeWire(doc, focusWire)) {
    return null;
  }
  const context = embeddedBlankBandProbeContext(doc, focusWire);
  if (!context) {
    return null;
  }
  if (focusWire + 1 >= wire.length) {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  const { indexInGroup, group } = context;

  if (indexInGroup < group.probes.length - 1) {
    return {
      doc: nextDoc,
      caretWire: collapseBlankBandDeleteLanding(nextDoc, focusWire, context),
      branch: "delete-blank-below",
    };
  }

  return {
    doc: nextDoc,
    caretWire: collapseBlankBandEmptyRowEndLanding(doc, nextDoc, focusWire, context),
    branch: "delete-lower-row",
  };
}

/**
 * Backspace from empty content row end sitting on a band-edge `\n` (not delete-probe).
 * Removes one blank-row newline — same ladder as blank-band collapse.
 */
export function resolveBackspaceFromEmptyContentRowEnd(
  doc: HandoffNoteDoc,
  focusWire: number,
  focus?: HandoffNoteDocPos
): EmbeddedBlankBandDeleteMove | null {
  if (!embeddedBlankBandAtEmptyContentRowEnd(doc, focusWire, focus)) {
    return null;
  }
  const wire = docToWire(doc);
  if (focusWire < 0 || focusWire >= wire.length || wire[focusWire] !== "\n") {
    return null;
  }
  if (!isEmbeddedBlankBandProbeWire(doc, focusWire)) {
    return null;
  }
  const context = embeddedBlankBandProbeContext(doc, focusWire);
  if (!context) {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  return {
    doc: nextDoc,
    caretWire: collapseBlankBandEmptyRowEndLanding(doc, nextDoc, focusWire, context),
    branch: "backspace-collapse-empty-above",
  };
}

/**
 * Backspace on a line-start `\n` before substantive content when every segment above is empty.
 * Not a blank-band probe — same collapse landing as blank-band ladder exhaustion.
 */
export function resolveEmbeddedBlankBandLineStartCollapse(
  doc: HandoffNoteDoc,
  focusWire: number
): EmbeddedBlankBandDeleteMove | null {
  if (isEmbeddedBlankBandDeleteProbeWire(doc, focusWire)) {
    return null;
  }
  const wire = docToWire(doc);
  if (focusWire < 0 || focusWire >= wire.length || wire[focusWire] !== "\n") {
    return null;
  }
  const lineStart = focusWire <= 0 ? 0 : wire.lastIndexOf("\n", focusWire - 1) + 1;
  const segmentAbove = wire.slice(lineStart, focusWire);
  if (segmentAbove.length > 0 && /\S/.test(segmentAbove)) {
    return null;
  }
  const afterBreak = wire.slice(focusWire + 1);
  const nextLineEnd = afterBreak.indexOf("\n");
  const nextSegment = nextLineEnd === -1 ? afterBreak : afterBreak.slice(0, nextLineEnd);
  if (nextSegment.length === 0 || !/\S/.test(nextSegment)) {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  return {
    doc: nextDoc,
    caretWire: embeddedBlankBandSubstantiveContentStartWire(nextDoc),
    branch: "backspace-line-start-collapse",
  };
}
