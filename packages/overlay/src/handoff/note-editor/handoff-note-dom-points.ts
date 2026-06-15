import {
  docPosToWireOffset,
  docToWire,
  normalizeDocPos,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";
import {
  buildRenderedNodeIndexMap,
  countWireTextDomChildren,
  docWireEndsWithNewline,
  isHandoffLinePadElement,
  isHandoffMentionElement,
  isHandoffWireBreakElement,
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

function isLastRenderedDocNode(doc: HandoffNoteDoc, nodeIndex: number): boolean {
  for (let index = doc.nodes.length - 1; index >= 0; index--) {
    const node = doc.nodes[index]!;
    if (node.type !== "text" || node.text) {
      return index === nodeIndex;
    }
  }
  return false;
}

/** Map doc node index to first rendered DOM child index (wire-split text expands). */
export function docPosToRenderedDomChildIndex(doc: HandoffNoteDoc, nodeIndex: number): number {
  let rendered = 0;
  for (let index = 0; index < doc.nodes.length; index++) {
    const node = doc.nodes[index]!;
    if (node.type === "text" && !node.text) {
      if (index === nodeIndex) {
        return rendered;
      }
      continue;
    }
    if (index === nodeIndex) {
      return rendered;
    }
    if (node.type === "text") {
      rendered += countWireTextDomChildren(node.text);
    } else {
      rendered++;
    }
  }
  return rendered;
}

function resolveTextDomPointAtOffset(
  root: HTMLElement,
  text: string,
  nodeOffset: number,
  domStartChildIndex: number,
  options: { docEndsWithNewline: boolean; isLastRenderedNode: boolean }
): { node: Node; offset: number } {
  const clamped = Math.max(0, Math.min(nodeOffset, text.length));

  if (!text.includes("\n")) {
    const domNode = root.childNodes[domStartChildIndex];
    if (domNode?.nodeType === Node.TEXT_NODE) {
      return { node: domNode, offset: clamped };
    }
    return { node: root, offset: domStartChildIndex };
  }

  let childIdx = domStartChildIndex;
  let remaining = clamped;
  const parts = text.split("\n");

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex]!;

    if (remaining <= part.length) {
      if (remaining < part.length && part) {
        const domNode = root.childNodes[childIdx];
        if (domNode?.nodeType === Node.TEXT_NODE) {
          return { node: domNode, offset: remaining };
        }
      }
      if (remaining === part.length && partIndex < parts.length - 1) {
        if (part) {
          childIdx++;
        }
        return { node: root, offset: childIdx };
      }
      if (part === "" && remaining === 0) {
        return { node: root, offset: childIdx };
      }
      if (part && remaining === part.length) {
        const domNode = root.childNodes[childIdx];
        if (domNode?.nodeType === Node.TEXT_NODE) {
          return { node: domNode, offset: remaining };
        }
      }
      break;
    }

    remaining -= part.length;
    if (part) {
      childIdx++;
    }

    if (partIndex < parts.length - 1) {
      if (remaining === 0) {
        return { node: root, offset: childIdx };
      }
      remaining -= 1;
      childIdx++;
    }
  }

  if (options.docEndsWithNewline && options.isLastRenderedNode && text.endsWith("\n")) {
    return { node: root, offset: root.childNodes.length - 1 };
  }

  const domNode = root.childNodes[childIdx - 1] ?? root.childNodes[domStartChildIndex];
  if (domNode?.nodeType === Node.TEXT_NODE) {
    return { node: domNode, offset: domNode.textContent?.length ?? 0 };
  }
  return { node: root, offset: childIdx };
}

