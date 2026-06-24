import {
  docPosToWireOffset,
  docToWire,
  embeddedBlankBandAtEmptyContentRowEnd,
  isEmbeddedBlankBandProbeWire,
  listEmbeddedBlankBandProbeWires,
  normalizeDocPos,
  wireOffsetToDocPos,
  type HandoffBlankBandDeleteOptions,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";
import {
  buildRenderedNodeIndexMap,
  countWireTextDomChildren,
  docWireEndsWithNewline,
  isHandoffBlankAnchorElement,
  isHandoffLinePadElement,
  isHandoffMentionElement,
  isHandoffWireBreakElement,
  mentionWireLength,
  wireOffsetAtTextBreak,
} from "./handoff-note-dom.js";

function isEditorNode(root: HTMLElement, node: Node): boolean {
  return node === root || root.contains(node);
}

/** `<br>` and collapsed ranges often report 0×0 while still carrying a paint position. */
export function hasPositionedDomRect(rect: DOMRect): boolean {
  return Number.isFinite(rect.top) && Number.isFinite(rect.left);
}

export function domRectAnchorMidY(rect: DOMRect): number {
  return rect.top + rect.height / 2;
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

/** Browser trailing edge on a split wire-text part before the next `\n` (§53 Rule 4). */
export function isContentTextNodeDomTailBeforeBreak(
  domOffset: number,
  part: string,
  partIndex: number,
  partCount: number
): boolean {
  return domOffset === part.length && part.length > 0 && partIndex < partCount - 1;
}

/**
 * §53 Rule 4 — read path: text-node tail belongs to content row end, not the following `\n`.
 * Blank-band probe wires come only from blank infrastructure DOM, not content text tails.
 */
export function docOffsetFromContentTextNodeDomPoint(
  nodeOffsetBase: number,
  domOffset: number,
  part: string,
  partIndex: number,
  partCount: number
): number {
  if (isContentTextNodeDomTailBeforeBreak(domOffset, part, partIndex, partCount)) {
    return nodeOffsetBase + domOffset - 1;
  }
  return nodeOffsetBase + domOffset;
}

/** §53 Rule 4 — write path: content row end renders at the browser text-node tail before a break. */
export function domOffsetForContentRowEndInSplitText(
  docOffsetInPart: number,
  part: string,
  partIndex: number,
  partCount: number
): number {
  if (docOffsetInPart === part.length - 1 && part.length > 0 && partIndex < partCount - 1) {
    return part.length;
  }
  return docOffsetInPart;
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
  const probeWires = new Set(listEmbeddedBlankBandProbeWires(doc));
  let rendered = 0;
  let wireCursor = 0;
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
      rendered += countWireTextDomChildren(node.text, {
        wireBase: wireCursor,
        blankProbeWires: probeWires,
      });
      wireCursor += node.text.length;
    } else {
      rendered++;
      wireCursor += mentionWireLength(node.agentId);
    }
  }
  return rendered;
}

/** Caret on a wire-break: blank-band anchor unless empty content row end (§53 Rule 4 + §69 chip). */
function domPointAfterWireBreak(
  root: HTMLElement,
  breakChildIdx: number,
  options?: {
    doc?: HandoffNoteDoc;
    breakWire?: number;
    blankBandDelete?: HandoffBlankBandDeleteOptions;
  }
): { node: Node; offset: number } {
  const br = root.childNodes[breakChildIdx];
  if (!(br instanceof HTMLBRElement && isHandoffWireBreakElement(br))) {
    return { node: root, offset: breakChildIdx };
  }
  const anchor = root.childNodes[breakChildIdx + 1];
  if (
    isHandoffBlankAnchorElement(anchor) &&
    options?.doc !== undefined &&
    options.breakWire !== undefined &&
    embeddedBlankBandAtEmptyContentRowEnd(options.doc, options.breakWire, options.blankBandDelete)
  ) {
    return { node: br, offset: 0 };
  }
  if (isHandoffBlankAnchorElement(anchor)) {
    const text = anchor.firstChild;
    if (text?.nodeType === Node.TEXT_NODE) {
      return { node: text, offset: 0 };
    }
  }
  return { node: br, offset: 0 };
}

