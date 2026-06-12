import {
  collapsedSelection,
  describeHandoffNoteCursorContext,
  docLength,
  docPosEqual,
  docPosToWireOffset,
  docToWire,
  isInterMentionAtomStart,
  normalizeDocPos,
  normalizeSelection,
  resolveDocVerticalArrowMove,
  snapVerticalArrowLanding,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
  type HandoffNoteVerticalArrowDirection,
} from "@caliper/core";
import { flattenHandoffNoteLog, handoffNoteDomSnapshot } from "../handoff-note-debug.js";
import { isHandoffMentionElement, mentionWireLength } from "./handoff-note-dom.js";

function isEditorNode(root: HTMLElement, node: Node): boolean {
  return node === root || root.contains(node);
}

function isRenderedDocNode(node: HandoffNoteDoc["nodes"][number]): boolean {
  return node.type !== "text" || Boolean(node.text);
}

function renderedIndexForDocNode(doc: HandoffNoteDoc, nodeIndex: number): number {
  let rendered = 0;
  for (let index = 0; index < doc.nodes.length; index++) {
    const node = doc.nodes[index]!;
    if (!isRenderedDocNode(node)) {
      if (index === nodeIndex) {
        return rendered;
      }
      continue;
    }
    if (index === nodeIndex) {
      return rendered;
    }
    rendered++;
  }
  return rendered;
}

function findMentionAncestor(root: HTMLElement, node: Node): HTMLSpanElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (isHandoffMentionElement(current)) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function domPointToDocPos(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  container: Node,
  offset: number
): HandoffNoteDocPos {
  if (!isEditorNode(root, container)) {
    return { nodeIndex: 0, nodeOffset: 0 };
  }

  if (container.nodeType === Node.TEXT_NODE) {
    const mention = findMentionAncestor(root, container);
    if (mention) {
      const agentId = mention.getAttribute("data-agent-id") ?? "";
      const pillText = mention.textContent ?? "";
      const clamped = Math.max(0, Math.min(offset, pillText.length));
      const nodeIndex = domNodeToDocIndex(root, doc, mention);
      if (nodeIndex === null) {
        return { nodeIndex: 0, nodeOffset: 0 };
      }
      const tokenLength = mentionWireLength(agentId);
      if (clamped <= 0) {
        return { nodeIndex, nodeOffset: 0 };
      }
      if (clamped >= pillText.length) {
        return { nodeIndex, nodeOffset: tokenLength };
      }
      return { nodeIndex, nodeOffset: 1 + clamped };
    }

    const nodeIndex = domNodeToDocIndex(root, doc, container);
    if (nodeIndex === null) {
      return { nodeIndex: 0, nodeOffset: 0 };
    }
    const node = doc.nodes[nodeIndex];
    const maxOffset = node?.type === "text" ? node.text.length : 0;
    return { nodeIndex, nodeOffset: Math.max(0, Math.min(offset, maxOffset)) };
  }

  if (container === root) {
    if (offset >= root.childNodes.length) {
      return wireOffsetToDocPos(doc, docToWire(doc).length);
    }
    const child = root.childNodes[offset];
    if (!child) {
      return wireOffsetToDocPos(doc, docToWire(doc).length);
    }
    const nodeIndex = domNodeToDocIndex(root, doc, child);
    if (nodeIndex === null) {
      return { nodeIndex: 0, nodeOffset: 0 };
    }
    const node = doc.nodes[nodeIndex]!;
    if (node.type === "mention") {
      return { nodeIndex, nodeOffset: 0 };
    }
    return { nodeIndex, nodeOffset: 0 };
  }

  if (isHandoffMentionElement(container)) {
    const nodeIndex = domNodeToDocIndex(root, doc, container);
    if (nodeIndex === null) {
      return { nodeIndex: 0, nodeOffset: 0 };
    }
    const agentId = container.getAttribute("data-agent-id") ?? "";
    const tokenLength = mentionWireLength(agentId);
    return { nodeIndex, nodeOffset: offset <= 0 ? 0 : tokenLength };
  }

  return domPointToDocPos(root, doc, container.parentNode ?? root, 0);
}

