const LAYOUT_SYNC_TOLERANCE_PX = 1;
const LAYOUT_SYNC_MAX_FRAMES = 12;

export type HandoffNoteLayoutHeights = {
  nativeHeight: number;
  mirrorHeight: number;
};

/** Force layout, then read native textarea and live mirror scroll heights. */
export function readSettledHandoffNoteHeights(
  textarea: HTMLTextAreaElement,
  mirror?: HTMLElement | null
): HandoffNoteLayoutHeights {
  void textarea.offsetHeight;
  if (mirror) {
    void mirror.offsetHeight;
  }
  return {
    nativeHeight: textarea.scrollHeight,
    mirrorHeight: mirror?.scrollHeight ?? textarea.scrollHeight,
  };
}

/**
 * Rich overlay caret/click must not run while off-DOM autosize has outpaced native
 * textarea and live mirror soft-wrap layout.
 */
export function isHandoffNoteLayoutSynced(
  textarea: HTMLTextAreaElement,
  expectedContentHeight: number,
  mirror?: HTMLElement | null
): boolean {
  const { nativeHeight, mirrorHeight } = readSettledHandoffNoteHeights(textarea, mirror);
  return (
    nativeHeight + LAYOUT_SYNC_TOLERANCE_PX >= expectedContentHeight &&
    mirrorHeight + LAYOUT_SYNC_TOLERANCE_PX >= expectedContentHeight
  );
}

export function runWhenHandoffNoteLayoutSynced(
  textarea: HTMLTextAreaElement,
  expectedContentHeight: number,
  run: () => void,
  options?: {
    mirror?: HTMLElement | null;
    maxFrames?: number;
    onTimeout?: (heights: HandoffNoteLayoutHeights) => void;
  }
): void {
  const maxFrames = options?.maxFrames ?? LAYOUT_SYNC_MAX_FRAMES;

  const tryRun = (frame: number) => {
    if (isHandoffNoteLayoutSynced(textarea, expectedContentHeight, options?.mirror)) {
      run();
      return;
    }
    if (frame + 1 >= maxFrames) {
      options?.onTimeout?.(readSettledHandoffNoteHeights(textarea, options?.mirror));
      run();
      return;
    }
    requestAnimationFrame(() => tryRun(frame + 1));
  };

  tryRun(0);
}
