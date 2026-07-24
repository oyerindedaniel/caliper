import {
  docPosEqual,
  docPosToWireOffset,
  isAtomicNode,
  nodeTokenLength,
  type HandoffNoteCaretLandingIntent,
  type HandoffNoteDocPos,
  wireOffsetToDocPos,
} from "./handoff-note-doc-pos.js";
import {
  docToWire,
  offsetAtDocPosition,
  spliceDocWireRange,
  type HandoffNoteDoc,
  type HandoffNoteEdit,
} from "./handoff-note-doc.js";

export type EmbeddedBlankBandCollapseBranch =
  | "row-chip-before-probe"
  | "step-to-content-row-end"
  | "backspace-collapse-blank"
  | "backspace-line-start-collapse"
  | "backspace-line-break-join"
  | "delete-collapse-blank-mid-band"
  | "delete-collapse-blank-at-edge"
  | "delete-line-break-join";

/** Caret may rest on blank-band probe infrastructure after collapse. */
export function blankBandCollapseBranchUsesProbeInfrastructureLanding(
  branch: EmbeddedBlankBandCollapseBranch
): boolean {
  return (
    branch === "backspace-collapse-blank" ||
    branch === "delete-collapse-blank-mid-band" ||
    branch === "delete-collapse-blank-at-edge" ||
    branch === "backspace-line-start-collapse"
  );
}

export type EmbeddedBlankBandCollapseMove = {
  doc: HandoffNoteDoc;
  caretWire: number;
  branch: EmbeddedBlankBandCollapseBranch;
  /**
   * Affinity on ambiguous content-char docks only (`collapsedSelectionWithIntent`).
   * CRE vs collapse-probe is structural — not this field.
   */
  affinityIntent: HandoffNoteCaretLandingIntent;
  /**
   * Producer-resolved selection focus. Collapse paths set this via
   * {@link docPosAfterBlankBandCollapse} (prior-owned alias vs probe infrastructure);
   * row-chip sets chip land focus. Delete-intent must not re-derive from `caretWire`.
   */
  focus: HandoffNoteDocPos;
};

/**
 * Collapse landing prefers atom/CRE alias when the stroke already owned that seam
 * (prior focus on an atom that abuts the blank-band probe). Otherwise collapse rests
 * on probe infrastructure. Derived from prior focus — not a landing-meaning flag.
 */
function blankBandCollapsePrefersProbeAlias(
  priorDoc: HandoffNoteDoc,
  priorFocus: HandoffNoteDocPos
): boolean {
  const node = priorDoc.nodes[priorFocus.nodeIndex];
  if (!isAtomicNode(node) || priorFocus.nodeOffset === 0) {
    return false;
  }
  const endWire = docPosToWireOffset(priorDoc, {
    nodeIndex: priorFocus.nodeIndex,
    nodeOffset: nodeTokenLength(node),
  });
  return isEmbeddedBlankBandProbeWire(priorDoc, endWire);
}

/**
 * Selection focus after blank-band collapse at `caretWire`.
 * Prior-owned atom abutting a probe keeps alias; else probe-infrastructure dock when
 * the branch lands on remaining probe topology.
 */
export function docPosAfterBlankBandCollapse(
  doc: HandoffNoteDoc,
  caretWire: number,
  branch: EmbeddedBlankBandCollapseBranch,
  prior?: { doc: HandoffNoteDoc; focus: HandoffNoteDocPos }
): HandoffNoteDocPos {
  const collapseLanding = blankBandCollapseBranchUsesProbeInfrastructureLanding(branch);
  const forceProbeInfrastructure =
    collapseLanding &&
    isEmbeddedBlankBandProbeWire(doc, caretWire) &&
    !(prior && blankBandCollapsePrefersProbeAlias(prior.doc, prior.focus));
  if (forceProbeInfrastructure) {
    return wireOffsetToDocPos(doc, caretWire);
  }
  // Focus-tied alias only — never first-probe-in-doc (multi-band docs collapse wrong).
  const alias = docPosAtEmbeddedBlankBandProbeAliasLanding(doc, caretWire);
  if (alias) {
    return alias;
  }
  if (
    isEmbeddedBlankBandProbeWire(doc, caretWire) &&
    embeddedBlankBandRowAboveProbeIsEmpty(doc, caretWire)
  ) {
    return docPosAfterContentRowChipBeforeProbe(doc, caretWire);
  }
  return wireOffsetToDocPos(doc, caretWire);
}

type BlankBandCollapseMoveDraft = Omit<EmbeddedBlankBandCollapseMove, "focus"> & {
  focus?: HandoffNoteDocPos;
};

/** Attach producer focus once — skip when the draft already owns focus (row-chip). */
function withBlankBandCollapseFocus(
  move: BlankBandCollapseMoveDraft,
  prior?: { doc: HandoffNoteDoc; focus: HandoffNoteDocPos }
): EmbeddedBlankBandCollapseMove {
  if (move.focus) {
    return move as EmbeddedBlankBandCollapseMove;
  }
  return {
    ...move,
    focus: docPosAfterBlankBandCollapse(move.doc, move.caretWire, move.branch, prior),
  };
}

/**
 * Delete at empty content-row end:
 * - `move` — collapse / clear (including sole leftover blank → empty doc)
 * - `noop` — last blank under substantive content above (band edge)
 * - `miss` — not this dock (e.g. line-start `\n` before content; Delete falls through)
 */
export type EmptyContentRowEndDeleteResolution =
  | { status: "move"; move: EmbeddedBlankBandCollapseMove }
  | { status: "noop" }
  | { status: "miss" };

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

/**
 * Blank-band probe next-segments are **empty only** (length 0).
 * Whitespace-only segments are content rows (typed spaces are real characters) —
 * they must not keep delete-probe / blank-row ownership.
 */
function isBlankBandSegment(segment: string): boolean {
  return segment.length === 0;
}

function lineStartBeforeWire(wire: string, endWire: number): number {
  return endWire <= 0 ? 0 : wire.lastIndexOf("\n", endWire - 1) + 1;
}

function lineSegmentEndingAt(wire: string, endWire: number): { start: number; segment: string } {
  const start = lineStartBeforeWire(wire, endWire);
  return { start, segment: wire.slice(start, endWire) };
}

function lineSegmentAtLineStart(wire: string, start: number): string {
  const lineEnd = wire.indexOf("\n", start);
  return wire.slice(start, lineEnd === -1 ? wire.length : lineEnd);
}

function isSubstantiveSegment(segment: string): boolean {
  return segment.length > 0 && /\S/.test(segment);
}

type AtomicWireSpan = {
  nodeIndex: number;
  start: number;
  end: number;
};

