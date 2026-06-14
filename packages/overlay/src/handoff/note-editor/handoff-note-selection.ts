import {
  collapsedSelection,
  describeHandoffNoteCursorContext,
  docPosEqual,
  docPosToWireOffset,
  docToWire,
  normalizeDocPos,
  normalizeSelection,
  resolveDocVerticalArrowMove,
  resolveWireLineColumn,
  resolveVerticalArrowRowStartLanding,
  resolveVerticalArrowVisualLanding,
  snapVerticalArrowLanding,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
  type HandoffNoteVerticalArrowDirection,
} from "@caliper/core";
import {
  flattenHandoffNoteLog,
  handoffNoteDomSnapshot,
  logVerArrow,
} from "../handoff-note-debug.js";
import {
  domPointToDocPos,
  getDocAnchorRect,
  probeDocPosAtVisualColumn,
  resolveDomPointAtDocPos,
} from "./handoff-note-dom-points.js";
import {
  buildHandoffNoteLayoutMap,
  buildLayoutMapFromSamples,
  isAtLayoutRowStart,
  type HandoffNoteLayoutMap,
} from "./handoff-note-layout-map.js";
import { type MeasuredWireOffset } from "./handoff-note-layout-map.js";

function readRawWireFocus(root: HTMLElement, doc: HandoffNoteDoc): number {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    return 0;
  }
  const range = selection.getRangeAt(0);
  const focus = domPointToDocPos(root, doc, range.endContainer, range.endOffset);
  return docPosToWireOffset(doc, focus);
}

/** DOM caret fell behind editor authority (e.g. popover pick left selection at superseded @query). */
function shouldRestoreAuthorityOverDom(
  doc: HandoffNoteDoc,
  live: HandoffNoteDocPos,
  from: HandoffNoteDocPos
): boolean {
  const liveWire = docPosToWireOffset(doc, live);
  const fromWire = docPosToWireOffset(doc, from);
  if (liveWire >= fromWire) {
    return false;
  }

  const liveNode = doc.nodes[live.nodeIndex];
  if (liveNode?.type === "text" && live.nodeOffset === liveNode.text.length) {
    return true;
  }

  const context = describeHandoffNoteCursorContext(doc, liveWire);
  if (context.kind === "mention-boundary" && context.edge === "start" && fromWire > context.end) {
    return true;
  }

  return false;
}

export function readDocSelection(root: HTMLElement, doc: HandoffNoteDoc): HandoffNoteSelection {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    return normalizeSelection(doc, {
      anchor: { nodeIndex: 0, nodeOffset: 0 },
      focus: { nodeIndex: 0, nodeOffset: 0 },
    });
  }

  const range = selection.getRangeAt(0);
  const rawAnchor = domPointToDocPos(root, doc, range.startContainer, range.startOffset);
  const rawFocus = domPointToDocPos(root, doc, range.endContainer, range.endOffset);
  const anchor = normalizeDocPos(doc, rawAnchor);
  const focus = normalizeDocPos(doc, rawFocus, { from: rawAnchor });
  return { anchor, focus };
}

export function readDocCursor(root: HTMLElement, doc: HandoffNoteDoc): HandoffNoteDocPos {
  return readDocSelection(root, doc).focus;
}

