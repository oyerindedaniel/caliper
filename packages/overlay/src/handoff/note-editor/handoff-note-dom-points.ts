import {
  describeHandoffNoteCursorContext,
  docPosToWireOffset,
  docToWire,
  docPosAtEmbeddedBlankBandProbeAliasLanding,
  embeddedBlankBandAtEmptyContentRowEnd,
  embeddedBlankBandSubstantiveContentAbutsProbe,
  isEmbeddedBlankBandDeleteProbeWire,
  isEmbeddedBlankBandProbeWire,
  listEmbeddedBlankBandProbeWires,
  normalizeDocPos,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
} from "@caliper/core";
import {
  buildRenderedNodeIndexMap,
  countWireTextDomChildren,
  docWireEndsWithNewline,
  HANDOFF_MENTION_ATTR,
  isHandoffBlankAnchorElement,
  isHandoffLinePadElement,
  isHandoffMentionElement,
  isHandoffWireBreakElement,
  mentionWireLength,
  readMentionNodeIndex,
  wireOffsetAtTextBreak,
} from "./handoff-note-dom.js";

function isEditorNode(root: HTMLElement, node: Node): boolean {
  return node === root || root.contains(node);
}

/** `<br>` and collapsed ranges often report 0×0 while still carrying a paint position. */
export function hasPositionedDomRect(rect: DOMRect): boolean {
  return Number.isFinite(rect.top) && Number.isFinite(rect.left);
}

export function isFiniteMeasuredLayoutCoord(coord: { top: number; left: number }): boolean {
  return Number.isFinite(coord.top) && Number.isFinite(coord.left);
}

