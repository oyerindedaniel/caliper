import {
  isKeyMatch,
  resolveElementFromFingerprint,
  type HandoffRegistry,
  type DeepRequired,
  type CommandsConfig,
} from "@caliper/core";

export type HandoffKeyboardControllerOptions = {
  registry: HandoffRegistry;
  commands: DeepRequired<CommandsConfig>;
  isMentionOpen: () => boolean;
};

export function createHandoffKeyboardController(options: HandoffKeyboardControllerOptions) {
  const { registry, commands, isMentionOpen } = options;

  return function handleHandoffKeyboard(e: KeyboardEvent): boolean {
    if (isMentionOpen()) {
      return false;
    }

    const state = registry.getUIState();
    const hasItems = (state?.items.length ?? 0) > 0;
    if (!hasItems && !registry.isInputOpen()) {
      return false;
    }

    const target = e.target as HTMLElement | null;

    if (
      commands.handoff.restore &&
      isKeyMatch(commands.handoff.restore, e) &&
      !registry.isInputOpen()
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const snapshot = registry.getUIState();
      if (snapshot && snapshot.items.length > 0) {
        registry.restoreFromState(snapshot, resolveElementFromFingerprint);
        registry.setInputOpen(false);
      }
      return true;
    }

    if (isKeyMatch(commands.handoff.open, e)) {
      if (e.shiftKey && registry.isInputOpen()) {
        if (target?.closest("[class*='handoff-textarea']")) {
          return true;
        }
        return false;
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      if (registry.isInputOpen()) {
        registry.commitSession();
      } else if (hasItems) {
        registry.setInputOpen(true);
      }
      return true;
    }

    return registry.isInputOpen();
  };
}