export function repairDocSelectionIfNeeded(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  from?: HandoffNoteDocPos,
  options?: { mode?: "full" | "strand-only" }
): HandoffNoteDocPos {
  const live = readDocSelection(root, doc);
  if (!docPosEqualNormalized(doc, live.anchor, live.focus)) {
    flattenHandoffNoteLog("caret>>repair", {
      branch: "nonCollapsedRange",
      anchor: live.anchor,
      focus: live.focus,
      from,
    });
    return live.focus;
  }

  const focusWire = readRawWireFocus(root, doc);
  const fromWire = from !== undefined ? docPosToWireOffset(doc, from) : undefined;
  const context = describeHandoffNoteCursorContext(doc, focusWire);

  if (
    context.kind === "mention-interior" &&
    fromWire !== undefined &&
    (fromWire <= context.start || fromWire > context.end)
  ) {
    const restored = wireOffsetToDocPos(doc, fromWire);
    flattenHandoffNoteLog("caret>>repair", {
      branch: "restoreFromOutsideMention",
      readStart: focusWire,
      fromWire,
      restoreTo: fromWire,
    });
    setDocSelection(root, doc, collapsedSelection(restored), { from, source: "repair" });
    return restored;
  }

  if (options?.mode === "strand-only") {
    return normalizeDocPos(doc, live.focus, { from });
  }

  if (from !== undefined && shouldRestoreAuthorityOverDom(doc, live.focus, from)) {
    flattenHandoffNoteLog("caret>>repair", {
      branch: "restoreAuthority",
      live: live.focus,
      liveWire: docPosToWireOffset(doc, live.focus),
      from,
      fromWire: docPosToWireOffset(doc, from),
    });
    setDocSelection(root, doc, collapsedSelection(from), { from, source: "repair.authority" });
    return from;
  }

  const normalized = normalizeDocPos(doc, live.focus, { from });
  if (docPosEqualNormalized(doc, normalized, live.focus)) {
    return normalized;
  }

  flattenHandoffNoteLog("caret>>repair", {
    branch: "snapDocPos",
    read: live.focus,
    from,
    snapped: normalized,
  });
  setDocSelection(root, doc, collapsedSelection(normalized), { from, source: "repair" });
  return normalized;
}

function docPosEqualNormalized(
  doc: HandoffNoteDoc,
  a: HandoffNoteDocPos,
  b: HandoffNoteDocPos
): boolean {
  const left = normalizeDocPos(doc, a);
  const right = normalizeDocPos(doc, b);
  return left.nodeIndex === right.nodeIndex && left.nodeOffset === right.nodeOffset;
}

export function setDocSelection(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  selection: HandoffNoteSelection,
  options?: { from?: HandoffNoteDocPos; source?: string }
): void {
  const docSel = normalizeSelection(doc, selection, { from: options?.from });
  const docApi = root.ownerDocument;
  const native = docApi.getSelection();
  if (!native) {
    return;
  }

  const startPoint = resolveDomPointAtDocPos(root, doc, docSel.anchor);
  const endPoint = resolveDomPointAtDocPos(root, doc, docSel.focus);
  const source = options?.source ?? "unknown";

  if (!startPoint || !endPoint) {
    flattenHandoffNoteLog(`caret>>setDoc>>${source}>>miss`, {
      requested: docSel,
      from: options?.from,
      dom: handoffNoteDomSnapshot(root),
    });
    return;
  }

  const range = docApi.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  native.removeAllRanges();
  native.addRange(range);

  flattenHandoffNoteLog(`caret>>setDoc>>${source}`, {
    requested: docSel,
    wire: {
      start: docPosToWireOffset(doc, docSel.anchor),
      end: docPosToWireOffset(doc, docSel.focus),
    },
  });
}

function pickClosestOnLine(line: MeasuredWireOffset[], targetLeft: number): MeasuredWireOffset {
  let best = line[0]!;
  for (const sample of line) {
    if (Math.abs(sample.left - targetLeft) < Math.abs(best.left - targetLeft)) {
      best = sample;
    }
  }
  return best;
}

function isMentionAtomStart(doc: HandoffNoteDoc, pos: HandoffNoteDocPos): boolean {
  const node = doc.nodes[pos.nodeIndex];
  return node?.type === "mention" && pos.nodeOffset === 0;
}

type VisualRowStartContext = {
  root: HTMLElement;
  targetRowTop: number;
  targetLineIndex: number;
  rowIndexForWire: (wire: number) => number;
  coordsForWire: (wire: number) => MeasuredWireOffset | null;
  goalColumnTolerance: number;
};

