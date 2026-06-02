import WebSocket from "ws";

import { DEFAULT_ENGINE_HOST, buildEngineHttpUrl, isLoopbackHost } from "@oyerinde/caliper-schema";
import type { CdpPageTarget } from "./cdp-protocol.js";

/** Command response envelope: `{ id, result?, error? }`. Domain result shapes live in cdp-protocol.ts and connect via `send<T>()`. */
type CdpCommandResponseEnvelope = {
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

/** Event envelope: `{ method, params? }`. Event param shapes live in cdp-protocol.ts and connect via `onEvent<T>()`. */
type CdpEventEnvelope = {
  method: string;
  params?: unknown;
};

type CdpWireMessage = CdpCommandResponseEnvelope | CdpEventEnvelope;

type PendingCommand = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type CdpEventHandler = (params: unknown) => void;

export class CdpClient {
  private readonly pendingCommands = new Map<number, PendingCommand>();
  private readonly eventHandlers = new Map<string, Set<CdpEventHandler>>();
  private nextCommandId = 1;

  private constructor(private readonly socket: WebSocket) {
    this.socket.on("message", (data: WebSocket.RawData) => {
      this.handleMessage(data.toString());
    });
  }

  static async connect(webSocketDebuggerUrl: string): Promise<CdpClient> {
    assertLoopbackDebuggerUrl(webSocketDebuggerUrl);

    const socket = new WebSocket(webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (error: Error) => reject(error));
    });

    return new CdpClient(socket);
  }

  static async listPageTargets(debugPort: number): Promise<CdpPageTarget[]> {
    const response = await fetch(buildEngineHttpUrl(DEFAULT_ENGINE_HOST, debugPort, "/json/list"));
    if (!response.ok) {
      throw new Error(`Failed to list Chrome debug targets (${response.status})`);
    }

    return (await response.json()) as CdpPageTarget[];
  }

  onEvent<TParams = unknown>(method: string, handler: (params: TParams) => void): () => void {
    const wrapped: CdpEventHandler = (params) => handler(params as TParams);
    const handlers = this.eventHandlers.get(method) ?? new Set<CdpEventHandler>();
    handlers.add(wrapped);
    this.eventHandlers.set(method, handlers);

    return () => {
      handlers.delete(wrapped);
    };
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const commandId = this.nextCommandId;
    this.nextCommandId += 1;

    return new Promise<T>((resolve, reject) => {
      this.pendingCommands.set(commandId, {
        resolve: (value) => resolve(value as T),
        reject,
      });

      this.socket.send(JSON.stringify({ id: commandId, method, params }));
    });
  }

  async waitForEvent(method: string, timeoutMs = 30_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for CDP event ${method}`));
      }, timeoutMs);

      const unsubscribe = this.onEvent(method, () => {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }

  private handleMessage(rawMessage: string): void {
    const message = JSON.parse(rawMessage) as CdpWireMessage;

    if (!isCommandResponse(message)) {
      this.dispatchEvent(message.method, message.params);
      return;
    }

    const pendingCommand = this.pendingCommands.get(message.id);
    if (!pendingCommand) {
      return;
    }

    this.pendingCommands.delete(message.id);

    if (message.error) {
      pendingCommand.reject(new Error(message.error.message));
      return;
    }

    pendingCommand.resolve(message.result);
  }

  private dispatchEvent(method: string, params: unknown): void {
    const handlers = this.eventHandlers.get(method);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(params);
    }
  }
}

function assertLoopbackDebuggerUrl(webSocketDebuggerUrl: string): void {
  const parsedUrl = new URL(webSocketDebuggerUrl);
  if (!isLoopbackHost(parsedUrl.hostname)) {
    throw new Error(`Refusing to connect to non-loopback CDP endpoint: ${parsedUrl.hostname}`);
  }
}

function isCommandResponse(message: CdpWireMessage): message is CdpCommandResponseEnvelope {
  return "id" in message;
}
