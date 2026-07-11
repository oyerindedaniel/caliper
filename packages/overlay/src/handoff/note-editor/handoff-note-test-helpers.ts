import {
  collapsedSelection,
  docPosToWireOffset,
  docToWire,
  listEmbeddedBlankBandProbeWires,
  normalizeDocPos,
  wireOffsetToDocPos,
  wireToDoc,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
  type HandoffNoteVerticalArrowDirection,
} from "@caliper/core";
import {
  readDocCursor,
  readDocSelection,
  resolveLayoutVerticalArrowMove,
  setDocSelection,
} from "./handoff-note-selection.js";
import {
  getDocAnchorRect,
  resolveDomPointAtDocPos,
  docPosToRenderedDomChildIndex,
} from "./handoff-note-dom-points.js";
import {
  isHandoffBlankAnchorElement,
  isHandoffWireBreakElement,
  iterWireTextDomSlots,
  renderHandoffNoteDoc,
} from "./handoff-note-dom.js";
import {
  buildHandoffNoteLayoutMap,
  buildLayoutMapFromSamples,
  invalidateHandoffNoteLayoutCache,
  layoutRowForFocus,
  setMeasuredSamplesCache,
  type HandoffNoteLayoutMap,
  type MeasuredWireOffset,
} from "./handoff-note-layout-map.js";
import { readMentionNodeIndex } from "./handoff-note-dom.js";

/** Layout sample with optional painted width for row content-extent tests. */
export function layoutMeasuredSample(
  wire: number,
  top: number,
  left: number,
  width = 0
): MeasuredWireOffset {
  return width > 0 ? { wire, top, left, right: left + width } : { wire, top, left };
}

type StubLayoutCoord = {
  top: number;
  left: number;
  height?: number;
  width?: number;
};

/** Test/layout helper only — no editor root, so landing uses sparse row-edge fallback when DOM probe is unavailable. */
export function resolveMeasuredVerticalArrowMoveForTests(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  measured: MeasuredWireOffset[],
  currentLeft: number,
  lineHeight: number
): { pos: HandoffNoteDocPos; handled: boolean; branch?: string } {
  if (measured.length < 2) {
    return { pos: focus, handled: false };
  }
  const layout = buildLayoutMapFromSamples(measured, lineHeight, doc);
  return resolveLayoutVerticalArrowMove(doc, focus, direction, layout, currentLeft);
}

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