function pickVerticalLandingOnLine(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  goalColumn: number,
  atRowStart: boolean,
  rowStart?: VisualRowStartContext
): { pos: HandoffNoteDocPos; branch: string } {
  const fromMentionStart = isMentionAtomStart(doc, focus);
  if (atRowStart && targetLine.length > 0) {
    if (rowStart) {
      // Row-start alignment is on the current band's content edge (goalColumn), not the
      // target band's leftmost layout sample (often a mention boundary on mid-text wrap).
      const probeColumn = goalColumn;
      const probed = probeDocPosAtVisualColumn(
        rowStart.root,
        doc,
        rowStart.targetRowTop,
        probeColumn
      );
      if (probed) {
        const landing = snapVerticalArrowLanding(doc, probed, direction);
        const resolvedWire = docPosToWireOffset(doc, landing);
        const probeRowIndex = rowStart.rowIndexForWire(resolvedWire);
        const probeCoord = rowStart.coordsForWire(resolvedWire);
        const columnMatches =
          probeCoord !== null &&
          Math.abs(probeCoord.left - goalColumn) <= rowStart.goalColumnTolerance;
        if (probeRowIndex === rowStart.targetLineIndex && columnMatches) {
          logVerArrow("resolve.rowStartProbe", {
            direction,
            fromWire: docPosToWireOffset(doc, focus),
            goalColumn,
            probeColumn,
            rowTop: rowStart.targetRowTop,
            resolvedWire,
            probeRowIndex,
            targetLineIndex: rowStart.targetLineIndex,
            probeLeft: probeCoord.left,
            accepted: true,
            branch: "dom-row-start-probe",
          });
          return {
            pos: normalizeDocPos(doc, landing, { from: focus }),
            branch: "dom-row-start-probe",
          };
        }
        logVerArrow("resolve.rowStartProbe", {
          direction,
          fromWire: docPosToWireOffset(doc, focus),
          goalColumn,
          probeColumn,
          rowTop: rowStart.targetRowTop,
          resolvedWire,
          probeRowIndex,
          targetLineIndex: rowStart.targetLineIndex,
          probeLeft: probeCoord?.left ?? null,
          columnMatches,
          accepted: false,
          branch: "probe-wrong-row",
        });
      } else {
        logVerArrow("resolve.rowStartProbe", {
          direction,
          fromWire: docPosToWireOffset(doc, focus),
          goalColumn,
          probeColumn,
          rowTop: rowStart.targetRowTop,
          branch: "probe-miss",
        });
      }
    }

    const rowStartLanding = resolveVerticalArrowRowStartLanding(
      doc,
      direction,
      targetLine,
      goalColumn
    );
    if (rowStartLanding) {
      const pos = normalizeDocPos(doc, wireOffsetToDocPos(doc, rowStartLanding.offset), {
        from: focus,
      });
      logVerArrow("resolve.rowStartProbe", {
        direction,
        fromWire: docPosToWireOffset(doc, focus),
        goalColumn,
        resolvedWire: docPosToWireOffset(doc, pos),
        branch: rowStartLanding.branch,
      });
      return { pos, branch: rowStartLanding.branch };
    }
  }

  const landing = resolveVerticalArrowVisualLanding(doc, direction, targetLine, goalColumn, {
    fromMentionStart,
  });
  if (landing === null) {
    const picked = pickClosestOnLine(targetLine, goalColumn);
    return {
      pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, picked.wire), { from: focus }),
      branch: "dom-column",
    };
  }

  let targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, landing.offset), { from: focus });
  if (!fromMentionStart && landing.branch === "dom-column") {
    const snapped = snapVerticalArrowLanding(doc, targetPos, direction);
    if (!docPosEqual(targetPos, snapped)) {
      targetPos = snapped;
      return { pos: targetPos, branch: "dom-snapVertical" };
    }
  }
  return { pos: targetPos, branch: landing.branch };
}

