import type {
  CaliperHandoffItem,
  CaliperHandoffState,
  CaliperSelectorInput,
} from "@oyerinde/caliper-schema";
import { deduceGeometry } from "@/geometry/utils/scroll-aware.js";
import type { SelectionMetadata } from "@/measurement-model/utils/selection-system.js";
import { buildSelectorInfo } from "@/shared/utils/selector.js";
import { assignColorIndex } from "./handoff-colors.js";
import {
  handoffResolvedNoteToWire,
  isHandoffPendingNoteEmpty,
  resolveHandoffNote,
} from "./handoff-note.js";
import { readPersistedHandoff } from "./handoff-session.js";
import { sanitizeHandoffSelection } from "./sanitize-handoff-selection.js";

type InternalHandoffItem = {
  agentId: string;
  element: Element;
  metadata: SelectionMetadata;
  fingerprint: CaliperSelectorInput;
  colorIndex: number;
  createdAt: number;
  updatedAt: number;
};

type LastCommittedHandoff = {
  state: CaliperHandoffState;
  wireNote: string;
};

export type HandoffPresentation = "visible" | "hiding" | "hidden";

export type HandoffRegistryItem = Pick<
  InternalHandoffItem,
  "agentId" | "element" | "metadata" | "fingerprint" | "colorIndex"
>;

/** Live overlay session while the user is collecting items. */
export type HandoffUIState = {
  items: CaliperHandoffItem[];
  activeItemId: string | null;
  highlightedAgentId: string | null;
  highlightShakeTick: number;
  inputOpen: boolean;
  presentation: HandoffPresentation;
};

export type HandoffRegistryListener = (state: HandoffUIState | null) => void;
export type HandoffCommitListener = (state: CaliperHandoffState) => void;

export type HandoffElementResolver = (fingerprint: CaliperSelectorInput) => Element | null;

export type RehydrateCommittedOptions = {
  openInput?: boolean;
  resolve?: HandoffElementResolver;
};

export interface HandoffRegistry {
  toggle: (element: Element) => boolean;
  remove: (agentId: string) => boolean;
  clear: () => void;
  setInputOpen: (open: boolean) => void;
  setPendingNote: (note: string) => void;
  getPendingNote: () => string;
  resetPendingNote: () => void;
  setHighlightedAgentId: (agentId: string | null) => void;
  commitSession: () => CaliperHandoffState | null;
  getLastCommitted: () => LastCommittedHandoff | null;
  rehydrateFromCommitted: (
    snapshot: CaliperHandoffState,
    wireNote: string,
    options?: RehydrateCommittedOptions
  ) => number;
  getUIState: () => HandoffUIState | null;
  getItems: () => HandoffRegistryItem[];
  getActiveItem: () => HandoffRegistryItem | null;
  getItemByAgentId: (agentId: string) => HandoffRegistryItem | null;
  isInputOpen: () => boolean;
  getPresentation: () => HandoffPresentation;
  restoreFromState(
    snapshot: CaliperHandoffState | HandoffUIState,
    resolve?: HandoffElementResolver
  ): number;
  refreshGeometry: () => void;
  onUpdate: (callback: HandoffRegistryListener) => () => void;
  onCommit: (callback: HandoffCommitListener) => () => void;
}

function metadataFromElement(element: Element): SelectionMetadata {
  const geometry = deduceGeometry(element);
  return {
    element,
    rect: geometry.rect,
    scrollHierarchy: geometry.scrollHierarchy,
    position: geometry.position,
    stickyConfig: geometry.stickyConfig,
    initialWindowX: geometry.initialWindowX,
    initialWindowY: geometry.initialWindowY,
    depth: geometry.depth,
    hasContainingBlock: !!geometry.containingBlock,
  };
}