/** Atomic span owning this wire, including its start and end alias boundaries. */
function atomicWireSpanAt(doc: HandoffNoteDoc, wire: number): AtomicWireSpan | null {
  let start = 0;
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    const end = start + nodeTokenLength(node);
    if (isAtomicNode(node) && wire >= start && wire <= end) {
      return { nodeIndex, start, end };
    }
    start = end;
  }
  return null;
}

function wireIsInAtomicInterior(doc: HandoffNoteDoc, wire: number): boolean {
  const span = atomicWireSpanAt(doc, wire);
  return span !== null && wire > span.start && wire < span.end;
}

function wireIsAtAtomicBoundary(doc: HandoffNoteDoc, wire: number): boolean {
  const span = atomicWireSpanAt(doc, wire);
  return span !== null && (wire === span.start || wire === span.end);
}

function atomicEndWireAtOrContaining(doc: HandoffNoteDoc, wire: number): number | null {
  return atomicWireSpanAt(doc, wire)?.end ?? null;
}

function atomicEndDocPosAtWire(doc: HandoffNoteDoc, wire: number): HandoffNoteDocPos | null {
  const span = atomicWireSpanAt(doc, wire);
  return span === null ? null : { nodeIndex: span.nodeIndex, nodeOffset: span.end - span.start };
}

function embeddedBlankBandRowAboveProbeIsSoleSubstantiveChar(
  wire: string,
  probeWire: number
): boolean {
  const { segment } = lineSegmentEndingAt(wire, probeWire);
  return segment.length === 1 && isSubstantiveSegment(segment);
}

