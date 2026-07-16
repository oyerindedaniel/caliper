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
import { describeCaretContext } from "./note-editor/handoff-note-dom-points.js";

const LOG_PREFIX = "[handoff-note]";

/** Collapse identical back-to-back lines (duplicate sync, repair paint storms). */
let lastDedupKey = "";
let dedupSuppressed = 0;

/** Skip repeated repair.authority paint lines with the same wire + DOM target. */
let lastRepairAuthorityPaintKey = "";

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
      return { branch: "step-to-content-row-end", predictedCaretWire: rowEnd };
    }
    return {
      branch: "backspace-collapse-blank",
      predictedCaretWire: probes[probeIndex - 1]!,
    };
  }
  if (focusWire + 1 >= wire.length) {
    return null;
  }
  if (probeIndex < probes.length - 1) {
    return {
      branch: "delete-collapse-blank-mid-band",
      predictedCaretWire: probes[probeIndex + 1]!,
    };
  }
  return { branch: "delete-collapse-blank-at-edge", predictedCaretWire: focusWire };
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

export type CaretSnapshotOptions = {
  doc: HandoffNoteDoc;
  authorityFocus?: HandoffNoteDocPos;
  activeFocus?: HandoffNoteDocPos;
  root?: HTMLElement;
  direction?: "backspace" | "delete";
  /** Include full escaped wire (mutate diffs). Default false — use wireLen. */
  includeWire?: boolean;
  /** Full DOM selection + probe list + char context. Default false. */
  verbose?: boolean;
};

export function buildCaretStateSnapshot(options: CaretSnapshotOptions): Record<string, unknown> {
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
  const atDeleteProbe = isEmbeddedBlankBandDeleteProbeWire(
    options.doc,
    focusWire,
    options.authorityFocus ?? options.activeFocus
  );
  const probeIndex = atProbe ? probes.indexOf(focusWire) : -1;
  const verbose = options.verbose === true;
  const authorityDrift =
    authorityWire !== undefined && activeWire !== undefined && authorityWire !== activeWire;
  const docPosDrift =
    options.authorityFocus !== undefined &&
    options.activeFocus !== undefined &&
    !docPosSame(options.authorityFocus, options.activeFocus);
  const showDocPos =
    verbose || authorityDrift || docPosDrift || atProbe || options.direction !== undefined;

  const snapshot: Record<string, unknown> = {
    wireLen: wire.length,
    focusWire,
    atProbe,
    atDeleteProbe,
  };

  if (options.includeWire) {
    snapshot.wire = escapeWireForLog(wire);
  } else {
    snapshot.probeCount = probes.length;
  }
  if (verbose || atProbe) {
    snapshot.contractProbes = probes;
  }
  if (options.direction !== undefined) {
    snapshot.charBefore = focusWire > 0 ? escapeWireChar(wire[focusWire - 1]) : null;
    snapshot.charAt = focusWire < wire.length ? escapeWireChar(wire[focusWire]) : null;
    snapshot.charAfter = focusWire + 1 < wire.length ? escapeWireChar(wire[focusWire + 1]) : null;
  }

  if (authorityWire !== undefined) {
    snapshot.authorityWire = authorityWire;
  }
  if (activeWire !== undefined) {
    snapshot.activeWire = activeWire;
  }
  if (authorityWire !== undefined && activeWire !== undefined) {
    snapshot.authorityDrift = authorityDrift;
  }
  if (showDocPos && options.authorityFocus !== undefined) {
    snapshot.authorityDoc = snapshotDocPos(options.doc, options.authorityFocus);
    snapshot.authorityOnMentionNodeEnd = caretOnMentionNodeEnd(options.doc, options.authorityFocus);
  }
  if (showDocPos && options.activeFocus !== undefined) {
    snapshot.activeDoc = snapshotDocPos(options.doc, options.activeFocus);
    snapshot.activeOnMentionNodeEnd = caretOnMentionNodeEnd(options.doc, options.activeFocus);
    snapshot.caretKind = describeCaretContext(options.doc, options.activeFocus, {
      root: options.root,
    }).kind;
  } else if (options.authorityFocus !== undefined) {
    snapshot.caretKind = describeCaretContext(options.doc, options.authorityFocus, {
      root: options.root,
    }).kind;
  }
  if (options.authorityFocus !== undefined && options.activeFocus !== undefined) {
    snapshot.docPosDrift = docPosDrift;
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
    snapshot.dom = verbose
      ? handoffNoteSelectionSnapshot(options.root)
      : handoffNoteSelectionSnapshotCompact(options.root);
  }

  return snapshot;
}

