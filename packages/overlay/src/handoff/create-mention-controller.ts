import type { HandoffRegistryItem } from "@caliper/core";
import { filterHandoffItems, isExactHandoffMentionQuery } from "@caliper/core";

export type MentionSession = {
  open: boolean;
  queryStart: number;
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
  queryStart: -1,
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
    options.onHighlight(null);
    notifyOpen();
  }

  function parseSession(text: string, cursor: number): MentionSession {
    const beforeCursor = text.slice(0, cursor);
    const activeMatch = beforeCursor.match(/@([^\s@]*)$/);
    if (!activeMatch || activeMatch.index === undefined) {
      return { ...CLOSED };
    }

    const query = activeMatch[1] ?? "";
    const queryStart = activeMatch.index;

    return {
      open: true,
      queryStart,
      query,
      highlightIndex:
        session.open && session.queryStart === queryStart ? session.highlightIndex : 0,
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
    if (top + popoverHeight > viewport.height - viewportMargin) {
      const above = anchor.top - popoverHeight - margin;
      top = above >= viewportMargin ? above : viewport.height - viewportMargin - popoverHeight;
    }

    let left = anchor.left;
    if (left + maxWidth > viewport.width - viewportMargin) {
      left = viewport.width - viewportMargin - maxWidth;
    }
    left = Math.max(viewportMargin, left);

    return { top, left, maxWidth };
  }

  function insertMention(textarea: HTMLTextAreaElement, agentId: string) {
    const cursor = textarea.selectionStart ?? textarea.value.length;
    const before = textarea.value.slice(0, session.queryStart);
    const after = textarea.value.slice(cursor);
    const token = `@${agentId} `;
    const nextValue = `${before}${token}${after}`;
    const nextCursor = before.length + token.length;
    textarea.value = nextValue;
    textarea.setSelectionRange(nextCursor, nextCursor);
    options.onNoteChange(nextValue);
    closeSession();
  }

  function selectHighlighted(textarea: HTMLTextAreaElement): boolean {
    const items = getFilteredItems();
    const item = items[session.highlightIndex];
    if (!item) {
      closeSession();
      return false;
    }
    insertMention(textarea, item.agentId);
    return true;
  }

  return {
    isOpen: () => session.open,
    getSession: () => session,
    getFilteredItems,
    resolveMentionPopoverPosition,
    handleInput(textarea: HTMLTextAreaElement) {
      const cursor = textarea.selectionStart ?? textarea.value.length;
      const wasOpen = session.open;
      const previousQuery = session.query;
      let next = parseSession(textarea.value, cursor);
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
    handleKeyDown(textarea: HTMLTextAreaElement, event: KeyboardEvent): boolean {
      if (!session.open) {
        return false;
      }

      const items = getFilteredItems();

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (items.length === 0) {
          return true;
        }
        session = {
          ...session,
          highlightIndex: (session.highlightIndex + 1) % items.length,
        };
        syncHighlight(items);
        return true;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (items.length === 0) {
          return true;
        }
        session = {
          ...session,
          highlightIndex: (session.highlightIndex - 1 + items.length) % items.length,
        };
        syncHighlight(items);
        return true;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return selectHighlighted(textarea);
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