function domPointAfterTextWireBreak(
  root: HTMLElement,
  breakChildIdx: number,
  text: string,
  wireBase: number,
  partIndex: number,
  doc: HandoffNoteDoc,
  blankBandDelete?: HandoffBlankBandDeleteOptions
): { node: Node; offset: number } {
  return domPointAfterWireBreak(root, breakChildIdx, {
    doc,
    breakWire: wireOffsetAtTextBreak(text, wireBase, partIndex),
    blankBandDelete,
  });
}

function advancePastWireBreakDom(root: HTMLElement, childIdx: number): number {
  let next = childIdx + 1;
  const anchor = root.childNodes[next];
  if (isHandoffBlankAnchorElement(anchor)) {
    next++;
  }
  return next;
}

function resolveTextDomPointAtOffset(
  root: HTMLElement,
  text: string,
  nodeOffset: number,
  domStartChildIndex: number,
  options: {
    doc: HandoffNoteDoc;
    docEndsWithNewline: boolean;
    isLastRenderedNode: boolean;
    wireBase: number;
    blankProbeWires: ReadonlySet<number>;
    blankBandDelete?: HandoffBlankBandDeleteOptions;
  }
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
          return {
            node: domNode,
            offset: domOffsetForContentRowEndInSplitText(remaining, part, partIndex, parts.length),
          };
        }
      }
      if (remaining === part.length && partIndex < parts.length - 1) {
        if (part) {
          childIdx++;
        }
        return domPointAfterTextWireBreak(
          root,
          childIdx,
          text,
          options.wireBase,
          partIndex,
          options.doc,
          options.blankBandDelete
        );
      }
      if (part === "" && remaining === 0) {
        return domPointAfterTextWireBreak(
          root,
          childIdx,
          text,
          options.wireBase,
          partIndex,
          options.doc,
          options.blankBandDelete
        );
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
        return domPointAfterTextWireBreak(
          root,
          childIdx,
          text,
          options.wireBase,
          partIndex,
          options.doc,
          options.blankBandDelete
        );
      }
      remaining -= 1;
      childIdx = advancePastWireBreakDom(root, childIdx);
    }
  }

  if (options.docEndsWithNewline && options.isLastRenderedNode && text.endsWith("\n")) {
    const padChild = root.childNodes[root.childNodes.length - 1];
    if (padChild instanceof HTMLBRElement && isHandoffLinePadElement(padChild)) {
      return { node: padChild, offset: 0 };
    }
    return domPointAfterWireBreak(root, root.childNodes.length - 1, {
      doc: options.doc,
      breakWire: options.wireBase + text.length - 1,
      blankBandDelete: options.blankBandDelete,
    });
  }

  const domNode = root.childNodes[childIdx - 1] ?? root.childNodes[domStartChildIndex];
  if (domNode?.nodeType === Node.TEXT_NODE) {
    return { node: domNode, offset: domNode.textContent?.length ?? 0 };
  }
  return domPointAfterWireBreak(root, childIdx, {
    doc: options.doc,
    breakWire: options.wireBase + Math.max(0, clamped - 1),
    blankBandDelete: options.blankBandDelete,
  });
}

function docPosAtPrecedingWireBreak(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  anchor: HTMLSpanElement
): HandoffNoteDocPos | null {
  const br = anchor.previousSibling;
  if (!(br instanceof HTMLBRElement) || !isHandoffWireBreakElement(br)) {
    return null;
  }
  for (let childIdx = 0; childIdx < root.childNodes.length; childIdx++) {
    if (root.childNodes[childIdx] !== br) {
      continue;
    }
    const atBreak = docPosFromRootDomChildIndex(root, doc, childIdx);
    return atBreak;
  }
  return null;
}

