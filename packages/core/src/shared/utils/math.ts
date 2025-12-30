/**
 * Linear interpolation between two values
 * @param start - Starting value
 * @param end - Target value
 * @param t - Interpolation factor (0-1, but can exceed for extrapolation)
 */
export function lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
}

/**
 * Lerp a DOMRect-like object
 * @param start - Starting rect
 * @param end - Target rect
 * @param t - Interpolation factor
 */
export function lerpRect(
    start: { left: number; top: number; width: number; height: number },
    end: { left: number; top: number; width: number; height: number },
    t: number
): { left: number; top: number; width: number; height: number } {
    return {
        left: lerp(start.left, end.left, t),
        top: lerp(start.top, end.top, t),
        width: lerp(start.width, end.width, t),
        height: lerp(start.height, end.height, t),
    };
}
