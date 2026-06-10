import {
  formatHandoffAgentIdPill,
  HANDOFF_PALETTE,
  parseHandoffNoteSegments,
  type HandoffNoteSegment,
} from "@caliper/core";
import { PREFIX } from "../css/styles.js";

export type NoteCursorRect = {
  top: number;
  left: number;
  height: number;
};

export type NoteCursorSpace = "viewport" | "wrap";

const CURSOR_PROBE = "\u200b";

function readTextareaLineHeightPx(style: CSSStyleDeclaration): number {
  const fontSize = parseFloat(style.fontSize) || 13;
  const lineHeight = style.lineHeight;
  if (lineHeight.endsWith("px")) {
    return parseFloat(lineHeight) || fontSize * 1.4;
  }
  const ratio = parseFloat(lineHeight);
  if (Number.isFinite(ratio)) {
    return ratio * fontSize;
  }
  return fontSize * 1.4;
}

/**
 * Indices where the pill mirror places a unique caret marker.
 * Mention interiors share one visual point (full pill rendered) and must not be hit-tested.
 */
export function collectNoteCaretProbeIndices(
  note: string,
  segments: HandoffNoteSegment[] = parseHandoffNoteSegments(note)
): number[] {
  const indices = new Set<number>([0]);

  let offset = 0;
  for (const segment of segments) {
    if (segment.type === "text") {
      for (let i = 0; i <= segment.value.length; i++) {
        indices.add(offset + i);
      }
      offset += segment.value.length;
      continue;
    }

    const start = offset;
    const end = offset + 1 + segment.agentId.length;
    indices.add(start);
    indices.add(end);
    offset = end;
  }

  return [...indices].sort((a, b) => a - b);
}

function appendPill(parent: HTMLElement, agentId: string, color: string) {
  const pill = document.createElement("span");
  pill.className = `${PREFIX}handoff-mention-pill`;
  pill.style.setProperty("--caliper-handoff-pill-color", color);
  pill.textContent = formatHandoffAgentIdPill(agentId);
  parent.appendChild(pill);
}

/** Build mirror content up to `cursor`, using pill elements where mentions appear. */
function appendContentUpToCursor(
  parent: HTMLElement,
  segments: HandoffNoteSegment[],
  cursor: number,
  colorByAgentId: Map<string, string>
) {
  let offset = 0;

  for (const segment of segments) {
    if (segment.type === "text") {
      const end = offset + segment.value.length;
      if (cursor <= offset) {
        return;
      }
      if (cursor < end) {
        parent.appendChild(document.createTextNode(segment.value.slice(0, cursor - offset)));
        return;
      }
      parent.appendChild(document.createTextNode(segment.value));
      offset = end;
      continue;
    }

    const tokenLength = 1 + segment.agentId.length;
    const end = offset + tokenLength;
    const color = colorByAgentId.get(segment.agentId) ?? HANDOFF_PALETTE[0]!;

    if (cursor <= offset) {
      return;
    }
    if (cursor < end) {
      if (cursor - offset <= 1) {
        return;
      }
      appendPill(parent, segment.agentId, color);
      return;
    }

    appendPill(parent, segment.agentId, color);
    offset = end;
  }
}

/**
 * Measure note position using the pill mirror layout (not raw `@caliper-*` token width).
 * Pass `selectionStart` for caret (cursor); pass `@` trigger index for popover anchor.
 * - `wrap`: coordinates inside `.handoff-note-wrap` (custom caret)
 * - `viewport`: fixed coordinates for the mention popover anchor
 */
