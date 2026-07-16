import {
  describeHandoffNoteCursorContext,
  docPosEqual,
  docPosToWireOffset,
  docToWire,
  docPosAtEmbeddedBlankBandProbeAliasLanding,
  embeddedBlankBandAtEmptyContentRowEnd,
  embeddedBlankBandSubstantiveContentAbutsProbe,
  isEmbeddedBlankBandDeleteProbeWire,
  isEmbeddedBlankBandProbeWire,
  listEmbeddedBlankBandProbeWires,
  nodeTokenLength,
  normalizeDocPos,
  wireOffsetToDocPos,
  type HandoffNoteArrowDirection,
  type HandoffNoteCursorContext,
  type HandoffNoteDoc,
  type HandoffNoteDocPos,
  isAtomicNode,
} from "@caliper/core";
import {
  buildRenderedNodeIndexMap,
  countWireTextDomChildren,
  docWireEndsWithNewline,
  isHandoffBlankAnchorElement,
  isHandoffLinePadElement,
  isHandoffLineStartAnchorElement,
  isHandoffMentionElement,
  isHandoffWireBreakElement,
  iterWireTextDomSlots,
  mentionWireLength,
  wireOffsetAtTextBreak,
} from "./handoff-note-dom.js";
import { isCrossRowSpacerAndPillDom } from "./handoff-note-row-geometry.js";
import { logHorArrow } from "../handoff-note-debug.js";

/** Layout acquire sample shape (matches layout-map `MeasuredWireOffset`; not imported — cycle). */
type DomMeasuredWireOffset = { wire: number; top: number; left: number; right?: number };

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
  // Insertion-point semantics: any non-empty part's text-node tail before a break is
  // content row end (last character) — including sole-char and whitespace-only parts.
  return domOffset === part.length && part.length > 0 && partIndex < partCount - 1;
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

/**
 * Rule 4 — write path (`handoff-note-arrow-contract.md`, click ingress): content row end
 * focuses the last character and paints at the browser text-node tail (insertion point
 * after that character) — including sole-char and whitespace-only parts. The following
 * `\n` always paints via the break path, never as a text-tail stand-in.
 */
export function domOffsetForContentRowEndInSplitText(
  docOffsetInPart: number,
  part: string,
  partIndex: number,
  partCount: number,
  focusAffinity?: "before" | "after"
): number {
  // Deletion-point / visual-start affinity: paint at the char, not text-tail.
  if (focusAffinity === "before") {
    return docOffsetInPart;
  }
  if (docOffsetInPart === part.length - 1 && part.length > 0 && partIndex < partCount - 1) {
    return part.length;
  }
  return docOffsetInPart;
}

/**
 * Doc position owning the character at a wire index — text-node offset when the wire
 * maps to text, otherwise falls back to wireOffsetToDocPos (mention boundaries).
 * Click/layout row-end uses this instead of mention-boundary alias normalization.
 * Paint/selection landing at a wire uses `resolvePaintContextAtWire` instead.
 */
export function docPosAtContentWire(doc: HandoffNoteDoc, wire: number): HandoffNoteDocPos {
  const wireLen = docToWire(doc).length;
  const clamped = Math.max(0, Math.min(wire, wireLen));
  let offset = 0;
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    const length = node.type === "text" ? node.text.length : 1 + node.agentId.length;
    if (clamped === offset) {
      return { nodeIndex, nodeOffset: 0 };
    }
    if (node.type === "text" && clamped > offset && clamped <= offset + length) {
      return { nodeIndex, nodeOffset: clamped - offset };
    }
    offset += length;
  }
  return wireOffsetToDocPos(doc, clamped);
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

/** Caret before a committed atom, outside the atom — line-start ZWSP when row starts after a break. */
function paintOutsideAtomicStart(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  atomicNodeIndex: number
): { node: Node; offset: number } {
  const renderedIndex = docPosToRenderedDomChildIndex(doc, atomicNodeIndex);
  const prev = renderedIndex > 0 ? root.childNodes[renderedIndex - 1] : null;
  if (isHandoffLineStartAnchorElement(prev)) {
    const text = prev.firstChild;
    if (text?.nodeType === Node.TEXT_NODE) {
      return { node: text, offset: 0 };
    }
  }
  return { node: root, offset: renderedIndex };
}

function docPosAtLineStartAnchor(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  anchor: HTMLSpanElement
): HandoffNoteDocPos | null {
  const nextDom = anchor.nextSibling;
  if (!nextDom) {
    return null;
  }
  const atomicIdx = domNodeToDocIndex(root, doc, nextDom);
  if (atomicIdx === null || !isAtomicNode(doc.nodes[atomicIdx])) {
    return null;
  }
  const prevNode = doc.nodes[atomicIdx - 1];
  if (prevNode?.type === "text") {
    return { nodeIndex: atomicIdx - 1, nodeOffset: prevNode.text.length };
  }
  return { nodeIndex: atomicIdx, nodeOffset: 0 };
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
        lineStartBeforeAtomic: isAtomicNode(doc.nodes[index + 1]),
      });
      wireCursor += node.text.length;
    } else if (isAtomicNode(node)) {
      rendered++;
      wireCursor += nodeTokenLength(node);
    }
  }
  return rendered;
}

/** Caret on a wire-break — sole owner of probe / cleared-row / blank-anchor paint with focus. */
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
    options.breakWire !== undefined
  ) {
    const doc = options.doc;
    const breakWire = options.breakWire;
    const focusDocPos = options.focusDocPos;
    const emptyRowEnd = embeddedBlankBandAtEmptyContentRowEnd(doc, breakWire, focusDocPos);
    const nonDeleteProbe =
      focusDocPos !== undefined &&
      isEmbeddedBlankBandProbeWire(doc, breakWire) &&
      !isEmbeddedBlankBandDeleteProbeWire(doc, breakWire, focusDocPos);
    if (emptyRowEnd || nonDeleteProbe) {
      return { node: br, offset: 0 };
    }
  }
  if (isHandoffBlankAnchorElement(anchor)) {
    const text = anchor.firstChild;
    if (text?.nodeType === Node.TEXT_NODE) {
      return { node: text, offset: 0 };
    }
  }
  // Row-start ZWSP is paint for atom-start (`paintOutsideAtomicStart`), not for the
  // break wire itself — break focus stays on `<br>` (layout geom + live/authority parity).
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
  if (isHandoffBlankAnchorElement(anchor) || isHandoffLineStartAnchorElement(anchor)) {
    next++;
  }
  return next;
}