function docPosFromRootDomChildIndex(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  targetChildIndex: number
): HandoffNoteDocPos {
  const targetNode = root.childNodes[targetChildIndex];
  if (isHandoffBlankAnchorElement(targetNode)) {
    return (
      docPosAtPrecedingWireBreak(root, doc, targetNode) ??
      wireOffsetToDocPos(doc, docToWire(doc).length)
    );
  }

  const wire = docToWire(doc);
  const docEndsWithNewline = wire.endsWith("\n");
  const probeWires = new Set(listEmbeddedBlankBandProbeWires(doc));
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
    const nodeWireBase = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
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
        const breakWire = wireOffsetAtTextBreak(text, nodeWireBase, partIndex);
        if (probeWires.has(breakWire)) {
          if (domIdx === targetChildIndex) {
            return { nodeIndex, nodeOffset };
          }
          domIdx++;
        }
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

    const blankAnchorParent = container.parentNode;
    if (isHandoffBlankAnchorElement(blankAnchorParent)) {
      return (
        docPosAtPrecedingWireBreak(root, doc, blankAnchorParent) ?? {
          nodeIndex: 0,
          nodeOffset: 0,
        }
      );
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
    const probeWires = new Set(listEmbeddedBlankBandProbeWires(doc));
    const wireBase = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex]!;
      const textChild = root.childNodes[childIdx];
      if (textChild === container) {
        return {
          nodeIndex,
          nodeOffset: docOffsetFromContentTextNodeDomPoint(
            nodeOffset,
            offset,
            part,
            partIndex,
            parts.length
          ),
        };
      }
      if (part) {
        nodeOffset += part.length;
        childIdx++;
      }
      if (partIndex < parts.length - 1) {
        childIdx++;
        nodeOffset += 1;
        const breakWire = wireOffsetAtTextBreak(node.text, wireBase, partIndex);
        if (probeWires.has(breakWire)) {
          const anchorChild = root.childNodes[childIdx];
          if (isHandoffBlankAnchorElement(anchorChild) && anchorChild.contains(container)) {
            return { nodeIndex, nodeOffset };
          }
          childIdx++;
        }
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

  if (isHandoffBlankAnchorElement(container)) {
    return (
      docPosAtPrecedingWireBreak(root, doc, container) ?? {
        nodeIndex: 0,
        nodeOffset: 0,
      }
    );
  }

  return domPointToDocPos(root, doc, container.parentNode ?? root, 0);
}

export function resolveDomPointAtDocPos(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  options?: HandoffBlankBandDeleteOptions
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
      doc,
      docEndsWithNewline: docWireEndsWithNewline(doc),
      isLastRenderedNode: isLastRenderedDocNode(doc, normalized.nodeIndex),
      wireBase: docPosToWireOffset(doc, { nodeIndex: normalized.nodeIndex, nodeOffset: 0 }),
      blankProbeWires: new Set(listEmbeddedBlankBandProbeWires(doc)),
      blankBandDelete: options,
    });
  }

  const tokenLength = mentionWireLength(node.agentId);
  if (normalized.nodeOffset <= 0) {
    return { node: root, offset: renderedIndex };
  }
  if (normalized.nodeOffset >= tokenLength) {
    const afterRendered = renderedIndex + 1;
    if (afterRendered < root.childNodes.length) {
      const nextDom = root.childNodes[afterRendered]!;
      if (nextDom.nodeType === Node.TEXT_NODE) {
        if (isHandoffBlankAnchorElement(nextDom.parentNode)) {
          return { node: root, offset: afterRendered };
        }
        return { node: nextDom, offset: 0 };
      }
    }
    return { node: root, offset: afterRendered };
  }
  const pillTextNode = domNode.firstChild;
  if (pillTextNode?.nodeType === Node.TEXT_NODE) {
    const pillText = pillTextNode as Text;
    const pillOffset = normalized.nodeOffset - 1;
    return {
      node: pillText,
      offset: Math.max(0, Math.min(pillOffset, pillText.length)),
    };
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

  if (point.node instanceof HTMLBRElement && isHandoffWireBreakElement(point.node)) {
    const breakRect = point.node.getBoundingClientRect();
    if (hasPositionedDomRect(breakRect)) {
      return breakRect;
    }
  }

  const range = root.ownerDocument.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);

  if (typeof range.getClientRects === "function") {
    const rects = range.getClientRects();
    if (rects.length > 0) {
      const rect = rects[0]!;
      if (hasPositionedDomRect(rect)) {
        return rect;
      }
    }
  }

  if (typeof range.getBoundingClientRect === "function") {
    const rect = range.getBoundingClientRect();
    if (hasPositionedDomRect(rect)) {
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

/** Append layout samples at each rendered text line (soft-wrap fragments). */
export function appendSoftWrapLineSamples(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  measured: { wire: number; top: number; left: number }[]
): void {
  const seen = new Set(measured.map((sample) => sample.wire));

  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex];
    if (node?.type !== "text" || node.text.length === 0 || node.text.includes("\n")) {
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
      if (seen.has(wire) || isEmbeddedBlankBandProbeWire(doc, wire)) {
        continue;
      }
      seen.add(wire);
      measured.push({ wire, top: midY, left: rect.left });
    }
  }
}
