import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import {
  BridgeMessageSchema,
  type CaliperActionResult,
  type CaliperActionResultFor,
  type CaliperBaseMethod,
  BitBridge,
  RpcFactory,
  CALIPER_METHODS,
  rehydrateWalkAndMeasureResult,
  isWalkAndMeasureSuccess,
  type Id,
  isId,
  type CaliperParams,
  isCaliperActionResultMethod,
  isBridgeNotification,
  isBridgeErrorResponse,
  isBridgeResultResponse,
} from "@oyerinde/caliper-schema";
import { tabManager } from "./tab-manager.js";
import { createLogger } from "../utils/logger.js";
import { generateId } from "../utils/id.js";
import { BridgeTimeoutError, BridgeValidationError } from "../utils/errors.js";
import { DEFAULT_BRIDGE_PORT, BRIDGE_REQUEST_TIMEOUT_MS } from "../shared/constants.js";
import { isBridgePreemptDisabled, preemptCaliperBridgePortHolder } from "../utils/port-holder.js";

import { EventEmitter } from "events";
import { BRIDGE_EVENTS } from "../shared/events.js";

const logger = createLogger("mcp-bridge");

export class BridgeService extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private pendingCalls = new Map<
    string,
    (result: CaliperActionResult | { error: string }) => void
  >();
  private startupError: string | null = null;
  private bridgeSessionId: string | null = null;
  private boundPort: number | null = null;

  constructor() {
    super();
  }

  isListening(): boolean {
    return this.wss !== null && this.startupError === null;
  }

  getStartupError(): string | null {
    return this.startupError;
  }

  getBridgeSessionId(): string | null {
    return this.bridgeSessionId;
  }

  getBoundPort(): number | null {
    return this.boundPort;
  }

  getConnectedTabCount(): number {
    return tabManager.getTabCount();
  }

  async start(port: number = DEFAULT_BRIDGE_PORT): Promise<void> {
    if (this.wss) {
      return;
    }

    this.startupError = null;
    this.bridgeSessionId = null;
    this.boundPort = null;

    try {
      await this.bindWebSocketServer(port);
    } catch (error: unknown) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === "EADDRINUSE" && !isBridgePreemptDisabled()) {
        const preempt = await preemptCaliperBridgePortHolder(port);
        if (preempt.ok) {
          logger.warn(`Preempted prior Caliper MCP bridge on port ${port} (pid ${preempt.pid})`);
          await this.bindWebSocketServer(port);
        } else if (preempt.reason === "not_caliper") {
          const message = preempt.detail;
          this.startupError = message;
          throw new Error(message);
        } else if (preempt.reason === "no_holder") {
          await this.bindWebSocketServer(port);
        } else {
          const message =
            preempt.reason === "disabled"
              ? `Port ${port} is in use and bridge preempt is disabled (${preempt.detail})`
              : preempt.detail;
          this.startupError = message;
          throw new Error(message);
        }
      } else {
        const message =
          errno.code === "EADDRINUSE"
            ? `Port ${port} is already in use. Close the other Caliper MCP instance or use --port. Set CALIPER_BRIDGE_NO_PREEMPT=1 to disable automatic takeover.`
            : `WebSocket server error: ${String(error)}`;

        this.startupError = message;
        throw new Error(message);
      }
    }

    this.bridgeSessionId = randomUUID();
    this.boundPort = port;
    logger.info(
      `WebSocket relay listening on port ${port} (bridgeSessionId=${this.bridgeSessionId})`
    );
  }

  private bindWebSocketServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const server = new WebSocketServer({ port });

        server.once("listening", () => {
          this.wss = server;
          this.init();
          resolve();
        });

        server.once("error", (error: NodeJS.ErrnoException) => {
          server.close();
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private init() {
    if (!this.wss) return;
    this.wss.on("connection", (ws: WebSocket) => {
      let tabId: string | null = null;

      ws.on("message", (data) => {
        try {
          let rawMessage: unknown;
          let binaryPayload: Uint8Array | undefined;

          if (Buffer.isBuffer(data)) {
            if (data[0] === 0x7b) {
              rawMessage = JSON.parse(data.toString());
            } else {
              const { json, payload } = BitBridge.unpackEnvelope(new Uint8Array(data));
              rawMessage = JSON.parse(json);
              binaryPayload = payload;
            }
          } else {
            rawMessage = JSON.parse(data.toString());
          }

          const result = BridgeMessageSchema.safeParse(rawMessage);

          if (!result.success) {
            logger.error("Invalid WS message format:", z.treeifyError(result.error));

            const msgObj = rawMessage as { id?: Id };
            if (msgObj?.id !== undefined && isId(msgObj.id)) {
              const resolve = this.pendingCalls.get(String(msgObj.id));
              if (resolve) {
                resolve({ error: new BridgeValidationError().message });
                this.pendingCalls.delete(String(msgObj.id));
              }
            }
            return;
          }

          const message = result.data;

          if (isBridgeNotification(message)) {
            if (message.method === CALIPER_METHODS.REGISTER_TAB) {
              const { tabId: newTabId, url, title, isFocused } = message.params;
              tabId = newTabId;
              tabManager.registerTab({
                id: tabId,
                ws,
                url,
                title,
                isFocused,
              });
              this.emit(BRIDGE_EVENTS.CONNECTION);
            } else if (message.method === CALIPER_METHODS.TAB_UPDATE) {
              const { isFocused } = message.params;
              if (tabId) {
                tabManager.updateTab(tabId, isFocused);
              }
            } else if (message.method === CALIPER_METHODS.STATE_UPDATE) {
              this.emit(BRIDGE_EVENTS.STATE, message.params);
            }
            return;
          }

          if (isBridgeErrorResponse(message)) {
            if (message.id !== null) {
              const resolve = this.pendingCalls.get(String(message.id));
              if (resolve) {
                resolve({ error: message.error.message });
                this.pendingCalls.delete(String(message.id));
              }
            }
            return;
          }

          if (isBridgeResultResponse(message)) {
            const resolve = this.pendingCalls.get(String(message.id));
            if (!resolve) return;

            const finalResult = message.result;

            if (isWalkAndMeasureSuccess(finalResult)) {
              const rehydrated = rehydrateWalkAndMeasureResult(finalResult, binaryPayload);
              if (!rehydrated.ok) {
                logger.error("Bit-Bridge reconstruction failed:", rehydrated.error);
                resolve({ error: rehydrated.error });
                this.pendingCalls.delete(String(message.id));
                return;
              }
              resolve(rehydrated.result);
              this.pendingCalls.delete(String(message.id));
              return;
            }

            resolve(finalResult);
            this.pendingCalls.delete(String(message.id));
          }
        } catch (error: unknown) {
          logger.error("WS Message Processing Error:", error);
        }
      });

      ws.on("close", () => {
        if (tabId) {
          tabManager.removeTab(tabId, ws);
          this.emit(BRIDGE_EVENTS.CONNECTION);
        }
      });
    });
  }

  async call<M extends CaliperBaseMethod>(
    method: M,
    params: CaliperParams<M>
  ): Promise<CaliperActionResultFor<M>> {
    if (this.startupError) {
      throw new Error(`Caliper Bridge Unavailable: ${this.startupError}`);
    }

    if (!this.wss) {
      throw new Error(
        "Caliper Bridge relay is not listening. Restart the MCP server or check caliper://runtime."
      );
    }

    const tab = tabManager.getActiveTab();
    if (!tab) {
      throw new Error(
        "No active browser tab connected to Caliper Bridge. Ensure the browser is open with Caliper enabled."
      );
    }

    const callId = generateId("mcp-call");

    let timeoutHandle: ReturnType<typeof setTimeout>;

    const responsePromise = new Promise<CaliperActionResultFor<M>>((resolve, reject) => {
      this.pendingCalls.set(callId, (bridgeResponse) => {
        clearTimeout(timeoutHandle);

        if ("error" in bridgeResponse && !("success" in bridgeResponse)) {
          if (bridgeResponse.error === new BridgeValidationError().message) {
            reject(new BridgeValidationError());
          } else {
            reject(new Error(bridgeResponse.error));
          }
          return;
        }

        if (isCaliperActionResultMethod(bridgeResponse, method)) {
          resolve(bridgeResponse);
          return;
        }

        reject(new Error("Unexpected result format received from bridge"));
      });

      tab.ws.send(JSON.stringify(RpcFactory.request(method, params, callId)));
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(new BridgeTimeoutError(method));
      }, BRIDGE_REQUEST_TIMEOUT_MS);
    });

    return Promise.race([responsePromise, timeoutPromise]);
  }

  async stop() {
    return new Promise<void>((resolve) => {
      if (!this.wss) {
        this.bridgeSessionId = null;
        this.boundPort = null;
        resolve();
        return;
      }

      const server = this.wss;
      this.wss = null;
      this.bridgeSessionId = null;
      this.boundPort = null;

      server.close(() => {
        logger.info("WebSocket relay stopped.");
        resolve();
      });
    });
  }
}

export const bridgeService = new BridgeService();
