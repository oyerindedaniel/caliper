import type { HandoffNoteDocPos, HandoffRegistryItem } from "@caliper/core";

import {
  docPosEqual,
  docPosToWireOffset,
  filterHandoffItems,
  isArrow,
  isExactHandoffMentionQuery,
  resolveActiveHandoffMentionQueryDoc,
  wireOffsetToDocPos,
  type HandoffNoteDoc,
  type HandoffNoteSelection,
} from "@caliper/core";

import { flattenHandoffNoteLog } from "./handoff-note-debug.js";
import type { HandoffNoteEditorHost } from "./note-editor/create-handoff-note-editor.js";

/** Doc end for an active `@query` token — always consumes the leading `@`. */
export function resolveActiveMentionReplaceEnd(
  session: Pick<MentionSession, "open" | "queryStart" | "query">,
  doc: HandoffNoteDoc,
  focus: HandoffNoteDocPos
): HandoffNoteDocPos {
  if (!session.open || !session.queryStart) {
    return focus;
  }
  const startWire = docPosToWireOffset(doc, session.queryStart);
  const endWire = startWire + 1 + session.query.length;
  return wireOffsetToDocPos(doc, endWire);
}

export type MentionSession = {
  open: boolean;
  queryStart: HandoffNoteDocPos | null;
  query: string;
  highlightIndex: number;
};

export type MentionAnchorRect = {
  top: number;
  left: number;
  height: number;
};

const CLOSED: MentionSession = {
  open: false,
  queryStart: null,
  query: "",
  highlightIndex: 0,
};

export type MentionControllerOptions = {
  getItems: () => HandoffRegistryItem[];
  onNoteChange: (note: string) => void;
  onHighlight: (agentId: string | null) => void;
  onOpenChange?: (open: boolean) => void;
};

