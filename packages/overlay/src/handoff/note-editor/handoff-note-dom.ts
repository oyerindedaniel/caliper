import {
  docToWire,
  formatHandoffAgentIdPill,
  listEmbeddedBlankBandProbeWires,
  type HandoffNoteDoc,
  type HandoffNoteNode,
} from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { handoffNoteDomSnapshot } from "../handoff-note-debug.js";

export const HANDOFF_MENTION_ATTR = "data-handoff-mention";
export const HANDOFF_AGENT_ID_ATTR = "data-agent-id";
export const HANDOFF_MENTION_NODE_INDEX_ATTR = "data-handoff-mention-node-index";
export const HANDOFF_WIRE_BREAK_ATTR = "data-handoff-wire-break";
export const HANDOFF_LINE_PAD_ATTR = "data-handoff-line-pad";
export const HANDOFF_BLANK_ANCHOR_ATTR = "data-handoff-blank-anchor";
export const HANDOFF_BLANK_ANCHOR_CHAR = "\u200b";

export type HandoffNotePresentationOptions = {
  colorByAgentId: Map<string, string>;
  selectedMentionNodeIndex?: number | null;
};

export type RenderOutcome = {
  domReplaced: boolean;
  docChanged: boolean;
};

export type RenderHandoffNoteDocRenderOptions = {
  trustDoc?: boolean;
  previousDoc?: HandoffNoteDoc;
};

export function isHandoffMentionElement(node: Node): node is HTMLSpanElement {
  return (
    node instanceof HTMLSpanElement &&
    node.hasAttribute(HANDOFF_MENTION_ATTR) &&
    node.hasAttribute(HANDOFF_AGENT_ID_ATTR)
  );
}

export function isHandoffWireBreakElement(node: Node): node is HTMLBRElement {
  return node instanceof HTMLBRElement && node.hasAttribute(HANDOFF_WIRE_BREAK_ATTR);
}

export function isHandoffLinePadElement(node: Node): node is HTMLBRElement {
  return node instanceof HTMLBRElement && node.hasAttribute(HANDOFF_LINE_PAD_ATTR);
}

export function isHandoffBlankAnchorElement(
  node: Node | null | undefined
): node is HTMLSpanElement {
  return node instanceof HTMLSpanElement && node.hasAttribute(HANDOFF_BLANK_ANCHOR_ATTR);
}

/** Wire offset at the `\n` between split parts `breakPartIndex` and `breakPartIndex + 1`. */
export function wireOffsetAtTextBreak(
  text: string,
  wireBase: number,
  breakPartIndex: number
): number {
  const parts = text.split("\n");
  let wire = wireBase;
  for (let index = 0; index < breakPartIndex; index++) {
    wire += parts[index]!.length + 1;
  }
  wire += parts[breakPartIndex]!.length;
  return wire;
}

export type WireTextDomOptions = {
  wireBase?: number;
  blankProbeWires?: ReadonlySet<number>;
};

export function readMentionAgentId(element: HTMLSpanElement): string {
  return element.getAttribute(HANDOFF_AGENT_ID_ATTR) ?? "";
}

