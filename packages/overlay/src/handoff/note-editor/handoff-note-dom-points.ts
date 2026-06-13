import {
  docPosToRenderedChildIndex,
  docPosToWireOffset,
  docToWire,
  normalizeDocPos,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";
import {
  buildRenderedNodeIndexMap,
  isHandoffMentionElement,
  mentionWireLength,
} from "./handoff-note-dom.js";

function isEditorNode(root: HTMLElement, node: Node): boolean {
  return node === root || root.contains(node);
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

function domNodeToDocIndex(root: HTMLElement, doc: HandoffNoteDoc, target: Node): number | null {
  const indexMap = buildRenderedNodeIndexMap(doc);
  for (let childIdx = 0; childIdx < root.childNodes.length; childIdx++) {
    const domNode = root.childNodes[childIdx];
    if (domNode === target || domNode?.contains(target)) {
      return indexMap[childIdx] ?? null;
    }
  }
  return null;
}

export function domPointToDocPos(
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

export function resolveDomPointAtDocPos(
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

  const renderedIndex = docPosToRenderedChildIndex(doc, normalized.nodeIndex);
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

/** Map a viewport point inside the editor to a doc caret (contract: visual row/column probe). */
export function probeDocPosAtVisualColumn(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  rowTop: number,
  column: number
): HandoffNoteDocPos | null {
  const docApi = root.ownerDocument;

  if (typeof docApi.caretPositionFromPoint === "function") {
    const hit = docApi.caretPositionFromPoint(column, rowTop);
    if (hit && isEditorNode(root, hit.offsetNode)) {
      return normalizeDocPos(doc, domPointToDocPos(root, doc, hit.offsetNode, hit.offset), {
        bias: "start",
      });
    }
  }

  const legacyDoc = docApi as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof legacyDoc.caretRangeFromPoint === "function") {
    const range = legacyDoc.caretRangeFromPoint(column, rowTop);
    if (range && isEditorNode(root, range.startContainer)) {
      return normalizeDocPos(
        doc,
        domPointToDocPos(root, doc, range.startContainer, range.startOffset),
        { bias: "start" }
      );
    }
  }

  return null;
}

/** Add layout samples at each rendered text line (soft-wrap fragments). */
export function enrichMeasuredTextLineSamples(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  measured: { wire: number; top: number; left: number }[]
): void {
  const seen = new Set(measured.map((sample) => sample.wire));

  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex];
    if (node?.type !== "text" || node.text.length === 0) {
      continue;
    }

    const point = resolveDomPointAtDocPos(root, doc, { nodeIndex, nodeOffset: 0 });
    if (!point || point.node.nodeType !== Node.TEXT_NODE) {
      continue;
    }

    const range = root.ownerDocument.createRange();
    range.selectNodeContents(point.node);
    const rects = typeof range.getClientRects === "function" ? [...range.getClientRects()] : [];
    if (rects.length === 0) {
      continue;
    }

    for (const rect of rects) {
      if (rect.width <= 0 && rect.height <= 0) {
        continue;
      }
      const midY = rect.top + rect.height / 2;
      const probeX = rect.left + Math.min(2, Math.max(0, rect.width / 2));
      const probed =
        probeDocPosAtVisualColumn(root, doc, midY, probeX) ??
        probeDocPosAtVisualColumn(root, doc, rect.top, probeX);
      if (!probed) {
        continue;
      }
      const wire = docPosToWireOffset(doc, probed);
      if (seen.has(wire)) {
        continue;
      }
      seen.add(wire);
      measured.push({ wire, top: midY, left: rect.left });
    }
  }
}
