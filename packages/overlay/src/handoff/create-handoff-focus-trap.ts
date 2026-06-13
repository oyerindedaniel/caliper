import { createEffect, type Accessor } from "solid-js";
import { isArrow } from "@caliper/core";
import { getHandoffNoteEditorTabStops } from "./note-editor/handoff-note-dom.js";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function queryFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex !== -1
  );
}

function getTrapFocusables(
  mentionOpen: boolean,
  panelRoot: HTMLElement | undefined,
  popoverRoot: HTMLElement | undefined,
  editorRoot: HTMLElement | undefined
): HTMLElement[] {
  if (mentionOpen && popoverRoot) {
    const popoverFocusables = queryFocusable(popoverRoot);
    if (popoverFocusables.length > 0) {
      return popoverFocusables;
    }
    if (popoverRoot.tabIndex < 0) {
      popoverRoot.tabIndex = 0;
    }
    return [popoverRoot];
  }

  if (editorRoot) {
    return getHandoffNoteEditorTabStops(editorRoot);
  }

  if (panelRoot) {
    const panelFocusables = queryFocusable(panelRoot);
    if (panelFocusables.length > 0) {
      return panelFocusables;
    }
  }

  return [];
}

function resolveTrapFocusIndex(focusables: HTMLElement[], active: HTMLElement | null): number {
  if (!active) {
    return -1;
  }
  const direct = focusables.indexOf(active);
  if (direct >= 0) {
    return direct;
  }
  return focusables.findIndex((element) => element === active || element.contains(active));
}

function wrapTrapFocusIndex(index: number, focusableCount: number, shiftKey: boolean): number {
  if (shiftKey) {
    return index <= 0 ? focusableCount - 1 : index - 1;
  }
  if (index < 0 || index >= focusableCount - 1) {
    return 0;
  }
  return index + 1;
}

function containsFocusableScope(scope: HTMLElement[], target: Node | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  return scope.some((root) => root === target || root.contains(target));
}

export type HandoffMentionListKeyboardOptions = {
  mentionOpen: Accessor<boolean>;
  isSessionOpen: Accessor<boolean>;
  editorRoot: Accessor<HTMLElement | undefined>;
  popoverRoot: Accessor<HTMLElement | undefined>;
  highlightedAgentId: Accessor<string | null>;
  optionIdPrefix: string;
  handleKeyDown: (event: KeyboardEvent) => boolean;
  onHandled: () => void;
};

export type HandoffFocusTrapOptions = {
  enabled: Accessor<boolean>;
  mentionOpen: Accessor<boolean>;
  panelRoot: Accessor<HTMLElement | undefined>;
  popoverRoot: Accessor<HTMLElement | undefined>;
  editorRoot: Accessor<HTMLElement | undefined>;
  /** Routes listbox keys while the popover has focus (Tab trap moves focus off the editor). */
  mentionListKeyboard?: HandoffMentionListKeyboardOptions;
};

export function wireHandoffFocusTrap(options: HandoffFocusTrapOptions): () => void {
  const getScopeRoots = (): HTMLElement[] => {
    const roots: HTMLElement[] = [];
    const panel = options.panelRoot();
    const popover = options.popoverRoot();
    if (panel) {
      roots.push(panel);
    }
    if (options.mentionOpen() && popover) {
      roots.push(popover);
    }
    return roots;
  };

  const getFocusables = () =>
    getTrapFocusables(
      options.mentionOpen(),
      options.panelRoot(),
      options.popoverRoot(),
      options.editorRoot()
    );

  const restoreFocus = () => {
    const focusables = getFocusables();
    const preferred = focusables[0] ?? options.editorRoot();
    preferred?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!options.enabled() || event.key !== "Tab") {
      return;
    }

    const focusables = getFocusables();
    if (focusables.length === 0) {
      event.preventDefault();
      restoreFocus();
      return;
    }

    if (focusables.length === 1) {
      event.preventDefault();
      focusables[0]!.focus();
      return;
    }

    const index = resolveTrapFocusIndex(focusables, document.activeElement as HTMLElement | null);
    const nextIndex = wrapTrapFocusIndex(index, focusables.length, event.shiftKey);

    event.preventDefault();
    focusables[nextIndex]!.focus();
  };

  const handleFocusIn = (event: FocusEvent) => {
    if (!options.enabled()) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node) || containsFocusableScope(getScopeRoots(), target)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    restoreFocus();
  };

  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("focusin", handleFocusIn, true);

  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("focusin", handleFocusIn, true);
  };
}

const MENTION_LIST_KEYBOARD_KEYS = new Set(["Enter", "ArrowUp", "ArrowDown", "Escape", " "]);

export function wireHandoffMentionListKeyboard(
  options: HandoffMentionListKeyboardOptions
): () => void {
  const focusHighlightedOption = () => {
    const agentId = options.highlightedAgentId();
    const popover = options.popoverRoot();
    if (!agentId || !popover) {
      return;
    }
    const option = popover.querySelector<HTMLElement>(
      `#${CSS.escape(`${options.optionIdPrefix}${agentId}`)}`
    );
    option?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!options.mentionOpen() || !options.isSessionOpen()) {
      return;
    }

    if (!MENTION_LIST_KEYBOARD_KEYS.has(event.key)) {
      return;
    }

    if (event.key === "Enter" && event.shiftKey) {
      return;
    }

    if (!options.editorRoot()) {
      return;
    }

    const handled = options.handleKeyDown(event);
    if (!handled) {
      return;
    }

    options.onHandled();

    if (isArrow.ver(event)) {
      focusHighlightedOption();
      return;
    }

    if (event.key === "Enter") {
      options.editorRoot()?.focus();
    }
  };

  window.addEventListener("keydown", handleKeyDown, true);

  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
  };
}

export function createHandoffFocusTrap(options: HandoffFocusTrapOptions): void {
  // Wire Tab/focusin trap once while the panel is present. mentionOpen is read at
  // event time inside wireHandoffFocusTrap — do not re-wire on mention toggle
  // (that stacked duplicate window listeners when the effect re-ran).
  createEffect(() => {
    if (!options.enabled()) {
      return;
    }
    return wireHandoffFocusTrap(options);
  });

  createEffect(() => {
    if (!options.enabled()) {
      return;
    }
    if (!options.mentionOpen()) {
      queueMicrotask(() => options.editorRoot()?.focus());
      return;
    }
    const mentionKeyboard = options.mentionListKeyboard;
    if (!mentionKeyboard) {
      return;
    }
    return wireHandoffMentionListKeyboard(mentionKeyboard);
  });
}