function domNodeToDocIndex(root: HTMLElement, doc: HandoffNoteDoc, target: Node): number | null {
  let rendered = 0;
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    if (!isRenderedDocNode(node)) {
      continue;
    }
    const domNode = root.childNodes[rendered];
    if (domNode === target || domNode?.contains(target)) {
      return nodeIndex;
    }
    rendered++;
  }
  return null;
}

function resolveDomPointAtDocPos(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos
): { node: Node; offset: number } | null {
  const normalized = normalizeDocPos(doc, pos);
  const node = doc.nodes[normalized.nodeIndex];
  if (!node) {
    if (root.firstChild?.nodeType === Node.TEXT_NODE) {
      return { node: root.firstChild, offset: 0 };
    }
    return { node: root, offset: 0 };
  }

  const renderedIndex = renderedIndexForDocNode(doc, normalized.nodeIndex);
  const domNode = root.childNodes[renderedIndex];
  if (!domNode) {
    return { node: root, offset: root.childNodes.length };
  }

  if (node.type === "text") {
    return {
      node: domNode,
      offset: Math.max(0, Math.min(normalized.nodeOffset, node.text.length)),
    };
  }

  const tokenLength = mentionWireLength(node.agentId);
  if (normalized.nodeOffset <= 0) {
    return { node: root, offset: renderedIndex };
  }
  if (normalized.nodeOffset >= tokenLength) {
    return { node: root, offset: renderedIndex + 1 };
  }

  return { node: domNode, offset: 0 };
}

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
  from?: HandoffNoteDocPos
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

type MeasuredWireOffset = { wire: number; top: number; left: number };

function sampleWireOffsets(doc: HandoffNoteDoc): number[] {
  const samples = new Set<number>([0, docLength(doc)]);
  let offset = 0;
  for (const node of doc.nodes) {
    samples.add(offset);
    if (node.type === "text") {
      offset += node.text.length;
    } else {
      offset += 1 + node.agentId.length;
      samples.add(offset);
    }
  }
  return [...samples].sort((left, right) => left - right);
}

