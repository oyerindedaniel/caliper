// DO NOT DELETE THIS FILE
import {
  docPosToWireOffset,
  docToWire,
  isEmbeddedBlankBandDeleteProbeWire,
  isEmbeddedBlankBandProbeWire,
  listEmbeddedBlankBandProbeWires,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";

const LOG_PREFIX = "[handoff-note]";

function escapeWireChar(char: string | undefined): string | null {
  if (char === undefined) {
    return null;
  }
  if (char === "\n") {
    return "\\n";
  }
  if (char === "\r") {
    return "\\r";
  }
  return char;
}

/** Escaped wire for console — newlines visible as \\n. */
export function escapeWireForLog(wire: string): string {
  return wire.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

/** Predict blank-band delete branch when focus is on a probe wire (dry-run). */
function predictBlankBandDeleteBranch(
  doc: HandoffNoteDoc,
  focusWire: number,
  direction: "backspace" | "delete"
): { branch: string; predictedCaretWire: number } | null {
  if (!isEmbeddedBlankBandProbeWire(doc, focusWire)) {
    return null;
  }
  const probes = listEmbeddedBlankBandProbeWires(doc);
  const probeIndex = probes.indexOf(focusWire);
  if (probeIndex < 0) {
    return null;
  }
  const wire = docToWire(doc);
  if (direction === "backspace") {
    if (probeIndex === 0) {
      const rowEnd = focusWire - 1;
      if (rowEnd < 0) {
        return null;
      }
      return { branch: "backspace-content-above", predictedCaretWire: rowEnd };
    }
    return {
      branch: "backspace-blank-above",
      predictedCaretWire: probes[probeIndex - 1]!,
    };
  }
  if (focusWire + 1 >= wire.length) {
    return null;
  }
  if (probeIndex < probes.length - 1) {
    return { branch: "delete-blank-below", predictedCaretWire: probes[probeIndex + 1]! };
  }
  return { branch: "delete-lower-row", predictedCaretWire: focusWire };
}

function snapshotDocPos(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos
): { nodeIndex: number; nodeOffset: number; nodeType: string } {
  const node = doc.nodes[pos.nodeIndex];
  return {
    nodeIndex: pos.nodeIndex,
    nodeOffset: pos.nodeOffset,
    nodeType: node?.type ?? "missing",
  };
}

function caretOnMentionNodeEnd(doc: HandoffNoteDoc, pos: HandoffNoteDocPos): boolean {
  const node = doc.nodes[pos.nodeIndex];
  return node?.type === "mention" && pos.nodeOffset >= 1 + node.agentId.length;
}

function docPosSame(a: HandoffNoteDocPos, b: HandoffNoteDocPos): boolean {
  return a.nodeIndex === b.nodeIndex && a.nodeOffset === b.nodeOffset;
}

export function buildCaretStateSnapshot(options: {
  doc: HandoffNoteDoc;
  authorityFocus?: HandoffNoteDocPos;
  activeFocus?: HandoffNoteDocPos;
  root?: HTMLElement;
  direction?: "backspace" | "delete";
  chipBeforeBlankBand?: boolean;
}): Record<string, unknown> {
  const wire = docToWire(options.doc);
  const probes = listEmbeddedBlankBandProbeWires(options.doc);
  const authorityWire =
    options.authorityFocus !== undefined
      ? docPosToWireOffset(options.doc, options.authorityFocus)
      : undefined;
  const activeWire =
    options.activeFocus !== undefined
      ? docPosToWireOffset(options.doc, options.activeFocus)
      : undefined;
  const focusWire = activeWire ?? authorityWire ?? 0;
  const atProbe = isEmbeddedBlankBandProbeWire(options.doc, focusWire);
  const atDeleteProbe = isEmbeddedBlankBandDeleteProbeWire(options.doc, focusWire, {
    chipBeforeBlankBand: options.chipBeforeBlankBand,
  });
  const probeIndex = atProbe ? probes.indexOf(focusWire) : -1;

  const snapshot: Record<string, unknown> = {
    wireLen: wire.length,
    wire: escapeWireForLog(wire),
    contractProbes: probes,
    focusWire,
    atProbe,
    atDeleteProbe,
    chipBeforeBlankBand: options.chipBeforeBlankBand ?? false,
    charBefore: focusWire > 0 ? escapeWireChar(wire[focusWire - 1]) : null,
    charAt: focusWire < wire.length ? escapeWireChar(wire[focusWire]) : null,
    charAfter: focusWire + 1 < wire.length ? escapeWireChar(wire[focusWire + 1]) : null,
  };

  if (authorityWire !== undefined) {
    snapshot.authorityWire = authorityWire;
  }
  if (activeWire !== undefined) {
    snapshot.activeWire = activeWire;
  }
  if (authorityWire !== undefined && activeWire !== undefined) {
    snapshot.authorityDrift = authorityWire !== activeWire;
  }
  if (options.authorityFocus !== undefined) {
    snapshot.authorityDoc = snapshotDocPos(options.doc, options.authorityFocus);
    snapshot.authorityOnMentionNodeEnd = caretOnMentionNodeEnd(options.doc, options.authorityFocus);
  }
  if (options.activeFocus !== undefined) {
    snapshot.activeDoc = snapshotDocPos(options.doc, options.activeFocus);
    snapshot.activeOnMentionNodeEnd = caretOnMentionNodeEnd(options.doc, options.activeFocus);
  }
  if (options.authorityFocus !== undefined && options.activeFocus !== undefined) {
    snapshot.docPosDrift = !docPosSame(options.authorityFocus, options.activeFocus);
  }
  if (probeIndex >= 0) {
    snapshot.probeIndex = probeIndex;
    snapshot.firstProbe = probeIndex === 0;
  }

  if (options.direction !== undefined) {
    const predicted = predictBlankBandDeleteBranch(options.doc, focusWire, options.direction);
    if (predicted) {
      snapshot.predictedBlankBandBranch = predicted.branch;
      snapshot.predictedCaretWire = predicted.predictedCaretWire;
    }
  }

  if (options.root) {
    snapshot.dom = handoffNoteSelectionSnapshot(options.root);
  }

  return snapshot;
}

export function logEditStateTrace(phase: string, data: Record<string, unknown> = {}): void {
  flattenHandoffNoteLog(`state>>${phase}`, data);
}

/** Filter console with `state>>` / `caret>>` / `delete>>` / `dom.` for pipeline traces. `caret>>setDoc>>` = doc→DOM paint. */
export function flattenHandoffNoteLog(
  event: string,
  data: Record<string, unknown> = {},
  level: "log" | "warn" = "log"
): void {
  const line = JSON.stringify({ event, ts: Date.now(), ...data });
  if (level === "warn") {
    console.warn(`${LOG_PREFIX} ${event}`, line);
    return;
  }
  console.log(`${LOG_PREFIX} ${event}`, line);
}

export function logCaretBoundaryTrace(source: string, data: Record<string, unknown> = {}): void {
  flattenHandoffNoteLog(`caret>>${source}`, data);
}

export function logCaretTrace(source: string, data: Record<string, unknown> = {}): void {
  flattenHandoffNoteLog(`caret>>${source}`, data);
}

export function logVerArrow(source: string, data: Record<string, unknown> = {}): void {
  flattenHandoffNoteLog(`caret>>ver>>${source}`, data);
}

export function handoffNoteDomSnapshot(
  root: HTMLElement | undefined
): Array<Record<string, unknown>> {
  if (!root) {
    return [];
  }
  return [...root.childNodes].map((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return { kind: "text", value: node.textContent ?? "" };
    }
    if (node instanceof HTMLSpanElement && node.hasAttribute("data-handoff-mention")) {
      return {
        kind: "mention",
        agentId: node.getAttribute("data-agent-id") ?? "",
        label: node.textContent ?? "",
      };
    }
    if (node instanceof HTMLBRElement && node.hasAttribute("data-handoff-wire-break")) {
      return { kind: "wireBreak" };
    }
    if (node instanceof HTMLBRElement && node.hasAttribute("data-handoff-line-pad")) {
      return { kind: "linePad" };
    }
    if (node instanceof HTMLSpanElement && node.hasAttribute("data-handoff-blank-anchor")) {
      return { kind: "blankAnchor" };
    }
    if (node instanceof HTMLElement) {
      return { kind: "element", tag: node.tagName, text: node.textContent ?? "" };
    }
    return { kind: "node", type: node.nodeType };
  });
}

export function handoffNoteLayoutProbe(
  root: HTMLElement | undefined,
  wireAfter: string
): Record<string, unknown> {
  if (!root) {
    return { domSnapshot: [], wireAfter, scrollHeight: 0, nativeCaretRect: null };
  }
  const selection = root.ownerDocument.getSelection();
  let nativeCaretRect: Record<string, number> | null = null;
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (typeof range.getBoundingClientRect === "function") {
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        nativeCaretRect = { top: rect.top, left: rect.left, height: rect.height };
      }
    }
  }
  return {
    domSnapshot: handoffNoteDomSnapshot(root),
    wireAfter,
    scrollHeight: root.scrollHeight,
    nativeCaretRect,
  };
}

export function domPointInMentionPill(root: HTMLElement, node: Node): boolean {
  return root.contains(node) && node.parentElement?.closest?.("[data-handoff-mention]") !== null;
}

export function handoffNoteSelectionSnapshot(
  root: HTMLElement | undefined
): Record<string, unknown> {
  if (!root) {
    return { start: 0, end: 0 };
  }
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { start: 0, end: 0, empty: true };
  }
  const range = selection.getRangeAt(0);
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  const anchorInPill =
    anchor instanceof Node &&
    root.contains(anchor) &&
    anchor.parentElement?.closest?.("[data-handoff-mention]") !== null;
  return {
    anchorNodeKind: anchor?.nodeType,
    anchorOffset: selection.anchorOffset,
    focusOffset: selection.focusOffset,
    rangeStartContainerKind: range.startContainer.nodeType,
    rangeStartOffset: range.startOffset,
    rangeEndOffset: range.endOffset,
    rangeStartText: range.startContainer.textContent?.slice(
      Math.max(0, range.startOffset - 8),
      range.startOffset + 8
    ),
    anchorInMentionPill: anchorInPill,
    collapsed: range.collapsed,
    anchorEqFocus: anchor === focus,
  };
}
