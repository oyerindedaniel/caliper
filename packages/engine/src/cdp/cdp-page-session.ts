import type { CdpClient } from "./cdp-client.js";

/** Per-page CDP view over a shared browser connection (flat sessionId). */
export class CdpPageSession {
  constructor(
    private readonly browser: CdpClient,
    readonly sessionId: string,
    readonly pageId: string
  ) {}

  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.browser.send<T>(method, params, this.sessionId);
  }

  onEvent<TParams = unknown>(method: string, handler: (params: TParams) => void): () => void {
    return this.browser.onEvent(method, handler, this.sessionId);
  }

  waitForEvent(method: string, timeoutMs = 30_000): Promise<void> {
    return this.browser.waitForEvent(method, timeoutMs, this.sessionId);
  }
}

export type CdpSendClient = Pick<CdpPageSession, "send" | "onEvent" | "waitForEvent">;
