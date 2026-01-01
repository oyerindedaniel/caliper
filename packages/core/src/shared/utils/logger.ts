/**
 * Deduplicated logger to prevent console flooding
 */
class DeduplicatedLogger {
    private lastMessage: string | null = null;

    log(message: string) {
        if (message === this.lastMessage) return;
        console.log(message);
        this.lastMessage = message;
    }
}

export const diagnosticLogger = new DeduplicatedLogger();

/**
 * Format an element for logging with tag and text preview
 */
export function formatElement(element: Element | null): string {
    if (!element) return "null";
    const text = (element.textContent || "").trim().slice(0, 20);
    return `${element.tagName}${element.className ? '.' + element.className : ''} ["${text}${text.length >= 20 ? '...' : ''}"]`;
}