function serializeItem(item: InternalHandoffItem): CaliperHandoffItem {
  return {
    agentId: item.agentId,
    fingerprint: item.fingerprint,
    selection: sanitizeHandoffSelection(item.metadata),
    colorIndex: item.colorIndex,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function handoffUIStateEquals(a: HandoffUIState | null, b: HandoffUIState | null): boolean {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }

  if (
    a.activeItemId !== b.activeItemId ||
    a.highlightedAgentId !== b.highlightedAgentId ||
    a.highlightShakeTick !== b.highlightShakeTick ||
    a.inputOpen !== b.inputOpen ||
    a.presentation !== b.presentation ||
    a.items.length !== b.items.length
  ) {
    return false;
  }

  for (let i = 0; i < a.items.length; i += 1) {
    const left = a.items[i]!;
    const right = b.items[i]!;
    if (
      left.agentId !== right.agentId ||
      left.colorIndex !== right.colorIndex ||
      left.createdAt !== right.createdAt ||
      left.updatedAt !== right.updatedAt
    ) {
      return false;
    }
  }

  return true;
}

function seedLastCommittedFromPersisted(): LastCommittedHandoff | null {
  const persisted = readPersistedHandoff();
  if (!persisted || persisted.items.length === 0) {
    return null;
  }
  return {
    state: persisted,
    wireNote: handoffResolvedNoteToWire(
      persisted.note,
      persisted.items.map((item) => item.agentId)
    ),
  };
}

function resolveActiveItemId(
  snapshot: CaliperHandoffState | HandoffUIState,
  restoredItems: Map<string, InternalHandoffItem>
): string | null {
  const preferred = "activeItemId" in snapshot ? snapshot.activeItemId : null;
  if (preferred && restoredItems.has(preferred)) {
    return preferred;
  }
  return [...restoredItems.keys()].pop() ?? null;
}

export function createHandoffRegistry(resolveElement?: HandoffElementResolver): HandoffRegistry {
  const items = new Map<string, InternalHandoffItem>();
  let activeItemId: string | null = null;
  let highlightedAgentId: string | null = null;
  let highlightShakeTick = 0;
  let inputOpen = false;
  let presentation: HandoffPresentation = "hidden";
  /** Live editor wire (`@caliper-…` pills) while drafting; cleared on commit. */
  let pendingNote = "";
  /** Last successful commit: agent `state.note` is resolved; `wireNote` keeps editor wire. */
  let lastCommitted: LastCommittedHandoff | null = seedLastCommittedFromPersisted();
  let lastNotifiedUIState: HandoffUIState | null = null;
  const listeners = new Set<HandoffRegistryListener>();
  const commitListeners = new Set<HandoffCommitListener>();

  function buildUIState(): HandoffUIState | null {
    if (items.size === 0) {
      return null;
    }

    return {
      items: [...items.values()].map(serializeItem),
      activeItemId,
      highlightedAgentId,
      highlightShakeTick,
      inputOpen,
      presentation,
    };
  }

  function notifyUI() {
    const state = buildUIState();
    if (handoffUIStateEquals(state, lastNotifiedUIState)) {
      return;
    }
    lastNotifiedUIState = state;
    listeners.forEach((listener) => listener(state));
  }

  function touchItem(item: InternalHandoffItem) {
    item.updatedAt = Date.now();
  }

  function refreshGeometry(options: { evenIfHidden?: boolean } = {}) {
    if (!options.evenIfHidden && presentation !== "visible") {
      return;
    }

    for (const item of items.values()) {
      if (!document.contains(item.element)) {
        continue;
      }
      item.metadata = metadataFromElement(item.element);
      item.fingerprint = buildSelectorInfo(item.element, item.metadata);
      touchItem(item);
    }
  }

  function showBoxesIfNeeded() {
    if (items.size > 0 && presentation === "hidden") {
      presentation = "visible";
      refreshGeometry({ evenIfHidden: true });
    }
  }

  function clearLiveSession() {
    items.clear();
    activeItemId = null;
    highlightedAgentId = null;
    highlightShakeTick = 0;
    inputOpen = false;
    presentation = "hidden";
    pendingNote = "";
    notifyUI();
  }

  function restoreItemsFromSnapshot(
    snapshot: CaliperHandoffState | HandoffUIState,
    resolveFn?: HandoffElementResolver
  ): number {
    items.clear();
    let restored = 0;

    for (const wireItem of snapshot.items) {
      const element = resolveFn?.(wireItem.fingerprint) ?? null;
      if (!element) {
        continue;
      }

      const metadata = metadataFromElement(element);
      items.set(wireItem.agentId, {
        agentId: wireItem.agentId,
        element,
        metadata,
        fingerprint: wireItem.fingerprint,
        colorIndex: wireItem.colorIndex ?? assignColorIndex(restored),
        createdAt: wireItem.createdAt,
        updatedAt: wireItem.updatedAt,
      });
      restored += 1;
    }

    activeItemId = resolveActiveItemId(snapshot, items);
    highlightedAgentId = null;
    highlightShakeTick = 0;
    presentation = items.size === 0 ? "hidden" : "visible";
    refreshGeometry({ evenIfHidden: true });
    return restored;
  }

  return {
    toggle(element) {
      const metadata = metadataFromElement(element);
      const fingerprint = buildSelectorInfo(element, metadata);
      const agentId = fingerprint.selector;

      const existing = items.get(agentId);
      if (existing) {
        items.delete(agentId);
        if (activeItemId === agentId) {
          activeItemId = [...items.keys()].pop() ?? null;
        }
        if (highlightedAgentId === agentId) {
          highlightedAgentId = null;
        }
        if (items.size === 0) {
          inputOpen = false;
          presentation = "hidden";
        }
        notifyUI();
        return false;
      }

      const now = Date.now();
      items.set(agentId, {
        agentId,
        element,
        metadata,
        fingerprint,
        colorIndex: assignColorIndex(items.size),
        createdAt: now,
        updatedAt: now,
      });
      activeItemId = agentId;
      showBoxesIfNeeded();
      notifyUI();
      return true;
    },

    remove(agentId) {
      if (!items.has(agentId)) {
        return false;
      }

      items.delete(agentId);
      if (activeItemId === agentId) {
        activeItemId = [...items.keys()].pop() ?? null;
      }
      if (highlightedAgentId === agentId) {
        highlightedAgentId = null;
      }
      if (items.size === 0) {
        inputOpen = false;
        activeItemId = null;
        presentation = "hidden";
      }
      notifyUI();
      return true;
    },

    clear() {
      lastCommitted = null;
      clearLiveSession();
    },

    setInputOpen(open) {
      const revealing = open && items.size > 0 && presentation === "hidden";
      inputOpen = open;
      if (open && items.size > 0) {
        presentation = "visible";
      }
      if (revealing) {
        refreshGeometry({ evenIfHidden: true });
      }
      notifyUI();
    },

    setPendingNote(note) {
      pendingNote = note;
    },

    getPendingNote: () => pendingNote,

    resetPendingNote() {
      pendingNote = "";
    },

    setHighlightedAgentId(agentId) {
      if (agentId !== null && !items.has(agentId)) {
        return;
      }
      if (agentId !== null) {
        highlightShakeTick += 1;
      }
      highlightedAgentId = agentId;
      notifyUI();
    },

    commitSession() {
      if (items.size === 0) {
        return null;
      }

      if (isHandoffPendingNoteEmpty(pendingNote)) {
        return null;
      }

      const committed: CaliperHandoffState = {
        items: [...items.values()].map(serializeItem),
        note: resolveHandoffNote(pendingNote),
      };

      lastCommitted = {
        state: committed,
        wireNote: pendingNote,
      };

      commitListeners.forEach((listener) => listener(committed));
      clearLiveSession();
      return committed;
    },

    getLastCommitted: () => lastCommitted,

    rehydrateFromCommitted(snapshot, wireNote, options = {}) {
      const resolveFn = options.resolve ?? resolveElement;
      const restored = restoreItemsFromSnapshot(snapshot, resolveFn);
      pendingNote = wireNote;
      inputOpen = options.openInput === true && restored > 0;
      if (inputOpen) {
        presentation = "visible";
      }
      notifyUI();
      return restored;
    },

    getUIState: buildUIState,

    getItems: () => [...items.values()],

    getActiveItem: () => (activeItemId ? (items.get(activeItemId) ?? null) : null),

    getItemByAgentId: (agentId) => items.get(agentId) ?? null,

    isInputOpen: () => inputOpen,

    getPresentation: () => presentation,

    restoreFromState(snapshot, resolve) {
      const resolveFn = resolve ?? resolveElement;
      const restored = restoreItemsFromSnapshot(snapshot, resolveFn);
      inputOpen = "inputOpen" in snapshot ? snapshot.inputOpen && items.size > 0 : false;
      if ("note" in snapshot && typeof snapshot.note === "string") {
        pendingNote = handoffResolvedNoteToWire(
          snapshot.note,
          snapshot.items.map((item) => item.agentId)
        );
      }
      notifyUI();
      return restored;
    },

    refreshGeometry() {
      refreshGeometry();
    },

    onUpdate(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    onCommit(callback) {
      commitListeners.add(callback);
      return () => commitListeners.delete(callback);
    },
  };
}