function resolveLayoutVerticalArrowMove(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  layout: HandoffNoteLayoutMap,
  goalColumn: number,
  root?: HTMLElement
): { pos: HandoffNoteDocPos; handled: boolean; branch?: string } {
  const fromWire = docPosToWireOffset(doc, focus);
  if (layout.visualRowCount < 2) {
    return { pos: focus, handled: false };
  }

  const currentLineIndex = layout.rowIndexForWire(fromWire);
  const targetLineIndex = direction === "up" ? currentLineIndex - 1 : currentLineIndex + 1;
  if (currentLineIndex < 0 || targetLineIndex < 0 || targetLineIndex >= layout.rows.length) {
    logVerArrow("resolve.reject", {
      direction,
      fromWire,
      reason: "lineIndexOutOfRange",
      currentLineIndex,
      targetLineIndex,
      visualRowCount: layout.visualRowCount,
    });
    return { pos: focus, handled: false };
  }

  const targetRow = layout.rows[targetLineIndex]!;
  const atRowStart = isAtLayoutRowStart(layout, fromWire, goalColumn);
  const edgeTolerance = Math.max(2, layout.lineHeight * 0.25);
  logVerArrow("resolve.layout", {
    direction,
    fromWire,
    goalColumn,
    currentLineIndex,
    targetLineIndex,
    atRowStart,
    targetRowWires: targetRow.samples.map((sample) => sample.wire),
  });

  const { pos: targetPos, branch } = pickVerticalLandingOnLine(
    doc,
    focus,
    direction,
    targetRow.samples,
    goalColumn,
    atRowStart,
    atRowStart && root
      ? {
          root,
          targetRowTop: targetRow.top,
          targetLineIndex,
          rowIndexForWire: layout.rowIndexForWire.bind(layout),
          coordsForWire: layout.coordsForWire.bind(layout),
          goalColumnTolerance: edgeTolerance,
        }
      : undefined
  );

  if (docPosEqual(targetPos, focus)) {
    return { pos: focus, handled: false };
  }
  return { pos: targetPos, handled: true, branch };
}

export function resolveMeasuredVerticalArrowMove(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  measured: MeasuredWireOffset[],
  _currentTop: number,
  currentLeft: number,
  lineHeight: number
): { pos: HandoffNoteDocPos; handled: boolean; branch?: string } {
  if (measured.length < 2) {
    return { pos: focus, handled: false };
  }
  const layout = buildLayoutMapFromSamples(measured, lineHeight);
  return resolveLayoutVerticalArrowMove(doc, focus, direction, layout, currentLeft);
}

function hasAdjacentWireLine(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection
): boolean {
  const wire = docToWire(doc);
  const offset = docPosToWireOffset(doc, focus);
  const { lineIndex } = resolveWireLineColumn(wire, Math.min(offset, Math.max(0, wire.length)));
  const lineCount = wire.includes("\n") ? wire.split("\n").length : 1;
  const targetLineIndex = direction === "up" ? lineIndex - 1 : lineIndex + 1;
  return targetLineIndex >= 0 && targetLineIndex < lineCount;
}

function wireLineIndexForFocus(doc: HandoffNoteDoc, focus: HandoffNoteDocPos): number {
  const wire = docToWire(doc);
  const offset = docPosToWireOffset(doc, focus);
  return resolveWireLineColumn(wire, Math.min(offset, Math.max(0, wire.length))).lineIndex;
}

function wireLineCount(doc: HandoffNoteDoc): number {
  const wire = docToWire(doc);
  return wire.includes("\n") ? wire.split("\n").length : 1;
}

function layoutVerticalMoveRejected(
  layout: HandoffNoteLayoutMap,
  fromWire: number,
  direction: HandoffNoteVerticalArrowDirection
): boolean {
  if (layout.visualRowCount < 2) {
    return false;
  }
  const currentLineIndex = layout.rowIndexForWire(fromWire);
  const targetLineIndex = direction === "up" ? currentLineIndex - 1 : currentLineIndex + 1;
  return currentLineIndex >= 0 && (targetLineIndex < 0 || targetLineIndex >= layout.visualRowCount);
}