export function logEditStateTrace(phase: string, data: Record<string, unknown> = {}): void {
  flattenHandoffNoteLog(`state>>${phase}`, data);
}

/**
 * Console filters: `state>>` edit ingress, `caret>>setDoc>>` paint, `caret>>repair` authority,
 * `caret>>ingress>>` pointer click forensics (`ingress>>firstTouch`, `click.ingress`, `repair.click`, `repair.strand`),
 * `caret>>ver>>` layout (arrow only), `caret>>hor>>` horizontal Left/Right (keydown/bail/step/apply/writeFinal/geom),
 * `caret>>click.ingress` + firstTouch for click-vs-arrow spacer geometry (`geom` field).
 * Empty-geom BR paint: `paintPoint` on `setDoc>>` / `ingress>>firstTouch` (elementRect vs
 * probeRangeRect vs rootOffsetProbe — which selection target has non-empty client rects).
 */
export function flattenHandoffNoteLog(
  event: string,
  data: Record<string, unknown> = {},
  level: "log" | "warn" = "log"
): void {
  const dedupKey = `${event}|${JSON.stringify(data)}`;
  if (level === "log" && dedupKey === lastDedupKey) {
    dedupSuppressed++;
    return;
  }
  if (dedupSuppressed > 0) {
    data = { ...data, dedupSuppressed };
    dedupSuppressed = 0;
  }
  lastDedupKey = dedupKey;

  const line = JSON.stringify({ event, ts: Date.now(), ...data });
  if (level === "warn") {
    console.warn(`${LOG_PREFIX} ${event}`, line);
    return;
  }
  console.log(`${LOG_PREFIX} ${event}`, line);
}

export function logCaretBoundaryTrace(source: string, data: Record<string, unknown> = {}): void {
  if (source.startsWith("setDoc>>repair.authority")) {
    const paint = data.paint as { nodeKind?: number; offset?: number } | undefined;
    const paintKey = `${data.requestedWire}:${paint?.nodeKind}:${paint?.offset}`;
    if (paintKey === lastRepairAuthorityPaintKey) {
      return;
    }
    lastRepairAuthorityPaintKey = paintKey;
  }
  flattenHandoffNoteLog(`caret>>${source}`, data);
}

export function logCaretTrace(source: string, data: Record<string, unknown> = {}): void {
  flattenHandoffNoteLog(`caret>>${source}`, data);
}

export function logVerArrow(source: string, data: Record<string, unknown> = {}): void {
  flattenHandoffNoteLog(`caret>>ver>>${source}`, data);
}

/** Horizontal Left/Right only — distinct from `caret>>ver>>` and bleed. */
export function logHorArrow(source: string, data: Record<string, unknown> = {}): void {
  flattenHandoffNoteLog(`caret>>hor>>${source}`, data);
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
    if (node instanceof HTMLSpanElement && node.hasAttribute("data-handoff-line-start-anchor")) {
      return { kind: "lineStartAnchor" };
    }
    if (node instanceof HTMLElement) {
      return { kind: "element", tag: node.tagName, text: node.textContent ?? "" };
    }
    return { kind: "node", type: node.nodeType };
  });
}