export function readMentionNodeIndex(element: HTMLSpanElement): number | null {
  const raw = element.getAttribute(HANDOFF_MENTION_NODE_INDEX_ATTR);
  if (raw === null) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Wire-length of a mention atom — must match docToWire token size. */
export function mentionWireLength(agentId: string): number {
  return 1 + agentId.length;
}

function isRenderedDocNode(node: HandoffNoteNode): boolean {
  return node.type !== "text" || Boolean(node.text);
}

/** DOM children produced by splitting wire newlines inside one text node (plus blank-band anchors). */
export function countWireTextDomChildren(text: string, options?: WireTextDomOptions): number {
  if (!text.includes("\n")) {
    return text ? 1 : 0;
  }
  const wireBase = options?.wireBase ?? 0;
  const probeWires = options?.blankProbeWires;
  let count = 0;
  const parts = text.split("\n");
  for (let index = 0; index < parts.length; index++) {
    if (parts[index]) {
      count++;
    }
    if (index < parts.length - 1) {
      count++;
      const breakWire = wireOffsetAtTextBreak(text, wireBase, index);
      if (probeWires?.has(breakWire)) {
        count++;
      }
    }
  }
  return count;
}

/** Rendered DOM child count including wire breaks, blank-band anchors, and optional EOF line-pad. */
export function renderedDomChildCount(doc: HandoffNoteDoc): number {
  const probeWires = new Set(listEmbeddedBlankBandProbeWires(doc));
  let count = 0;
  let wireCursor = 0;
  for (const node of doc.nodes) {
    if (node.type === "text") {
      if (!node.text) {
        continue;
      }
      count += countWireTextDomChildren(node.text, {
        wireBase: wireCursor,
        blankProbeWires: probeWires,
      });
      wireCursor += node.text.length;
      continue;
    }
    count++;
    wireCursor += mentionWireLength(node.agentId);
  }
  if (docToWire(doc).endsWith("\n")) {
    count++;
  }
  return count;
}

export function docWireEndsWithNewline(doc: HandoffNoteDoc): boolean {
  return docToWire(doc).endsWith("\n");
}

export function docGainedWireNewline(
  prev: HandoffNoteDoc | undefined,
  next: HandoffNoteDoc
): boolean {
  if (!prev) {
    return false;
  }
  const count = (wire: string) => (wire.match(/\n/g) ?? []).length;
  return count(docToWire(next)) > count(docToWire(prev));
}

function createWireBreakElement(): HTMLBRElement {
  const br = document.createElement("br");
  br.setAttribute(HANDOFF_WIRE_BREAK_ATTR, "true");
  return br;
}

function createLinePadElement(): HTMLBRElement {
  const br = document.createElement("br");
  br.setAttribute(HANDOFF_LINE_PAD_ATTR, "true");
  return br;
}

function createBlankAnchorElement(): HTMLSpanElement {
  const span = document.createElement("span");
  span.setAttribute(HANDOFF_BLANK_ANCHOR_ATTR, "true");
  span.appendChild(document.createTextNode(HANDOFF_BLANK_ANCHOR_CHAR));
  return span;
}

/** Map wire `\n` inside a text node to `<br>` siblings; blank probes get a caret anchor after the break. */
export function appendWireTextToDom(
  parent: HTMLElement,
  text: string,
  options?: WireTextDomOptions
): void {
  if (!text.includes("\n")) {
    if (text) {
      parent.appendChild(document.createTextNode(text));
    }
    return;
  }
  const wireBase = options?.wireBase ?? 0;
  const probeWires = options?.blankProbeWires;
  const parts = text.split("\n");
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part) {
      parent.appendChild(document.createTextNode(part));
    }
    if (index < parts.length - 1) {
      parent.appendChild(createWireBreakElement());
      const breakWire = wireOffsetAtTextBreak(text, wireBase, index);
      if (probeWires?.has(breakWire)) {
        parent.appendChild(createBlankAnchorElement());
      }
    }
  }
}

function appendDocLinePadIfNeeded(root: HTMLElement, doc: HandoffNoteDoc): void {
  if (docWireEndsWithNewline(doc)) {
    root.appendChild(createLinePadElement());
  }
}

/** childIndex → doc.nodes index (skips empty text nodes, matching render). */
export function buildRenderedNodeIndexMap(doc: HandoffNoteDoc): number[] {
  const map: number[] = [];
  const probeWires = new Set(listEmbeddedBlankBandProbeWires(doc));
  let wireCursor = 0;
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    if (!isRenderedDocNode(node)) {
      continue;
    }
    if (node.type === "mention") {
      map.push(nodeIndex);
      wireCursor += mentionWireLength(node.agentId);
      continue;
    }
    const text = node.text;
    if (!text.includes("\n")) {
      if (text) {
        map.push(nodeIndex);
      }
      wireCursor += text.length;
      continue;
    }
    const parts = text.split("\n");
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex]!;
      if (part) {
        map.push(nodeIndex);
      }
      if (partIndex < parts.length - 1) {
        map.push(nodeIndex);
        const breakWire = wireOffsetAtTextBreak(text, wireCursor, partIndex);
        if (probeWires.has(breakWire)) {
          map.push(nodeIndex);
        }
      }
    }
    wireCursor += text.length;
  }
  if (docWireEndsWithNewline(doc)) {
    const lastTextIndex = [...doc.nodes]
      .map((node, index) => ({ node, index }))
      .reverse()
      .find(({ node }) => node.type === "text" && node.text)?.index;
    map.push(lastTextIndex ?? doc.nodes.length - 1);
  }
  return map;
}

/** Same rendered child sequence (types + mention ids); text may differ. */
export function sameRenderedDocStructure(prev: HandoffNoteDoc, next: HandoffNoteDoc): boolean {
  const prevRendered = prev.nodes.filter(isRenderedDocNode);
  const nextRendered = next.nodes.filter(isRenderedDocNode);
  if (prevRendered.length !== nextRendered.length) {
    return false;
  }
  for (let index = 0; index < prevRendered.length; index++) {
    const left = prevRendered[index]!;
    const right = nextRendered[index]!;
    if (left.type !== right.type) {
      return false;
    }
    if (left.type === "mention" && right.type === "mention" && left.agentId !== right.agentId) {
      return false;
    }
  }
  return true;
}