/** True when substantive content sits on the row immediately above `probeWire`. */
export function embeddedBlankBandHasSubstantiveRowAbove(wire: string, probeWire: number): boolean {
  if (probeWire <= 0) {
    return false;
  }
  return isSubstantiveSegment(lineSegmentEndingAt(wire, probeWire).segment);
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
    if (isSubstantiveSegment(lineSegmentAtLineStart(wire, start))) {
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
    if (isSubstantiveSegment(between)) {
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
 * Physical `probeWire - 1` may sit inside an atom; landing policy uses atom-end instead.
 * Sole remaining substantive char owns the char wire (affinity `after`) — never the probe.
 */
export function embeddedBlankBandContentRowEndBeforeProbe(
  doc: HandoffNoteDoc,
  probeWire: number
): number {
  const wire = docToWire(doc);
  const { start: lineStart, segment } = lineSegmentEndingAt(wire, probeWire);
  if (!isSubstantiveSegment(segment)) {
    return lineStart;
  }
  const physicalEnd = probeWire - 1;
  const atomicEnd = atomicEndWireAtOrContaining(doc, physicalEnd);
  if (atomicEnd !== null && wireIsInAtomicInterior(doc, physicalEnd)) {
    return atomicEnd;
  }
  return physicalEnd;
}

/**
 * Same-row whitespace content unit on the wire (excludes `\n` break transport).
 * Commit spacer / leftover pad / spacer-before-probe chips share this unit class —
 * always pair with a text owner check when a doc is available.
 */
function isSameRowWhitespaceContentChar(ch: string): boolean {
  return ch.length === 1 && ch !== "\n" && /\s/.test(ch);
}

/** Text-owned same-row whitespace at wire — not atom interior, not a break. */
export function isTextOwnedSameRowWhitespaceAtWire(doc: HandoffNoteDoc, wire: number): boolean {
  const ch = docToWire(doc)[wire];
  if (ch === undefined || !isSameRowWhitespaceContentChar(ch)) {
    return false;
  }
  const pos = wireOffsetToDocPos(doc, wire);
  return doc.nodes[pos.nodeIndex]?.type === "text";
}

/**
 * Caret landing after chipping the last character before a probe.
 * Whitespace chips use semantic row end; substantive chips prefer CRE (char or mention-end).
 */
function embeddedBlankBandChipEndBeforeProbe(
  doc: HandoffNoteDoc,
  probeWire: number,
  deletedChar: string
): number {
  const landing = embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire);
  if (isSameRowWhitespaceContentChar(deletedChar)) {
    return landing;
  }
  if (landing !== probeWire) {
    return landing;
  }
  const physicalEnd = probeWire - 1;
  if (physicalEnd >= 0 && wireIsInAtomicInterior(doc, physicalEnd)) {
    return physicalEnd;
  }
  return landing;
}

/**
 * Cleared visual dock after an emptied content-row chip.
 *
 * Semantic content-row-end names the empty segment at the former chip-site probe. After
 * an abutting clear, that segment is often a pre-existing blank beneath the cleared row;
 * the cleared visual row is the previous probe in the fused group when that previous
 * probe still has substantive content above it. Mid-fusion empties keep the semantic land.
 *
 * “Emptied” is post-delete topology only (no substantive row above + CRE collapsed to the
 * probe) — not a deleted-char whitespace sniff. Whitespace vs substantive still affects
 * chipEnd landing; fuse eligibility does not.
 */
function contentRowEmptiedAboveProbe(doc: HandoffNoteDoc, probeAfterDelete: number): boolean {
  const wire = docToWire(doc);
  return (
    !embeddedBlankBandHasSubstantiveRowAbove(wire, probeAfterDelete) &&
    embeddedBlankBandContentRowEndBeforeProbe(doc, probeAfterDelete) === probeAfterDelete
  );
}

function caretWireAfterEmptiedContentRowChip(
  doc: HandoffNoteDoc,
  probeAfterDelete: number,
  deletedChar: string
): number {
  const natural = embeddedBlankBandChipEndBeforeProbe(doc, probeAfterDelete, deletedChar);
  const wire = docToWire(doc);
  if (
    !contentRowEmptiedAboveProbe(doc, probeAfterDelete) ||
    !isEmbeddedBlankBandProbeWire(doc, natural)
  ) {
    return natural;
  }
  if (!embeddedBlankBandRowAboveProbeIsEmpty(doc, natural)) {
    return natural;
  }
  const context = embeddedBlankBandProbeContext(doc, natural);
  if (!context || context.indexInGroup <= 0) {
    return natural;
  }
  const previous = context.group.probes[context.indexInGroup - 1]!;
  if (!embeddedBlankBandHasSubstantiveRowAbove(wire, previous)) {
    return natural;
  }
  return previous;
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
  const semanticEnd = embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire);
  return focusWire === semanticEnd && focusWire !== probeWire;
}

export function embeddedBlankBandSpacerBeforeProbeRowChip(
  doc: HandoffNoteDoc,
  focusWire: number
): boolean {
  return (
    isTextOwnedSameRowWhitespaceAtWire(doc, focusWire) &&
    focusWire + 1 < docToWire(doc).length &&
    isEmbeddedBlankBandProbeWire(doc, focusWire + 1)
  );
}

/** Doc-pos authority: caret at content-row end immediately before a blank-band probe. */
function caretAtContentRowEndBeforeProbe(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  probeWire: number
): boolean {
  if (!isEmbeddedBlankBandProbeWire(doc, probeWire)) {
    return false;
  }
  const wire = docToWire(doc);
  const { start: lineStart, segment } = lineSegmentEndingAt(wire, probeWire);
  if (!isSubstantiveSegment(segment)) {
    return false;
  }
  const focusWire = docPosToWireOffset(doc, focus);
  if (wireIsInAtomicInterior(doc, focusWire)) {
    return false;
  }
  if (focusWire === probeWire && !caretRestsOnEmbeddedBlankBandProbeAlias(doc, focus, probeWire)) {
    return false;
  }
  const lineStartPos = wireOffsetToDocPos(doc, lineStart);
  if (focusWire === probeWire - 1) {
    const node = doc.nodes[focus.nodeIndex];
    if (node?.type === "text" && focus.nodeIndex !== lineStartPos.nodeIndex) {
      return true;
    }
    if (node?.type === "text" && focus.nodeIndex === lineStartPos.nodeIndex) {
      // ≤2-char same-node rows: last-char focus alone is not CRE (visual-start nibble /
      // affinity owns chip). Longer rows: last char is CRE by wire position.
      if (segment.length <= 2) {
        return false;
      }
      return focus.nodeOffset >= lineStartPos.nodeOffset + segment.length - 1;
    }
  }
  const node = doc.nodes[focus.nodeIndex];
  if (node?.type === "text" && focus.nodeIndex === lineStartPos.nodeIndex) {
    return focus.nodeOffset >= lineStartPos.nodeOffset + segment.length;
  }
  if (node?.type === "mention" && focusWire === probeWire) {
    return focus.nodeOffset >= 1 + node.agentId.length;
  }
  return false;
}

/**
 * Backspace on blank-band probe with content-row alias: unit behind is the prior char.
 * Caret on the content char itself is owned by resolveHandoffNoteDeleteIntent
 * (affinity `after` → that char; else generic unit-behind nibble) — never chip ahead here.
 */
function resolveBackspaceRowChipAtContentRowEnd(
  doc: HandoffNoteDoc,
  focusWire: number,
  focus: HandoffNoteDocPos
): EmbeddedBlankBandCollapseMove | null {
  if (!isEmbeddedBlankBandProbeWire(doc, focusWire)) {
    return null;
  }
  const wire = docToWire(doc);
  if (
    caretRestsOnEmbeddedBlankBandProbeAlias(doc, focus, focusWire) ||
    caretAtContentRowEndBeforeProbe(doc, focus, focusWire)
  ) {
    const charWire = focusWire - 1;
    if (charWire >= 0 && wire[charWire] !== "\n") {
      return resolveRowChipBeforeEmbeddedBlankProbe(doc, charWire);
    }
  }
  return null;
}

/**
 * Content-row edit adjacent to a blank band. This is intentionally separate from
 * blank-band collapse so delete intent can ask "does content win?" before
 * treating the same wire as blank infrastructure.
 */
export function resolveContentRowEditBeforeEmbeddedBlankBand(
  doc: HandoffNoteDoc,
  focusWire: number,
  direction: HandoffNoteEdit,
  focus: HandoffNoteDocPos
): EmbeddedBlankBandCollapseMove | null {
  const wire = docToWire(doc);
  if (direction === "delete") {
    if (focusWire + 1 >= wire.length) {
      return null;
    }
    if (
      caretAtContentRowEndBeforeProbe(doc, focus, focusWire + 1) ||
      embeddedBlankBandSpacerBeforeProbeRowChip(doc, focusWire)
    ) {
      const rowChip = resolveRowChipBeforeEmbeddedBlankProbe(doc, focusWire);
      if (rowChip) {
        return rowChip;
      }
    }
    return null;
  }

  // Probe alias only — content-char Backspace unit-behind is intent + affinity.
  return resolveBackspaceRowChipAtContentRowEnd(doc, focusWire, focus);
}

/** Collapsed caret at wire.length after a trailing `\n` (empty line start at document end). */
export function isTrailingNewlinePastEndWire(wire: string, offset: number): boolean {
  return wire.length > 0 && offset === wire.length && wire.endsWith("\n");
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
  return isSubstantiveSegment(segment);
}

/** Row segment above probe has no substantive text (content row cleared). */
export function embeddedBlankBandRowAboveProbeIsEmpty(
  doc: HandoffNoteDoc,
  probeWire: number
): boolean {
  return !isSubstantiveSegment(lineSegmentEndingAt(docToWire(doc), probeWire).segment);
}

/**
 * Last probe in a multi-probe band with empty row above — still blank-band delete
 * infrastructure when `requireSubstantiveBelow` matches band tail shape.
 */
function isBlankBandEmptyRowTailProbe(
  doc: HandoffNoteDoc,
  probeWire: number,
  requireSubstantiveBelow: boolean
): boolean {
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
  const hasBelow = embeddedBlankBandHasSubstantiveRowBelowGroup(docToWire(doc), group);
  return requireSubstantiveBelow ? hasBelow : !hasBelow;
}

/**
 * Single empty-content-row-end dock at a blank-band probe (CRE, not delete-probe).
 * Two geometries, one meaning:
 * - band-head under substantive content with probe-infrastructure focus
 * - emptied row above the probe (line-start / semantic end / alias focus; not empty-row-tail)
 */
export function handoffNoteCaretAtEmptyContentRowEndDock(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  probeWire: number
): boolean {
  if (!isEmbeddedBlankBandProbeWire(doc, probeWire)) {
    return false;
  }

  const wire = docToWire(doc);
  const context = embeddedBlankBandProbeContext(doc, probeWire);
  if (
    context &&
    context.indexInGroup === 0 &&
    docPosEqual(focus, wireOffsetToDocPos(doc, probeWire)) &&
    embeddedBlankBandHasSubstantiveRowAbove(wire, probeWire)
  ) {
    return true;
  }

  if (!embeddedBlankBandRowAboveProbeIsEmpty(doc, probeWire)) {
    return false;
  }
  if (
    isBlankBandEmptyRowTailProbe(doc, probeWire, true) ||
    isBlankBandEmptyRowTailProbe(doc, probeWire, false)
  ) {
    return false;
  }
  const focusWire = docPosToWireOffset(doc, focus);
  const lineStart = lineSegmentEndingAt(wire, probeWire).start;
  const semanticEnd = embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire);
  return (
    focusWire === lineStart ||
    focusWire === semanticEnd ||
    caretRestsOnEmbeddedBlankBandProbeAlias(doc, focus, probeWire)
  );
}