/** Clash-style bleed gate: multiline `\n` docs must not bleed when layout still owes a vertical move. */
function shouldApplyVerticalBoundaryBleed(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  layout: HandoffNoteLayoutMap,
  fromWire: number
): boolean {
  const wire = docToWire(doc);
  const hasNewline = wire.includes("\n");
  const lineIndex = wireLineIndexForFocus(doc, focus);
  const onFirstWireLine = lineIndex === 0;
  const onLastWireLine = lineIndex === wireLineCount(doc) - 1;
  const layoutRejected = layoutVerticalMoveRejected(layout, fromWire, direction);

  if (hasNewline) {
    if (direction === "up" && !onFirstWireLine) {
      return false;
    }
    if (direction === "down" && !onLastWireLine) {
      return false;
    }
    if (layoutRejected) {
      return false;
    }
  }

  const currentLineIndex = layout.rowIndexForWire(fromWire);
  if (layout.visualRowCount < 2) {
    return true;
  }
  if (direction === "up") {
    return currentLineIndex === 0;
  }
  return currentLineIndex >= 0 && currentLineIndex === layout.visualRowCount - 1;
}

export function resolveDomVerticalArrowMove(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection
): { pos: HandoffNoteDocPos; handled: boolean } {
  const fromWire = docPosToWireOffset(doc, focus);
  logVerArrow("resolve.entry", {
    direction,
    fromWire,
    hasNewline: docToWire(doc).includes("\n"),
    adjacentWireLine: hasAdjacentWireLine(doc, focus, direction),
  });

  if (hasAdjacentWireLine(doc, focus, direction)) {
    const wireMove = resolveDocVerticalArrowMove(doc, focus, direction);
    if (wireMove.handled) {
      logVerArrow("resolve.wireAdjacent", {
        direction,
        fromWire,
        toWire: docPosToWireOffset(doc, wireMove.pos),
      });
      return wireMove;
    }
  }

  const layout = buildHandoffNoteLayoutMap(root, doc, focus);
  const focusCoord = layout.coordsForWire(fromWire);
  const anchorRect = getDocAnchorRect(root, doc, focus);
  const goalColumn = focusCoord?.left ?? anchorRect?.left ?? 0;
  const layoutMove = resolveLayoutVerticalArrowMove(
    doc,
    focus,
    direction,
    layout,
    goalColumn,
    root
  );
  if (layoutMove.handled) {
    logVerArrow("resolve.land", {
      direction,
      fromWire,
      toWire: docPosToWireOffset(doc, layoutMove.pos),
      branch: layoutMove.branch ?? null,
    });
    return { pos: layoutMove.pos, handled: true };
  }

  const currentLineIndex = layout.rowIndexForWire(fromWire);
  const layoutRejected = layoutVerticalMoveRejected(layout, fromWire, direction);
  const bleedAllowed = shouldApplyVerticalBoundaryBleed(doc, focus, direction, layout, fromWire);
  logVerArrow("resolve.bleedGate", {
    direction,
    fromWire,
    hasNewline: docToWire(doc).includes("\n"),
    wireLineIndex: wireLineIndexForFocus(doc, focus),
    wireLineCount: wireLineCount(doc),
    currentLineIndex,
    visualRowCount: layout.visualRowCount,
    layoutRejected,
    bleedAllowed,
  });

  if (layout.visualRowCount >= 2 && currentLineIndex >= 0 && !bleedAllowed) {
    logVerArrow("resolve.blockedMidWrap", {
      direction,
      fromWire,
      visualRowCount: layout.visualRowCount,
      branch: layoutRejected ? "layout-exhausted-multiline" : "mid-wrap-no-bleed",
    });
    return { pos: focus, handled: false };
  }

  const fallback = resolveDocVerticalArrowMove(doc, focus, direction);
  logVerArrow("resolve.fallbackWire", {
    direction,
    fromWire,
    toWire: docPosToWireOffset(doc, fallback.pos),
    handled: fallback.handled,
  });
  return fallback;
}
