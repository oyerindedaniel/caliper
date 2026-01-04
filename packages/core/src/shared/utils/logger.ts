class DeduplicatedLogger {
    private lastMessage: string | null = null;
    private count = 0;

    log(message: string) {
        if (message === this.lastMessage) {
            this.count++;
            return;
        }

        if (this.lastMessage && this.count > 0) {
            console.log(`[x${this.count + 1}] ^`);
        }

        console.log(message);
        this.lastMessage = message;
        this.count = 0;
    }

    logSpatial(label: string, stable: { left: number; top: number }, delta: { x: number; y: number }) {
        const liveX = stable.left - delta.x;
        const liveY = stable.top - delta.y;
        this.log(`[Spatial:${label}] Stable:(${stable.left.toFixed(1)}, ${stable.top.toFixed(1)}) Delta:(${delta.x.toFixed(1)}, ${delta.y.toFixed(1)}) -> Live:(${liveX.toFixed(1)}, ${liveY.toFixed(1)})`);
    }
}

export const diagnosticLogger = new DeduplicatedLogger();

/**
 * Format a DOMRect for logging
 */
export function formatRect(rect: DOMRect | null): string {
    if (!rect) return "null";
    return `{L:${rect.left.toFixed(1)}, T:${rect.top.toFixed(1)}, W:${rect.width}, H:${rect.height}}`;
}

/**
 * Format an element for logging with tag and text preview
 */
export function formatElement(element: Element | null): string {
    if (!element) return "null";
    const text = (element.textContent || "").trim().slice(0, 20);
    return `${element.tagName}${element.className ? '.' + element.className : ''} ["${text}${text.length >= 20 ? '...' : ''}"]`;
}