function createMentionElement(
  agentId: string,
  color: string,
  highlighted: boolean,
  nodeIndex: number
): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.className = `${PREFIX}handoff-mention-pill${highlighted ? ` ${PREFIX}handoff-mention-pill-highlighted` : ""}`;
  pill.setAttribute(HANDOFF_MENTION_ATTR, "true");
  pill.setAttribute(HANDOFF_AGENT_ID_ATTR, agentId);
  pill.setAttribute(HANDOFF_MENTION_NODE_INDEX_ATTR, String(nodeIndex));
  pill.setAttribute("contenteditable", "false");
  pill.tabIndex = 0;
  pill.setAttribute("role", "button");
  pill.setAttribute("aria-label", `Mention ${formatHandoffAgentIdPill(agentId, "full")}`);
  pill.style.setProperty("--caliper-handoff-pill-color", color);
  pill.textContent = formatHandoffAgentIdPill(agentId, "full");
  return pill;
}

/** Tab stops inside the note editor — contenteditable root, then mention pills in document order. */
export function getHandoffNoteEditorTabStops(editorRoot: HTMLElement): HTMLElement[] {
  const pills = Array.from(
    editorRoot.querySelectorAll<HTMLSpanElement>(`span[${HANDOFF_MENTION_ATTR}]`)
  ).filter((pill) => pill.tabIndex >= 0);
  return [editorRoot, ...pills];
}

function syncMentionPillAccessibility(pill: HTMLSpanElement, agentId: string): void {
  pill.tabIndex = 0;
  pill.setAttribute("role", "button");
  pill.setAttribute("aria-label", `Mention ${formatHandoffAgentIdPill(agentId, "full")}`);
}

function hasStrayDomElements(root: HTMLElement): boolean {
  return handoffNoteDomSnapshot(root).some((node) => node.kind === "element");
}

function fullRebuildDocDom(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  options: HandoffNotePresentationOptions
): void {
  root.replaceChildren();
  if (doc.nodes.length === 0) {
    return;
  }

  const probeWires = new Set(listEmbeddedBlankBandProbeWires(doc));
  let wireCursor = 0;
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    if (node.type === "text") {
      if (node.text) {
        appendWireTextToDom(root, node.text, {
          wireBase: wireCursor,
          blankProbeWires: probeWires,
        });
        wireCursor += node.text.length;
      }
      continue;
    }
    const color = options.colorByAgentId.get(node.agentId) ?? "";
    const highlighted = options.selectedMentionNodeIndex === nodeIndex;
    root.appendChild(createMentionElement(node.agentId, color, highlighted, nodeIndex));
    wireCursor += mentionWireLength(node.agentId);
  }

  appendDocLinePadIfNeeded(root, doc);
}

/** In-place text patch when rendered structure is unchanged. Returns false on any mismatch. */
export function tryPatchDocDom(
  root: HTMLElement,
  prevDoc: HandoffNoteDoc,
  nextDoc: HandoffNoteDoc,
  options: HandoffNotePresentationOptions
): boolean {
  if (!sameRenderedDocStructure(prevDoc, nextDoc)) {
    return false;
  }

  if (docGainedWireNewline(prevDoc, nextDoc)) {
    return false;
  }

  for (const node of nextDoc.nodes) {
    if (node.type === "text" && node.text.includes("\n")) {
      return false;
    }
  }

  const indexMap = buildRenderedNodeIndexMap(nextDoc);
  if (root.childNodes.length !== indexMap.length) {
    return false;
  }

  for (let childIdx = 0; childIdx < indexMap.length; childIdx++) {
    const nodeIndex = indexMap[childIdx]!;
    const node = nextDoc.nodes[nodeIndex]!;
    const dom = root.childNodes[childIdx]!;

    if (node.type === "text") {
      if (dom.nodeType !== Node.TEXT_NODE) {
        return false;
      }
      if (dom.textContent !== node.text) {
        dom.textContent = node.text;
      }
      continue;
    }

    if (!isHandoffMentionElement(dom)) {
      return false;
    }
    if (readMentionAgentId(dom) !== node.agentId) {
      return false;
    }
  }

  updateMentionPresentation(root, options);
  return true;
}