/** Native caret geometry for arrow-vs-click spacer forensics. Includes zero-size rects. */
export function handoffNoteCaretGeomSnapshot(
  root: HTMLElement | undefined
): Record<string, unknown> {
  if (!root) {
    return { empty: true };
  }
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { empty: true };
  }
  const range = selection.getRangeAt(0);
  let caret: { top: number; left: number; width: number; height: number } | null = null;
  if (typeof range.getBoundingClientRect === "function") {
    const rect = range.getBoundingClientRect();
    caret = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  }
  const clientRects =
    typeof range.getClientRects === "function"
      ? [...range.getClientRects()].map((r) => ({
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
        }))
      : [];
  const rootRect =
    typeof root.getBoundingClientRect === "function" ? root.getBoundingClientRect() : null;
  let relativeTop: number | null = null;
  let relativeLeft: number | null = null;
  if (caret !== null && rootRect !== null) {
    relativeTop = caret.top - rootRect.top;
    relativeLeft = caret.left - rootRect.left;
  }
  return {
    caret,
    clientRects,
    clientRectCount: clientRects.length,
    rootTop: rootRect?.top ?? null,
    rootLeft: rootRect?.left ?? null,
    relativeTop,
    relativeLeft,
  };
}

export function handoffNoteLayoutProbe(
  root: HTMLElement | undefined,
  wireAfter: string
): Record<string, unknown> {
  if (!root) {
    return { domSnapshot: [], wireAfter, scrollHeight: 0, nativeCaretRect: null };
  }
  const geom = handoffNoteCaretGeomSnapshot(root);
  const caret = geom.caret as
    | { top: number; left: number; width: number; height: number }
    | null
    | undefined;
  const nativeCaretRect =
    caret != null && (caret.width > 0 || caret.height > 0)
      ? { top: caret.top, left: caret.left, height: caret.height }
      : null;
  return {
    domSnapshot: handoffNoteDomSnapshot(root),
    wireAfter,
    scrollHeight: root.scrollHeight,
    nativeCaretRect,
    geom,
  };
}

export function domPointInMentionPill(root: HTMLElement, node: Node): boolean {
  return root.contains(node) && node.parentElement?.closest?.("[data-handoff-mention]") !== null;
}