export function createMentionController(options: MentionControllerOptions) {
  let session: MentionSession = { ...CLOSED };

  function notifyOpen() {
    options.onOpenChange?.(session.open);
  }

  function closeSession() {
    if (!session.open) {
      return;
    }
    session = { ...CLOSED };
    notifyOpen();
    options.onHighlight(null);
  }

  function parseSession(doc: HandoffNoteDoc, selection: HandoffNoteSelection): MentionSession {
    const active = resolveActiveHandoffMentionQueryDoc(doc, selection);
    if (!active) {
      return { ...CLOSED };
    }

    return {
      open: true,
      queryStart: active.queryStart,
      query: active.query,
      highlightIndex:
        session.open && session.queryStart && docPosEqual(session.queryStart, active.queryStart)
          ? session.highlightIndex
          : 0,
    };
  }

  function getFilteredItems(): HandoffRegistryItem[] {
    if (!session.open) {
      return [];
    }
    return filterHandoffItems(options.getItems(), session.query);
  }

  function syncHighlight(items: HandoffRegistryItem[]) {
    if (!session.open) {
      options.onHighlight(null);
      return;
    }
    if (items.length === 0) {
      session = { ...session, highlightIndex: 0 };
      options.onHighlight(null);
      return;
    }
    const index = Math.min(session.highlightIndex, items.length - 1);
    if (index !== session.highlightIndex) {
      session = { ...session, highlightIndex: index };
    }
    options.onHighlight(items[index]?.agentId ?? null);
  }

  function resolveMentionPopoverPosition(
    anchor: MentionAnchorRect,
    viewport: { width: number; height: number },
    popoverWidth: number,
    popoverHeight: number
  ) {
    const margin = 6;
    const viewportMargin = 12;
    const maxWidth = Math.min(popoverWidth, viewport.width - viewportMargin * 2);

    let top = anchor.top + margin;
    let side: "top" | "bottom" = "bottom";
    if (top + popoverHeight > viewport.height - viewportMargin) {
      const above = anchor.top - popoverHeight - margin;
      if (above >= viewportMargin) {
        top = above;
        side = "top";
      } else {
        top = viewport.height - viewportMargin - popoverHeight;
      }
    }

    let left = anchor.left;
    if (left + maxWidth > viewport.width - viewportMargin) {
      left = viewport.width - viewportMargin - maxWidth;
    }
    left = Math.max(viewportMargin, left);

    return { top, left, maxWidth, side };
  }

  function insertMention(editor: HandoffNoteEditorHost, agentId: string) {
    const activeSession = { ...session };
    const doc = editor.getDoc();
    const selection = editor.getSelectionState();
    const wire = editor.getWire();
    const replaceStart = activeSession.queryStart!;
    const replaceEnd = resolveActiveMentionReplaceEnd(activeSession, doc, selection.focus);

    editor.insertMentionAtomAt(agentId, replaceStart, replaceEnd);

    flattenHandoffNoteLog("mention.insert", {
      agentId,
      wireBefore: wire,
      wireAfter: editor.getWire(),
      queryStart: docPosToWireOffset(doc, replaceStart),
      replaceEnd: docPosToWireOffset(doc, replaceEnd),
      liveCursorAtCommit: editor.getCursor(),
      cursorAfter: editor.getCursor(),
    });

    options.onNoteChange(editor.getWire());

    closeSession();
  }

  function selectHighlighted(editor: HandoffNoteEditorHost): boolean {
    const items = getFilteredItems();
    const item = items[session.highlightIndex];
    if (!item) {
      closeSession();
      return false;
    }

    insertMention(editor, item.agentId);

    return true;
  }

  return {
    isOpen: () => session.open,
    getSession: () => session,
    getFilteredItems,
    resolveMentionPopoverPosition,
    handleInput(editor: HandoffNoteEditorHost) {
      const doc = editor.getDoc();
      const selection = editor.getSelectionState();
      const cursor = editor.getCursor();
      const wire = editor.getWire();
      const wasOpen = session.open;
      const previousQuery = session.query;

      let next = parseSession(doc, selection);
      if (
        next.open &&
        !wasOpen &&
        isExactHandoffMentionQuery(
          next.query,

          options.getItems().map((item) => item.agentId)
        )
      ) {
        next = { ...CLOSED };
      }

      if (
        next.open !== wasOpen ||
        next.query !== previousQuery ||
        (next.queryStart &&
          session.queryStart &&
          !docPosEqual(next.queryStart, session.queryStart)) ||
        (next.queryStart && !session.queryStart) ||
        (!next.queryStart && session.queryStart)
      ) {
        flattenHandoffNoteLog("mention.session", {
          wire,
          cursor,
          wasOpen,
          previousQuery,
          next,
          wireSlice:
            next.open && next.queryStart
              ? wire.slice(docPosToWireOffset(doc, next.queryStart), cursor)
              : undefined,
        });
      }

      session = next;

      if (session.open) {
        if (!wasOpen || session.query !== previousQuery) {
          session = { ...session, highlightIndex: 0 };
        }

        syncHighlight(getFilteredItems());
      } else if (wasOpen) {
        options.onHighlight(null);
      }
      notifyOpen();
    },

    handleKeyDown(editor: HandoffNoteEditorHost, event: KeyboardEvent): boolean {
      if (!session.open) {
        return false;
      }

      const items = getFilteredItems();

      if (isArrow.ver(event)) {
        if (items.length === 0) {
          closeSession();
          return false;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        session = {
          ...session,
          highlightIndex: isArrow.down(event)
            ? (session.highlightIndex + 1) % items.length
            : (session.highlightIndex - 1 + items.length) % items.length,
        };
        syncHighlight(items);
        return true;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return selectHighlighted(editor);
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeSession();
        return true;
      }

      if (event.key === " ") {
        closeSession();
        event.stopImmediatePropagation();
        return false;
      }

      return false;
    },
    closeSession,
    commitMention(editor: HandoffNoteEditorHost, agentId: string): boolean {
      if (!session.open) {
        return false;
      }
      insertMention(editor, agentId);
      return true;
    },

    setHighlightByAgentId(agentId: string) {
      if (!session.open) {
        return;
      }
      const items = getFilteredItems();
      const index = items.findIndex((item) => item.agentId === agentId);
      if (index < 0) {
        return;
      }
      session = { ...session, highlightIndex: index };
      options.onHighlight(agentId);
    },
    moveHighlight(delta: -1 | 1) {
      const items = getFilteredItems();
      if (!session.open || items.length === 0) {
        return;
      }
      const nextIndex = (session.highlightIndex + delta + items.length) % items.length;
      session = { ...session, highlightIndex: nextIndex };
      syncHighlight(items);
    },
    selectHighlighted,
  };
}

export type MentionController = ReturnType<typeof createMentionController>;
