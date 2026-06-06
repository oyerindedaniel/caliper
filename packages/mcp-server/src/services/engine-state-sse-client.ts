import {
  CALIPER_ENGINE_STATE_SSE_PATH,
  CaliperEngineStateSnapshotSchema,
  type CaliperEngineStateSnapshot,
} from "@oyerinde/caliper-schema";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("engine-state-sse");

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export type EngineStateSseCallback = (snapshot: CaliperEngineStateSnapshot) => void;

export class EngineStateSseClient {
  private readonly engineUrl: string;
  private callback: EngineStateSseCallback | null = null;
  private abortController: AbortController | null = null;
  private reconnectAttempt = 0;
  private shouldStayConnected = false;
  private listenTask: Promise<void> | null = null;

  constructor(engineUrl: string) {
    this.engineUrl = engineUrl.replace(/\/$/, "");
  }

  setCallback(callback: EngineStateSseCallback | null): void {
    this.callback = callback;
  }

  start(): void {
    this.shouldStayConnected = true;
    if (!this.listenTask) {
      this.listenTask = this.listenLoop().finally(() => {
        this.listenTask = null;
      });
    }
  }

  stop(): void {
    this.shouldStayConnected = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  private async listenLoop(): Promise<void> {
    while (this.shouldStayConnected) {
      try {
        await this.consumeStream();
        this.reconnectAttempt = 0;
      } catch (error) {
        if (!this.shouldStayConnected) {
          return;
        }

        logger.warn("Engine state SSE disconnected", error);
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
        this.reconnectAttempt += 1;
        await sleep(delay);
      }
    }
  }

  private async consumeStream(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();

    const response = await fetch(`${this.engineUrl}${CALIPER_ENGINE_STATE_SSE_PATH}`, {
      headers: { accept: "text/event-stream" },
      signal: this.abortController.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Engine state SSE failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (this.shouldStayConnected) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        this.dispatchChunk(chunk);
        boundary = buffer.indexOf("\n\n");
      }
    }
  }

  private dispatchChunk(chunk: string): void {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice("data:".length).trim();
      if (!payload) {
        continue;
      }

      try {
        const snapshot = CaliperEngineStateSnapshotSchema.parse(JSON.parse(payload));
        this.callback?.(snapshot);
      } catch (error) {
        logger.warn("Invalid engine state SSE payload", error);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
