import { createSignal, type Accessor } from "solid-js";

/**
 * Retriggers a CSS animation bound to a data attribute. Changing only the
 * attribute value while it stays present does not restart the animation; this
 * clears on one frame and sets on the next.
 */
export function createCssAnimationPulse(): {
  value: Accessor<number | undefined>;
  bump: (tick: number) => void;
  dispose: () => void;
} {
  let generation = 0;
  let rafId = 0;
  const [value, setValue] = createSignal<number | undefined>(undefined);

  const bump = (tick: number) => {
    if (tick <= 0) {
      generation += 1;
      cancelAnimationFrame(rafId);
      rafId = 0;
      setValue(undefined);
      return;
    }

    const gen = ++generation;
    setValue(undefined);
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (gen !== generation) {
        return;
      }
      setValue(tick);
    });
  };

  const dispose = () => {
    generation += 1;
    cancelAnimationFrame(rafId);
    rafId = 0;
    setValue(undefined);
  };

  return { value, bump, dispose };
}
