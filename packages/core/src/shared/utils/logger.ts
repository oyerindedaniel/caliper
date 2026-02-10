export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

export interface LoggerOptions {
  prefix?: string;
  enabled?: boolean;
}

class Logger {
  private prefix: string;
  private enabled: boolean;

  constructor(options: LoggerOptions = {}) {
    this.prefix = options.prefix ? `[${options.prefix}]` : "[Caliper]";
    this.enabled = options.enabled !== false;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  debug(...args: any[]) {
    if (!this.enabled) return;
    console.debug(this.prefix, ...args);
  }

  info(...args: any[]) {
    if (!this.enabled) return;
    console.info(this.prefix, ...args);
  }

  warn(...args: any[]) {
    if (!this.enabled) return;
    console.warn(this.prefix, ...args);
  }

  error(...args: any[]) {
    if (!this.enabled) return;
    console.error(this.prefix, ...args);
  }

  log(...args: any[]) {
    if (!this.enabled) return;
    console.log(this.prefix, ...args);
  }
}

/**
 * Global logger instance used by Caliper core.
 */
export const logger = new Logger({ prefix: "Caliper" });

/**
 * Creates a specialized logger for a specific module or component.
 * 
 * @param prefix - The prefix to prepended to log messages (e.g., 'agent-bridge').
 * @param enabled - Whether this logger is enabled. Defaults to true.
 * @returns A new Logger instance.
 */
export function createLogger(prefix: string, enabled?: boolean) {
  return new Logger({ prefix: `Caliper:${prefix}`, enabled });
}

/**
 * Formats a DOMRect into a human-readable string for logging.
 * 
 * @param rect - The rect to format.
 * @returns A formatted string or "null".
 */
export function formatRect(rect: DOMRect | null): string {
  if (!rect) return "null";
  return `{L:${rect.left.toFixed(1)}, T:${rect.top.toFixed(1)}, W:${rect.width}, H:${rect.height}}`;
}

/**
 * Formats an Element into a descriptive string including its tag name, 
 * classes, and a snippet of its text content.
 * 
 * @param element - The element to format.
 * @returns A formatted string or "null".
 */
export function formatElement(element: Element | null): string {
  if (!element) return "null";
  const text = (element.textContent || "").trim().slice(0, 20);
  return `${element.tagName}${element.className ? "." + element.className : ""} ["${text}${text.length >= 20 ? "..." : ""}"]`;
}
