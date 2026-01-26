/**
 * Simple internal logger for the MCP server.
 */
export class Logger {
    private enabled: boolean = true;
    private prefix: string;

    constructor(prefix: string) {
        this.prefix = `[Caliper:${prefix}]`;
    }

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
    }

    info(...args: any[]) {
        if (this.enabled) console.error(this.prefix, ...args);
    }

    warn(...args: any[]) {
        if (this.enabled) console.error(this.prefix, "WARN:", ...args);
    }

    error(...args: any[]) {
        if (this.enabled) console.error(this.prefix, "ERROR:", ...args);
    }

    debug(...args: any[]) {
        if (this.enabled) console.error(this.prefix, "DEBUG:", ...args);
    }
}

export const createLogger = (prefix: string) => new Logger(prefix);
export const logger = createLogger("mcp");