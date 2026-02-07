/**
 * Schedules a callback to run after requestAnimationFrame and a microtask.
 * This ensures the DOM has settled and coordinates are accurate.
 */
export async function waitPostRaf<T>(callback: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    if (
      typeof requestAnimationFrame === "undefined" ||
      (typeof document !== "undefined" && document.hidden)
    ) {
      setTimeout(() => {
        try {
          resolve(callback());
        } catch (e) {
          reject(e);
        }
      }, 0);
      return;
    }

    requestAnimationFrame(() => {
      Promise.resolve().then(() => {
        try {
          resolve(callback());
        } catch (e) {
          reject(e);
        }
      });
    });
  });
}
