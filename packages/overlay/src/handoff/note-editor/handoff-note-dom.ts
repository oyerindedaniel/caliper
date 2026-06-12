import {
  docToWire,
  formatHandoffAgentIdPill,
  normalizeHandoffNoteDoc,
  type HandoffNoteDoc,
  type HandoffNoteNode,
} from "@caliper/core";
import { PREFIX } from "../../css/styles.js";
import { flattenHandoffNoteLog, handoffNoteDomSnapshot } from "../handoff-note-debug.js";

export const HANDOFF_MENTION_ATTR = "data-handoff-mention";
export const HANDOFF_AGENT_ID_ATTR = "data-agent-id";

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

function readMentionColorsFromDom(root: HTMLElement): Map<string, string> {
  const colors = new Map<string, string>();
  const pills = root.querySelectorAll<HTMLSpanElement>(`span[${HANDOFF_MENTION_ATTR}]`);
  for (const pill of pills) {
    const agentId = readMentionAgentId(pill);
    if (!agentId || colors.has(agentId)) {
      continue;
    }
    const color = pill.style.getPropertyValue("--caliper-handoff-pill-color").trim();
    if (color) {
      colors.set(agentId, color);
    }
  }
  return colors;
}

/** Wire-length of a mention atom — must match docToWire token size. */
export function mentionWireLength(agentId: string): number {
  return 1 + agentId.length;
}

function createMentionElement(
  agentId: string,
  color: string,
  highlighted: boolean
): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.className = `${PREFIX}handoff-mention-pill${highlighted ? ` ${PREFIX}handoff-mention-pill-highlighted` : ""}`;
  pill.setAttribute(HANDOFF_MENTION_ATTR, "true");
  pill.setAttribute(HANDOFF_AGENT_ID_ATTR, agentId);
  pill.setAttribute("contenteditable", "false");
  pill.style.setProperty("--caliper-handoff-pill-color", color);
  pill.textContent = formatHandoffAgentIdPill(agentId, "full");
  return pill;
}

function countDocDomNodes(doc: HandoffNoteDoc): number {
  return doc.nodes.filter((node) => node.type !== "text" || node.text).length;
}

export function renderHandoffNoteDoc(
  root: HTMLElement,
  doc: HandoffNoteDoc,
  options: {
    colorByAgentId: Map<string, string>;
    highlightedAgentId?: string | null;
  }
): void {
  const wireBefore = parseHandoffNoteDom(root);
  const wireAfter = docToWire(doc);
  const domNodeCount = handoffNoteDomSnapshot(root).length;
  const structureMismatch = domNodeCount !== countDocDomNodes(doc);
  const hasStrayElements = handoffNoteDomSnapshot(root).some((node) => node.kind === "element");
  if (
    wireBefore === wireAfter &&
    root.childNodes.length > 0 &&
    !structureMismatch &&
    !hasStrayElements
  ) {
    updateMentionPresentation(root, options);
    return;
  }

  flattenHandoffNoteLog("dom.render", { wireBefore, wireAfter });

  root.replaceChildren();
  if (doc.nodes.length === 0) {
    return;
  }

  for (const node of doc.nodes) {
    if (node.type === "text") {
      if (node.text) {
        root.appendChild(document.createTextNode(node.text));
      }
      continue;
    }
    const color = options.colorByAgentId.get(node.agentId) ?? "";
    const highlighted = options.highlightedAgentId === node.agentId;
    root.appendChild(createMentionElement(node.agentId, color, highlighted));
  }
}

/** Update pill colors and highlight state without rebuilding DOM or touching selection. */
export function updateMentionPresentation(
  root: HTMLElement,
  options: {
    colorByAgentId: Map<string, string>;
    highlightedAgentId?: string | null;
  }
): void {
  const highlightedAgentId = options.highlightedAgentId ?? null;
  const pills = root.querySelectorAll<HTMLSpanElement>(`span[${HANDOFF_MENTION_ATTR}]`);
  for (const pill of pills) {
    const agentId = readMentionAgentId(pill);
    const color = options.colorByAgentId.get(agentId) ?? "";
    pill.style.setProperty("--caliper-handoff-pill-color", color);
    const on = highlightedAgentId !== null && agentId === highlightedAgentId;
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

/** Remove browser-generated wrapper elements; keep text nodes and mention pills only. */
export function normalizeHandoffNoteDom(
  root: HTMLElement,
  options?: { colorByAgentId?: Map<string, string> }
): boolean {
  const wireBefore = parseHandoffNoteDom(root);
  const doc = normalizeHandoffNoteDoc(parseHandoffNoteDomToDoc(root));
  const colorByAgentId = options?.colorByAgentId ?? readMentionColorsFromDom(root);
  const domBefore = handoffNoteDomSnapshot(root);
  renderHandoffNoteDoc(root, doc, { colorByAgentId });
  const wireAfter = parseHandoffNoteDom(root);
  const domAfter = handoffNoteDomSnapshot(root);
  const structureChanged =
    domBefore.length !== domAfter.length ||
    wireBefore !== wireAfter ||
    domAfter.some((node) => node.kind === "element");
  if (structureChanged) {
    flattenHandoffNoteLog("dom.normalize", {
      wireBefore,
      wireAfter,
      domNodeCountBefore: domBefore.length,
      domNodeCountAfter: domAfter.length,
    });
  }
  return structureChanged;
}
