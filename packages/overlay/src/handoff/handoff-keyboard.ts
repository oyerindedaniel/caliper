import {
  isHandoffPendingNoteEmpty,
  isKeyMatch,
  resolveElementFromFingerprint,
  type HandoffRegistry,
  type DeepRequired,
  type CommandsConfig,
} from "@caliper/core";
import {
  HANDOFF_MENTION_ATTR,
  isHandoffMentionElement,
  readMentionAgentId,
} from "./note-editor/handoff-note-dom.js";

export type HandoffKeyboardControllerOptions = {
  registry: HandoffRegistry;
  commands: DeepRequired<CommandsConfig>;
  isMentionOpen: () => boolean;
  onRejectEmptySubmit?: () => void;
};

function resolveKeyboardTarget(event: KeyboardEvent): HTMLElement | null {
  const target = event.target;
  if (target instanceof HTMLElement) {
    return target;
  }
  const active = document.activeElement;
  return active instanceof HTMLElement ? active : null;
}

function isHandoffMentionTabStop(target: HTMLElement | null): target is HTMLSpanElement {
  return !!target && isHandoffMentionElement(target);
}

function isHandoffNoteSubmitTarget(target: HTMLElement | null): boolean {
  if (!target) {
    return false;
  }
  if (target.closest(`span[${HANDOFF_MENTION_ATTR}]`)) {
    return false;
  }
  const editableRoot = target.closest('[contenteditable]:not([contenteditable="false"])');
  return editableRoot instanceof HTMLElement;
}

function highlightMentionTabStop(
  registry: HandoffRegistry,
  target: HTMLSpanElement,
  event: KeyboardEvent
): boolean {
  event.preventDefault();
  event.stopImmediatePropagation();
  registry.setHighlightedAgentId(readMentionAgentId(target));
  return true;
}

export function createHandoffKeyboardController(options: HandoffKeyboardControllerOptions) {
  const { registry, commands, isMentionOpen, onRejectEmptySubmit } = options;

  return function handleHandoffKeyboard(e: KeyboardEvent): boolean {
    if (isMentionOpen()) {
      return false;
    }

    const target = resolveKeyboardTarget(e);
    const hasLiveItems = registry.getItems().length > 0;
    const lastCommitted = registry.getLastCommitted();
    if (!hasLiveItems && !registry.isInputOpen() && !lastCommitted) {
      return false;
    }

    if (isKeyMatch(commands.handoff.open, e)) {
      if (e.shiftKey && registry.isInputOpen()) {
        if (target?.closest("[class*='handoff-textarea']")) {
          return true;
        }
        return false;
      }

      if (isHandoffMentionTabStop(target)) {
        return highlightMentionTabStop(registry, target, e);
      }

      if (registry.isInputOpen()) {
        if (!isHandoffNoteSubmitTarget(target)) {
          return false;
        }

        e.preventDefault();
        e.stopImmediatePropagation();

        if (isHandoffPendingNoteEmpty(registry.getPendingNote())) {
          onRejectEmptySubmit?.();
          return true;
        }
        registry.commitSession();
        return true;
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      if (hasLiveItems) {
        registry.setInputOpen(true);
        return true;
      }

      if (lastCommitted) {
        registry.rehydrateFromCommitted(lastCommitted.state, lastCommitted.wireNote, {
          openInput: true,
          resolve: resolveElementFromFingerprint,
        });
      }
      return true;
    }

    return registry.isInputOpen();
  };
}