export function renderHandoffNoteDoc(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  options: HandoffNotePresentationOptions,
  renderOptions?: RenderHandoffNoteDocRenderOptions
): RenderOutcome {
  const trustDoc = renderOptions?.trustDoc ?? false;
  const previousDoc = renderOptions?.previousDoc;

  if (trustDoc) {
    const expectedCount = renderedDomChildCount(doc);
    const domReady =
      root.childNodes.length === expectedCount &&
      !hasStrayDomElements(root) &&
      (expectedCount > 0 || root.childNodes.length === 0);

    if (
      domReady &&
      previousDoc &&
      !docGainedWireNewline(previousDoc, doc) &&
      tryPatchDocDom(root, previousDoc, doc, options)
    ) {
      return { domReplaced: false, docChanged: true };
    }

    fullRebuildDocDom(root, doc, options);
    updateMentionPresentation(root, options);
    return { domReplaced: true, docChanged: true };
  }

  const wireBefore = parseHandoffNoteDom(root);
  const wireAfter = docToWire(doc);
  const domNodeCount = handoffNoteDomSnapshot(root).length;
  const structureMismatch = domNodeCount !== renderedDomChildCount(doc);
  const hasStrayElements = hasStrayDomElements(root);
  if (
    wireBefore === wireAfter &&
    root.childNodes.length > 0 &&
    !structureMismatch &&
    !hasStrayElements
  ) {
    updateMentionPresentation(root, options);
    return { domReplaced: false, docChanged: false };
  }

  if (
    previousDoc &&
    !docGainedWireNewline(previousDoc, doc) &&
    tryPatchDocDom(root, previousDoc, doc, options)
  ) {
    return { domReplaced: false, docChanged: true };
  }

  fullRebuildDocDom(root, doc, options);
  updateMentionPresentation(root, options);
  return { domReplaced: true, docChanged: true };
}

/** Update pill colors and highlight state without rebuilding DOM or touching selection. */
export function updateMentionPresentation(
  root: HTMLElement,
  options: HandoffNotePresentationOptions
): void {
  const selectedMentionNodeIndex = options.selectedMentionNodeIndex ?? null;
  const pills = root.querySelectorAll<HTMLSpanElement>(`span[${HANDOFF_MENTION_ATTR}]`);
  for (const pill of pills) {
    const agentId = readMentionAgentId(pill);
    const color = options.colorByAgentId.get(agentId) ?? "";
    pill.style.setProperty("--caliper-handoff-pill-color", color);
    syncMentionPillAccessibility(pill, agentId);
    const nodeIndex = readMentionNodeIndex(pill);
    const on = selectedMentionNodeIndex !== null && nodeIndex === selectedMentionNodeIndex;
    pill.classList.toggle(`${PREFIX}handoff-mention-pill-highlighted`, on);
  }
}

/**
 * Serialize editor DOM to wire string.
 * Walks only direct meaningful children; mention spans contribute `@agentId` wire tokens.
 */
export function parseHandoffNoteDom(root: HTMLElement): string {
  let wire = "";
  let prevWasMention = false;
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      wire += child.textContent ?? "";
      prevWasMention = false;
      continue;
    }
    if (isHandoffWireBreakElement(child)) {
      wire += "\n";
      prevWasMention = false;
      continue;
    }
    if (isHandoffLinePadElement(child)) {
      continue;
    }
    if (isHandoffBlankAnchorElement(child)) {
      continue;
    }
    if (isHandoffMentionElement(child)) {
      const agentId = readMentionAgentId(child);
      if (agentId) {
        if (prevWasMention) {
          wire += " ";
        }
        wire += `@${agentId}`;
        prevWasMention = true;
      }
      continue;
    }
    if (child instanceof HTMLElement) {
      wire += child.textContent ?? "";
      prevWasMention = false;
    }
  }
  return wire;
}

/** Build the doc model from CE DOM — never round-trip through flat wire (that loses mention boundaries). */
export function parseHandoffNoteDomToDoc(root: HTMLElement): HandoffNoteDoc {
  const nodes: HandoffNoteNode[] = [];
  let pendingText = "";

  const flushText = () => {
    if (pendingText) {
      nodes.push({ type: "text", text: pendingText });
      pendingText = "";
    }
  };

  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      pendingText += child.textContent ?? "";
      continue;
    }
    if (isHandoffWireBreakElement(child)) {
      pendingText += "\n";
      continue;
    }
    if (isHandoffLinePadElement(child)) {
      continue;
    }
    if (isHandoffBlankAnchorElement(child)) {
      continue;
    }
    if (isHandoffMentionElement(child)) {
      flushText();
      const agentId = readMentionAgentId(child);
      if (agentId) {
        nodes.push({ type: "mention", agentId });
      }
      continue;
    }
    if (child instanceof HTMLElement) {
      pendingText += child.textContent ?? "";
    }
  }
  flushText();
  return { nodes };
}
