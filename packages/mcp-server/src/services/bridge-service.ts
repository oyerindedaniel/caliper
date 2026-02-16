import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import {
  BridgeMessageSchema,
  type CaliperActionResult,
  type CaliperMethod,
  type CaliperAgentState,
  BitBridge,
  RpcFactory,
  CALIPER_METHODS,
  type Id,
  isId,
  type CaliperParams,
  isCaliperActionResult,
  isBridgeNotification,
  isBridgeErrorResponse,
  isBridgeResultResponse,
  CaliperNodeSchema,
} from "@oyerinde/caliper-schema";
import { tabManager } from "./tab-manager.js";
import { createLogger } from "../utils/logger.js";
import { generateId } from "../utils/id.js";
import { BridgeTimeoutError, BridgeValidationError } from "../utils/errors.js";
import { DEFAULT_BRIDGE_PORT, BRIDGE_REQUEST_TIMEOUT_MS } from "../shared/constants.js";

import { EventEmitter } from "events";
import { BRIDGE_EVENTS } from "../shared/events.js";

const logger = createLogger("mcp-bridge");

function getExponentialBackoff(attempt: number, baseDelay: number): number {
  return Math.pow(2, attempt) * baseDelay;
}

export class BridgeService extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private pendingCalls = new Map<
    string,
    (result: CaliperActionResult | CaliperAgentState | { error: string }) => void
  >();
  private startupError: string | null = null;

  constructor() {
    super();
  }

  async start(port: number = DEFAULT_BRIDGE_PORT, retries: number = 3): Promise<void> {
    if (this.wss) return;

    const attemptStart = (currentPort: number, remaining: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        try {
          const server = new WebSocketServer({ port: currentPort });

          server.on("listening", () => {
            this.wss = server;
            this.init();
            resolve();
          });

          server.on("error", (error: unknown) => {
            const err = error as { code?: string; message?: string };

            if (err.code === "EADDRINUSE" && remaining > 0) {
              const attemptNum = retries - remaining + 1;
              const delay = getExponentialBackoff(attemptNum - 1, 500);

              logger.warn(
                `Port ${currentPort} is currently in use. Retrying in ${delay}ms... (Attempt ${attemptNum}/${retries})`
              );
              server.close();
              server.removeAllListeners();

              setTimeout(() => {
                attemptStart(currentPort, remaining - 1)
                  .then(resolve)
                  .catch(reject);
              }, delay);
            } else {
              const errorMessage =
                err.code === "EADDRINUSE"
                  ? `Port ${currentPort} is already in use by another process. Please close the other instance of Caliper or use a different port.`
                  : `WebSocket server error: ${String(error)}`;

              logger.error(errorMessage);
              this.startupError = errorMessage;
              server.close();
              reject(new Error(errorMessage));
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    };

    try {
      await attemptStart(port, retries);
    } catch (error: unknown) {
      if (!this.startupError) {
        this.startupError = `Failed to start WebSocket relay after multiple attempts: ${String(error)}`;
      }
    }
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

            if (isCaliperActionResult(finalResult)) {
              if ("walkResult" in finalResult && binaryPayload) {
                try {
                  const raw = BitBridge.deserialize(binaryPayload);
                  const parsed = CaliperNodeSchema.safeParse(raw);
                  if (parsed.success) {
                    finalResult.walkResult.root = parsed.data;
                  } else {
                    logger.error("Bit-Bridge deserialized node failed schema validation", z.treeifyError(parsed.error));
                  }
                } catch (error) {
                  logger.error("Bit-Bridge reconstruction failed:", error);
                }
              }
              resolve(finalResult);
            } else {
              resolve({ error: "Unexpected result format received from bridge" });
            }
            this.pendingCalls.delete(String(message.id));
          }
        } catch (error: unknown) {
          logger.error("WS Message Processing Error:", error);
        }
      });

      ws.on("close", () => {
        if (tabId) {
          tabManager.removeTab(tabId, ws);
        }
      });
    });

    logger.info(`WebSocket Relay initialized on port ${this.wss.options.port}`);
  }

  async call<M extends CaliperMethod, T = CaliperActionResult>(
    method: M,
    params: CaliperParams<M>,
    retries: number = 0
  ): Promise<T> {
    if (this.startupError) {
      throw new Error(`Caliper Bridge Unavailable: ${this.startupError}`);
    }

    const tab = tabManager.getActiveTab();
    if (!tab) {
      throw new Error(
        "No active browser tab connected to Caliper Bridge. Ensure the browser is open with Caliper enabled."
      );
    }

    const callWithTimeout = async (attempt: number): Promise<T> => {
      const callId = generateId("mcp-call");

      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingCalls.delete(callId);
          reject(new BridgeTimeoutError(method, attempt, retries));
        }, BRIDGE_REQUEST_TIMEOUT_MS);

        this.pendingCalls.set(callId, (res) => {
          clearTimeout(timeout);
          if ("error" in res && !("success" in res)) {
            if (res.error === new BridgeValidationError().message) {
              reject(new BridgeValidationError());
            } else {
              reject(new Error(res.error));
            }
          } else {
            resolve(res as T);
          }
        });

        tab.ws.send(JSON.stringify(RpcFactory.request(method, params, callId)));
      });
    };

    let lastError: Error | null = null;
    for (let i = 0; i <= retries; i++) {
      try {
        return await callWithTimeout(i);
      } catch (err) {
        lastError = err as Error;
        const isRetryable =
          lastError instanceof BridgeTimeoutError || lastError instanceof BridgeValidationError;

        if (!isRetryable) {
          throw lastError;
        }

        if (i < retries) {
          const delay = getExponentialBackoff(i, 300);
          logger.warn(`${lastError.message}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error(`Failed bridge call: ${method}`);
  }

  async stop() {
    return new Promise<void>((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }
      this.wss.close(() => {
        logger.info("WebSocket relay stopped.");
        resolve();
      });
    });
  }
}

export const bridgeService = new BridgeService();