function domPointAtTextNodeWireBreak(
  root: HTMLElement,
  childIdx: number,
  text: string,
  wireBase: number,
  partIndex: number,
  doc: HandoffNoteDoc,
  focusDocPos: HandoffNoteDocPos
): { node: Node; offset: number } {
  return domPointAfterTextWireBreak(root, childIdx, text, wireBase, partIndex, doc, focusDocPos);
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
    focusDocPos: HandoffNoteDocPos;
    focusAffinity?: "before" | "after";
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
            offset: domOffsetForContentRowEndInSplitText(
              remaining,
              part,
              partIndex,
              parts.length,
              options.focusAffinity
            ),
          };
        }
      }
      const atWireBreak =
        (remaining === part.length && partIndex < parts.length - 1) ||
        (part === "" && remaining === 0);
      if (atWireBreak) {
        // Break wire always paints via domPointAfterWireBreak (BR / blank / line-start).
        // Rule 4 content-row-end is the last character of the part (branch above), not this `\n`.
        if (remaining === part.length && part) {
          childIdx++;
        }
        return domPointAtTextNodeWireBreak(
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
        return domPointAtTextNodeWireBreak(
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

function docPosAtMentionEndProbeAlias(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  mentionDom: HTMLSpanElement
): HandoffNoteDocPos | null {
  const mentionIdx = domNodeToDocIndex(root, doc, mentionDom);
  if (mentionIdx === null) {
    return null;
  }
  const agentId = mentionDom.getAttribute("data-agent-id") ?? "";
  const mentionEndWire = docPosToWireOffset(doc, {
    nodeIndex: mentionIdx,
    nodeOffset: mentionWireLength(agentId),
  });
  return docPosAtProbeAliasWhenSubstantiveAbuts(doc, mentionEndWire);
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
      const alias = docPosAtMentionEndProbeAlias(root, doc, prevDom);
      if (alias) {
        return alias;
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
      const alias = docPosAtMentionEndProbeAlias(root, doc, mentionDom);
      if (alias) {
        return alias;
      }
    }
    return (
      docPosAtPrecedingWireBreak(root, doc, targetNode) ??
      wireOffsetToDocPos(doc, docToWire(doc).length)
    );
  }
  if (isHandoffLineStartAnchorElement(targetNode)) {
    return (
      docPosAtLineStartAnchor(root, doc, targetNode) ??
      wireOffsetToDocPos(doc, docToWire(doc).length)
    );
  }

  const wire = docToWire(doc);
  const docEndsWithNewline = wire.endsWith("\n");
  const probeWires = new Set(listEmbeddedBlankBandProbeWires(doc));
  let domIdx = 0;

  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    if (node.type === "text" && !node.text) {
      continue;
    }

    if (isAtomicNode(node)) {
      if (domIdx === targetChildIndex) {
        const prevDom = root.childNodes[targetChildIndex - 1];
        if (
          prevDom &&
          (isHandoffWireBreakElement(prevDom) || isHandoffLineStartAnchorElement(prevDom)) &&
          nodeIndex > 0
        ) {
          const prevNode = doc.nodes[nodeIndex - 1];
          if (prevNode?.type === "text") {
            return { nodeIndex: nodeIndex - 1, nodeOffset: prevNode.text.length };
          }
        }
        return { nodeIndex, nodeOffset: 0 };
      }
      domIdx++;
      continue;
    }

    const text = node.text;
    const nodeWireBase = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
    const next = doc.nodes[nodeIndex + 1];
    const wireTextOptions = {
      wireBase: nodeWireBase,
      blankProbeWires: probeWires,
      lineStartBeforeAtomic: isAtomicNode(next),
    };
    if (!text.includes("\n")) {
      if (domIdx === targetChildIndex) {
        return { nodeIndex, nodeOffset: 0 };
      }
      domIdx++;
      continue;
    }

    for (const slot of iterWireTextDomSlots(text, domIdx, wireTextOptions)) {
      if (slot.domIdx === targetChildIndex) {
        return { nodeIndex, nodeOffset: slot.nodeOffset };
      }
    }
    domIdx += countWireTextDomChildren(text, wireTextOptions);
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
        return { nodeIndex, nodeOffset: 1 };
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
    if (isHandoffLineStartAnchorElement(blankAnchorParent)) {
      return (
        docPosAtLineStartAnchor(root, doc, blankAnchorParent) ?? {
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
    const wireBase = docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 });
    const probeWires = new Set(listEmbeddedBlankBandProbeWires(doc));
    const next = doc.nodes[nodeIndex + 1];
    const wireTextOptions = {
      wireBase,
      blankProbeWires: probeWires,
      lineStartBeforeAtomic: isAtomicNode(next),
    };
    const partCount = node.text.split("\n").length;
    for (const slot of iterWireTextDomSlots(node.text, domStart, wireTextOptions)) {
      if (slot.kind === "text") {
        const textChild = root.childNodes[slot.domIdx];
        if (textChild === container) {
          return {
            nodeIndex,
            nodeOffset: docOffsetFromContentTextNodeDomPoint(
              slot.nodeOffset,
              offset,
              slot.part,
              slot.partIndex,
              partCount
            ),
          };
        }
      }
      if (slot.kind === "blank-anchor") {
        const anchorChild = root.childNodes[slot.domIdx];
        if (isHandoffBlankAnchorElement(anchorChild) && anchorChild.contains(container)) {
          return { nodeIndex, nodeOffset: slot.nodeOffset };
        }
      }
      if (slot.kind === "line-start-anchor") {
        const anchorChild = root.childNodes[slot.domIdx];
        if (isHandoffLineStartAnchorElement(anchorChild) && anchorChild.contains(container)) {
          return (
            docPosAtLineStartAnchor(root, doc, anchorChild) ?? {
              nodeIndex,
              nodeOffset: slot.nodeOffset,
            }
          );
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

export type DomPointReadOptions = {
  /** Prior authority doc pos — wins at same-wire alias seams on passive selection read. */
  from?: HandoffNoteDocPos;
};

/** Passive DOM read: when wire matches authority but owner differs, trust authority doc pos.
 * Also: paint may place the caret on the content text tail while authority sits on the
 * following non-probe `\n` (insert after last char). Click-ingress read of that tail is
 * the last-char wire — with authority `from`, keep the `\n` so typing does not go live-behind.
 */
export function resolveDomReadDocPos(
  doc: HandoffNoteDoc,
  read: HandoffNoteDocPos,
  authority?: HandoffNoteDocPos
): HandoffNoteDocPos {
  if (!authority) {
    return read;
  }
  if (read.nodeIndex === authority.nodeIndex && read.nodeOffset === authority.nodeOffset) {
    return read;
  }
  const readWire = docPosToWireOffset(doc, read);
  const authorityWire = docPosToWireOffset(doc, authority);
  if (readWire === authorityWire) {
    return authority;
  }
  if (isContentTextTailAliasOfNonProbeBreak(doc, readWire, authorityWire)) {
    return authority;
  }
  const authorityNode = doc.nodes[authority.nodeIndex];
  const readNode = doc.nodes[read.nodeIndex];
  if (
    authorityNode?.type === "mention" &&
    readNode?.type === "mention" &&
    authority.nodeIndex === read.nodeIndex
  ) {
    return authority;
  }
  return read;
}

/** True when `readWire` is the last content char and `authorityWire` is the following non-probe `\n`. */
function isContentTextTailAliasOfNonProbeBreak(
  doc: HandoffNoteDoc,
  readWire: number,
  authorityWire: number
): boolean {
  if (readWire !== authorityWire - 1) {
    return false;
  }
  const wire = docToWire(doc);
  if (authorityWire < 0 || authorityWire >= wire.length || wire[authorityWire] !== "\n") {
    return false;
  }
  if (isEmbeddedBlankBandProbeWire(doc, authorityWire)) {
    return false;
  }
  const ch = wire[readWire];
  return ch !== undefined && ch !== "\n";
}

export type HandoffNotePaintContext = {
  focusPos: HandoffNoteDocPos;
  paintPos: HandoffNoteDocPos;
  caretKind: HandoffNoteCursorContext["kind"];
};

function resolveCaretKindForPaintContext(
  doc: HandoffNoteDoc,
  focusPos: HandoffNoteDocPos,
  paintPos: HandoffNoteDocPos
): HandoffNoteCursorContext["kind"] {
  const focusNode = doc.nodes[focusPos.nodeIndex];
  if (focusNode?.type === "text") {
    return "text";
  }
  const paintNode = doc.nodes[paintPos.nodeIndex];
  if (paintNode?.type === "text") {
    return "text";
  }
  return describeHandoffNoteCursorContext(doc, docPosToWireOffset(doc, paintPos)).kind;
}

/** Canonical paint authority: focus doc pos, paint doc pos, and caret kind from paint wire. */
export function resolvePaintContext(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  options?: { root?: HTMLElement; from?: HandoffNoteDocPos }
): HandoffNotePaintContext {
  const wire = docPosToWireOffset(doc, focus);
  const focusPos = resolveFocusAtWire(doc, wire, { incoming: focus, from: options?.from });
  const paintPos = resolvePaintPosFromFocus(doc, focusPos, options);
  return {
    focusPos,
    paintPos,
    caretKind: resolveCaretKindForPaintContext(doc, focusPos, paintPos),
  };
}

/** Cursor kind from focus doc pos — text-node focus is always text; mention uses paint path. */
export function describeCaretContext(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  options?: { root?: HTMLElement }
): HandoffNoteCursorContext {
  const ctx = resolvePaintContext(doc, focus, options);
  if (ctx.caretKind === "text") {
    return { kind: "text" };
  }
  return describeHandoffNoteCursorContext(doc, docPosToWireOffset(doc, ctx.paintPos));
}

/**
 * Inter-atomic gap: leading atom | single-char spacer text | following atom.
 * Continuation is spacer offset 1 — same wire as following atomic start.
 */
const INTER_ATOMIC_FOLLOWING_OFFSET = 2;

/** Painted DOM element for an atomic node (mentions → pill span; other atoms extend here). */
export function atomicElement(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number
): HTMLElement | null {
  if (!isAtomicNode(doc.nodes[nodeIndex])) {
    return null;
  }
  const rendered = docPosToRenderedDomChildIndex(doc, nodeIndex);
  const domNode = root.childNodes[rendered];
  if (domNode && isHandoffMentionElement(domNode)) {
    return domNode;
  }
  return null;
}

/** Spacer-tail continuation when leading atom sandwiches a 1-char text before another atom. */
function interAtomicSpacerContinuationPos(
  doc: HandoffNoteDoc,
  leadingAtomicIndex: number
): HandoffNoteDocPos | null {
  if (!isAtomicNode(doc.nodes[leadingAtomicIndex])) {
    return null;
  }
  const spacerIndex = leadingAtomicIndex + 1;
  const followingAtomicIndex = leadingAtomicIndex + INTER_ATOMIC_FOLLOWING_OFFSET;
  const spacer = doc.nodes[spacerIndex];
  if (spacer?.type !== "text" || spacer.text.length !== 1) {
    return null;
  }
  if (!isAtomicNode(doc.nodes[followingAtomicIndex])) {
    return null;
  }
  const continuationPos: HandoffNoteDocPos = { nodeIndex: spacerIndex, nodeOffset: 1 };
  const followingStartPos: HandoffNoteDocPos = {
    nodeIndex: followingAtomicIndex,
    nodeOffset: 0,
  };
  if (docPosToWireOffset(doc, continuationPos) !== docPosToWireOffset(doc, followingStartPos)) {
    return null;
  }
  return continuationPos;
}

function continuationPosBeforeAtomicStart(
  doc: HandoffNoteDoc,
  followingAtomicIndex: number
): HandoffNoteDocPos | null {
  return interAtomicSpacerContinuationPos(
    doc,
    followingAtomicIndex - INTER_ATOMIC_FOLLOWING_OFFSET
  );
}

/** Same-wire paint via spacer tail only when spacer and following atom sit on different visual rows. */
function isCrossRowInterAtomicSpacerPaintAlias(
  doc: HandoffNoteDoc,
  followingAtomicIndex: number,
  root?: HTMLElement
): boolean {
  const leadingIndex = followingAtomicIndex - INTER_ATOMIC_FOLLOWING_OFFSET;
  const spacerIndex = leadingIndex + 1;
  const spacer = doc.nodes[spacerIndex];
  if (spacer?.type !== "text" || !/^\s+$/.test(spacer.text) || /[\n\r]/.test(spacer.text)) {
    return false;
  }
  if (!root) {
    return false;
  }
  const spacerRect = getDocAnchorRect(root, doc, { nodeIndex: spacerIndex, nodeOffset: 0 });
  const atomEl = atomicElement(root, doc, followingAtomicIndex);
  if (!spacerRect || !atomEl) {
    return false;
  }
  return isCrossRowSpacerAndPillDom(spacerRect, atomEl) === true;
}

/** Blank-band abut keeps atomic-end paint so DOM does not land on blank-anchor text. */
function blankBandKeepsAtomicEndPaint(doc: HandoffNoteDoc): boolean {
  return listEmbeddedBlankBandProbeWires(doc).some((probe) =>
    embeddedBlankBandSubstantiveContentAbutsProbe(doc, probe)
  );
}

/**
 * Same-wire paint aliases from focus:
 * - atomic start → cross-row inter-atomic spacer tail (when spacer/atom on different rows)
 * - atomic end → following text offset 0, unless blank-band substantive content abuts a probe
 *   (DOM must paint atomic end off blank infrastructure — same gate as resolveDomPointAtDocPos)
 */
function resolvePaintPosFromFocus(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  options?: { root?: HTMLElement }
): HandoffNoteDocPos {
  const node = doc.nodes[pos.nodeIndex];
  if (!isAtomicNode(node)) {
    return pos;
  }

  if (pos.nodeOffset === 0) {
    const continuation = continuationPosBeforeAtomicStart(doc, pos.nodeIndex);
    if (
      continuation &&
      docPosToWireOffset(doc, continuation) === docPosToWireOffset(doc, pos) &&
      isCrossRowInterAtomicSpacerPaintAlias(doc, pos.nodeIndex, options?.root)
    ) {
      return continuation;
    }
    return pos;
  }

  if (pos.nodeOffset !== atomicEndOffset(doc, pos.nodeIndex)) {
    return pos;
  }

  const postText = doc.nodes[pos.nodeIndex + 1];
  if (postText?.type !== "text") {
    return pos;
  }
  const textStart: HandoffNoteDocPos = { nodeIndex: pos.nodeIndex + 1, nodeOffset: 0 };
  if (docPosToWireOffset(doc, textStart) !== docPosToWireOffset(doc, pos)) {
    return pos;
  }
  if (blankBandKeepsAtomicEndPaint(doc)) {
    return pos;
  }
  return textStart;
}

export function resolvePaintDocPos(
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  options?: { root?: HTMLElement }
): HandoffNoteDocPos {
  return resolvePaintContext(doc, pos, options).paintPos;
}

function atomicEndOffset(doc: HandoffNoteDoc, nodeIndex: number): number {
  const node = doc.nodes[nodeIndex];
  if (!node || !isAtomicNode(node)) {
    return 0;
  }
  return nodeTokenLength(node);
}

function docPosAtAtomicEnd(doc: HandoffNoteDoc, nodeIndex: number): HandoffNoteDocPos {
  return { nodeIndex, nodeOffset: atomicEndOffset(doc, nodeIndex) };
}

function docPosAfterNode(doc: HandoffNoteDoc, nodeIndex: number): HandoffNoteDocPos {
  if (nodeIndex + 1 < doc.nodes.length) {
    return { nodeIndex: nodeIndex + 1, nodeOffset: 0 };
  }
  const node = doc.nodes[nodeIndex];
  if (node?.type === "text") {
    return { nodeIndex, nodeOffset: node.text.length };
  }
  return docPosAtAtomicEnd(doc, nodeIndex);
}

function docPosBeforeNode(doc: HandoffNoteDoc, nodeIndex: number): HandoffNoteDocPos {
  if (nodeIndex <= 0) {
    return { nodeIndex: 0, nodeOffset: 0 };
  }
  const prev = doc.nodes[nodeIndex - 1];
  if (prev?.type === "text") {
    const len = prev.text.length;
    return { nodeIndex: nodeIndex - 1, nodeOffset: len > 0 ? len : 0 };
  }
  return docPosAtAtomicEnd(doc, nodeIndex - 1);
}

function collectTextOwnersAtWire(doc: HandoffNoteDoc, wire: number): HandoffNoteDocPos[] {
  const owners: HandoffNoteDocPos[] = [];
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex];
    if (node?.type !== "text") {
      continue;
    }
    for (let nodeOffset = 0; nodeOffset <= node.text.length; nodeOffset++) {
      const pos = { nodeIndex, nodeOffset };
      if (docPosToWireOffset(doc, pos) === wire) {
        owners.push(pos);
      }
    }
  }
  return owners;
}

/**
 * Text tail between two adjacent atomic nodes on the same wire alias.
 * Gap text must stay on one storage line — newlines mean a new row prefix, not an inter-atomic gap.
 */
function isInterAtomicTextTail(
  doc: HandoffNoteDoc,
  textNodeIndex: number,
  pos: HandoffNoteDocPos
): boolean {
  const node = doc.nodes[textNodeIndex];
  if (node?.type !== "text" || pos.nodeOffset !== node.text.length) {
    return false;
  }
  if (/[\n\r]/.test(node.text)) {
    return false;
  }
  return isAtomicNode(doc.nodes[textNodeIndex - 1]) && isAtomicNode(doc.nodes[textNodeIndex + 1]);
}

function atomicStartPosAtWire(doc: HandoffNoteDoc, wire: number): HandoffNoteDocPos | null {
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    if (!isAtomicNode(doc.nodes[nodeIndex])) {
      continue;
    }
    if (docPosToWireOffset(doc, { nodeIndex, nodeOffset: 0 }) === wire) {
      return { nodeIndex, nodeOffset: 0 };
    }
  }
  return null;
}

/** Default doc owner at a wire when no incoming/from authority is supplied. */
function resolveCanonicalFocusAtWire(doc: HandoffNoteDoc, wire: number): HandoffNoteDocPos {
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    if (!isAtomicNode(doc.nodes[nodeIndex])) {
      continue;
    }
    const continuation = continuationPosBeforeAtomicStart(doc, nodeIndex);
    if (continuation && docPosToWireOffset(doc, continuation) === wire) {
      return continuation;
    }
  }

  const ctx = describeHandoffNoteCursorContext(doc, wire);
  const textOwners = collectTextOwnersAtWire(doc, wire);

  if (ctx.kind === "mention-boundary" && ctx.edge === "end") {
    const postAtomicText = textOwners.find((pos) => {
      const prev = doc.nodes[pos.nodeIndex - 1];
      return pos.nodeOffset === 0 && isAtomicNode(prev);
    });
    if (postAtomicText) {
      return postAtomicText;
    }
  }

  if (ctx.kind === "mention-boundary" && ctx.edge === "start") {
    const interAtomicTail = textOwners.find((pos) =>
      isInterAtomicTextTail(doc, pos.nodeIndex, pos)
    );
    if (interAtomicTail) {
      return interAtomicTail;
    }
    const atomicStart = atomicStartPosAtWire(doc, wire);
    if (atomicStart) {
      return atomicStart;
    }
  }

  if (ctx.kind === "mention-interior") {
    return wireOffsetToDocPos(doc, wire);
  }

  if (textOwners[0]) {
    return textOwners[0];
  }
  return wireOffsetToDocPos(doc, wire);
}

/** Paint/step focus at a wire — incoming/from authority wins; else canonical owner. */
function resolveFocusAtWire(
  doc: HandoffNoteDoc,
  wire: number,
  options?: { incoming?: HandoffNoteDocPos; from?: HandoffNoteDocPos }
): HandoffNoteDocPos {
  if (options?.from && docPosToWireOffset(doc, options.from) === wire) {
    return options.from;
  }
  if (options?.incoming && docPosToWireOffset(doc, options.incoming) === wire) {
    return options.incoming;
  }
  return resolveCanonicalFocusAtWire(doc, wire);
}

function predecessorTextBeforeAtomicStart(
  doc: HandoffNoteDoc,
  atomicNodeIndex: number
): HandoffNoteDocPos {
  const prev = doc.nodes[atomicNodeIndex - 1];
  if (prev?.type !== "text" || prev.text.length < 1) {
    return docPosBeforeNode(doc, atomicNodeIndex);
  }
  const focusPos = { nodeIndex: atomicNodeIndex, nodeOffset: 0 };
  const endPos = { nodeIndex: atomicNodeIndex - 1, nodeOffset: prev.text.length };
  const focusWire = docPosToWireOffset(doc, focusPos);
  const endWire = docPosToWireOffset(doc, endPos);
  // Text end aliases atomic start.
  if (endWire === focusWire) {
    // Inter-atomic gap: land on the gap tail (continuation) — same wire, doc owner change.
    if (isInterAtomicTextTail(doc, atomicNodeIndex - 1, endPos)) {
      return endPos;
    }
    // Prefix / row-leading text: step to the preceding char (different wire).
    return { nodeIndex: atomicNodeIndex - 1, nodeOffset: prev.text.length - 1 };
  }
  return endPos;
}

function tryIntraTextHorizontalStep(
  doc: HandoffNoteDoc,
  focusPos: HandoffNoteDocPos,
  direction: HandoffNoteArrowDirection
): HandoffNoteDocPos | null {
  const node = doc.nodes[focusPos.nodeIndex];
  if (node?.type !== "text") {
    return null;
  }
  const delta = direction === "left" ? -1 : 1;
  const nextOffset = focusPos.nodeOffset + delta;
  if (nextOffset >= 0 && nextOffset <= node.text.length) {
    return { nodeIndex: focusPos.nodeIndex, nodeOffset: nextOffset };
  }
  return null;
}

function resolveHorizontalDocSuccessor(
  doc: HandoffNoteDoc,
  focusPos: HandoffNoteDocPos
): HandoffNoteDocPos | null {
  const intra = tryIntraTextHorizontalStep(doc, focusPos, "right");
  if (intra && !docPosEqual(intra, focusPos)) {
    return intra;
  }

  const node = doc.nodes[focusPos.nodeIndex];
  const wire = docPosToWireOffset(doc, focusPos);
  const ctx = describeHandoffNoteCursorContext(doc, wire);

  if (isAtomicNode(node)) {
    if (ctx.kind === "mention-interior") {
      return docPosAfterNode(doc, focusPos.nodeIndex);
    }
    if (ctx.kind === "mention-boundary") {
      if (ctx.edge === "start") {
        return docPosAtAtomicEnd(doc, focusPos.nodeIndex);
      }
      return docPosAfterNode(doc, focusPos.nodeIndex);
    }
  }

  if (node?.type === "text") {
    if (focusPos.nodeOffset >= node.text.length) {
      const after = docPosAfterNode(doc, focusPos.nodeIndex);
      // Pill is one horizontal token: do not micro-stop at following atomic start (same wire).
      if (after && isAtomicNode(doc.nodes[after.nodeIndex]) && after.nodeOffset === 0) {
        return docPosAfterNode(doc, after.nodeIndex) ?? docPosAtAtomicEnd(doc, after.nodeIndex);
      }
      return after;
    }
    if (focusPos.nodeOffset === 0 && isAtomicNode(doc.nodes[focusPos.nodeIndex - 1])) {
      if (node.text.length > 0) {
        return { nodeIndex: focusPos.nodeIndex, nodeOffset: 1 };
      }
      const next = doc.nodes[focusPos.nodeIndex + 1];
      if (isAtomicNode(next)) {
        return { nodeIndex: focusPos.nodeIndex + 1, nodeOffset: 0 };
      }
    }
  }

  const nextWire = wire + 1;
  if (nextWire > docToWire(doc).length) {
    return null;
  }
  return resolveCanonicalFocusAtWire(doc, nextWire);
}

function resolveHorizontalDocPredecessor(
  doc: HandoffNoteDoc,
  focusPos: HandoffNoteDocPos
): HandoffNoteDocPos | null {
  const intra = tryIntraTextHorizontalStep(doc, focusPos, "left");
  if (intra && !docPosEqual(intra, focusPos)) {
    return intra;
  }

  const node = doc.nodes[focusPos.nodeIndex];
  const wire = docPosToWireOffset(doc, focusPos);
  const ctx = describeHandoffNoteCursorContext(doc, wire);

  if (isAtomicNode(node)) {
    if (ctx.kind === "mention-interior") {
      return { nodeIndex: focusPos.nodeIndex, nodeOffset: 0 };
    }
    if (ctx.kind === "mention-boundary") {
      if (ctx.edge === "end") {
        return { nodeIndex: focusPos.nodeIndex, nodeOffset: 0 };
      }
      return predecessorTextBeforeAtomicStart(doc, focusPos.nodeIndex);
    }
  }

  if (node?.type === "text" && focusPos.nodeOffset === 0) {
    if (isAtomicNode(doc.nodes[focusPos.nodeIndex - 1])) {
      return { nodeIndex: focusPos.nodeIndex - 1, nodeOffset: 0 };
    }
    return docPosBeforeNode(doc, focusPos.nodeIndex);
  }

  const prevWire = wire - 1;
  if (prevWire < 0) {
    return null;
  }
  return resolveCanonicalFocusAtWire(doc, prevWire);
}

function resolveHorizontalDocStep(
  doc: HandoffNoteDoc,
  focusPos: HandoffNoteDocPos,
  direction: HandoffNoteArrowDirection
): HandoffNoteDocPos | null {
  return direction === "right"
    ? resolveHorizontalDocSuccessor(doc, focusPos)
    : resolveHorizontalDocPredecessor(doc, focusPos);
}

/** Paint authority for a wire offset — focus and paint after alias seams. */
export function resolvePaintContextAtWire(
  doc: HandoffNoteDoc,
  wire: number,
  options?: { root?: HTMLElement; from?: HandoffNoteDocPos }
): HandoffNotePaintContext {
  const focusPos = resolveFocusAtWire(doc, wire, { from: options?.from });
  return resolvePaintContext(doc, focusPos, options);
}

/** Thin alias of `resolvePaintContextAtWire(...).paintPos` for wire→paint import. */
export function docPosAtPaintWire(
  doc: HandoffNoteDoc,
  wire: number,
  options?: { root?: HTMLElement }
): HandoffNoteDocPos {
  return resolvePaintContextAtWire(doc, wire, options).paintPos;
}

function horPosSnapshot(doc: HandoffNoteDoc, pos: HandoffNoteDocPos): Record<string, unknown> {
  const node = doc.nodes[pos.nodeIndex];
  const wire = docPosToWireOffset(doc, pos);
  return {
    nodeIndex: pos.nodeIndex,
    nodeOffset: pos.nodeOffset,
    nodeType: node?.type ?? "missing",
    wire,
    cursorKind: describeHandoffNoteCursorContext(doc, wire).kind,
  };
}

export function resolvePaintHorizontalArrowMove(
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos,
  direction: HandoffNoteArrowDirection,
  options?: { root?: HTMLElement; from?: HandoffNoteDocPos }
): { pos: HandoffNoteDocPos; handled: boolean } {
  const paintCtx = resolvePaintContext(doc, focus, options);
  const { focusPos, paintPos } = paintCtx;
  const step = resolveHorizontalDocStep(doc, focusPos, direction);
  if (!step || docPosEqual(step, focusPos)) {
    logHorArrow("step", {
      direction,
      handled: false,
      reason: !step ? "nullStep" : "stepEqualsFocusPos",
      focusIn: horPosSnapshot(doc, focus),
      focusPos: horPosSnapshot(doc, focusPos),
      paintPos: horPosSnapshot(doc, paintPos),
    });
    return { pos: focus, handled: false };
  }
  const landed = normalizeDocPos(doc, step, { from: step });
  const paintLanded = resolvePaintContext(doc, landed, {
    root: options?.root,
    from: landed,
  }).paintPos;
  const selectionLand = normalizeDocPos(doc, paintLanded, { from: paintLanded });
  if (docPosEqual(selectionLand, focus)) {
    logHorArrow("step", {
      direction,
      handled: false,
      reason: "paintLandEqualsFocusIn",
      focusIn: horPosSnapshot(doc, focus),
      focusPos: horPosSnapshot(doc, focusPos),
      paintPos: horPosSnapshot(doc, paintPos),
      step: horPosSnapshot(doc, step),
      landed: horPosSnapshot(doc, landed),
      selectionLand: horPosSnapshot(doc, selectionLand),
    });
    return { pos: focus, handled: false };
  }
  const focusWire = docPosToWireOffset(doc, focusPos);
  const landWire = docPosToWireOffset(doc, selectionLand);
  logHorArrow("step", {
    direction,
    handled: true,
    sameWire: focusWire === landWire,
    focusIn: horPosSnapshot(doc, focus),
    focusPos: horPosSnapshot(doc, focusPos),
    paintPos: horPosSnapshot(doc, paintPos),
    step: horPosSnapshot(doc, step),
    landed: horPosSnapshot(doc, landed),
    selectionLand: horPosSnapshot(doc, selectionLand),
  });
  return { pos: selectionLand, handled: true };
}

export function resolveDomPointAtDocPos(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  pos: HandoffNoteDocPos,
  options?: { from?: HandoffNoteDocPos; focusAffinity?: "before" | "after" }
): { node: Node; offset: number } | null {
  const normalized = normalizeDocPos(doc, pos, options?.from ? { from: options.from } : undefined);
  const { paintPos } = resolvePaintContext(doc, normalized, { root });
  const node = doc.nodes[paintPos.nodeIndex];
  if (!node) {
    if (root.firstChild?.nodeType === Node.TEXT_NODE) {
      return { node: root.firstChild, offset: 0 };
    }
    return { node: root, offset: 0 };
  }

  const renderedIndex = docPosToRenderedDomChildIndex(doc, paintPos.nodeIndex);
  const domNode = root.childNodes[renderedIndex];
  if (!domNode) {
    if (docWireEndsWithNewline(doc) && isLastRenderedDocNode(doc, paintPos.nodeIndex)) {
      return { node: root, offset: root.childNodes.length - 1 };
    }
    return { node: root, offset: root.childNodes.length };
  }

  if (node.type === "text") {
    const nextDocNode = doc.nodes[paintPos.nodeIndex + 1];
    if (
      isAtomicNode(nextDocNode) &&
      paintPos.nodeOffset >= node.text.length &&
      (node.text.length === 0 || node.text.endsWith("\n"))
    ) {
      // Empty pre-atomic or row-start after trailing wire-breaks: line-start ZWSP dock.
      // Mid-row spacer tails (`" "` before atom) do not end with `\n` — keep text paint.
      return paintOutsideAtomicStart(root, doc, paintPos.nodeIndex + 1);
    }
    return resolveTextDomPointAtOffset(root, node.text, paintPos.nodeOffset, renderedIndex, {
      doc,
      docEndsWithNewline: docWireEndsWithNewline(doc),
      isLastRenderedNode: isLastRenderedDocNode(doc, paintPos.nodeIndex),
      wireBase: docPosToWireOffset(doc, { nodeIndex: paintPos.nodeIndex, nodeOffset: 0 }),
      focusDocPos: paintPos,
      focusAffinity: options?.focusAffinity,
    });
  }

  const tokenLength = nodeTokenLength(node);
  if (paintPos.nodeOffset <= 0) {
    return paintOutsideAtomicStart(root, doc, paintPos.nodeIndex);
  }
  if (paintPos.nodeOffset >= tokenLength) {
    const afterRendered = renderedIndex + 1;
    const postText = doc.nodes[paintPos.nodeIndex + 1];
    if (postText?.type === "text" && blankBandKeepsAtomicEndPaint(doc)) {
      return { node: root, offset: afterRendered };
    }
    if (afterRendered < root.childNodes.length) {
      const nextDom = root.childNodes[afterRendered]!;
      if (nextDom.nodeType === Node.TEXT_NODE) {
        if (isHandoffBlankAnchorElement(nextDom.parentNode)) {
          return { node: root, offset: afterRendered };
        }
        const postText = doc.nodes[paintPos.nodeIndex + 1];
        if (postText?.type === "text" && postText.text.includes("\n")) {
          const parts = postText.text.split("\n");
          const firstPart = parts[0] ?? "";
          if (parts.length > 1 && /^\s+$/.test(firstPart)) {
            const wireBase = docPosToWireOffset(doc, {
              nodeIndex: paintPos.nodeIndex + 1,
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
    const pillOffset = paintPos.nodeOffset - 1;
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

/** Authoritative geometry for an embedded `\n` rendered as `<br data-handoff-wire-break>`. */
export function measureWireBreakCoord(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  wire: number
): DomMeasuredWireOffset | null {
  const { paintPos: pos } = resolvePaintContextAtWire(doc, wire, { root });
  const domPoint = resolveDomPointAtDocPos(root, doc, pos);
  if (!domPoint) {
    return null;
  }

  let element: Element | null = null;
  if (domPoint.node === root) {
    const child = root.childNodes[domPoint.offset];
    if (child instanceof HTMLBRElement) {
      element = child;
    }
  } else if (domPoint.node instanceof HTMLBRElement) {
    element = domPoint.node;
  } else if (domPoint.node.parentNode === root) {
    const sibling = root.childNodes[domPoint.offset];
    if (sibling instanceof HTMLBRElement) {
      element = sibling;
    }
  }

  if (element && isHandoffWireBreakElement(element)) {
    const rect = element.getBoundingClientRect();
    if (hasPositionedDomRect(rect)) {
      return { wire, top: domRectAnchorMidY(rect), left: rect.left, right: rect.right };
    }
  }

  const rect = getDocAnchorRect(root, doc, pos);
  if (!rect || !hasPositionedDomRect(rect)) {
    return null;
  }
  return { wire, top: domRectAnchorMidY(rect), left: rect.left, right: rect.right };
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

export type TargetRowAtomPaintSpan = {
  atomNodeIndex: number;
  startWire: number;
  endWire: number;
  layoutLeft: number;
  layoutRight: number;
};

/**
 * Atom half-split for atoms layout-assigned to the target row.
 * Row membership from layout samples. Column bbox: DOM when goal is inside painted
 * atom rect; else layout-acquired span (covers soft-wrap co-band and test stubs).
 */
export function resolveTargetRowPillWireForGoalColumn(
  root: HTMLElement | undefined,
  doc: HandoffNoteDoc,
  goalColumn: number,
  spans: readonly TargetRowAtomPaintSpan[],
  tolerance: number
): number | null {
  for (const span of spans) {
    if (root) {
      const atomEl = atomicElement(root, doc, span.atomNodeIndex);
      if (atomEl) {
        const rect = atomEl.getBoundingClientRect();
        if (hasPositionedDomRect(rect)) {
          const domWire = wireOffsetForPillHalfSplitColumn(
            goalColumn,
            rect.left,
            rect.right,
            span.startWire,
            span.endWire,
            tolerance
          );
          if (domWire !== null) {
            return domWire;
          }
        }
      }
    }
    const layoutWire = wireOffsetForPillHalfSplitColumn(
      goalColumn,
      span.layoutLeft,
      span.layoutRight,
      span.startWire,
      span.endWire,
      tolerance
    );
    if (layoutWire !== null) {
      return layoutWire;
    }
  }
  return null;
}

export type ViewportCaretHitProbe = {
  api: "caretPositionFromPoint" | "caretRangeFromPoint" | null;
  missReason: string | null;
  pos: HandoffNoteDocPos | null;
  wire: number | null;
  caretKind: string | null;
};

/** Raw DOM caret at viewport (x, y) — layout sample paint without doc authority remap. */
export function probeDomPointAtViewport(
  root: HTMLElement,
  x: number,
  y: number
): { node: Node; offset: number } | null {
  const docApi = root.ownerDocument;

  if (typeof docApi.caretPositionFromPoint === "function") {
    const hit = docApi.caretPositionFromPoint(x, y);
    if (!hit || !isEditorNode(root, hit.offsetNode)) {
      return null;
    }
    return { node: hit.offsetNode, offset: hit.offset };
  }

  const legacyDoc = docApi as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof legacyDoc.caretRangeFromPoint === "function") {
    const range = legacyDoc.caretRangeFromPoint(x, y);
    if (!range || !isEditorNode(root, range.startContainer)) {
      return null;
    }
    return { node: range.startContainer, offset: range.startOffset };
  }

  return null;
}

/** Browser caret hit-test at viewport (x, y). Step 2 of click repair; also the primitive behind `probeDocPosAtVisualColumn`. */
export function probeViewportCaretHit(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  x: number,
  y: number,
  options?: { from?: HandoffNoteDocPos; bias?: "start" | "end" }
): ViewportCaretHitProbe {
  const docApi = root.ownerDocument;
  const biasOpt = options?.bias ? { bias: options.bias } : undefined;
  const fromOpt = options?.from ? { from: options.from, ...biasOpt } : biasOpt;

  if (typeof docApi.caretPositionFromPoint === "function") {
    const hit = docApi.caretPositionFromPoint(x, y);
    if (!hit) {
      return {
        api: "caretPositionFromPoint",
        missReason: "caret-miss",
        pos: null,
        wire: null,
        caretKind: null,
      };
    }
    if (!isEditorNode(root, hit.offsetNode)) {
      return {
        api: "caretPositionFromPoint",
        missReason: "outside-editor",
        pos: null,
        wire: null,
        caretKind: null,
      };
    }
    const pos = normalizeDocPos(
      doc,
      domPointToDocPos(root, doc, hit.offsetNode, hit.offset),
      fromOpt
    );
    const wire = docPosToWireOffset(doc, pos);
    return {
      api: "caretPositionFromPoint",
      missReason: null,
      pos,
      wire,
      caretKind: resolvePaintContext(doc, pos, { root }).caretKind,
    };
  }

  const legacyDoc = docApi as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof legacyDoc.caretRangeFromPoint === "function") {
    const range = legacyDoc.caretRangeFromPoint(x, y);
    if (!range) {
      return {
        api: "caretRangeFromPoint",
        missReason: "caret-miss",
        pos: null,
        wire: null,
        caretKind: null,
      };
    }
    if (!isEditorNode(root, range.startContainer)) {
      return {
        api: "caretRangeFromPoint",
        missReason: "outside-editor",
        pos: null,
        wire: null,
        caretKind: null,
      };
    }
    const pos = normalizeDocPos(
      doc,
      domPointToDocPos(root, doc, range.startContainer, range.startOffset),
      fromOpt
    );
    const wire = docPosToWireOffset(doc, pos);
    return {
      api: "caretRangeFromPoint",
      missReason: null,
      pos,
      wire,
      caretKind: resolvePaintContext(doc, pos, { root }).caretKind,
    };
  }

  return { api: null, missReason: "no-caret-api", pos: null, wire: null, caretKind: null };
}

/** Step 3a of click repair and vertical arrows: caret hit-test at layout row Y and goal column X. */
export function probeDocPosAtVisualColumn(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  rowTop: number,
  column: number
): HandoffNoteDocPos | null {
  return probeViewportCaretHit(root, doc, column, rowTop, { bias: "start" }).pos;
}

type LayoutRectProbeColumn = {
  kind: "left" | "mid" | "right";
  x: number;
};

function probeColumnsForLayoutRect(rect: DOMRect): LayoutRectProbeColumn[] {
  const insetLeft = rect.left + Math.min(2, Math.max(0, rect.width / 2));
  const mid = rect.left + rect.width / 2;
  const insetRight = rect.right - Math.min(2, Math.max(0, rect.width / 2));
  const columns: LayoutRectProbeColumn[] = [{ kind: "left", x: insetLeft }];
  if (mid !== insetLeft) {
    columns.push({ kind: "mid", x: mid });
  }
  if (insetRight !== mid && insetRight !== insetLeft) {
    columns.push({ kind: "right", x: insetRight });
  }
  return columns;
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
  measured: DomMeasuredWireOffset[],
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
    for (const probe of probeColumnsForLayoutRect(rect)) {
      const probed =
        probeDocPosAtVisualColumn(root, doc, midY, probe.x) ??
        probeDocPosAtVisualColumn(root, doc, rect.top, probe.x);
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

function anchorMidYAtTextNodeOffset(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  nodeOffset: number
): number | null {
  const rect = getDocAnchorRect(root, doc, { nodeIndex, nodeOffset });
  if (!rect || !hasPositionedDomRect(rect)) {
    return null;
  }
  return domRectAnchorMidY(rect);
}

function isTextOffsetOnLowerFragment(
  midY: number,
  upper: DOMRect,
  lower: DOMRect,
  tolerance: number
): boolean {
  const splitY = (upper.bottom + lower.top) / 2;
  return midY >= splitY - tolerance;
}

/** First nodeOffset on the lower visual fragment between two painted line boxes. */
function findFirstTextOffsetOnLowerFragment(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  localStart: number,
  localEndExclusive: number,
  upper: DOMRect,
  lower: DOMRect,
  tolerance: number
): number | null {
  if (localEndExclusive <= localStart) {
    return null;
  }
  const startMidY = anchorMidYAtTextNodeOffset(root, doc, nodeIndex, localStart);
  if (startMidY === null) {
    return null;
  }
  if (isTextOffsetOnLowerFragment(startMidY, upper, lower, tolerance)) {
    return localStart;
  }
  const endMidY = anchorMidYAtTextNodeOffset(root, doc, nodeIndex, localEndExclusive - 1);
  if (endMidY === null || !isTextOffsetOnLowerFragment(endMidY, upper, lower, tolerance)) {
    return null;
  }

  let lo = localStart;
  let hi = localEndExclusive;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midY = anchorMidYAtTextNodeOffset(root, doc, nodeIndex, mid);
    if (midY === null) {
      return null;
    }
    if (isTextOffsetOnLowerFragment(midY, upper, lower, tolerance)) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

function measuredSampleAtTextNodeOffset(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  nodeOffset: number
): DomMeasuredWireOffset | null {
  const rect = getDocAnchorRect(root, doc, { nodeIndex, nodeOffset });
  if (!rect || !hasPositionedDomRect(rect)) {
    return null;
  }
  const top = domRectAnchorMidY(rect);
  const left = rect.left;
  if (!isUsableMeasuredLayoutCoord({ top, left })) {
    return null;
  }
  return {
    wire: docPosToWireOffset(doc, { nodeIndex, nodeOffset }),
    top,
    left,
    right: rect.right,
  };
}

function upsertFragmentBoundarySamplesAtSplit(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  textLength: number,
  splitOffset: number,
  measured: DomMeasuredWireOffset[],
  seen: Set<number>
): void {
  if (splitOffset === 0) {
    return;
  }
  if (splitOffset > 0) {
    const prefixEnd = measuredSampleAtTextNodeOffset(root, doc, nodeIndex, splitOffset - 1);
    if (prefixEnd) {
      upsertSoftWrapMeasuredSample(measured, seen, prefixEnd);
    }
  }
  if (splitOffset < textLength) {
    const continuationStart = measuredSampleAtTextNodeOffset(root, doc, nodeIndex, splitOffset);
    if (continuationStart) {
      upsertSoftWrapMeasuredSample(measured, seen, continuationStart);
    }
  }
}

function appendPaintedFragmentBoundarySamples(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  localStart: number,
  localEndExclusive: number,
  upper: DOMRect,
  lower: DOMRect,
  measured: DomMeasuredWireOffset[],
  seen: Set<number>
): number | null {
  const tolerance = Math.max(1, Math.abs(lower.top - upper.top) / 4);
  const splitOffset = findFirstTextOffsetOnLowerFragment(
    root,
    doc,
    nodeIndex,
    localStart,
    localEndExclusive,
    upper,
    lower,
    tolerance
  );
  if (splitOffset === null || splitOffset <= localStart) {
    return splitOffset;
  }
  upsertFragmentBoundarySamplesAtSplit(
    root,
    doc,
    nodeIndex,
    localEndExclusive,
    splitOffset,
    measured,
    seen
  );
  return splitOffset;
}

function wireRangeForTextSubrange(
  doc: HandoffNoteDoc,
  nodeIndex: number,
  localStart: number,
  localEndExclusive: number
): { startWire: number; endWireExclusive: number } {
  const startWire = docPosToWireOffset(doc, { nodeIndex, nodeOffset: localStart });
  const endWireExclusive = docPosToWireOffset(doc, {
    nodeIndex,
    nodeOffset: localEndExclusive,
  });
  return { startWire, endWireExclusive };
}

function isSubstantiveTextSubrange(
  text: string,
  localStart: number,
  localEndExclusive: number
): boolean {
  if (localEndExclusive <= localStart) {
    return false;
  }
  const segment = text.slice(localStart, localEndExclusive);
  return segment.length > 0 && !/^\s*$/.test(segment);
}

/** Per-wire anchor measure when painted fragment rects are unavailable (headless / unpainted). */
function appendUnpaintedSegmentBoundarySamples(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  localStart: number,
  localEndExclusive: number,
  startWire: number,
  endWireExclusive: number,
  measured: DomMeasuredWireOffset[],
  seen: Set<number>
): number {
  const beforeCount = measured.length;

  if (!seen.has(startWire)) {
    const lineStart = measuredSegmentLineStartSample(root, doc, nodeIndex, localStart, startWire);
    if (lineStart) {
      upsertSoftWrapMeasuredSample(measured, seen, lineStart);
    }
  }

  const lineEndLocal = localEndExclusive - 1;
  const lineEndWire = docPosToWireOffset(doc, { nodeIndex, nodeOffset: lineEndLocal });
  if (
    lineEndLocal >= localStart &&
    lineEndWire >= startWire &&
    lineEndWire < endWireExclusive &&
    !seen.has(lineEndWire)
  ) {
    const lineEnd = measuredSampleAtTextNodeOffset(root, doc, nodeIndex, lineEndLocal);
    if (lineEnd) {
      upsertSoftWrapMeasuredSample(measured, seen, lineEnd);
    }
  }

  return measured.length - beforeCount;
}

function measuredSegmentLineStartSample(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  localStart: number,
  startWire: number
): DomMeasuredWireOffset | null {
  const direct = measuredSampleAtTextNodeOffset(root, doc, nodeIndex, localStart);
  if (direct) {
    return direct;
  }
  const wire = docToWire(doc);
  const breakWire = startWire - 1;
  if (breakWire < 0 || wire[breakWire] !== "\n") {
    return null;
  }
  const breakCoord = measureWireBreakCoord(root, doc, breakWire);
  if (!breakCoord || !isUsableMeasuredLayoutCoord(breakCoord)) {
    return null;
  }
  return { wire: startWire, top: breakCoord.top, left: breakCoord.left };
}

/** Painted fragment boundaries + column probes for one text-node substring. */
function appendPaintedSoftWrapSamplesForTextSubrange(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  localStart: number,
  localEndExclusive: number,
  measured: DomMeasuredWireOffset[],
  seen: Set<number>
): number {
  const node = doc.nodes[nodeIndex];
  if (
    node?.type !== "text" ||
    !isSubstantiveTextSubrange(node.text, localStart, localEndExclusive)
  ) {
    return 0;
  }

  const { startWire, endWireExclusive } = wireRangeForTextSubrange(
    doc,
    nodeIndex,
    localStart,
    localEndExclusive
  );
  if (isEmbeddedBlankBandProbeWire(doc, startWire)) {
    return 0;
  }

  const beforeCount = measured.length;

  const startPoint = resolveDomPointAtDocPos(root, doc, { nodeIndex, nodeOffset: localStart });
  if (!startPoint || startPoint.node.nodeType !== Node.TEXT_NODE) {
    return appendUnpaintedSegmentBoundarySamples(
      root,
      doc,
      nodeIndex,
      localStart,
      localEndExclusive,
      startWire,
      endWireExclusive,
      measured,
      seen
    );
  }
  const textNode = startPoint.node as Text;
  const domStart = startPoint.offset;
  let domEnd: number;
  if (localEndExclusive < node.text.length && node.text[localEndExclusive] === "\n") {
    const lastCharPoint = resolveDomPointAtDocPos(root, doc, {
      nodeIndex,
      nodeOffset: localEndExclusive - 1,
    });
    if (!lastCharPoint || lastCharPoint.node.nodeType !== Node.TEXT_NODE) {
      return appendUnpaintedSegmentBoundarySamples(
        root,
        doc,
        nodeIndex,
        localStart,
        localEndExclusive,
        startWire,
        endWireExclusive,
        measured,
        seen
      );
    }
    if (lastCharPoint.node !== textNode) {
      return appendUnpaintedSegmentBoundarySamples(
        root,
        doc,
        nodeIndex,
        localStart,
        localEndExclusive,
        startWire,
        endWireExclusive,
        measured,
        seen
      );
    }
    // Rule 4: last substantive char before embedded `\n` already resolves to the
    // browser text-node tail (offset === length); do not add +1.
    domEnd = lastCharPoint.offset;
  } else {
    // Segment exclusive end at text-node EOF (plain soft-wrap node or post-`\n` tail).
    domEnd = textNode.length;
  }
  if (domEnd <= domStart) {
    return appendUnpaintedSegmentBoundarySamples(
      root,
      doc,
      nodeIndex,
      localStart,
      localEndExclusive,
      startWire,
      endWireExclusive,
      measured,
      seen
    );
  }

  const range = root.ownerDocument.createRange();
  try {
    range.setStart(textNode, domStart);
    range.setEnd(textNode, domEnd);
  } catch {
    return appendUnpaintedSegmentBoundarySamples(
      root,
      doc,
      nodeIndex,
      localStart,
      localEndExclusive,
      startWire,
      endWireExclusive,
      measured,
      seen
    );
  }

  const rects = typeof range.getClientRects === "function" ? [...range.getClientRects()] : [];
  const visualRects = rects
    .filter((rect) => rect.width > 0 || rect.height > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);

  if (visualRects.length > 0) {
    const bandSplitOffsets: Array<number | null> = [];
    for (let bandIndex = 0; bandIndex < visualRects.length - 1; bandIndex++) {
      const upper = visualRects[bandIndex]!;
      const lower = visualRects[bandIndex + 1]!;
      if (Math.abs(lower.top - upper.top) <= 1) {
        bandSplitOffsets[bandIndex] = null;
        continue;
      }
      bandSplitOffsets[bandIndex] = appendPaintedFragmentBoundarySamples(
        root,
        doc,
        nodeIndex,
        localStart,
        localEndExclusive,
        upper,
        lower,
        measured,
        seen
      );
    }

    for (let rectIndex = 0; rectIndex < visualRects.length; rectIndex++) {
      const rect = visualRects[rectIndex]!;
      const isLastFragment = rectIndex === visualRects.length - 1;
      const bandSplitOffset = bandSplitOffsets[rectIndex] ?? null;
      const midY = rect.top + rect.height / 2;
      for (const column of probeColumnsForLayoutRect(rect)) {
        const sample = probeSoftWrapSampleAtColumn(root, doc, midY, column.x);
        if (!sample) {
          continue;
        }
        if (sample.wire < startWire || sample.wire >= endWireExclusive) {
          continue;
        }
        if (
          shouldSkipPrefixFragmentColumnProbe(
            doc,
            nodeIndex,
            column,
            isLastFragment,
            bandSplitOffset,
            sample.wire
          )
        ) {
          continue;
        }
        upsertSoftWrapMeasuredSample(measured, seen, sample);
      }
    }

    if (!seen.has(startWire)) {
      const lineStart = measuredSegmentLineStartSample(root, doc, nodeIndex, localStart, startWire);
      if (lineStart) {
        upsertSoftWrapMeasuredSample(measured, seen, lineStart);
      }
    }

    const lineEndLocal = localEndExclusive - 1;
    const lineEndWire = docPosToWireOffset(doc, { nodeIndex, nodeOffset: lineEndLocal });
    if (
      lineEndLocal >= localStart &&
      lineEndWire >= startWire &&
      lineEndWire < endWireExclusive &&
      !seen.has(lineEndWire)
    ) {
      const lineEnd = measuredSampleAtTextNodeOffset(root, doc, nodeIndex, lineEndLocal);
      if (lineEnd) {
        upsertSoftWrapMeasuredSample(measured, seen, lineEnd);
      }
    }
  }

  if (measured.length === beforeCount) {
    return appendUnpaintedSegmentBoundarySamples(
      root,
      doc,
      nodeIndex,
      localStart,
      localEndExclusive,
      startWire,
      endWireExclusive,
      measured,
      seen
    );
  }

  return measured.length - beforeCount;
}

function appendPaintedSoftWrapSamplesForTextNode(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  nodeIndex: number,
  measured: DomMeasuredWireOffset[],
  seen: Set<number>
): void {
  const node = doc.nodes[nodeIndex];
  if (node?.type !== "text" || node.text.length === 0) {
    return;
  }

  if (!node.text.includes("\n")) {
    appendPaintedSoftWrapSamplesForTextSubrange(
      root,
      doc,
      nodeIndex,
      0,
      node.text.length,
      measured,
      seen
    );
    return;
  }

  let segmentStart = 0;
  for (let local = 0; local < node.text.length; local++) {
    if (node.text[local] !== "\n") {
      continue;
    }
    appendPaintedSoftWrapSamplesForTextSubrange(
      root,
      doc,
      nodeIndex,
      segmentStart,
      local,
      measured,
      seen
    );
    segmentStart = local + 1;
  }
  appendPaintedSoftWrapSamplesForTextSubrange(
    root,
    doc,
    nodeIndex,
    segmentStart,
    node.text.length,
    measured,
    seen
  );
}

function shouldSkipPrefixFragmentColumnProbe(
  doc: HandoffNoteDoc,
  nodeIndex: number,
  column: LayoutRectProbeColumn,
  isLastFragment: boolean,
  bandSplitOffset: number | null,
  probedWire: number
): boolean {
  if (isLastFragment) {
    return false;
  }
  if (column.kind === "right") {
    return true;
  }
  if (bandSplitOffset === null || bandSplitOffset <= 0) {
    return false;
  }
  const pos = wireOffsetToDocPos(doc, probedWire);
  if (pos.nodeIndex !== nodeIndex) {
    return false;
  }
  return pos.nodeOffset >= bandSplitOffset;
}

function upsertSoftWrapMeasuredSample(
  measured: DomMeasuredWireOffset[],
  seen: Set<number>,
  sample: DomMeasuredWireOffset
): void {
  if (!isUsableMeasuredLayoutCoord(sample)) {
    return;
  }
  const existingIndex = measured.findIndex((entry) => entry.wire === sample.wire);
  if (existingIndex >= 0) {
    measured[existingIndex] = sample;
    seen.add(sample.wire);
    return;
  }
  if (seen.has(sample.wire)) {
    return;
  }
  seen.add(sample.wire);
  measured.push(sample);
}

function probeSoftWrapSampleAtColumn(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  midY: number,
  probeX: number
): DomMeasuredWireOffset | null {
  const probed = probeDocPosAtVisualColumn(root, doc, midY, probeX);
  if (!probed) {
    return null;
  }
  const wire = docPosToWireOffset(doc, probed);
  if (isEmbeddedBlankBandProbeWire(doc, wire)) {
    return null;
  }
  return { wire, top: midY, left: probeX };
}

/** Append layout samples at each rendered text line (soft-wrap fragments). */
export function appendSoftWrapLineSamples(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  measured: DomMeasuredWireOffset[]
): void {
  const seen = new Set(measured.map((sample) => sample.wire));

  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    appendPaintedSoftWrapSamplesForTextNode(root, doc, nodeIndex, measured, seen);
  }
}
