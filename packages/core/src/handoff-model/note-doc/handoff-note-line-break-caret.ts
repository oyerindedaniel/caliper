import {
  offsetAtDocPosition,
  resolveDocPosition,
  type HandoffNoteDoc,
} from "./handoff-note-doc.js";

/** Enable caret-boundary traces with HANDOFF_NOTE_LINE_BREAK_CARET_TRACE=1 */
export function isHandoffNoteEnvTraceEnabled(envVar: string): boolean {
  return typeof process !== "undefined" && process.env[envVar] === "1";
}

export function traceLineBreakCaretBoundary(branch: string, fields: Record<string, unknown>): void {
  if (!isHandoffNoteEnvTraceEnabled("HANDOFF_NOTE_LINE_BREAK_CARET_TRACE")) {
    return;
  }
  console.log(JSON.stringify({ event: "lineBreak.caret", branch, ...fields }));
}

type LineBreakCaretRun = {
  textStartWire: number;
  suffixStartWire: number;
  beforeMention: boolean;
  afterMention: boolean;
  atLastContent: boolean;
  inSuffix: boolean;
};

/** Index in a text node where trailing `\n` run begins. */
export function lineBreakSuffixStartInText(text: string): number {
  let index = text.length;
  while (index > 0 && text[index - 1] === "\n") {
    index--;
  }
  return index;
}

function resolveLineBreakSuffixStartInNode(
  text: string,
  beforeMention: boolean,
  afterMention: boolean
): number {
  const trailingSuffixStart = lineBreakSuffixStartInText(text);
  if (trailingSuffixStart < text.length) {
    return trailingSuffixStart;
  }
  if ((beforeMention || afterMention) && /^\s+\n/.test(text)) {
    return text.indexOf("\n");
  }
  return text.length;
}

/** Caret context for Shift+Enter in mention-adjacent text nodes with inline `\n` runs. */
export function describeLineBreakCaretRun(
  doc: HandoffNoteDoc,
  wire: string,
  offset: number
): LineBreakCaretRun | null {
  const clamped = Math.max(0, Math.min(offset, wire.length));
  const pos = resolveDocPosition(doc, clamped);
  if (pos === null) {
    return null;
  }

  const node = doc.nodes[pos.nodeIndex];
  if (node?.type !== "text") {
    return null;
  }

  const suffixStartInNode = resolveLineBreakSuffixStartInNode(
    node.text,
    doc.nodes[pos.nodeIndex + 1]?.type === "mention",
    doc.nodes[pos.nodeIndex - 1]?.type === "mention"
  );
  const textStartWire = offsetAtDocPosition(doc, pos.nodeIndex, 0);
  const textEndWire = textStartWire + node.text.length;
  const lastContentInNode = Math.max(0, suffixStartInNode - 1);
  const lastContentWire = textStartWire + lastContentInNode;
  const suffixStartWire = textStartWire + suffixStartInNode;
  const beforeMention = doc.nodes[pos.nodeIndex + 1]?.type === "mention";
  const afterMention = doc.nodes[pos.nodeIndex - 1]?.type === "mention";

  if (suffixStartInNode >= node.text.length) {
    if (!beforeMention && !afterMention) {
      return null;
    }
    return {
      textStartWire,
      suffixStartWire: textEndWire,
      beforeMention,
      afterMention,
      atLastContent:
        clamped === lastContentWire || (clamped === textEndWire && (beforeMention || afterMention)),
      inSuffix: false,
    };
  }

  return {
    textStartWire,
    suffixStartWire,
    beforeMention,
    afterMention,
    atLastContent:
      clamped === lastContentWire || (clamped === textEndWire && (beforeMention || afterMention)),
    inSuffix: clamped >= suffixStartWire && clamped < textEndWire && wire[clamped] === "\n",
  };
}
