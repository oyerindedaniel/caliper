import {
  docToWire,
  formatHandoffAgentIdPill,
  renderedChildCount,
  type HandoffNoteDoc,
  type HandoffNoteNode,
} from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { flattenHandoffNoteLog, handoffNoteDomSnapshot } from "../handoff-note-debug.js";

export const HANDOFF_MENTION_ATTR = "data-handoff-mention";
export const HANDOFF_AGENT_ID_ATTR = "data-agent-id";
export const HANDOFF_MENTION_NODE_INDEX_ATTR = "data-handoff-mention-node-index";

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

/** childIndex → doc.nodes index (skips empty text nodes, matching render). */
export function buildRenderedNodeIndexMap(doc: HandoffNoteDoc): number[] {
  const map: number[] = [];
  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    if (!isRenderedDocNode(node)) {
      continue;
    }
    map.push(nodeIndex);
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
  flattenHandoffNoteLog("dom.render", { wireAfter: docToWire(doc), mode: "fullRebuild" });

  root.replaceChildren();
  if (doc.nodes.length === 0) {
    return;
  }

  for (let nodeIndex = 0; nodeIndex < doc.nodes.length; nodeIndex++) {
    const node = doc.nodes[nodeIndex]!;
    if (node.type === "text") {
      if (node.text) {
        root.appendChild(document.createTextNode(node.text));
      }
      continue;
    }
    const color = options.colorByAgentId.get(node.agentId) ?? "";
    const highlighted = options.selectedMentionNodeIndex === nodeIndex;
    root.appendChild(createMentionElement(node.agentId, color, highlighted, nodeIndex));
  }
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
    const expectedCount = renderedChildCount(doc);
    const domReady =
      root.childNodes.length === expectedCount &&
      !hasStrayDomElements(root) &&
      (expectedCount > 0 || root.childNodes.length === 0);

    if (domReady && previousDoc && tryPatchDocDom(root, previousDoc, doc, options)) {
      return { domReplaced: false, docChanged: true };
    }

    fullRebuildDocDom(root, doc, options);
    updateMentionPresentation(root, options);
    return { domReplaced: true, docChanged: true };
  }

  const wireBefore = parseHandoffNoteDom(root);
  const wireAfter = docToWire(doc);
  const domNodeCount = handoffNoteDomSnapshot(root).length;
  const structureMismatch = domNodeCount !== renderedChildCount(doc);
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

  if (previousDoc && tryPatchDocDom(root, previousDoc, doc, options)) {
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
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) {
        nodes.push({ type: "text", text });
      }
      continue;
    }
    if (isHandoffMentionElement(child)) {
      const agentId = readMentionAgentId(child);
      if (agentId) {
        nodes.push({ type: "mention", agentId });
      }
      continue;
    }
    if (child instanceof HTMLElement) {
      const text = child.textContent ?? "";
      if (text) {
        nodes.push({ type: "text", text });
      }
    }
  }
  return { nodes };
}