export function measureNoteCursor(
  textarea: HTMLTextAreaElement,
  options: {
    note: string;
    colorByAgentId: Map<string, string>;
    selectionStart?: number;
    space: NoteCursorSpace;
  }
): NoteCursorRect | null {
  const cursor = options.selectionStart ?? textarea.selectionStart ?? 0;
  const style = getComputedStyle(textarea);
  const segments = parseHandoffNoteSegments(options.note);

  const measureRoot = document.createElement("div");
  measureRoot.className = `${PREFIX}handoff-note-mirror`;
  measureRoot.style.position = "absolute";
  measureRoot.style.visibility = "hidden";
  measureRoot.style.top = "0";
  measureRoot.style.left = "-9999px";
  measureRoot.style.width = `${textarea.clientWidth}px`;
  measureRoot.style.boxSizing = "border-box";
  measureRoot.style.pointerEvents = "none";
  measureRoot.style.overflow = "hidden";
  measureRoot.style.whiteSpace = style.whiteSpace;
  measureRoot.style.overflowWrap = style.overflowWrap;
  measureRoot.style.fontFamily = style.fontFamily;
  measureRoot.style.fontSize = style.fontSize;
  measureRoot.style.lineHeight = style.lineHeight;
  measureRoot.style.padding = style.padding;
  measureRoot.style.scrollbarGutter = style.scrollbarGutter;

  appendContentUpToCursor(measureRoot, segments, cursor, options.colorByAgentId);

  const marker = document.createElement("span");
  marker.textContent = CURSOR_PROBE;
  measureRoot.appendChild(marker);

  document.body.appendChild(measureRoot);

  const rootRect = measureRoot.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const lineHeight = readTextareaLineHeightPx(style);

  document.body.removeChild(measureRoot);

  const markerTop = markerRect.top - rootRect.top;
  const markerLeft = markerRect.left - rootRect.left;

  if (options.space === "viewport") {
    const textareaRect = textarea.getBoundingClientRect();
    return {
      top: textareaRect.top + markerTop - textarea.scrollTop + lineHeight,
      left: textareaRect.left + markerLeft - textarea.scrollLeft,
      height: lineHeight,
    };
  }

  return {
    top: markerTop - textarea.scrollTop,
    left: markerLeft - textarea.scrollLeft,
    height: lineHeight,
  };
}

function snapCursorInsideMentions(
  textarea: HTMLTextAreaElement,
  index: number,
  clickX: number,
  options: {
    note: string;
    colorByAgentId: Map<string, string>;
  }
): number {
  const segments = parseHandoffNoteSegments(options.note);
  let offset = 0;

  for (const segment of segments) {
    if (segment.type === "text") {
      offset += segment.value.length;
      continue;
    }

    const tokenLength = 1 + segment.agentId.length;
    const start = offset;
    const end = offset + tokenLength;

    if (index > start && index < end) {
      const measureOpts = {
        note: options.note,
        colorByAgentId: options.colorByAgentId,
        space: "wrap" as const,
      };
      const startRect = measureNoteCursor(textarea, {
        ...measureOpts,
        selectionStart: start,
      });
      const endRect = measureNoteCursor(textarea, {
        ...measureOpts,
        selectionStart: end,
      });
      if (!startRect || !endRect) {
        return index;
      }
      return clickX < (startRect.left + endRect.left) / 2 ? start : end;
    }

    offset = end;
  }

  return index;
}

/**
 * Map a click to a note index using the pill mirror layout (not raw `@caliper-*` widths).
 */
export function resolveNoteCursorFromPoint(
  textarea: HTMLTextAreaElement,
  clientX: number,
  clientY: number,
  options: {
    note: string;
    colorByAgentId: Map<string, string>;
  }
): { index: number; clickXInWrap: number; nativeIndex: number } {
  const wrap = textarea.closest(`.${PREFIX}handoff-note-wrap`);
  const nativeIndex = textarea.selectionStart ?? 0;

  if (!wrap) {
    return { index: nativeIndex, clickXInWrap: 0, nativeIndex };
  }

  const wrapRect = wrap.getBoundingClientRect();
  const clickXInWrap = clientX - wrapRect.left;
  const clickYInWrap = clientY - wrapRect.top;
  const segments = parseHandoffNoteSegments(options.note);
  const probeIndices = collectNoteCaretProbeIndices(options.note, segments);
  const measureOpts = {
    note: options.note,
    colorByAgentId: options.colorByAgentId,
    space: "wrap" as const,
  };

  let bestIndex = probeIndices[0] ?? 0;
  let bestDistance2D = Infinity;

  for (const index of probeIndices) {
    const rect = measureNoteCursor(textarea, { ...measureOpts, selectionStart: index });
    if (!rect) {
      continue;
    }
    const distance2D = Math.hypot(rect.left - clickXInWrap, rect.top - clickYInWrap);
    if (distance2D < bestDistance2D) {
      bestDistance2D = distance2D;
      bestIndex = index;
    }
  }

  const chosenIndex = snapCursorInsideMentions(textarea, bestIndex, clickXInWrap, options);
  return { index: chosenIndex, clickXInWrap, nativeIndex };
}
