import { createEffect, type Accessor } from "solid-js";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

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
  textarea: HTMLTextAreaElement | undefined
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

  if (textarea) {
    return [textarea];
  }

  if (panelRoot) {
    const panelFocusables = queryFocusable(panelRoot);
    if (panelFocusables.length > 0) {
      return panelFocusables;
    }
  }

  return [];
}

function containsFocusableScope(scope: HTMLElement[], target: Node | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  return scope.some((root) => root === target || root.contains(target));
}

export type HandoffFocusTrapOptions = {
  enabled: Accessor<boolean>;
  mentionOpen: Accessor<boolean>;
  panelRoot: Accessor<HTMLElement | undefined>;
  popoverRoot: Accessor<HTMLElement | undefined>;
  textarea: Accessor<HTMLTextAreaElement | undefined>;
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
      options.textarea()
    );

  const restoreFocus = () => {
    const focusables = getFocusables();
    const preferred = focusables[0] ?? options.textarea();
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

    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey) {
      if (!active || active === first || !focusables.includes(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (!active || active === last || !focusables.includes(active)) {
      event.preventDefault();
      first.focus();
    }
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

export function createHandoffFocusTrap(options: HandoffFocusTrapOptions): void {
  createEffect(() => {
    if (!options.enabled()) {
      return;
    }

    return wireHandoffFocusTrap(options);
  });

  createEffect(() => {
    if (!options.enabled() || options.mentionOpen()) {
      return;
    }

    queueMicrotask(() => options.textarea()?.focus());
  });
}