/** Test-only: place native DOM selection at a doc position without authority normalize on write. */
export function setBrowserDomSelectionAtDocPos(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos
): void {
  const point = resolveDomPointAtDocPos(root, doc, pos);
  if (!point) {
    throw new Error("setBrowserDomSelectionAtDocPos: could not resolve DOM point");
  }
  const selection = root.ownerDocument.getSelection();
  if (!selection) {
    throw new Error("expected document selection");
  }
  const range = root.ownerDocument.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Test-only: place native DOM selection at a doc position without wire round-trip. */
export function setSelectionAtDocPos(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos
): void {
  const point = resolveDomPointAtDocPos(root, doc, pos);
  if (!point) {
    throw new Error(`setSelectionAtDocPos: no paint for ${JSON.stringify(pos)}`);
  }
  const range = root.ownerDocument.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  if (!selection) {
    throw new Error("setSelectionAtDocPos: no selection");
  }
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
  const layout = buildHandoffNoteLayoutMap(root, doc, focus);
  return layoutRowForFocus(root, doc, layout, focus);
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
  setMeasuredSamplesCache(
    root,
    wire,
    root.clientWidth,
    monotonicMeasuredLayoutSamples(wire, options)
  );
}

/** Stub pill geometry so jsdom layout tests match playground wrap rows. */
export function stubHandoffNoteMentionLayoutCoords(
  root: HTMLElement,
  coordsByNodeIndex: Map<number, StubLayoutCoord>
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
    const width = coords.width ?? 120;
    const top = coords.top - height / 2;
    pill.getBoundingClientRect = () =>
      ({
        top,
        left: coords.left,
        right: coords.left + width,
        bottom: top + height,
        width,
        height,
        x: coords.left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  }
  invalidateHandoffNoteLayoutCache(root);
}

function patchElementLayoutRect(element: Element, sample: StubLayoutCoord): void {
  const height = sample.height ?? 18;
  const width = sample.width ?? 4;
  const top = sample.top - height / 2;
  element.getBoundingClientRect = () =>
    ({
      top,
      left: sample.left,
      right: sample.left + width,
      bottom: top + height,
      width,
      height,
      x: sample.left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function patchLayoutGeometryAtWire(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  wireOffset: number,
  sample: { top: number; left: number }
): void {
  const point = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, wireOffset));
  if (!point) {
    return;
  }
  if (point.node instanceof HTMLBRElement && isHandoffWireBreakElement(point.node)) {
    patchElementLayoutRect(point.node, sample);
    return;
  }
  const parent = point.node.parentElement;
  if (point.node.nodeType === Node.TEXT_NODE && parent && isHandoffBlankAnchorElement(parent)) {
    patchElementLayoutRect(parent, sample);
    return;
  }
}

/**
 * Re-sync jsdom layout geometry after a doc mutation/full DOM rebuild.
 * Production acquire reads live DOM; tests patch painted bands on the new tree.
 */
export function refreshHandoffNoteEditorLayoutGeometry(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  wire: string,
  options: {
    mentionCoords: Map<number, StubLayoutCoord>;
    baseTop?: number;
    stride?: number;
  }
): void {
  stubHandoffNoteMentionLayoutCoords(root, options.mentionCoords);
  const samples = monotonicMeasuredLayoutSamples(wire, {
    baseTop: options.baseTop ?? 141,
    stride: options.stride ?? 36,
  });
  const probes = new Set(listEmbeddedBlankBandProbeWires(doc));

  for (const sample of samples) {
    if (probes.has(sample.wire)) {
      patchLayoutGeometryAtWire(root, doc, sample.wire, sample);
      continue;
    }
    if (sample.wire > 0 && wire[sample.wire - 1] === "\n") {
      patchLayoutGeometryAtWire(root, doc, sample.wire - 1, sample);
    }
    if (sample.wire === 0) {
      patchLayoutGeometryAtWire(root, doc, 0, sample);
    }
  }
  invalidateHandoffNoteLayoutCache(root);
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
    if (Math.abs(x - column) <= 2 && Math.abs(y - rowTop) <= 12) {
      return { offsetNode: point.node, offset: point.offset } as CaretPosition;
    }
    return priorFromPoint?.(x, y) ?? null;
  };

  (
    docApi as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint = (x, y) => {
    if (Math.abs(x - column) <= 2 && Math.abs(y - rowTop) <= 12) {
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

/** Test-only: stub multiple caretPositionFromPoint hits (embedded-newline fragment probes). */
export function stubCaretProbeHits(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  hits: Array<{ column: number; rowTop: number; pos: HandoffNoteDocPos }>
): () => void {
  const resolved = hits.map((hit) => {
    const point = resolveDomPointAtDocPos(root, doc, hit.pos);
    if (!point) {
      throw new Error("stubCaretProbeHits: could not resolve DOM point");
    }
    return { ...hit, point };
  });
  const docApi = root.ownerDocument;
  const priorFromPoint = docApi.caretPositionFromPoint?.bind(docApi);
  const priorRangeFromPoint = (
    docApi as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint?.bind(docApi);

  docApi.caretPositionFromPoint = (x, y) => {
    for (const hit of resolved) {
      if (Math.abs(x - hit.column) <= 2 && Math.abs(y - hit.rowTop) <= 12) {
        return { offsetNode: hit.point.node, offset: hit.point.offset } as CaretPosition;
      }
    }
    return priorFromPoint?.(x, y) ?? null;
  };

  (
    docApi as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint = (x, y) => {
    for (const hit of resolved) {
      if (Math.abs(x - hit.column) <= 2 && Math.abs(y - hit.rowTop) <= 12) {
        const range = docApi.createRange();
        range.setStart(hit.point.node, hit.point.offset);
        range.collapse(true);
        return range;
      }
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
  rect: StubLayoutCoord
): () => void {
  return stubHandoffNoteAnchorRectAtDomPoint(
    root,
    resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, wire)),
    rect
  );
}

/** Test-only: stub collapsed-range anchor geometry at a doc position (jsdom layout). */
export function stubHandoffNoteAnchorRectAtDocPos(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  rect: StubLayoutCoord
): () => void {
  return stubHandoffNoteAnchorRectAtDomPoint(root, resolveDomPointAtDocPos(root, doc, pos), rect);
}

function stubHandoffNoteAnchorRectAtDomPoint(
  root: HTMLElement,
  point: { node: Node; offset: number } | null,
  rect: StubLayoutCoord
): () => void {
  if (!point) {
    throw new Error("stubHandoffNoteAnchorRectAtDomPoint: could not resolve DOM point");
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

  invalidateHandoffNoteLayoutCache(root);
  return () => {
    docApi.createRange = priorCreateRange;
  };
}

function stubRectForCoord(coord: StubLayoutCoord): DOMRect {
  const height = coord.height ?? 18;
  const width = coord.width ?? 4;
  const midY = coord.top;
  return {
    top: midY - height / 2,
    left: coord.left,
    right: coord.left + width,
    bottom: midY + height / 2,
    width,
    height,
    x: coord.left,
    y: midY - height / 2,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Line-fragment rects from getClientRects: `top` is the painted box top, not midY. */
function stubLineFragmentRect(coord: StubLayoutCoord): DOMRect {
  const height = coord.height ?? 18;
  const width = coord.width ?? 80;
  const top = coord.top;
  return {
    top,
    left: coord.left,
    right: coord.left + width,
    bottom: top + height,
    width,
    height,
    x: coord.left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Test-only: stub collapsed anchor midY/left for any offset inside a text node. */
export function stubTextNodeOffsetAnchorRects(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  resolveRect: (nodeOffset: number, textLength: number) => StubLayoutCoord | null
): () => void {
  return stubTextNodeLineRects(root, doc, nodeIndex, [], { resolveOffsetRect: resolveRect });
}

/** Test-only: stub getClientRects on a text node for soft-wrap line fragments. */
export function stubTextNodeLineRects(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  rects: StubLayoutCoord[],
  options?: {
    resolveOffsetRect?: (nodeOffset: number, textLength: number) => StubLayoutCoord | null;
  }
): () => void {
  const docTextNode = doc.nodes[nodeIndex];
  if (docTextNode?.type !== "text") {
    throw new Error("stubTextNodeLineRects: expected text doc node");
  }
  const docTextLength = docTextNode.text.length;
  type PaintedTextSlot = { textNode: Text; docOffsetBase: number };
  const textSlots: PaintedTextSlot[] = [];
  if (!docTextNode.text.includes("\n")) {
    const point = resolveDomPointAtDocPos(root, doc, { nodeIndex, nodeOffset: 0 });
    if (point?.node.nodeType === Node.TEXT_NODE) {
      textSlots.push({ textNode: point.node as Text, docOffsetBase: 0 });
    }
  } else {
    const renderedStart = docPosToRenderedDomChildIndex(doc, nodeIndex);
    const wireBase = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
    const probeWires = new Set(listEmbeddedBlankBandProbeWires(doc));
    for (const slot of iterWireTextDomSlots(docTextNode.text, renderedStart, {
      wireBase,
      blankProbeWires: probeWires,
    })) {
      if (slot.kind !== "text") {
        continue;
      }
      const domNode = root.childNodes[slot.domIdx];
      if (domNode?.nodeType === Node.TEXT_NODE) {
        textSlots.push({ textNode: domNode as Text, docOffsetBase: slot.nodeOffset });
      }
    }
  }
  if (textSlots.length === 0) {
    throw new Error("stubTextNodeLineRects: expected rendered text node");
  }
  const docApi = root.ownerDocument;
  const priorCreateRange = docApi.createRange.bind(docApi);

  docApi.createRange = () => {
    const range = priorCreateRange();
    let rangeStart: number | null = null;
    let rangeEnd: number | null = null;
    let activeSlot: PaintedTextSlot | null = null;

    const slotFor = (node: Node): PaintedTextSlot | undefined =>
      textSlots.find((entry) => entry.textNode === node);

    const docOffsetFor = (slot: PaintedTextSlot, domOffset: number): number =>
      slot.docOffsetBase + domOffset;

    const attachFragmentRectsForSpan = () => {
      if (
        activeSlot === null ||
        rangeStart === null ||
        rangeEnd === null ||
        rangeEnd <= rangeStart ||
        rects.length === 0
      ) {
        return;
      }
      let spanRects = rects;
      if (options?.resolveOffsetRect) {
        const tops = new Set<number>();
        const startCoord = options.resolveOffsetRect(
          docOffsetFor(activeSlot, rangeStart),
          docTextLength
        );
        const endCoord = options.resolveOffsetRect(
          docOffsetFor(activeSlot, rangeEnd - 1),
          docTextLength
        );
        if (startCoord) {
          tops.add(startCoord.top);
        }
        if (endCoord) {
          tops.add(endCoord.top);
        }
        for (let domOffset = rangeStart; domOffset < rangeEnd; domOffset++) {
          const coord = options.resolveOffsetRect(
            docOffsetFor(activeSlot, domOffset),
            docTextLength
          );
          if (coord) {
            tops.add(coord.top);
          }
        }
        const matched = rects.filter((rect) => {
          const midY = rect.top + (rect.height ?? 18) / 2;
          return [...tops].some((top) => Math.abs(midY - top) <= 1);
        });
        if (matched.length > 0) {
          spanRects = matched;
        }
      }
      range.getClientRects = () =>
        spanRects.map((rect) => stubLineFragmentRect(rect)) as unknown as DOMRectList;
    };

    const priorSelect = range.selectNodeContents.bind(range);
    range.selectNodeContents = (node: Node) => {
      priorSelect(node);
      const slot = slotFor(node);
      if (slot && rects.length > 0) {
        range.getClientRects = () =>
          rects.map((rect) => stubLineFragmentRect(rect)) as unknown as DOMRectList;
      }
      return range;
    };
    const priorSetStart = range.setStart.bind(range);
    const priorSetEnd = range.setEnd.bind(range);
    range.setStart = (node: Node, offset: number) => {
      priorSetStart(node, offset);
      const slot = slotFor(node);
      if (slot) {
        activeSlot = slot;
        rangeStart = offset;
        if (options?.resolveOffsetRect) {
          const coord = options.resolveOffsetRect(docOffsetFor(slot, offset), docTextLength);
          if (coord) {
            const stubRect = stubRectForCoord(coord);
            range.getClientRects = () => [stubRect] as unknown as DOMRectList;
            range.getBoundingClientRect = () => stubRect;
          }
        }
        attachFragmentRectsForSpan();
      }
      return undefined;
    };
    range.setEnd = (node: Node, offset: number) => {
      priorSetEnd(node, offset);
      const slot = slotFor(node);
      if (slot) {
        if (activeSlot === null) {
          activeSlot = slot;
        }
        rangeEnd = offset;
        attachFragmentRectsForSpan();
      }
      return undefined;
    };
    return range;
  };

  return () => {
    docApi.createRange = priorCreateRange;
  };
}

/** Test-only: wire-segment fragment rects + caret probes for embedded-newline acquire (single createRange patch). */
export function stubEmbeddedNewlineSegmentAcquire(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  input: {
    startWire: number;
    endWireExclusive: number;
    rects: StubLayoutCoord[];
    probeHits: Array<{ column: number; rowTop: number; pos: HandoffNoteDocPos }>;
  }
): () => void {
  const { startWire, endWireExclusive, rects, probeHits } = input;
  const resolvedHits = probeHits.map((hit) => {
    const point = resolveDomPointAtDocPos(root, doc, hit.pos);
    if (!point) {
      throw new Error("stubEmbeddedNewlineSegmentAcquire: could not resolve probe DOM point");
    }
    return { ...hit, point };
  });
  const stubbedRects = rects.map(
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
  );

  const docApi = root.ownerDocument;
  const priorCreateRange = docApi.createRange.bind(docApi);
  const priorFromPoint = docApi.caretPositionFromPoint?.bind(docApi);
  const priorRangeFromPoint = (
    docApi as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint?.bind(docApi);

  const expectedStart = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, startWire));
  const expectedEnd = resolveDomPointAtDocPos(
    root,
    doc,
    wireOffsetToDocPos(doc, endWireExclusive - 1)
  );
  if (!expectedStart || !expectedEnd) {
    throw new Error("stubEmbeddedNewlineSegmentAcquire: could not resolve segment endpoints");
  }
  const expectedEndOffset =
    expectedEnd.node.nodeType === Node.TEXT_NODE
      ? Math.min(expectedEnd.offset + 1, (expectedEnd.node as Text).length)
      : expectedEnd.offset;

  docApi.createRange = () => {
    const range = priorCreateRange();
    let rangeStartNode: Node | null = null;
    let rangeStartOffset = -1;
    let rangeEndNode: Node | null = null;
    let rangeEndOffset = -1;
    const priorSetStart = range.setStart.bind(range);
    const priorSetEnd = range.setEnd.bind(range);
    const attachSegmentRects = () => {
      if (
        rangeStartNode === null ||
        rangeEndNode === null ||
        rangeStartOffset < 0 ||
        rangeEndOffset < 0
      ) {
        return;
      }
      if (
        rangeStartNode === expectedStart.node &&
        rangeStartOffset === expectedStart.offset &&
        rangeEndNode === expectedEnd.node &&
        rangeEndOffset === expectedEndOffset
      ) {
        range.getClientRects = () => stubbedRects as unknown as DOMRectList;
        range.getBoundingClientRect = () =>
          stubbedRects[0] ?? stubbedRects[stubbedRects.length - 1]!;
      }
    };
    range.setStart = (node: Node, offset: number) => {
      priorSetStart(node, offset);
      rangeStartNode = node;
      rangeStartOffset = offset;
      for (const hit of resolvedHits) {
        if (node === hit.point.node && offset === hit.point.offset) {
          range.getClientRects = () => [stubbedRects[0]!] as unknown as DOMRectList;
          range.getBoundingClientRect = () => stubbedRects[0]!;
        }
      }
      return undefined;
    };
    range.setEnd = (node: Node, offset: number) => {
      priorSetEnd(node, offset);
      rangeEndNode = node;
      rangeEndOffset = offset;
      attachSegmentRects();
      return undefined;
    };
    return range;
  };

  docApi.caretPositionFromPoint = (x, y) => {
    for (const hit of resolvedHits) {
      if (Math.abs(x - hit.column) <= 2 && Math.abs(y - hit.rowTop) <= 12) {
        return { offsetNode: hit.point.node, offset: hit.point.offset } as CaretPosition;
      }
    }
    return priorFromPoint?.(x, y) ?? null;
  };

  (
    docApi as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint = (x, y) => {
    for (const hit of resolvedHits) {
      if (Math.abs(x - hit.column) <= 2 && Math.abs(y - hit.rowTop) <= 12) {
        const range = docApi.createRange();
        range.setStart(hit.point.node, hit.point.offset);
        range.collapse(true);
        return range;
      }
    }
    return priorRangeFromPoint?.(x, y) ?? null;
  };

  invalidateHandoffNoteLayoutCache(root);
  return () => {
    docApi.createRange = priorCreateRange;
    docApi.caretPositionFromPoint = priorFromPoint;
    (
      docApi as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    ).caretRangeFromPoint = priorRangeFromPoint;
  };
}

/** Test-only: stub getClientRects on a wire run resolved to DOM range endpoints. */
export function stubWireRangeRects(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  startWire: number,
  endWireExclusive: number,
  rects: StubLayoutCoord[]
): () => void {
  const startPoint = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, startWire));
  const endPoint = resolveDomPointAtDocPos(
    root,
    doc,
    wireOffsetToDocPos(doc, endWireExclusive - 1)
  );
  if (!startPoint || !endPoint) {
    throw new Error("stubWireRangeRects: could not resolve DOM endpoints");
  }
  const endOffset =
    endPoint.node.nodeType === Node.TEXT_NODE
      ? Math.min(endPoint.offset + 1, (endPoint.node as Text).length)
      : endPoint.offset;
  const docApi = root.ownerDocument;
  const priorCreateRange = docApi.createRange.bind(docApi);
  const stubbedRects = rects.map(
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
  );

  docApi.createRange = () => {
    const range = priorCreateRange();
    let rangeStartNode: Node | null = null;
    let rangeStartOffset = -1;
    let rangeEndNode: Node | null = null;
    let rangeEndOffset = -1;
    const priorSetStart = range.setStart.bind(range);
    const priorSetEnd = range.setEnd.bind(range);
    range.setStart = (node: Node, offset: number) => {
      priorSetStart(node, offset);
      rangeStartNode = node;
      rangeStartOffset = offset;
      return undefined;
    };
    range.setEnd = (node: Node, offset: number) => {
      priorSetEnd(node, offset);
      rangeEndNode = node;
      rangeEndOffset = offset;
      if (
        rangeStartNode === startPoint.node &&
        rangeStartOffset === startPoint.offset &&
        rangeEndNode === endPoint.node &&
        rangeEndOffset === endOffset
      ) {
        range.getClientRects = () => stubbedRects as unknown as DOMRectList;
        range.getBoundingClientRect = () =>
          stubbedRects[0] ?? stubbedRects[stubbedRects.length - 1]!;
      }
      return undefined;
    };
    return range;
  };

  invalidateHandoffNoteLayoutCache(root);
  return () => {
    docApi.createRange = priorCreateRange;
  };
}

export type VerticalColumnProbeFixture = {
  root: HTMLElement;
  doc: HandoffNoteDoc;
  /** Cache key — must match `docToWire(doc)` (use `editor.getWire()` in integration tests). */
  wire: string;
  fromWire: number;
  goalColumn: number;
  probeTargetWire: number;
  samples: MeasuredWireOffset[];
  rootWidth?: number;
  mentionCoords?: Map<number, StubLayoutCoord>;
  /** Fail fast when measured layout collapses (usually stale cache after anchor stub). */
  expectMinVisualRows?: number;
};

/**
 * DOM column-probe test harness: anchor + probe stubs aligned to layout row tops, with measured
 * samples re-seeded after anchor install (anchor stubs invalidate the layout cache).
 */
export function prepareVerticalColumnProbe(fixture: VerticalColumnProbeFixture): {
  restore: () => void;
  layout: HandoffNoteLayoutMap;
  sourceRowTop: number;
  targetRowTop: number;
} {
  const width = fixture.rootWidth ?? fixture.root.clientWidth;
  Object.defineProperty(fixture.root, "clientWidth", { configurable: true, value: width });
  if (fixture.mentionCoords) {
    stubHandoffNoteMentionLayoutCoords(fixture.root, fixture.mentionCoords);
  }

  const fromPos = wireOffsetToDocPos(fixture.doc, fixture.fromWire);
  const probePos = wireOffsetToDocPos(fixture.doc, fixture.probeTargetWire);

  setMeasuredSamplesCache(fixture.root, fixture.wire, width, fixture.samples);
  let layout = buildHandoffNoteLayoutMap(fixture.root, fixture.doc, fromPos);

  const sourceRowIdx = layout.rowIndexForWire(fixture.fromWire);
  const targetRowIdx = layout.rowIndexForWire(fixture.probeTargetWire);
  if (sourceRowIdx < 0 || targetRowIdx < 0) {
    throw new Error(
      `prepareVerticalColumnProbe: missing layout row for from=${fixture.fromWire} probe=${fixture.probeTargetWire}`
    );
  }
  const sourceRowTop = layout.rows[sourceRowIdx]!.top;

  if (
    fixture.expectMinVisualRows !== undefined &&
    layout.visualRowCount < fixture.expectMinVisualRows
  ) {
    throw new Error(
      `prepareVerticalColumnProbe: expected >= ${fixture.expectMinVisualRows} visual rows, got ${layout.visualRowCount}`
    );
  }

  const restoreAnchor = stubHandoffNoteAnchorRectAtWire(
    fixture.root,
    fixture.doc,
    fixture.fromWire,
    {
      top: sourceRowTop,
      left: fixture.goalColumn,
    }
  );

  setMeasuredSamplesCache(fixture.root, fixture.wire, width, fixture.samples);
  layout = buildHandoffNoteLayoutMap(fixture.root, fixture.doc, fromPos);
  const targetRowTop = layout.rows[layout.rowIndexForWire(fixture.probeTargetWire)]!.top;

  const restoreProbe = stubCaretProbeAtDocPos(
    fixture.root,
    fixture.doc,
    fixture.goalColumn,
    targetRowTop,
    probePos
  );

  return {
    restore: () => {
      restoreProbe();
      restoreAnchor();
    },
    layout,
    sourceRowTop,
    targetRowTop,
  };
}

export const MULTI_MENTION_SOFT_WRAP_AGENT = "caliper-wrapagent01";
const MULTI_MENTION_SOFT_WRAP_ROW0 = 141.1;
const MULTI_MENTION_SOFT_WRAP_ROW1 = 159.3;
const MULTI_MENTION_SOFT_WRAP_ROW2 = 177.49;
const MULTI_MENTION_SOFT_WRAP_ROOT_W = 310;
/** 3-char prefix — same length as session `ddm`. */
const MULTI_MENTION_SOFT_WRAP_PREFIX = "pre";
/** 8-char mid chunk — same length as session `danidhhd`. */
const MULTI_MENTION_SOFT_WRAP_MID = "wraptext";

export function buildMultiMentionSoftWrapWire(): string {
  return `${MULTI_MENTION_SOFT_WRAP_PREFIX} @${MULTI_MENTION_SOFT_WRAP_AGENT} d @${MULTI_MENTION_SOFT_WRAP_AGENT} ${MULTI_MENTION_SOFT_WRAP_MID} @${MULTI_MENTION_SOFT_WRAP_AGENT} @${MULTI_MENTION_SOFT_WRAP_AGENT} `;
}

function listMentionNodeIndices(doc: HandoffNoteDoc): number[] {
  const mentionNodes: number[] = [];
  for (let i = 0; i < doc.nodes.length; i++) {
    if (doc.nodes[i]?.type === "mention") {
      mentionNodes.push(i);
    }
  }
  return mentionNodes;
}

function buildThreeRowMentionSoftWrapSamples(
  doc: HandoffNoteDoc,
  wire: string,
  mentionNodes: number[],
  agent: string
) {
  const fourthMentionStart = docPosToWireOffset(doc, {
    nodeIndex: mentionNodes[3]!,
    nodeOffset: 0,
  });
  const wrapRowStartWire = docPosToWireOffset(doc, {
    nodeIndex: mentionNodes[1]! + 1,
    nodeOffset: 1,
  });
  const interiorWire = docPosToWireOffset(doc, {
    nodeIndex: mentionNodes[1]! + 1,
    nodeOffset: 4,
  });
  return [
    { wire: 0, top: MULTI_MENTION_SOFT_WRAP_ROW0, left: 349.5 },
    { wire: 4, top: MULTI_MENTION_SOFT_WRAP_ROW0, left: 378.57 },
    {
      wire: docPosToWireOffset(doc, {
        nodeIndex: mentionNodes[0]!,
        nodeOffset: 1 + agent.length,
      }),
      top: MULTI_MENTION_SOFT_WRAP_ROW0,
      left: 495.73,
    },
    {
      wire: docPosToWireOffset(doc, { nodeIndex: mentionNodes[0]!, nodeOffset: 0 }),
      top: MULTI_MENTION_SOFT_WRAP_ROW0,
      left: 495.73,
    },
    {
      wire: docPosToWireOffset(doc, {
        nodeIndex: mentionNodes[1]!,
        nodeOffset: 1 + agent.length,
      }),
      top: MULTI_MENTION_SOFT_WRAP_ROW0,
      left: 511.51,
    },
    {
      wire:
        docPosToWireOffset(doc, {
          nodeIndex: mentionNodes[1]!,
          nodeOffset: 1 + agent.length,
        }) + 1,
      top: MULTI_MENTION_SOFT_WRAP_ROW1,
      left: 628.67,
    },
    {
      wire: docPosToWireOffset(doc, { nodeIndex: mentionNodes[2]!, nodeOffset: 0 }),
      top: MULTI_MENTION_SOFT_WRAP_ROW1,
      left: 406.86,
    },
    {
      wire: docPosToWireOffset(doc, {
        nodeIndex: mentionNodes[2]!,
        nodeOffset: 1 + agent.length,
      }),
      top: MULTI_MENTION_SOFT_WRAP_ROW1,
      left: 524.02,
    },
    { wire: fourthMentionStart, top: MULTI_MENTION_SOFT_WRAP_ROW2, left: 348.5 },
    { wire: wire.length, top: MULTI_MENTION_SOFT_WRAP_ROW2, left: 469.21 },
    { wire: wrapRowStartWire, top: MULTI_MENTION_SOFT_WRAP_ROW1, left: 355.15 },
    { wire: interiorWire, top: MULTI_MENTION_SOFT_WRAP_ROW1, left: 379.09 },
  ];
}

/** Four-mention soft-wrap fixture with three visual rows (row-1 click ingress family). */
export function mountThreeRowMentionSoftWrapFixture() {
  const wire = buildMultiMentionSoftWrapWire();
  const doc = wireToDoc(wire);
  const root = document.createElement("div");
  root.style.width = `${MULTI_MENTION_SOFT_WRAP_ROOT_W}px`;
  root.contentEditable = "true";
  document.body.appendChild(root);
  renderHandoffNoteDoc(root, doc, {
    colorByAgentId: new Map([[MULTI_MENTION_SOFT_WRAP_AGENT, "#06f"]]),
  });
  Object.defineProperty(root, "clientWidth", {
    configurable: true,
    value: MULTI_MENTION_SOFT_WRAP_ROOT_W,
  });

  const mentionNodes = listMentionNodeIndices(doc);
  stubHandoffNoteMentionLayoutCoords(
    root,
    new Map(
      mentionNodes.map((nodeIndex, i) => [
        nodeIndex,
        {
          top:
            i < 2
              ? MULTI_MENTION_SOFT_WRAP_ROW0
              : i === 2
                ? MULTI_MENTION_SOFT_WRAP_ROW1
                : MULTI_MENTION_SOFT_WRAP_ROW2,
          left: 500 + i * 8,
        },
      ])
    )
  );

  const fourthMentionStart = docPosToWireOffset(doc, {
    nodeIndex: mentionNodes[3]!,
    nodeOffset: 0,
  });
  const wrapRowStartWire = docPosToWireOffset(doc, {
    nodeIndex: mentionNodes[1]! + 1,
    nodeOffset: 1,
  });
  const interiorWire = docPosToWireOffset(doc, {
    nodeIndex: mentionNodes[1]! + 1,
    nodeOffset: 4,
  });
  const middleTextNode = mentionNodes[1]! + 1;
  const samples = buildThreeRowMentionSoftWrapSamples(
    doc,
    wire,
    mentionNodes,
    MULTI_MENTION_SOFT_WRAP_AGENT
  );
  setMeasuredSamplesCache(root, wire, MULTI_MENTION_SOFT_WRAP_ROOT_W, samples);
  stubTextNodeLineRects(root, doc, middleTextNode, [
    { top: MULTI_MENTION_SOFT_WRAP_ROW0, left: 520, width: 100 },
    { top: MULTI_MENTION_SOFT_WRAP_ROW1, left: 380, width: 200 },
  ]);

  const postfixSpacerNode = mentionNodes[2]! + 1;

  return {
    root,
    doc,
    wire,
    agent: MULTI_MENTION_SOFT_WRAP_AGENT,
    mentionNodes,
    middleTextNode,
    postfixSpacerNode,
    fourthMentionStart,
    wrapRowStartWire,
    interiorWire,
    row0Top: MULTI_MENTION_SOFT_WRAP_ROW0,
    row1Top: MULTI_MENTION_SOFT_WRAP_ROW1,
    row2Top: MULTI_MENTION_SOFT_WRAP_ROW2,
    rootWidth: MULTI_MENTION_SOFT_WRAP_ROOT_W,
  };
}

/** Spacer between third and fourth mention: interior on row 1, alias wire on row 2. */
export function applyThreeRowSpacerBrowserParityLayoutStubs(
  fx: Pick<
    ReturnType<typeof mountThreeRowMentionSoftWrapFixture>,
    "root" | "doc" | "postfixSpacerNode" | "row1Top"
  >
): void {
  stubTextNodeLineRects(
    fx.root,
    fx.doc,
    fx.postfixSpacerNode,
    [{ top: fx.row1Top, left: 520, width: 120, height: 18 }],
    {
      resolveOffsetRect: (nodeOffset) => ({
        top: fx.row1Top,
        left: 520 + nodeOffset * 8,
        width: 8,
        height: 18,
      }),
    }
  );
  const postfixSpacer = fx.doc.nodes[fx.postfixSpacerNode];
  if (postfixSpacer?.type === "text") {
    stubHandoffNoteAnchorRectAtDocPos(
      fx.root,
      fx.doc,
      { nodeIndex: fx.postfixSpacerNode, nodeOffset: postfixSpacer.text.length },
      { top: fx.row1Top, left: 537, width: 30 }
    );
  }
}

export function mountMultiMentionSoftWrapFixture() {
  const wire = buildMultiMentionSoftWrapWire();
  const doc = wireToDoc(wire);
  const root = document.createElement("div");
  root.style.width = `${MULTI_MENTION_SOFT_WRAP_ROOT_W}px`;
  root.contentEditable = "true";
  document.body.appendChild(root);
  renderHandoffNoteDoc(root, doc, {
    colorByAgentId: new Map([[MULTI_MENTION_SOFT_WRAP_AGENT, "#06f"]]),
  });
  Object.defineProperty(root, "clientWidth", {
    configurable: true,
    value: MULTI_MENTION_SOFT_WRAP_ROOT_W,
  });

  const mentionNodes = listMentionNodeIndices(doc);

  const pillCoords = new Map<number, { top: number; left: number }>();
  mentionNodes.forEach((nodeIndex, i) => {
    pillCoords.set(nodeIndex, {
      top: i < 2 ? MULTI_MENTION_SOFT_WRAP_ROW0 : MULTI_MENTION_SOFT_WRAP_ROW1,
      left: 500 + i * 8,
    });
  });
  stubHandoffNoteMentionLayoutCoords(root, pillCoords);

  const secondMentionEnd = docPosToWireOffset(doc, {
    nodeIndex: mentionNodes[1]!,
    nodeOffset: 1 + MULTI_MENTION_SOFT_WRAP_AGENT.length,
  });
  const secondPostStart = docPosToWireOffset(doc, {
    nodeIndex: mentionNodes[1]! + 1,
    nodeOffset: 0,
  });
  const continuationTextPos = { nodeIndex: mentionNodes[1]! + 1, nodeOffset: 1 };
  const continuationWire = docPosToWireOffset(doc, continuationTextPos);
  const row0ClickPos = wireOffsetToDocPos(doc, 4);

  const samples = [
    { wire: 0, top: MULTI_MENTION_SOFT_WRAP_ROW0, left: 347.5 },
    { wire: 4, top: MULTI_MENTION_SOFT_WRAP_ROW0, left: 374.73 },
    {
      wire: docPosToWireOffset(doc, { nodeIndex: mentionNodes[0]!, nodeOffset: 0 }),
      top: MULTI_MENTION_SOFT_WRAP_ROW0,
      left: 491.89,
    },
    {
      wire: docPosToWireOffset(doc, { nodeIndex: mentionNodes[1]!, nodeOffset: 0 }),
      top: MULTI_MENTION_SOFT_WRAP_ROW0,
      left: 507.67,
    },
    { wire: secondPostStart, top: MULTI_MENTION_SOFT_WRAP_ROW1, left: 624.82 },
    {
      wire: docPosToWireOffset(doc, { nodeIndex: mentionNodes[2]!, nodeOffset: 0 }),
      top: MULTI_MENTION_SOFT_WRAP_ROW1,
      left: 382.09,
    },
    {
      wire: docPosToWireOffset(doc, { nodeIndex: mentionNodes[3]!, nodeOffset: 0 }),
      top: MULTI_MENTION_SOFT_WRAP_ROW1,
      left: 503.81,
    },
    { wire: wire.length, top: MULTI_MENTION_SOFT_WRAP_ROW1, left: 624.52 },
    {
      wire: secondMentionEnd,
      top: MULTI_MENTION_SOFT_WRAP_ROW0 - 0.43,
      left: 624.82,
      right: 627.33,
    },
    {
      wire: continuationWire,
      top: MULTI_MENTION_SOFT_WRAP_ROW0 - 0.43,
      left: 624.82,
      right: 627.33,
    },
  ];
  setMeasuredSamplesCache(root, wire, MULTI_MENTION_SOFT_WRAP_ROOT_W, samples);

  const sandwichSpacerNode = mentionNodes[0]! + 1;
  const middleTextNode = mentionNodes[1]! + 1;
  stubTextNodeLineRects(root, doc, middleTextNode, [
    { top: MULTI_MENTION_SOFT_WRAP_ROW0, left: 520, width: 100 },
    { top: MULTI_MENTION_SOFT_WRAP_ROW1, left: 380, width: 200 },
  ]);
  stubTextNodeLineRects(root, doc, sandwichSpacerNode, [
    { top: MULTI_MENTION_SOFT_WRAP_ROW0, left: 500, width: 30 },
  ]);

  return {
    root,
    doc,
    wire,
    secondPostStart,
    continuationTextPos,
    continuationWire,
    row0ClickPos,
    sandwichSpacerNode,
    middleTextNode,
    samples,
    row0Top: MULTI_MENTION_SOFT_WRAP_ROW0,
    row1Top: MULTI_MENTION_SOFT_WRAP_ROW1,
    rootWidth: MULTI_MENTION_SOFT_WRAP_ROOT_W,
    agent: MULTI_MENTION_SOFT_WRAP_AGENT,
  };
}

export function reapplyMultiMentionSoftWrapStubs(
  fx: Pick<
    ReturnType<typeof mountMultiMentionSoftWrapFixture>,
    "root" | "doc" | "wire" | "middleTextNode" | "sandwichSpacerNode" | "samples"
  >
): void {
  setMeasuredSamplesCache(fx.root, fx.wire, MULTI_MENTION_SOFT_WRAP_ROOT_W, fx.samples);
  stubTextNodeLineRects(fx.root, fx.doc, fx.middleTextNode, [
    { top: MULTI_MENTION_SOFT_WRAP_ROW0, left: 520, width: 100 },
    { top: MULTI_MENTION_SOFT_WRAP_ROW1, left: 380, width: 200 },
  ]);
  stubTextNodeLineRects(fx.root, fx.doc, fx.sandwichSpacerNode, [
    { top: MULTI_MENTION_SOFT_WRAP_ROW0, left: 500, width: 30 },
  ]);
  stubTextNodeOffsetAnchorRects(fx.root, fx.doc, fx.middleTextNode, (offset) =>
    offset <= 0
      ? { top: MULTI_MENTION_SOFT_WRAP_ROW0, left: 520 }
      : { top: MULTI_MENTION_SOFT_WRAP_ROW1, left: 380 }
  );
}