/**
 * Empty content row end: caret on the CRE dock before a probe, not blank-band
 * delete infrastructure. Substantive content still on the row before a non-probe
 * break is not empty row end. Focus owner required for probe alias docks.
 */
/**
 * Focus-less CRE from band topology alone — prefix-only blanks (`\n`, `\n\ntail`)
 * and lone trailing blank with no substantive above. Not used when focus is present
 * (dock owns that path); kept for wire-only callers / prefix fixtures.
 */
function emptyContentRowEndFromBandTopology(doc: HandoffNoteDoc, caretWire: number): boolean {
  const wire = docToWire(doc);
  if (embeddedBlankBandContentRowEndBeforeProbe(doc, caretWire) !== caretWire) {
    return false;
  }
  if (!isEmbeddedBlankBandProbeWire(doc, caretWire)) {
    if (isSubstantiveSegment(lineSegmentEndingAt(wire, caretWire).segment)) {
      return false;
    }
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

export function embeddedBlankBandAtEmptyContentRowEnd(
  doc: HandoffNoteDoc,
  caretWire: number,
  focus?: HandoffNoteDocPos
): boolean {
  if (
    focus &&
    isEmbeddedBlankBandProbeWire(doc, caretWire) &&
    handoffNoteCaretAtEmptyContentRowEndDock(doc, focus, caretWire)
  ) {
    return true;
  }
  return emptyContentRowEndFromBandTopology(doc, caretWire);
}

/** True when caret rests on blank-band collapse infrastructure (not empty content row end). */
export function isEmbeddedBlankBandCollapseProbeWire(
  doc: HandoffNoteDoc,
  wire: number,
  focus: HandoffNoteDocPos
): boolean {
  if (!isEmbeddedBlankBandProbeWire(doc, wire)) {
    return false;
  }
  if (
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

function collapseBlankBandAdjacentProbeLanding(
  deletedProbeWire: number,
  context: EmbeddedBlankBandProbeContext,
  direction: HandoffNoteEdit
): number | null {
  const { indexInGroup, group } = context;
  if (direction === "backspace" && indexInGroup > 0) {
    const targetProbe = group.probes[indexInGroup - 1]!;
    return deletedProbeWire < targetProbe ? targetProbe - 1 : targetProbe;
  }
  if (direction === "delete" && indexInGroup < group.probes.length - 1) {
    const targetProbe = group.probes[indexInGroup + 1]!;
    return deletedProbeWire < targetProbe ? targetProbe - 1 : targetProbe;
  }
  if (direction === "delete" && indexInGroup > 0) {
    return group.probes[indexInGroup - 1]!;
  }
  return null;
}

function collapseBlankBandBackspaceLanding(
  nextDoc: HandoffNoteDoc,
  deletedProbeWire: number,
  context: EmbeddedBlankBandProbeContext,
  priorDoc: HandoffNoteDoc
): { caretWire: number; affinityIntent: HandoffNoteCaretLandingIntent } {
  const nextWire = docToWire(nextDoc);
  const priorWire = docToWire(priorDoc);
  const { group } = context;

  // Content above the band (trailing-only or sandwiched) — use band-head, not the deleted
  // probe: mid-band probes have an empty segment immediately above, so probe-local
  // substantiveRowAbove is false and would wrongly take the leading/adjacent path.
  if (embeddedBlankBandHasSubstantiveContentAboveBand(priorWire, group.probes)) {
    const caretWire = embeddedBlankBandContentRowEndBeforeProbe(priorDoc, group.probes[0]!);
    return { caretWire, affinityIntent: "content-row-end" };
  }

  // Leading: no content above the band — continue toward remaining blanks / content below.
  const adjacent = collapseBlankBandAdjacentProbeLanding(deletedProbeWire, context, "backspace");
  if (adjacent !== null) {
    return { caretWire: adjacent, affinityIntent: "deletion-point" };
  }

  const range = embeddedBlankBandProbeRange(nextWire, group);
  const inBand = listEmbeddedBlankBandProbeWires(nextDoc).filter(
    (probe) => probe >= range.start && probe < range.end
  );
  if (inBand.length > 0) {
    return { caretWire: inBand[0]!, affinityIntent: "deletion-point" };
  }

  return {
    caretWire: substantiveRowStartBelowProbe(nextWire, deletedProbeWire),
    affinityIntent: "deletion-point",
  };
}

function collapseBlankBandDeleteLanding(
  nextDoc: HandoffNoteDoc,
  deletedProbeWire: number,
  context: EmbeddedBlankBandProbeContext
): number {
  const adjacent = collapseBlankBandAdjacentProbeLanding(deletedProbeWire, context, "delete");
  if (adjacent !== null) {
    return adjacent;
  }
  return substantiveRowStartBelowProbe(docToWire(nextDoc), deletedProbeWire);
}

function isSubstantiveLineStart(wire: string, start: number): boolean {
  return isSubstantiveSegment(lineSegmentAtLineStart(wire, start));
}

/** Visual row anchors: line starts plus one probe wire per empty visual row. */
export function listVisualRowAnchorWires(doc: HandoffNoteDoc): number[] {
  const wire = docToWire(doc);
  const probeList = listEmbeddedBlankBandProbeWires(doc);
  if (probeList.length === 0) {
    return wireLineStartOffsets(wire);
  }
  // Blank stops own empty-row lattice (including blank-only document end). Deduped set
  // avoids duplicate leading-0 when the first probe is also line start 0.
  const anchors = new Set<number>([0, ...listBlankVisualLineStartWires(doc)]);
  for (const start of wireLineStartOffsets(wire)) {
    if (start === 0 || anchors.has(start)) {
      continue;
    }
    if (!isSubstantiveLineStart(wire, start)) {
      continue;
    }
    anchors.add(start);
  }
  return [...anchors].sort((left, right) => left - right);
}

/** Blank probe on the same paint band as content above — storage `\n` before the next substantive row. */
export function isInlineSuffixBlankProbeWire(doc: HandoffNoteDoc, probeWire: number): boolean {
  const wire = docToWire(doc);
  const lineStart = lineStartBeforeWire(wire, probeWire);
  const beforeBreak = wire.slice(lineStart, probeWire);
  if (!isSubstantiveSegment(beforeBreak)) {
    return false;
  }
  const afterBreak = wire.slice(probeWire + 1);
  const nextNewline = afterBreak.indexOf("\n");
  const nextSegment = nextNewline === -1 ? afterBreak : afterBreak.slice(0, nextNewline);
  return isSubstantiveSegment(nextSegment);
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

/**
 * Navigable blank stop wires = empty line-start offsets (line-array authority).
 * Empty open → `[0]`. Every empty segment (including trailing empty after a final `\n`
 * at `wire.length`) is one stop. Probe wires stay delete/paint docks and may differ
 * from these line-starts — do not use probes as a second caret identity for the same row.
 */
export function listBlankVisualLineStartWires(doc: HandoffNoteDoc): number[] {
  const wire = docToWire(doc);
  if (wire.length === 0) {
    return [0];
  }
  const stops: number[] = [];
  for (const lineStart of wireLineStartOffsets(wire)) {
    if (isBlankBandSegment(lineSegmentAtLineStart(wire, lineStart))) {
      stops.push(lineStart);
    }
  }
  return stops;
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
  const { segment } = lineSegmentEndingAt(wire, probeWire);
  return isSubstantiveSegment(segment);
}

/**
 * Break-wire dock kind: bare `<br>` vs blank-anchor ZWSP.
 * Emit and paint must agree (one probe → one dock).
 *
 * Bare BR when: final probe before EOF line-pad; emptied empty CRE (empty row above);
 * sole-char content abutting empty CRE; or not empty-CRE (default bare).
 * Blank-anchor when: delete-probe owns the blank row; multi-char substantive abut;
 * or trailing whitespace above (not emptied) — except pad-preceding, which stays bare.
 */
export function embeddedBlankBandProbePaintsBareWireBreak(
  doc: HandoffNoteDoc,
  breakWire: number,
  focusDocPos: HandoffNoteDocPos
): boolean {
  if (!isEmbeddedBlankBandProbeWire(doc, breakWire)) {
    return false;
  }
  const wire = docToWire(doc);
  // Pad owns the trailing empty-line band — last wire `\n` before pad is always bare.
  if (wire.endsWith("\n") && breakWire === wire.length - 1) {
    return true;
  }
  if (isEmbeddedBlankBandCollapseProbeWire(doc, breakWire, focusDocPos)) {
    return false;
  }
  if (!embeddedBlankBandAtEmptyContentRowEnd(doc, breakWire, focusDocPos)) {
    return true;
  }
  if (embeddedBlankBandSubstantiveContentAbutsProbe(doc, breakWire)) {
    return embeddedBlankBandRowAboveProbeIsSoleSubstantiveChar(wire, breakWire);
  }
  return embeddedBlankBandRowAboveProbeIsEmpty(doc, breakWire);
}

/**
 * Whether render emits a blank-anchor after this probe break.
 * Uses probe-wire focus so emit matches paint for that probe (one dock).
 */
export function embeddedBlankBandProbeEmitsBlankAnchor(
  doc: HandoffNoteDoc,
  breakWire: number
): boolean {
  if (!isEmbeddedBlankBandProbeWire(doc, breakWire)) {
    return false;
  }
  return !embeddedBlankBandProbePaintsBareWireBreak(
    doc,
    breakWire,
    wireOffsetToDocPos(doc, breakWire)
  );
}

/**
 * Doc position after a content-row chip before a blank-band probe (partial or emptied).
 * Prefer mention/content alias when abutting; else semantic CRE (last remaining char).
 */
export function docPosAfterContentRowChipBeforeProbe(
  doc: HandoffNoteDoc,
  probeWire: number
): HandoffNoteDocPos {
  const mentionLanding = docPosAtEmbeddedBlankBandProbeAliasLanding(doc, probeWire);
  if (mentionLanding) {
    return mentionLanding;
  }
  return wireOffsetToDocPos(doc, embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire));
}

/**
 * Selection focus for a row-chip land wire.
 * Probe dock under content: same-wire alias (atom-end) or probe-infrastructure doc pos.
 * Content caretWire: chip land helper (may land off-wire on row text).
 */
function docPosAfterRowChipCaretWire(doc: HandoffNoteDoc, caretWire: number): HandoffNoteDocPos {
  const wire = docToWire(doc);
  if (
    isEmbeddedBlankBandProbeWire(doc, caretWire) &&
    embeddedBlankBandHasSubstantiveRowAbove(wire, caretWire)
  ) {
    const alias = docPosAtEmbeddedBlankBandProbeAliasLanding(doc, caretWire);
    if (alias && docPosToWireOffset(doc, alias) === caretWire) {
      return alias;
    }
    return wireOffsetToDocPos(doc, caretWire);
  }
  let probeWire = caretWire;
  if (!isEmbeddedBlankBandProbeWire(doc, caretWire) && caretWire + 1 < wire.length) {
    if (isEmbeddedBlankBandProbeWire(doc, caretWire + 1)) {
      probeWire = caretWire + 1;
    }
  }
  return docPosAfterContentRowChipBeforeProbe(doc, probeWire);
}

/**
 * Single row-chip land surface: cleared visual wire + selection focus after an emptied chip.
 * Classification (CRE vs delete-probe) is structural on the next key — not retained here.
 */
export function resolveRowChipLanding(
  doc: HandoffNoteDoc,
  probeAfterDelete: number,
  deletedChar: string
): { caretWire: number; focus: HandoffNoteDocPos } {
  const caretWire = caretWireAfterEmptiedContentRowChip(doc, probeAfterDelete, deletedChar);
  return { caretWire, focus: docPosAfterRowChipCaretWire(doc, caretWire) };
}

/**
 * Probe wire aliases semantic content row end after a whitespace chip — authority
 * belongs on the atomic node end or row tail, not blank-band zwsp infrastructure.
 */
export function docPosAtEmbeddedBlankBandProbeAliasLanding(
  doc: HandoffNoteDoc,
  probeWire: number
): HandoffNoteDocPos | null {
  if (!embeddedBlankBandSubstantiveContentAbutsProbe(doc, probeWire)) {
    return null;
  }
  const semanticWire = embeddedBlankBandContentRowEndBeforeProbe(doc, probeWire);
  const atomicEnd = atomicEndDocPosAtWire(doc, semanticWire);
  if (atomicEnd && docPosToWireOffset(doc, atomicEnd) === semanticWire) {
    return atomicEnd;
  }
  return wireOffsetToDocPos(doc, semanticWire);
}

/**
 * Atomic-start wire aliases to the preceding text-node tail (not the atom).
 * Same-wire owner as overlay inter-atomic / pre-atom text tails — not a second rule.
 * Used for forward-delete whitespace landing and DOM paint at atomic boundaries.
 */
export function docPosAtAtomicStartTextAlias(
  doc: HandoffNoteDoc,
  atomicStartWire: number
): HandoffNoteDocPos | null {
  let offset = 0;
  let atomicNodeIndex = -1;
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    if (isAtomicNode(node) && offset === atomicStartWire) {
      atomicNodeIndex = nodeIndex;
      break;
    }
    offset += nodeTokenLength(node);
  }
  if (atomicNodeIndex <= 0) {
    return null;
  }

  const prev = doc.nodes[atomicNodeIndex - 1];
  if (prev?.type !== "text") {
    return null;
  }

  return { nodeIndex: atomicNodeIndex - 1, nodeOffset: prev.text.length };
}

/**
 * Empty line-start stop → newline that opens that empty row (collapse splice target).
 * Mid-doc / EOF stops sit on the empty row start; the opener is usually stop - 1.
 * Probe-coincident stops are not mapped here — {@link resolveBlankVisualLineStartCollapse}
 * refuses those so probe / empty-CRE paths own them.
 */
function blankVisualLineStartToOpenProbeWire(doc: HandoffNoteDoc, stopWire: number): number | null {
  if (!listBlankVisualLineStartWires(doc).includes(stopWire)) {
    return null;
  }
  if (isEmbeddedBlankBandProbeWire(doc, stopWire)) {
    return null;
  }
  if (stopWire > 0 && isEmbeddedBlankBandProbeWire(doc, stopWire - 1)) {
    return stopWire - 1;
  }
  return null;
}

/**
 * After blank-row collapse from a stop caret, prefer remaining empty line-start identity.
 * When the collapsed stop was the last blank stop (often EOF), do not keep a band-head
 * land while a higher empty line-start remains — that skips a blank row (live jump).
 */
function blankStopLandCaretWire(
  doc: HandoffNoteDoc,
  landWire: number,
  priorStopWire: number,
  priorStops: number[]
): number {
  const stops = listBlankVisualLineStartWires(doc);
  let caret = landWire;
  if (stops.includes(caret)) {
    // keep stop identity
  } else if (isEmbeddedBlankBandProbeWire(doc, caret) && stops.includes(caret + 1)) {
    caret = caret + 1;
  }

  const priorWasLastStop =
    priorStops.length > 0 && priorStopWire === priorStops[priorStops.length - 1];
  if (priorWasLastStop && stops.length > 1) {
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    if (caret === first && last !== first) {
      return last;
    }
  }
  return caret;
}

function withBlankStopLand(
  move: EmbeddedBlankBandCollapseMove,
  priorStopWire: number,
  priorStops: number[],
  prior: { doc: HandoffNoteDoc; focus: HandoffNoteDocPos }
): EmbeddedBlankBandCollapseMove {
  const caretWire = blankStopLandCaretWire(move.doc, move.caretWire, priorStopWire, priorStops);
  // Caret may remount off the inner probe land — re-derive focus once for the final wire.
  return withBlankBandCollapseFocus(
    {
      doc: move.doc,
      caretWire,
      branch: move.branch,
      affinityIntent: move.affinityIntent,
    },
    prior
  );
}

/**
 * Backspace or Delete when caret is on a blank visual line-start stop (not a probe dock).
 * Collapses the empty row that stop names (via its opening probe), then lands on
 * stop/CRE authority — not probe-dock identity.
 *
 * Probe-coincident stops stay on {@link resolveEmbeddedBlankBandCollapse} /
 * empty-CRE probe paths. Do not divert those through this entry.
 */
export function resolveBlankVisualLineStartCollapse(
  doc: HandoffNoteDoc,
  stopWire: number,
  direction: HandoffNoteEdit,
  priorFocus: HandoffNoteDocPos
): EmbeddedBlankBandCollapseMove | null {
  const priorStops = listBlankVisualLineStartWires(doc);
  if (!priorStops.includes(stopWire)) {
    return null;
  }
  // Probe docks that share a stop wire are owned by probe / empty-CRE collapse.
  if (isEmbeddedBlankBandProbeWire(doc, stopWire)) {
    return null;
  }

  const openProbe = blankVisualLineStartToOpenProbeWire(doc, stopWire);
  if (openProbe === null) {
    return null;
  }
  const probeFocus = wireOffsetToDocPos(doc, openProbe);
  const prior = { doc, focus: priorFocus };
  const land = (move: EmbeddedBlankBandCollapseMove) =>
    withBlankStopLand(move, stopWire, priorStops, prior);

  if (direction === "backspace") {
    const emptyRow = resolveBackspaceFromEmptyContentRowEnd(doc, openProbe, probeFocus);
    if (emptyRow) {
      return land(emptyRow);
    }
    const probeCollapse = resolveEmbeddedBlankBandCollapse(doc, openProbe, "backspace", probeFocus);
    return probeCollapse ? land(probeCollapse) : null;
  }

  const emptyRow = resolveDeleteFromEmptyContentRowEnd(doc, openProbe, probeFocus);
  if (emptyRow.status === "move") {
    return land(emptyRow.move);
  }
  const probeCollapse = resolveEmbeddedBlankBandCollapse(doc, openProbe, "delete", probeFocus);
  return probeCollapse ? land(probeCollapse) : null;
}

/**
 * Typing at a blank-band probe wire rests on the `\n`; insert after it, not before.
 * Empty line-start stops can share that `\n` with the *next* blank's probe — when the
 * caret is on a stop, insert into this empty line (no after-probe step).
 */
export function insertDocPosAfterEmbeddedBlankProbe(
  doc: HandoffNoteDoc,
  pos: { nodeIndex: number; nodeOffset: number }
): { nodeIndex: number; nodeOffset: number } {
  const wire = offsetAtDocPosition(doc, pos.nodeIndex, pos.nodeOffset);
  const stops = listBlankVisualLineStartWires(doc);
  const onStop = stops.includes(wire);
  const onProbe = isEmbeddedBlankBandProbeWire(doc, wire);
  if (onStop) {
    return pos;
  }
  if (!onProbe) {
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

/** Row opens on an atomic node (pill), not typed text — including typed `@query`. */
function lineStartsWithAtomicNode(doc: HandoffNoteDoc, lineStartWire: number): boolean {
  const pos = wireOffsetToDocPos(doc, lineStartWire);
  return isAtomicNode(doc.nodes[pos.nodeIndex]) && pos.nodeOffset === 0;
}

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
    const lineStartWire = wire + 1;
    const segment = text.slice(lineStartWire, lineEnd === -1 ? text.length : lineEnd);
    if (!isSubstantiveSegment(segment) || lineStartsWithAtomicNode(doc, lineStartWire)) {
      continue;
    }
    return {
      exitNewlineWire: wire,
      lineStartWire,
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

/** Backspace or Delete at blank-band collapse-probe wires — caret policy plus wire splice. */
export function resolveEmbeddedBlankBandCollapse(
  doc: HandoffNoteDoc,
  focusWire: number,
  direction: HandoffNoteEdit,
  focus: HandoffNoteDocPos,
  options?: { atomicEndCollapse?: boolean }
): EmbeddedBlankBandCollapseMove | null {
  if (!options?.atomicEndCollapse && !isEmbeddedBlankBandCollapseProbeWire(doc, focusWire, focus)) {
    return null;
  }

  const context = embeddedBlankBandProbeContext(doc, focusWire);
  if (!context) {
    return null;
  }

  if (wireIsInAtomicInterior(doc, focusWire)) {
    return null;
  }
  if (
    !options?.atomicEndCollapse &&
    wireIsAtAtomicBoundary(doc, focusWire) &&
    !isEmbeddedBlankBandCollapseProbeWire(doc, focusWire, focus)
  ) {
    return null;
  }

  const { indexInGroup } = context;
  const wire = docToWire(doc);

  if (direction === "backspace") {
    const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
    const landing = collapseBlankBandBackspaceLanding(nextDoc, focusWire, context, doc);
    return withBlankBandCollapseFocus(
      {
        doc: nextDoc,
        caretWire: landing.caretWire,
        branch: "backspace-collapse-blank",
        affinityIntent: landing.affinityIntent,
      },
      { doc, focus }
    );
  }

  // Final wire `\n`: trailing-under-content is band-edge (nothing below) — miss so intent
  // no-ops. Leading-only may still collapse that blank.
  if (
    focusWire + 1 >= wire.length &&
    embeddedBlankBandHasSubstantiveContentAboveBand(wire, context.group.probes)
  ) {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  const prior = { doc, focus };
  if (indexInGroup < context.group.probes.length - 1) {
    return withBlankBandCollapseFocus(
      {
        doc: nextDoc,
        caretWire: collapseBlankBandDeleteLanding(nextDoc, focusWire, context),
        branch: "delete-collapse-blank-mid-band",
        affinityIntent: "deletion-point",
      },
      prior
    );
  }

  const nextWire = docToWire(nextDoc);
  if (embeddedBlankBandHasSubstantiveRowBelowGroup(wire, context.group)) {
    return withBlankBandCollapseFocus(
      {
        doc: nextDoc,
        caretWire: embeddedBlankBandDeleteEndLanding(
          nextDoc,
          wire,
          nextWire,
          focusWire,
          context.group
        ),
        branch: "delete-collapse-blank-at-edge",
        affinityIntent: "deletion-point",
      },
      prior
    );
  }

  return withBlankBandCollapseFocus(
    {
      doc: nextDoc,
      caretWire: collapseBlankBandDeleteLanding(nextDoc, focusWire, context),
      branch: "delete-collapse-blank-at-edge",
      affinityIntent: "deletion-point",
    },
    prior
  );
}

/**
 * Atomic delete that clears substantive content on a row above a sandwiched
 * blank band — lands on cleared-row visual start (band groups may merge on wire).
 */
export function resolveAtomicDeleteRowClearChip(
  priorDoc: HandoffNoteDoc,
  focusWire: number,
  nextDoc: HandoffNoteDoc
): { caretWire: number } | null {
  const priorWire = docToWire(priorDoc);
  const { start: lineStart } = lineSegmentEndingAt(priorWire, focusWire);
  const lineEndIdx = priorWire.indexOf("\n", lineStart);
  if (lineEndIdx === -1) {
    return null;
  }
  const lineSegment = priorWire.slice(lineStart, lineEndIdx);
  if (!isSubstantiveSegment(lineSegment)) {
    return null;
  }

  const nextWire = docToWire(nextDoc);
  const nextLineEndIdx = nextWire.indexOf("\n", lineStart);
  const nextLineEnd = nextLineEndIdx === -1 ? nextWire.length : nextLineEndIdx;
  const nextSegment = nextWire.slice(lineStart, nextLineEnd);
  if (isSubstantiveSegment(nextSegment)) {
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
 * Delete: unit ahead at that char. Backspace: only when intent already chose this char as
 * unit behind (affinity `after` on char-before-break), or probe-alias paths chip the prior char.
 */
export function resolveRowChipBeforeEmbeddedBlankProbe(
  doc: HandoffNoteDoc,
  focusWire: number
): EmbeddedBlankBandCollapseMove | null {
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
  if (wireIsInAtomicInterior(doc, focusWire)) {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  const landing = resolveRowChipLanding(nextDoc, focusWire, wire[focusWire]!);
  return {
    doc: nextDoc,
    caretWire: landing.caretWire,
    focus: landing.focus,
    branch: "row-chip-before-probe",
    // Affinity only if focus lands on an ambiguous content char; probe docks omit.
    affinityIntent: "content-row-end",
  };
}

/**
 * Delete from empty content-row end on a blank-band probe.
 * Sole leftover blank with no content above clears to empty; last blank under
 * content above is band-edge noop; non-probe line-start `\n` is a miss.
 */
export function resolveDeleteFromEmptyContentRowEnd(
  doc: HandoffNoteDoc,
  focusWire: number,
  focus?: HandoffNoteDocPos
): EmptyContentRowEndDeleteResolution {
  if (!embeddedBlankBandAtEmptyContentRowEnd(doc, focusWire, focus)) {
    return { status: "miss" };
  }
  const wire = docToWire(doc);
  if (focusWire < 0 || focusWire >= wire.length || wire[focusWire] !== "\n") {
    return { status: "miss" };
  }
  if (!isEmbeddedBlankBandProbeWire(doc, focusWire)) {
    return { status: "miss" };
  }
  const context = embeddedBlankBandProbeContext(doc, focusWire);
  if (!context) {
    return { status: "miss" };
  }
  if (focusWire + 1 >= wire.length) {
    if (embeddedBlankBandHasSubstantiveRowAbove(wire, focusWire)) {
      return { status: "noop" };
    }
    const prior = focus ? { doc, focus } : undefined;
    return {
      status: "move",
      move: withBlankBandCollapseFocus(
        {
          doc: spliceDocWireRange(doc, focusWire, focusWire + 1, ""),
          caretWire: 0,
          branch: "delete-collapse-blank-at-edge",
          affinityIntent: "deletion-point",
        },
        prior
      ),
    };
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  const { indexInGroup, group } = context;
  const prior = focus ? { doc, focus } : undefined;

  if (indexInGroup < group.probes.length - 1) {
    return {
      status: "move",
      move: withBlankBandCollapseFocus(
        {
          doc: nextDoc,
          caretWire: collapseBlankBandDeleteLanding(nextDoc, focusWire, context),
          branch: "delete-collapse-blank-mid-band",
          affinityIntent: "deletion-point",
        },
        prior
      ),
    };
  }

  return {
    status: "move",
    move: withBlankBandCollapseFocus(
      {
        doc: nextDoc,
        caretWire: collapseBlankBandEmptyRowEndLanding(doc, nextDoc, focusWire, context),
        branch: "delete-collapse-blank-at-edge",
        affinityIntent: "deletion-point",
      },
      prior
    ),
  };
}

/**
 * Backspace from empty content row end sitting on a band-edge `\n` (not delete-probe).
 * Removes one blank-row newline.
 *
 * Landing — same producer as blank-band Backspace ({@link collapseBlankBandBackspaceLanding}):
 * content above (trailing-only or sandwiched) remounts content-row-end with `after`; leading
 * blanks with no content above keep downward / lower-start landing. Delete empty-row-end
 * stays downward-only.
 */
export function resolveBackspaceFromEmptyContentRowEnd(
  doc: HandoffNoteDoc,
  focusWire: number,
  focus?: HandoffNoteDocPos
): EmbeddedBlankBandCollapseMove | null {
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
  const { indexInGroup, group } = context;
  const substantiveAbove = embeddedBlankBandHasSubstantiveRowAbove(wire, focusWire);
  const prior = focus ? { doc, focus } : undefined;

  // One Backspace lander for content-above and leading mid-band / non-head probes.
  // Sole leading blank (index 0, band exhausted upward) keeps empty-row-end downward land.
  if (substantiveAbove || indexInGroup < group.probes.length - 1 || indexInGroup > 0) {
    const landing = collapseBlankBandBackspaceLanding(nextDoc, focusWire, context, doc);
    return withBlankBandCollapseFocus(
      {
        doc: nextDoc,
        caretWire: landing.caretWire,
        branch: "backspace-collapse-blank",
        affinityIntent: landing.affinityIntent,
      },
      prior
    );
  }

  return withBlankBandCollapseFocus(
    {
      doc: nextDoc,
      caretWire: collapseBlankBandEmptyRowEndLanding(doc, nextDoc, focusWire, context),
      branch: "backspace-collapse-blank",
      affinityIntent: "deletion-point",
    },
    prior
  );
}

/**
 * True when every wire segment strictly before `focusWire` is empty/whitespace.
 * Contract line-start collapse: leading blanks only — never when upper content remains.
 */
function wireHasNoSubstantiveSegmentBefore(wire: string, focusWire: number): boolean {
  if (focusWire <= 0) {
    return true;
  }
  for (const segment of wire.slice(0, focusWire).split("\n")) {
    if (isSubstantiveSegment(segment)) {
      return false;
    }
  }
  return true;
}

/**
 * Backspace on a line-start `\n` before substantive content when every segment above is empty.
 * Not a blank-band probe — same collapse landing as blank-band ladder exhaustion.
 * Sandwiched geometry (substantive content above) must not match — Delete/Backspace there
 * fall through to generic splice / blank-band probe paths so caret lands at lower visual start.
 */
export function resolveEmbeddedBlankBandLineStartCollapse(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): EmbeddedBlankBandCollapseMove | null {
  const focusWire = docPosToWireOffset(doc, focus);
  if (isEmbeddedBlankBandCollapseProbeWire(doc, focusWire, focus)) {
    return null;
  }
  const wire = docToWire(doc);
  if (focusWire < 0 || focusWire >= wire.length || wire[focusWire] !== "\n") {
    return null;
  }
  if (!wireHasNoSubstantiveSegmentBefore(wire, focusWire)) {
    return null;
  }
  const afterBreak = wire.slice(focusWire + 1);
  const nextLineEnd = afterBreak.indexOf("\n");
  const nextSegment = nextLineEnd === -1 ? afterBreak : afterBreak.slice(0, nextLineEnd);
  if (!isSubstantiveSegment(nextSegment)) {
    return null;
  }

  const nextDoc = spliceDocWireRange(doc, focusWire, focusWire + 1, "");
  return withBlankBandCollapseFocus(
    {
      doc: nextDoc,
      caretWire: embeddedBlankBandSubstantiveContentStartWire(nextDoc),
      branch: "backspace-line-start-collapse",
      affinityIntent: "deletion-point",
    },
    { doc, focus }
  );
}

function substantiveLineBreakAt(doc: HandoffNoteDoc, wire: string, breakWire: number): boolean {
  if (breakWire < 0 || breakWire >= wire.length || wire[breakWire] !== "\n") {
    return false;
  }
  if (isEmbeddedBlankBandProbeWire(doc, breakWire)) {
    return false;
  }
  const lineStart = lineSegmentEndingAt(wire, breakWire).start;
  const segmentAbove = wire.slice(lineStart, breakWire);
  if (!isSubstantiveSegment(segmentAbove)) {
    return false;
  }
  const afterBreak = wire.slice(breakWire + 1);
  const nextLineEnd = afterBreak.indexOf("\n");
  const segmentBelow = nextLineEnd === -1 ? afterBreak : afterBreak.slice(0, nextLineEnd);
  return isSubstantiveSegment(segmentBelow);
}

/**
 * Merge two populated rows separated by a single substantive `\n` (normal line break, not blank-band).
 * Backspace at lower-row visual start; delete on the break wire.
 */
export function resolveSubstantiveLineBreakJoin(
  doc: HandoffNoteDoc,
  focusWire: number,
  direction: HandoffNoteEdit
): EmbeddedBlankBandCollapseMove | null {
  const wire = docToWire(doc);
  let breakWire: number;
  if (direction === "backspace") {
    if (focusWire <= 0 || wire[focusWire - 1] !== "\n") {
      return null;
    }
    breakWire = focusWire - 1;
  } else {
    if (focusWire < 0 || focusWire >= wire.length || wire[focusWire] !== "\n") {
      return null;
    }
    breakWire = focusWire;
  }
  if (!substantiveLineBreakAt(doc, wire, breakWire)) {
    return null;
  }
  const nextDoc = spliceDocWireRange(doc, breakWire, breakWire + 1, "");
  const branch: EmbeddedBlankBandCollapseBranch =
    direction === "backspace" ? "backspace-line-break-join" : "delete-line-break-join";
  return withBlankBandCollapseFocus({
    doc: nextDoc,
    caretWire: breakWire,
    branch,
    affinityIntent: "deletion-point",
  });
}
