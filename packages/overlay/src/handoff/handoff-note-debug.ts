// DO NOT DELETE THIS FILE
const LOG_PREFIX = "[handoff-note]";

/** Filter console with `ce.` / `caret>>` / `mention.` / `dom.` for pipeline traces. */
export function flattenHandoffNoteLog(
  event: string,
  data: Record<string, unknown> = {},
  level: "log" | "warn" = "log"
): void {
  const line = JSON.stringify({ event, ts: Date.now(), ...data });
  if (level === "warn") {
    console.warn(`${LOG_PREFIX} ${event}`, line);
    return;
  }
  console.log(`${LOG_PREFIX} ${event}`, line);
}

export function logCaretTrace(source: string, data: Record<string, unknown> = {}): void {
  flattenHandoffNoteLog(`caret>>${source}`, data);
}

export function handoffNoteDomSnapshot(
  root: HTMLElement | undefined
): Array<Record<string, unknown>> {
  if (!root) {
    return [];
  }
  return [...root.childNodes].map((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return { kind: "text", value: node.textContent ?? "" };
    }
    if (node instanceof HTMLSpanElement && node.hasAttribute("data-handoff-mention")) {
      return {
        kind: "mention",
        agentId: node.getAttribute("data-agent-id") ?? "",
        label: node.textContent ?? "",
      };
    }
    if (node instanceof HTMLElement) {
      return { kind: "element", tag: node.tagName, text: node.textContent ?? "" };
    }
    return { kind: "node", type: node.nodeType };
  });
}

export function handoffNoteSelectionSnapshot(
  root: HTMLElement | undefined
): Record<string, unknown> {
  if (!root) {
    return { start: 0, end: 0 };
  }
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { start: 0, end: 0, empty: true };
  }
  const range = selection.getRangeAt(0);
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  const anchorInPill =
    anchor instanceof Node &&
    root.contains(anchor) &&
    anchor.parentElement?.closest?.("[data-handoff-mention]") !== null;
  return {
    anchorNodeKind: anchor?.nodeType,
    anchorOffset: selection.anchorOffset,
    focusOffset: selection.focusOffset,
    rangeStartContainerKind: range.startContainer.nodeType,
    rangeStartOffset: range.startOffset,
    rangeEndOffset: range.endOffset,
    rangeStartText: range.startContainer.textContent?.slice(
      Math.max(0, range.startOffset - 8),
      range.startOffset + 8
    ),
    anchorInMentionPill: anchorInPill,
    collapsed: range.collapsed,
    anchorEqFocus: anchor === focus,
  };
}
