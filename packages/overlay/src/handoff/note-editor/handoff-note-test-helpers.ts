import {
  collapsedSelection,
  docPosToWireOffset,
  listEmbeddedBlankBandProbeWires,
  normalizeDocPos,
  wireOffsetToDocPos,
  wireToDoc,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";
import { readDocCursor, readDocSelection, setDocSelection } from "./handoff-note-selection.js";
import { getDocAnchorRect, resolveDomPointAtDocPos } from "./handoff-note-dom-points.js";
import {
  buildHandoffNoteLayoutMap,
  invalidateHandoffNoteLayoutCache,
  setMeasuredSamplesCache,
} from "./handoff-note-layout-map.js";
import { readMentionNodeIndex } from "./handoff-note-dom.js";

/** Test-only: fire `selectionchange` so the editor reconciles caret from DOM (including repair). */
export function dispatchSelectionChange(root: HTMLElement): void {
  root.ownerDocument.dispatchEvent(new Event("selectionchange"));
}

/** Test-only: native caret at the trailing edge of a text node (browser row-tail click). */
export function setDomCaretAtTextEnd(root: HTMLElement, textNode: Text): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) {
    throw new Error("expected document selection");
  }
  const range = root.ownerDocument.createRange();
  range.setStart(textNode, textNode.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Test-only: native caret at the leading edge of a text node (browser row-head click). */
export function setDomCaretAtTextStart(root: HTMLElement, textNode: Text): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) {
    throw new Error("expected document selection");
  }
  const range = root.ownerDocument.createRange();
  range.setStart(textNode, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Test-only: park the native caret inside a mention pill text node (simulates browser strand). */
export function strandSelectionInMentionPill(root: HTMLElement, pillTextOffset = 3): void {
  const pill = root.querySelector("span[data-handoff-mention]");
  if (!pill?.firstChild || pill.firstChild.nodeType !== Node.TEXT_NODE) {
    throw new Error("expected mention pill with text child");
  }
  const pillText = pill.firstChild as Text;
  const selection = root.ownerDocument.getSelection();
  if (!selection) {
    throw new Error("expected document selection");
  }
  const range = root.ownerDocument.createRange();
  range.setStart(pillText, pillTextOffset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Test-only helper: place the DOM caret at a wire offset via doc positions. */
export function setSelectionAtWire(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  start: number,
  end = start,
  options?: { fromOffset?: number; source?: string }
): void {
  const from =
    options?.fromOffset !== undefined ? wireOffsetToDocPos(doc, options.fromOffset) : undefined;
  setDocSelection(
    root,
    doc,
    {
      anchor: normalizeDocPos(doc, wireOffsetToDocPos(doc, start), { from }),
      focus: normalizeDocPos(doc, wireOffsetToDocPos(doc, end), { from }),
    },
    { from, source: options?.source }
  );
}

export function readDomWireCursor(root: HTMLElement, doc: HandoffNoteDoc): number {
  return docPosToWireOffset(doc, readDocCursor(root, doc));
}

export function readDomWireSelection(
  root: HTMLElement,
  doc: HandoffNoteDoc
): { start: number; end: number } {
  const { anchor, focus } = readDocSelection(root, doc);
  const start = docPosToWireOffset(doc, anchor);
  const end = docPosToWireOffset(doc, focus);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function selectionAtWire(doc: HandoffNoteDoc, offset: number) {
  return collapsedSelection(wireOffsetToDocPos(doc, offset));
}

export function getAnchorRectAtWire(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  offset: number
): DOMRect | null {
  return getDocAnchorRect(root, doc, wireOffsetToDocPos(doc, offset));
}

export function readHandoffNoteLayoutSamplesForTests(root: HTMLElement, doc: HandoffNoteDoc) {
  return buildHandoffNoteLayoutMap(root, doc).samples;
}

export function readHandoffNoteLayoutRowIndexForTests(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  wire: number,
  focus = wireOffsetToDocPos(doc, wire)
): number {
  return buildHandoffNoteLayoutMap(root, doc, focus).rowIndexForWire(wire);
}

type MeasuredLayoutSample = { wire: number; top: number; left: number };

function wireLineStartOffsets(wire: string): number[] {
  const starts = [0];
  for (let index = 0; index < wire.length; index++) {
    if (wire[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function isSubstantiveWireLineSegment(wire: string, lineStart: number): boolean {
  const lineEnd = wire.indexOf("\n", lineStart);
  const segment = wire.slice(lineStart, lineEnd === -1 ? wire.length : lineEnd);
  return segment.length > 0 && !/^\s*$/.test(segment);
}

/** Test-only: monotonic row tops for jsdom when DOM measure collapses (replaces removed production synthesize*). */
export function monotonicMeasuredLayoutSamples(
  wire: string,
  options?: { baseTop?: number; stride?: number }
): MeasuredLayoutSample[] {
  const baseTop = options?.baseTop ?? 100;
  const stride = options?.stride ?? 36;
  const doc = wireToDoc(wire);
  const probes = new Set(listEmbeddedBlankBandProbeWires(doc));
  type Anchor = { wire: number; kind: "line-start" | "blank-probe" };
  const anchors: Anchor[] = [{ wire: 0, kind: "line-start" }];
  for (const probeWire of probes) {
    anchors.push({ wire: probeWire, kind: "blank-probe" });
  }
  for (const lineStart of wireLineStartOffsets(wire)) {
    if (lineStart === 0 || probes.has(lineStart)) {
      continue;
    }
    if (!isSubstantiveWireLineSegment(wire, lineStart)) {
      continue;
    }
    if (!anchors.some((anchor) => anchor.wire === lineStart)) {
      anchors.push({ wire: lineStart, kind: "line-start" });
    }
  }
  anchors.sort((left, right) => left.wire - right.wire);

  const byWire = new Map<number, MeasuredLayoutSample>();
  let rowTop = baseTop;
  let inlineBlankPending = false;

  for (const anchor of anchors) {
    if (anchor.wire === 0) {
      byWire.set(0, { wire: 0, top: rowTop, left: 0 });
      inlineBlankPending = true;
      continue;
    }
    if (anchor.kind === "blank-probe" && inlineBlankPending) {
      byWire.set(anchor.wire, { wire: anchor.wire, top: rowTop, left: 0 });
      inlineBlankPending = false;
      continue;
    }
    rowTop += stride;
    if (anchor.kind === "blank-probe") {
      byWire.set(anchor.wire, { wire: anchor.wire, top: rowTop, left: 0 });
    } else {
      byWire.set(anchor.wire, { wire: anchor.wire, top: rowTop, left: 0 });
      inlineBlankPending = true;
    }
  }

  return [...byWire.values()].sort((left, right) => left.wire - right.wire);
}

export function seedMonotonicMeasuredLayout(
  root: HTMLElement,
  wire: string,
  options?: { baseTop?: number; stride?: number }
): void {
  setMeasuredSamplesCache(wire, root.clientWidth, monotonicMeasuredLayoutSamples(wire, options));
}

/** Stub pill geometry so jsdom layout tests match playground wrap rows. */
export function stubHandoffNoteMentionLayoutCoords(
  root: HTMLElement,
  coordsByNodeIndex: Map<number, { top: number; left: number; height?: number }>
): void {
  const pills = root.querySelectorAll<HTMLSpanElement>("span[data-handoff-mention]");
  for (const pill of pills) {
    const nodeIndex = readMentionNodeIndex(pill);
    if (nodeIndex === null) {
      continue;
    }
    const coords = coordsByNodeIndex.get(nodeIndex);
    if (!coords) {
      continue;
    }
    const height = coords.height ?? 17;
    const top = coords.top - height / 2;
    pill.getBoundingClientRect = () =>
      ({
        top,
        left: coords.left,
        right: coords.left + 120,
        bottom: top + height,
        width: 120,
        height,
        x: coords.left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  }
  invalidateHandoffNoteLayoutCache();
}

/** Test-only: stub caretPositionFromPoint for visual column probe on a target band. */
export function stubCaretProbeAtDocPos(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  column: number,
  rowTop: number,
  pos: HandoffNoteDocPos
): () => void {
  const point = resolveDomPointAtDocPos(root, doc, pos);
  if (!point) {
    throw new Error("stubCaretProbeAtDocPos: could not resolve DOM point");
  }
  const docApi = root.ownerDocument;
  const priorFromPoint = docApi.caretPositionFromPoint?.bind(docApi);
  const priorRangeFromPoint = (
    docApi as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint?.bind(docApi);

  docApi.caretPositionFromPoint = (x, y) => {
    if (Math.abs(x - column) <= 2 && Math.abs(y - rowTop) <= 6) {
      return { offsetNode: point.node, offset: point.offset } as CaretPosition;
    }
    return priorFromPoint?.(x, y) ?? null;
  };

  (
    docApi as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint = (x, y) => {
    if (Math.abs(x - column) <= 2 && Math.abs(y - rowTop) <= 6) {
      const range = docApi.createRange();
      range.setStart(point.node, point.offset);
      range.collapse(true);
      return range;
    }
    return priorRangeFromPoint?.(x, y) ?? null;
  };

  return () => {
    docApi.caretPositionFromPoint = priorFromPoint;
    (
      docApi as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    ).caretRangeFromPoint = priorRangeFromPoint;
  };
}

/** Test-only: stub collapsed-range anchor geometry at a wire offset (jsdom layout). */
export function stubHandoffNoteAnchorRectAtWire(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  wire: number,
  rect: { top: number; left: number; height?: number; width?: number }
): () => void {
  const pos = wireOffsetToDocPos(doc, wire);
  const point = resolveDomPointAtDocPos(root, doc, pos);
  if (!point) {
    throw new Error("stubHandoffNoteAnchorRectAtWire: could not resolve DOM point");
  }
  const height = rect.height ?? 18;
  const width = rect.width ?? 4;
  const midY = rect.top;
  const stubRect = {
    top: midY - height / 2,
    left: rect.left,
    right: rect.left + width,
    bottom: midY + height / 2,
    width,
    height,
    x: rect.left,
    y: midY - height / 2,
    toJSON: () => ({}),
  } as DOMRect;
  const docApi = root.ownerDocument;
  const priorCreateRange = docApi.createRange.bind(docApi);

  docApi.createRange = () => {
    const range = priorCreateRange();
    const priorSetStart = range.setStart.bind(range);
    range.setStart = (node: Node, offset: number) => {
      priorSetStart(node, offset);
      if (node === point.node && offset === point.offset) {
        range.getClientRects = () => [stubRect] as unknown as DOMRectList;
        range.getBoundingClientRect = () => stubRect;
      }
      return undefined;
    };
    return range;
  };

  invalidateHandoffNoteLayoutCache();
  return () => {
    docApi.createRange = priorCreateRange;
  };
}

/** Test-only: stub getClientRects on a text node for soft-wrap line fragments. */
export function stubTextNodeLineRects(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  rects: Array<{ top: number; left: number; width?: number; height?: number }>
): () => void {
  const point = resolveDomPointAtDocPos(root, doc, { nodeIndex, nodeOffset: 0 });
  if (!point || point.node.nodeType !== Node.TEXT_NODE) {
    throw new Error("stubTextNodeLineRects: expected text node");
  }
  const textNode = point.node as Text;
  const docApi = root.ownerDocument;
  const priorCreateRange = docApi.createRange.bind(docApi);

  docApi.createRange = () => {
    const range = priorCreateRange();
    const priorSelect = range.selectNodeContents.bind(range);
    range.selectNodeContents = (node: Node) => {
      priorSelect(node);
      if (node === textNode) {
        range.getClientRects = () =>
          rects.map(
            (rect) =>
              ({
                top: rect.top,
                left: rect.left,
                right: rect.left + (rect.width ?? 80),
                bottom: rect.top + (rect.height ?? 18),
                width: rect.width ?? 80,
                height: rect.height ?? 18,
                x: rect.left,
                y: rect.top,
                toJSON: () => ({}),
              }) as DOMRect
          ) as unknown as DOMRectList;
      }
      return range;
    };
    return range;
  };

  return () => {
    docApi.createRange = priorCreateRange;
  };
}
