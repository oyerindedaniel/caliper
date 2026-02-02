/**
 * Schedules a callback to run after requestAnimationFrame and a microtask.
 * This ensures the DOM has settled and coordinates are accurate.
 */
export async function waitPostRaf<T>(callback: () => T): Promise<T> {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === "undefined") {
            resolve(callback());
            return;
        }

        requestAnimationFrame(() => {
            Promise.resolve().then(() => {
                resolve(callback());
            });
        });
    });
}