function rectSnapshot(
  rect: DOMRect | DOMRectReadOnly | null | undefined
): Record<string, number> | null {
  if (!rect) {
    return null;
  }
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Paint-point forensics for empty caret geom (BR vs text vs root offset).
 * Filter: `paintPoint` on `caret>>setDoc>>` / `caret>>ingress>>firstTouch`.
 */
export function handoffNotePaintPointSnapshot(
  root: HTMLElement | undefined,
  point: { node: Node; offset: number } | null | undefined
): Record<string, unknown> {
  if (!root || !point) {
    return { empty: true };
  }
  const { node, offset } = point;
  const el = node instanceof Element ? node : null;
  const text = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "") : null;
  const prev = node.previousSibling;
  const next = node.nextSibling;
  const siblingKind = (n: Node | null): string | null => {
    if (!n) {
      return null;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      return `text:${JSON.stringify((n.textContent ?? "").slice(0, 24))}`;
    }
    if (n instanceof HTMLBRElement) {
      if (n.hasAttribute("data-handoff-wire-break")) {
        return "wireBreak";
      }
      if (n.hasAttribute("data-handoff-line-pad")) {
        return "linePad";
      }
      return "br";
    }
    if (n instanceof HTMLElement && n.hasAttribute("data-handoff-mention")) {
      return `mention:${n.getAttribute("data-agent-id") ?? ""}`;
    }
    if (n instanceof HTMLElement) {
      return `el:${n.tagName}`;
    }
    return `node:${n.nodeType}`;
  };
  let elementRect: Record<string, number> | null = null;
  let elementClientRectCount = 0;
  if (el && typeof el.getBoundingClientRect === "function") {
    elementRect = rectSnapshot(el.getBoundingClientRect());
    elementClientRectCount =
      typeof el.getClientRects === "function" ? el.getClientRects().length : 0;
  }
  // Probe: collapsed range at this exact paint point (vs live selection geom).
  let probeRangeRect: Record<string, number> | null = null;
  let probeClientRectCount = 0;
  try {
    const range = root.ownerDocument.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    probeRangeRect = rectSnapshot(range.getBoundingClientRect());
    probeClientRectCount = range.getClientRects().length;
  } catch {
    probeRangeRect = null;
  }
  // Alternate probe: parent root offset at this child's index (mention-start exterior).
  let rootOffsetProbe: Record<string, unknown> | null = null;
  if (node.parentNode === root && el) {
    const childIndex = [...root.childNodes].indexOf(node as ChildNode);
    if (childIndex >= 0) {
      try {
        const alt = root.ownerDocument.createRange();
        alt.setStart(root, childIndex);
        alt.collapse(true);
        rootOffsetProbe = {
          childIndex,
          rect: rectSnapshot(alt.getBoundingClientRect()),
          clientRectCount: alt.getClientRects().length,
        };
      } catch {
        rootOffsetProbe = { childIndex, error: true };
      }
    }
  }
  return {
    nodeName: node.nodeName,
    nodeType: node.nodeType,
    offset,
    isWireBreak: el instanceof HTMLBRElement && el.hasAttribute("data-handoff-wire-break"),
    isLinePad: el instanceof HTMLBRElement && el.hasAttribute("data-handoff-line-pad"),
    textLen: text?.length ?? null,
    textTail: text != null ? JSON.stringify(text.slice(Math.max(0, text.length - 12))) : null,
    prev: siblingKind(prev),
    next: siblingKind(next),
    elementRect,
    elementClientRectCount,
    probeRangeRect,
    probeClientRectCount,
    rootOffsetProbe,
  };
}

/**
 * Log browser first-touch on `selectionchange` before reconcile/repair runs.
 * Filter console: `caret>>ingress>>firstTouch`
 */
export function logSelectionChangeFirstTouch(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  options: {
    priorWire: number;
    liveWire: number;
    liveFocus: HandoffNoteDocPos;
    clickIngress: { clientX: number; clientY: number } | null;
  }
): void {
  const selection = root.ownerDocument.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const startNode = range?.startContainer ?? null;
  const inMentionPill = startNode ? domPointInMentionPill(root, startNode) : false;
  const parent =
    startNode?.nodeType === Node.TEXT_NODE
      ? startNode.parentElement
      : startNode instanceof Element
        ? startNode
        : null;
  const paintPoint =
    startNode != null && range != null
      ? handoffNotePaintPointSnapshot(root, {
          node: startNode,
          offset: range.startOffset,
        })
      : { empty: true };

  logCaretBoundaryTrace("ingress>>firstTouch", {
    priorWire: options.priorWire,
    liveWire: options.liveWire,
    hadClickIngress: options.clickIngress !== null,
    clickX: options.clickIngress?.clientX ?? null,
    clickY: options.clickIngress?.clientY ?? null,
    inMentionPill,
    startContainerKind: startNode?.nodeName ?? null,
    startOffset: range?.startOffset ?? null,
    parentTag: parent?.tagName ?? null,
    activeDoc: snapshotDocPos(doc, options.liveFocus),
    paintPoint,
    geom: handoffNoteCaretGeomSnapshot(root),
  });
}

/** Lean native selection for state>> traces — k/o/pill matches full snapshot semantics. */
export function handoffNoteSelectionSnapshotCompact(
  root: HTMLElement | undefined
): Record<string, unknown> {
  if (!root) {
    return { empty: true };
  }
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { empty: true };
  }
  const anchor = selection.anchorNode;
  const anchorInPill = anchor instanceof Node && domPointInMentionPill(root, anchor);
  return {
    k: anchor?.nodeType,
    o: selection.anchorOffset,
    pill: anchorInPill,
  };
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