function clusterMeasuredLines(
  measured: MeasuredWireOffset[],
  tolerance: number
): MeasuredWireOffset[][] {
  if (measured.length === 0) {
    return [];
  }
  const sorted = [...measured].sort(
    (left, right) => left.top - right.top || left.left - right.left
  );
  const lines: MeasuredWireOffset[][] = [];
  let current: MeasuredWireOffset[] = [];
  let currentTop = sorted[0]!.top;
  for (const sample of sorted) {
    if (current.length === 0 || Math.abs(sample.top - currentTop) <= tolerance) {
      current.push(sample);
      currentTop = current.reduce((sum, entry) => sum + entry.top, 0) / current.length;
      continue;
    }
    lines.push(current);
    current = [sample];
    currentTop = sample.top;
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function findLineIndexForTop(
  lines: MeasuredWireOffset[][],
  top: number,
  tolerance: number
): number {
  for (let index = 0; index < lines.length; index++) {
    const lineTop = lines[index]![0]!.top;
    if (Math.abs(lineTop - top) <= tolerance) {
      return index;
    }
  }
  return -1;
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

function lineStartSample(line: MeasuredWireOffset[]): MeasuredWireOffset {
  return line.reduce((best, sample) => (sample.wire < best.wire ? sample : best), line[0]!);
}

function pickVerticalLandingOnLine(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  targetLine: MeasuredWireOffset[],
  currentLeft: number
): { pos: HandoffNoteDocPos; branch: string } {
  const fromMentionStart = isMentionAtomStart(doc, focus);
  if (fromMentionStart) {
    const picked = lineStartSample(targetLine);
    return {
      pos: normalizeDocPos(doc, wireOffsetToDocPos(doc, picked.wire), { from: focus }),
      branch: "dom-lineStart-fromMention",
    };
  }

  const picked = pickClosestOnLine(targetLine, currentLeft);
  let targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, picked.wire), { from: focus });
  let branch = "dom-column";
  if (isInterMentionAtomStart(doc, targetPos)) {
    const lineStartWire = lineStartSample(targetLine).wire;
    targetPos = normalizeDocPos(doc, wireOffsetToDocPos(doc, lineStartWire), { from: focus });
    branch = "dom-lineStart-interMention";
  } else {
    targetPos = snapVerticalArrowLanding(doc, targetPos, direction);
    if (
      !docPosEqual(
        targetPos,
        normalizeDocPos(doc, wireOffsetToDocPos(doc, picked.wire), { from: focus })
      )
    ) {
      branch = "dom-snapVertical";
    }
  }
  return { pos: targetPos, branch };
}

export function resolveMeasuredVerticalArrowMove(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection,
  measured: MeasuredWireOffset[],
  currentTop: number,
  currentLeft: number,
  lineHeight: number
): { pos: HandoffNoteDocPos; handled: boolean; branch?: string } {
  if (measured.length < 2) {
    return { pos: focus, handled: false };
  }

  const tolerance = Math.max(lineHeight, 8) * 0.5;
  const lines = clusterMeasuredLines(measured, tolerance);
  const currentLineIndex = findLineIndexForTop(lines, currentTop, tolerance);
  const targetLineIndex = direction === "up" ? currentLineIndex - 1 : currentLineIndex + 1;
  if (currentLineIndex < 0 || targetLineIndex < 0 || targetLineIndex >= lines.length) {
    return { pos: focus, handled: false };
  }

  const targetLine = lines[targetLineIndex]!;
  const { pos: targetPos, branch } = pickVerticalLandingOnLine(
    doc,
    focus,
    direction,
    targetLine,
    currentLeft
  );

  if (docPosEqual(targetPos, focus)) {
    return { pos: focus, handled: false };
  }
  return { pos: targetPos, handled: true, branch };
}

export function resolveDomVerticalArrowMove(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteVerticalArrowDirection
): { pos: HandoffNoteDocPos; handled: boolean } {
  const wireMove = resolveDocVerticalArrowMove(doc, focus, direction);
  if (wireMove.handled) {
    return wireMove;
  }

  const currentRect = getDocAnchorRect(root, doc, focus);
  if (!currentRect) {
    return { pos: focus, handled: false };
  }

  const measured: MeasuredWireOffset[] = [];
  for (const wire of sampleWireOffsets(doc)) {
    const rect = getDocAnchorRect(root, doc, wireOffsetToDocPos(doc, wire));
    if (!rect) {
      continue;
    }
    measured.push({ wire, top: rect.top, left: rect.left });
  }
  const lineHeight = Math.max(currentRect.height, 8);
  const measuredMove = resolveMeasuredVerticalArrowMove(
    doc,
    focus,
    direction,
    measured,
    currentRect.top,
    currentRect.left,
    lineHeight
  );
  if (measuredMove.branch) {
    flattenHandoffNoteLog("caret>>verticalArrow", {
      direction,
      branch: measuredMove.branch,
      fromWire: docPosToWireOffset(doc, focus),
      toWire: docPosToWireOffset(doc, measuredMove.pos),
      handled: measuredMove.handled,
    });
  }
  return { pos: measuredMove.pos, handled: measuredMove.handled };
}

export function getDocAnchorRect(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos
): DOMRect | null {
  const point = resolveDomPointAtDocPos(root, doc, pos);
  if (!point) {
    return null;
  }

  const range = root.ownerDocument.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);

  if (typeof range.getClientRects === "function") {
    const rects = range.getClientRects();
    if (rects.length > 0) {
      return rects[0] ?? null;
    }
  }

  if (typeof range.getBoundingClientRect === "function") {
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      return rect;
    }
  }

  return root.getBoundingClientRect();
}
