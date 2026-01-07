export interface SuppressionOptions {
    maxFrames?: number;
    delay?: number;
}

/**
 * Creates a delegated action that can suppress execution for a number of calls
 * if a condition is met. Useful for avoiding "staircase" effects where hover
 * events jump between parent/child elements too quickly.
 */
export function createSuppressionDelegate<T extends any[]>(
    action: (...args: T) => void,
    options: SuppressionOptions = {}
) {
    const maxFrames = options.maxFrames ?? 8;
    const delay = options.delay ?? 30;

    let suppressionFrames = 0;
    let trailingTimer: ReturnType<typeof setTimeout> | null = null;

    return {
        execute(shouldSuppress: boolean, ...args: T) {
            if (trailingTimer) {
                clearTimeout(trailingTimer);
                trailingTimer = null;
            }

            if (shouldSuppress && suppressionFrames < maxFrames) {
                suppressionFrames++;
                trailingTimer = setTimeout(() => {
                    suppressionFrames = 0;
                    action(...args);
                    trailingTimer = null;
                }, delay);
            } else {
                suppressionFrames = 0;
                action(...args);
            }
        },

        cancel() {
            if (trailingTimer) {
                clearTimeout(trailingTimer);
                trailingTimer = null;
            }
            suppressionFrames = 0;
        },
    };
}
