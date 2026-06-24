import { type HandoffNoteDocPos, wireOffsetToDocPos } from "./handoff-note-doc-pos.js";
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

export type HandoffBlankBandDeleteOptions = {
  /** Set for one delete cycle after clearing the last char on a row before a blank band. */
  chipBeforeBlankBand?: boolean;
};

export type EmbeddedBlankBandDeleteMove = {
  doc: HandoffNoteDoc;
  caretWire: number;
  branch: EmbeddedBlankBandDeleteBranch;
  chipBeforeBlankBand?: boolean;
  preserveMentionInterior?: boolean;
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
  return physicalEnd;
}

/**
 * Caret landing after chipping the last character before a probe.
 * Whitespace-only chips use semantic row end; substantive chips that leave mention
 * abutting the probe land on mention-interior so the next backspace removes the
 * mention without nibbling blank infrastructure first.
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
  return lastGroup.probes[lastGroup.probes.length - 1]!;
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

/**
 * Empty content row end: caret on the line-start `\n` of a cleared content row,
 * not blank-band delete infrastructure (contract Rule 4 + content row chip).
 */
export function embeddedBlankBandAtEmptyContentRowEnd(
  doc: HandoffNoteDoc,
  caretWire: number,
  options?: HandoffBlankBandDeleteOptions
): boolean {
  if (options?.chipBeforeBlankBand) {
    return true;
  }
  const wire = docToWire(doc);
  if (embeddedBlankBandContentRowEndBeforeProbe(doc, caretWire) !== caretWire) {
    return false;
  }
  if (!isEmbeddedBlankBandProbeWire(doc, caretWire)) {
    return caretWire >= 0 && caretWire < wire.length && wire[caretWire] === "\n";
  }
  // Substantive content abutting probe: same wire is content row end, not delete infrastructure.
  if (embeddedBlankBandSubstantiveContentAbutsProbe(doc, caretWire)) {
    return true;
  }
  const context = embeddedBlankBandProbeContext(doc, caretWire);
  if (!context) {
    return false;
  }
  const { indexInGroup, group } = context;
  if (group.probes.length === 1) {
    return (
      !embeddedBlankBandHasSubstantiveContentAboveBand(wire, group.probes) &&
      !embeddedBlankBandHasSubstantiveRowBelowGroup(wire, group)
    );
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
  options?: HandoffBlankBandDeleteOptions
): boolean {
  if (!isEmbeddedBlankBandProbeWire(doc, wire)) {
    return false;
  }
  return !embeddedBlankBandAtEmptyContentRowEnd(doc, wire, options);
}

function substantiveRowStartBelowProbe(wire: string, afterProbeWire: number): number {
  let start = afterProbeWire;
  while (start < wire.length && wire[start] === "\n") {
    start += 1;
  }
  return start;
}

/** After removing a band-edge blank, land on line-start gate or substantive visual start. */
function embeddedBlankBandDeleteEndLanding(
  nextDoc: HandoffNoteDoc,
  priorWire: string,
  nextWire: string,
  deletedProbeWire: number,
  group: EmbeddedBlankBandGroup
): number {
  const substantiveStart = substantiveRowStartBelowProbe(nextWire, deletedProbeWire);
  if (
    substantiveStart > deletedProbeWire &&
    nextWire[deletedProbeWire] === "\n" &&
    !isEmbeddedBlankBandProbeWire(nextDoc, deletedProbeWire) &&
    !embeddedBlankBandHasSubstantiveContentAboveBand(priorWire, group.probes)
  ) {
    return deletedProbeWire;
  }
  return substantiveStart;
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
  options?: HandoffBlankBandDeleteOptions
): EmbeddedBlankBandDeleteMove | null {
  if (!isEmbeddedBlankBandDeleteProbeWire(doc, focusWire, options)) {
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
  if (caretContext.kind === "mention-boundary" && !isEmbeddedBlankBandProbeWire(doc, focusWire)) {
    return null;
  }

  const { indexInGroup } = context;
  const wire = docToWire(doc);

  if (direction === "backspace") {
    if (indexInGroup === 0 && embeddedBlankBandHasSubstantiveRowAbove(wire, focusWire)) {
      if (!embeddedBlankBandIsSandwichedBlankRow(doc, focusWire)) {
        if (embeddedBlankBandMentionOnlyContentRowAbove(doc, focusWire)) {
          // Mention-only row: collapse blank infrastructure, not atomic mention delete.
        } else {
          const landing = embeddedBlankBandContentRowEndBeforeProbe(doc, focusWire);
          if (landing !== focusWire) {
            const charWire = focusWire - 1;
            const deletedChar = wire[charWire];
            if (
              charWire === landing &&
              deletedChar !== "\n" &&
              deletedChar !== undefined &&
              !/^\s$/.test(deletedChar)
            ) {
              const rowChip = resolveRowChipBeforeEmbeddedBlankProbe(doc, charWire);
              if (rowChip) {
                return rowChip;
              }
            }
            return {
              doc,
              caretWire: landing,
              branch: "backspace-content-above",
            };
          }
        }
      }
    }

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
 * Chip one character on the row immediately before a blank-band probe (§70).
 * `focusWire` is the removed char; probe is at `focusWire + 1`.
 * Called from `applyDocDelete` (caret on char) and from the blank-band step branch
 * (backspace on probe when semantic landing equals the char behind).
 */
export function resolveRowChipBeforeEmbeddedBlankProbe(
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
  const nextWire = docToWire(nextDoc);
  const lineStart =
    probeAfterDelete <= 0 ? 0 : nextWire.lastIndexOf("\n", probeAfterDelete - 1) + 1;
  const rowSegment = nextWire.slice(lineStart, probeAfterDelete);
  const rowEmptied = rowSegment.length === 0 || !/\S/.test(rowSegment);
  const deletedChar = wire[focusWire]!;
  const caretWire = embeddedBlankBandChipEndBeforeProbe(nextDoc, probeAfterDelete, deletedChar);
  const landedInterior =
    describeHandoffNoteCursorContext(nextDoc, caretWire).kind === "mention-interior";
  return {
    doc: nextDoc,
    caretWire,
    branch: "backspace-content-above",
    ...(rowEmptied ? { chipBeforeBlankBand: true } : {}),
    ...(landedInterior ? { preserveMentionInterior: true } : {}),
  };
}

/**
 * Delete from band head awaiting input: removes one blank-row `\n`
 * and lands on the next probe below or lower substantive visual start.
 */
export function resolveDeleteFromEmptyContentRowEnd(
  doc: HandoffNoteDoc,
  focusWire: number,
  options?: HandoffBlankBandDeleteOptions
): EmbeddedBlankBandDeleteMove | null {
  if (!embeddedBlankBandAtEmptyContentRowEnd(doc, focusWire, options)) {
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
  const nextWire = docToWire(nextDoc);
  const { indexInGroup, group } = context;

  if (indexInGroup < group.probes.length - 1) {
    return {
      doc: nextDoc,
      caretWire: collapseBlankBandDeleteLanding(nextDoc, focusWire, context),
      branch: "delete-blank-below",
    };
  }

  if (embeddedBlankBandHasSubstantiveRowBelowGroup(wire, group)) {
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
 * Backspace from empty content row end sitting on a band-edge `\n` (not delete-probe).
 * Removes one blank-row newline — same ladder as blank-band collapse.
 */
export function resolveBackspaceFromEmptyContentRowEnd(
  doc: HandoffNoteDoc,
  focusWire: number,
  options?: HandoffBlankBandDeleteOptions
): EmbeddedBlankBandDeleteMove | null {
  if (!embeddedBlankBandAtEmptyContentRowEnd(doc, focusWire, options)) {
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
    caretWire: collapseBlankBandBackspaceLanding(nextDoc, focusWire, context, doc),
    branch: "backspace-collapse-empty-above",
  };
}

/**
 * Backspace on a line-start `\n` before substantive content when every segment above is empty.
 * Not a blank-band probe — same collapse landing as blank-band ladder exhaustion.
 */
export function resolveEmbeddedBlankBandLineStartCollapse(
  doc: HandoffNoteDoc,
  focusWire: number,
  options?: HandoffBlankBandDeleteOptions
): EmbeddedBlankBandDeleteMove | null {
  if (isEmbeddedBlankBandDeleteProbeWire(doc, focusWire, options)) {
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