function docPosFromRootDomChildIndex(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  targetChildIndex: number
): HandoffNoteDocPos {
  const wire = docToWire(doc);
  const docEndsWithNewline = wire.endsWith("\n");
  let domIdx = 0;
  let wireOffset = 0;

  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    if (node.type === "text" && !node.text) {
      continue;
    }

    if (node.type === "mention") {
      if (domIdx === targetChildIndex) {
        const prevDom = root.childNodes[targetChildIndex - 1];
        if (prevDom && isHandoffWireBreakElement(prevDom) && nodeIndex > 0) {
          const prevNode = doc.nodes[nodeIndex - 1];
          if (prevNode?.type === "text") {
            return { nodeIndex: nodeIndex - 1, nodeOffset: prevNode.text.length };
          }
        }
        return { nodeIndex, nodeOffset: 0 };
      }
      domIdx++;
      wireOffset += mentionWireLength(node.agentId);
      continue;
    }

    const text = node.text;
    if (!text.includes("\n")) {
      if (domIdx === targetChildIndex) {
        return { nodeIndex, nodeOffset: 0 };
      }
      domIdx++;
      wireOffset += text.length;
      continue;
    }

    const parts = text.split("\n");
    let nodeOffset = 0;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex]!;
      if (part) {
        if (domIdx === targetChildIndex) {
          return { nodeIndex, nodeOffset };
        }
        domIdx++;
        nodeOffset += part.length;
        wireOffset += part.length;
      }
      if (partIndex < parts.length - 1) {
        if (domIdx === targetChildIndex) {
          return { nodeIndex, nodeOffset };
        }
        domIdx++;
        nodeOffset += 1;
        wireOffset += 1;
      }
    }
  }

  if (docEndsWithNewline && domIdx === targetChildIndex) {
    return wireOffsetToDocPos(doc, wire.length);
  }

  return wireOffsetToDocPos(doc, wire.length);
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
    if (node?.type !== "text") {
      return { nodeIndex, nodeOffset: 0 };
    }

    if (!node.text.includes("\n")) {
      return {
        nodeIndex,
        nodeOffset: Math.max(0, Math.min(offset, node.text.length)),
      };
    }

    const domStart = docPosToRenderedDomChildIndex(doc, nodeIndex);
    let childIdx = domStart;
    let nodeOffset = 0;
    const parts = node.text.split("\n");
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex]!;
      const textChild = root.childNodes[childIdx];
      if (textChild === container) {
        return { nodeIndex, nodeOffset: nodeOffset + offset };
      }
      if (part) {
        nodeOffset += part.length;
        childIdx++;
      }
      if (partIndex < parts.length - 1) {
        childIdx++;
        nodeOffset += 1;
      }
    }
    return { nodeIndex, nodeOffset: node.text.length };
  }

  if (container === root) {
    if (offset >= root.childNodes.length) {
      return wireOffsetToDocPos(doc, docToWire(doc).length);
    }
    const child = root.childNodes[offset];
    if (!child) {
      return wireOffsetToDocPos(doc, docToWire(doc).length);
    }
    if (isHandoffLinePadElement(child)) {
      return wireOffsetToDocPos(doc, docToWire(doc).length);
    }
    return docPosFromRootDomChildIndex(root, doc, offset);
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

  if (isHandoffWireBreakElement(container) || isHandoffLinePadElement(container)) {
    for (let childIdx = 0; childIdx < root.childNodes.length; childIdx++) {
      if (root.childNodes[childIdx] === container) {
        return docPosFromRootDomChildIndex(root, doc, childIdx);
      }
    }
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

  const renderedIndex = docPosToRenderedDomChildIndex(doc, normalized.nodeIndex);
  const domNode = root.childNodes[renderedIndex];
  if (!domNode) {
    if (docWireEndsWithNewline(doc) && isLastRenderedDocNode(doc, normalized.nodeIndex)) {
      return { node: root, offset: root.childNodes.length - 1 };
    }
    return { node: root, offset: root.childNodes.length };
  }

  if (node.type === "text") {
    return resolveTextDomPointAtOffset(root, node.text, normalized.nodeOffset, renderedIndex, {
      docEndsWithNewline: docWireEndsWithNewline(doc),
      isLastRenderedNode: isLastRenderedDocNode(doc, normalized.nodeIndex),
    });
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