/** Reject collapsed root fallbacks that poison layout acquire caches. */
export function isUsableMeasuredLayoutCoord(coord: { top: number; left: number }): boolean {
  return isFiniteMeasuredLayoutCoord(coord) && !(coord.top === 0 && coord.left === 0);
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

/** Browser trailing edge on a split wire-text part before the next `\n`. Contract: `handoff-note-arrow-contract.md` — click ingress, Rule 4 (text-node tail ownership). */
export function isContentTextNodeDomTailBeforeBreak(
  domOffset: number,
  part: string,
  partIndex: number,
  partCount: number
): boolean {
  if (domOffset !== part.length || partIndex >= partCount - 1) {
    return false;
  }
  if (part.length > 1) {
    return true;
  }
  return /^\s+$/.test(part);
}

/**
 * Rule 4 — read path (`handoff-note-arrow-contract.md`, click ingress): text-node tail belongs to
 * content row end, not the following `\n`. Blank-band probe wires come only from blank
 * infrastructure DOM, not content text tails.
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

/** Rule 4 — write path (`handoff-note-arrow-contract.md`, click ingress): content row end renders at the browser text-node tail before a break. */
export function domOffsetForContentRowEndInSplitText(
  docOffsetInPart: number,
  part: string,
  partIndex: number,
  partCount: number
): number {
  if (docOffsetInPart === part.length - 1 && part.length > 1 && partIndex < partCount - 1) {
    return part.length;
  }
  if (docOffsetInPart === 0 && /^\s+$/.test(part) && partIndex < partCount - 1) {
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

/** Caret on a wire-break: blank-band anchor unless empty content row end (Rule 4 + content row chip; `handoff-note-arrow-contract.md`). */
function domPointAfterWireBreak(
  root: HTMLElement,
  breakChildIdx: number,
  options?: {
    doc?: HandoffNoteDoc;
    breakWire?: number;
    /** Authority doc pos — required to disambiguate cleared sandwiched row end from delete-probe paint. */
    focusDocPos?: HandoffNoteDocPos;
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
    embeddedBlankBandAtEmptyContentRowEnd(options.doc, options.breakWire, options.focusDocPos)
  ) {
    return { node: br, offset: 0 };
  }
  if (
    isHandoffBlankAnchorElement(anchor) &&
    options?.doc !== undefined &&
    options.breakWire !== undefined &&
    options.focusDocPos !== undefined &&
    isEmbeddedBlankBandProbeWire(options.doc, options.breakWire) &&
    !isEmbeddedBlankBandDeleteProbeWire(options.doc, options.breakWire, options.focusDocPos)
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
  focusDocPos: HandoffNoteDocPos
): { node: Node; offset: number } {
  return domPointAfterWireBreak(root, breakChildIdx, {
    doc,
    breakWire: wireOffsetAtTextBreak(text, wireBase, partIndex),
    focusDocPos,
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
    focusDocPos: HandoffNoteDocPos;
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
          options.focusDocPos
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
          options.focusDocPos
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
          options.focusDocPos
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
      focusDocPos: options.focusDocPos,
    });
  }

  const domNode = root.childNodes[childIdx - 1] ?? root.childNodes[domStartChildIndex];
  if (domNode?.nodeType === Node.TEXT_NODE) {
    return { node: domNode, offset: domNode.textContent?.length ?? 0 };
  }
  return domPointAfterWireBreak(root, childIdx, {
    doc: options.doc,
    breakWire: options.wireBase + Math.max(0, clamped - 1),
    focusDocPos: options.focusDocPos,
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

function docPosAtProbeAliasWhenSubstantiveAbuts(
  doc: HandoffNoteDoc,
  breakWire: number
): HandoffNoteDocPos | null {
  if (!embeddedBlankBandSubstantiveContentAbutsProbe(doc, breakWire)) {
    return null;
  }
  return docPosAtEmbeddedBlankBandProbeAliasLanding(doc, breakWire);
}

function docPosFromRootDomChildIndex(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  targetChildIndex: number
): HandoffNoteDocPos {
  const targetNode = root.childNodes[targetChildIndex];
  if (!targetNode) {
    return wireOffsetToDocPos(doc, docToWire(doc).length);
  }
  if (isHandoffWireBreakElement(targetNode)) {
    const prevDom = targetChildIndex > 0 ? root.childNodes[targetChildIndex - 1] : null;
    const nextDom = targetNode.nextSibling;
    if (
      prevDom &&
      isHandoffMentionElement(prevDom) &&
      nextDom &&
      isHandoffBlankAnchorElement(nextDom)
    ) {
      const mentionIdx = domNodeToDocIndex(root, doc, prevDom);
      const agentId = prevDom.getAttribute("data-agent-id") ?? "";
      if (mentionIdx !== null) {
        const mentionEndWire = docPosToWireOffset(doc, {
          nodeIndex: mentionIdx,
          nodeOffset: mentionWireLength(agentId),
        });
        const alias = docPosAtProbeAliasWhenSubstantiveAbuts(doc, mentionEndWire);
        if (alias) {
          return alias;
        }
      }
    }
  }
  if (isHandoffBlankAnchorElement(targetNode)) {
    const brDom = targetChildIndex > 0 ? root.childNodes[targetChildIndex - 1] : null;
    const mentionDom = targetChildIndex > 1 ? root.childNodes[targetChildIndex - 2] : null;
    if (
      brDom &&
      isHandoffWireBreakElement(brDom) &&
      mentionDom &&
      isHandoffMentionElement(mentionDom)
    ) {
      const mentionIdx = domNodeToDocIndex(root, doc, mentionDom);
      const agentId = mentionDom.getAttribute("data-agent-id") ?? "";
      if (mentionIdx !== null) {
        const mentionEndWire = docPosToWireOffset(doc, {
          nodeIndex: mentionIdx,
          nodeOffset: mentionWireLength(agentId),
        });
        const alias = docPosAtProbeAliasWhenSubstantiveAbuts(doc, mentionEndWire);
        if (alias) {
          return alias;
        }
      }
    }
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
    const focusWire = docPosToWireOffset(doc, normalized);
    const caretContext = describeHandoffNoteCursorContext(doc, focusWire);
    const nextDocNode = doc.nodes[normalized.nodeIndex + 1];
    if (
      caretContext.kind === "mention-boundary" &&
      caretContext.edge === "start" &&
      nextDocNode?.type === "mention" &&
      normalized.nodeOffset >= node.text.length
    ) {
      const mentionRendered = docPosToRenderedDomChildIndex(doc, normalized.nodeIndex + 1);
      return { node: root, offset: mentionRendered };
    }
    return resolveTextDomPointAtOffset(root, node.text, normalized.nodeOffset, renderedIndex, {
      doc,
      docEndsWithNewline: docWireEndsWithNewline(doc),
      isLastRenderedNode: isLastRenderedDocNode(doc, normalized.nodeIndex),
      wireBase: docPosToWireOffset(doc, { nodeIndex: normalized.nodeIndex, nodeOffset: 0 }),
      blankProbeWires: new Set(listEmbeddedBlankBandProbeWires(doc)),
      focusDocPos: normalized,
    });
  }

  const tokenLength = mentionWireLength(node.agentId);
  if (normalized.nodeOffset <= 0) {
    return { node: root, offset: renderedIndex };
  }
  if (normalized.nodeOffset >= tokenLength) {
    const afterRendered = renderedIndex + 1;
    const postText = doc.nodes[normalized.nodeIndex + 1];
    const abuttingProbe =
      postText?.type === "text"
        ? listEmbeddedBlankBandProbeWires(doc).find((probe) =>
            embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)
          )
        : undefined;
    if (abuttingProbe !== undefined) {
      return { node: root, offset: afterRendered };
    }
    if (afterRendered < root.childNodes.length) {
      const nextDom = root.childNodes[afterRendered]!;
      if (nextDom.nodeType === Node.TEXT_NODE) {
        if (isHandoffBlankAnchorElement(nextDom.parentNode)) {
          return { node: root, offset: afterRendered };
        }
        const postText = doc.nodes[normalized.nodeIndex + 1];
        if (postText?.type === "text" && postText.text.includes("\n")) {
          const parts = postText.text.split("\n");
          const firstPart = parts[0] ?? "";
          if (parts.length > 1 && /^\s+$/.test(firstPart)) {
            const wireBase = docPosToWireOffset(doc, {
              nodeIndex: normalized.nodeIndex + 1,
              nodeOffset: 0,
            });
            const breakWire = wireOffsetAtTextBreak(postText.text, wireBase, 0);
            if (isEmbeddedBlankBandProbeWire(doc, breakWire)) {
              return { node: nextDom, offset: firstPart.length };
            }
          }
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

/**
 * Pill atomicity by painted column: goal strictly inside pill bbox → left half start, right half end.
 * Same rule for vertical up and down.
 */
export function wireOffsetForPillHalfSplitColumn(
  goalColumn: number,
  pillLeft: number,
  pillRight: number,
  startWire: number,
  endWire: number,
  tolerance = 0
): number | null {
  if (goalColumn <= pillLeft + tolerance || goalColumn >= pillRight - tolerance) {
    return null;
  }
  const mid = (pillLeft + pillRight) / 2;
  return goalColumn < mid ? startWire : endWire;
}

/** DOM-painted pills on a visual row band — half-split landing before caret probe. */
export function resolveDomPillBoundaryPosForGoalColumn(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  goalColumn: number,
  rowTop: number,
  rowBandTolerance: number,
  goalColumnTolerance: number
): HandoffNoteDocPos | null {
  const pills = root.querySelectorAll<HTMLSpanElement>(`span[${HANDOFF_MENTION_ATTR}]`);
  for (const pill of pills) {
    const rect = pill.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (Math.abs(midY - rowTop) > rowBandTolerance) {
      continue;
    }
    const nodeIndex = readMentionNodeIndex(pill);
    if (nodeIndex === null) {
      continue;
    }
    const agentId = pill.getAttribute("data-agent-id") ?? "";
    const startWire = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
    const endWire = docPosToWireOffset(doc, {
      nodeIndex,
      nodeOffset: mentionWireLength(agentId),
    });
    const landingWire = wireOffsetForPillHalfSplitColumn(
      goalColumn,
      rect.left,
      rect.right,
      startWire,
      endWire,
      goalColumnTolerance
    );
    if (landingWire !== null) {
      return wireOffsetToDocPos(doc, landingWire);
    }
  }
  return null;
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

function probeColumnsForLayoutRect(rect: DOMRect): number[] {
  const insetLeft = rect.left + Math.min(2, Math.max(0, rect.width / 2));
  const mid = rect.left + rect.width / 2;
  return insetLeft === mid ? [insetLeft] : [insetLeft, mid];
}

function textRangeExclusiveEndOffset(node: Text, pointOffset: number): number {
  return Math.min(pointOffset + 1, node.length);
}

/** DOM-measured samples from each painted fragment of a substantive embedded-newline wire run. */
export function appendMeasuredSamplesFromWireRange(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  startWire: number,
  endWireExclusive: number,
  measured: { wire: number; top: number; left: number }[],
  seen: Set<number>
): number {
  if (startWire >= endWireExclusive) {
    return 0;
  }

  const startPoint = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, startWire));
  const endPoint = resolveDomPointAtDocPos(
    root,
    doc,
    wireOffsetToDocPos(doc, endWireExclusive - 1)
  );
  if (!startPoint || !endPoint) {
    return 0;
  }

  const range = root.ownerDocument.createRange();
  try {
    range.setStart(startPoint.node, startPoint.offset);
    if (endPoint.node.nodeType === Node.TEXT_NODE) {
      range.setEnd(
        endPoint.node,
        textRangeExclusiveEndOffset(endPoint.node as Text, endPoint.offset)
      );
    } else {
      range.setEnd(endPoint.node, endPoint.offset);
    }
  } catch {
    return 0;
  }

  const rects = typeof range.getClientRects === "function" ? [...range.getClientRects()] : [];
  let added = 0;

  for (const rect of rects) {
    if (rect.width <= 0 && rect.height <= 0) {
      continue;
    }
    const midY = rect.top + rect.height / 2;
    for (const probeX of probeColumnsForLayoutRect(rect)) {
      const probed =
        probeDocPosAtVisualColumn(root, doc, midY, probeX) ??
        probeDocPosAtVisualColumn(root, doc, rect.top, probeX);
      if (!probed) {
        continue;
      }
      const wire = docPosToWireOffset(doc, probed);
      if (isEmbeddedBlankBandProbeWire(doc, wire)) {
        continue;
      }
      const sample = { wire, top: midY, left: rect.left };
      if (!isUsableMeasuredLayoutCoord(sample)) {
        continue;
      }
      const existingIndex = measured.findIndex((entry) => entry.wire === wire);
      if (existingIndex >= 0) {
        measured[existingIndex] = sample;
        seen.add(wire);
        added++;
        continue;
      }
      if (seen.has(wire)) {
        continue;
      }
      seen.add(wire);
      measured.push(sample);
      added++;
    }
  }

  return added;
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
      const sample = { wire, top: midY, left: rect.left };
      if (!isUsableMeasuredLayoutCoord(sample)) {
        continue;
      }
      seen.add(wire);
      measured.push(sample);
    }
  }
}
