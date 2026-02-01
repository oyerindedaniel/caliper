import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { BridgeMessageSchema, type CaliperActionResult, type CaliperMethod, type CaliperAgentState, BitBridge } from "@oyerinde/caliper-schema";
import { tabManager } from "./tab-manager.js";
import { createLogger } from "../utils/logger.js";
import { generateId } from "../utils/id.js";
import { BridgeTimeoutError, BridgeValidationError } from "../utils/errors.js";
import { DEFAULT_BRIDGE_PORT, BRIDGE_REQUEST_TIMEOUT_MS } from "../shared/constants.js";

const logger = createLogger("mcp-bridge");

function getExponentialBackoff(attempt: number, baseDelay: number): number {
  return Math.pow(2, attempt) * baseDelay;
}

export class BridgeService {
  private wss: WebSocketServer | null = null;
  private pendingCalls = new Map<
    string,
    (result: CaliperActionResult | CaliperAgentState | { error: string }) => void
  >();
  private startupError: string | null = null;

  constructor() { }

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

              logger.warn(`Port ${currentPort} is currently in use. Retrying in ${delay}ms... (Attempt ${attemptNum}/${retries})`);
              server.close();
              server.removeAllListeners();

              setTimeout(() => {
                attemptStart(currentPort, remaining - 1).then(resolve).catch(reject);
              }, delay);
            } else {
              const errorMessage = err.code === "EADDRINUSE"
                ? `Port ${currentPort} is already in use by another process. Please close the other instance of Caliper or use a different port.`
                : `WebSocket server error: ${String(error)}`;

              logger.error(errorMessage);
              this.startupError = errorMessage;
              server.close();
              reject(new Error(errorMessage));
            }
          });
        } catch (err) {
          reject(err);
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

            const msgObj = rawMessage as { id?: string };
            if (msgObj?.id && typeof msgObj.id === "string") {
              const resolve = this.pendingCalls.get(msgObj.id);
              if (resolve) {
                resolve({ error: new BridgeValidationError().message });
                this.pendingCalls.delete(msgObj.id);
              }
            }
            return;
          }

          const message = result.data;

          switch (message.type) {
            case "REGISTER_TAB":
              tabId = message.payload.tabId;
              tabManager.registerTab({
                id: tabId,
                ws,
                url: message.payload.url,
                title: message.payload.title,
                isFocused: message.payload.isFocused,
              });
              break;

            case "TAB_UPDATE":
              if (tabId) {
                tabManager.updateTab(tabId, message.payload.isFocused);
              }
              break;

            case "TOOL_RESPONSE":
              const resolve = this.pendingCalls.get(message.id);
              if (resolve) {
                if (message.result) {
                  let finalResult = message.result as CaliperActionResult;

                  if (finalResult.success && finalResult.method === "CALIPER_WALK_AND_MEASURE" && binaryPayload) {
                    try {
                      const root = BitBridge.deserialize(binaryPayload);
                      finalResult = {
                        ...finalResult,
                        walkResult: {
                          ...finalResult.walkResult,
                          root,
                        },
                      };
                      logger.info(`Bit-Bridge: Reconstructed tree from ${binaryPayload.byteLength} bytes.`);
                    } catch (e) {
                      logger.error("Bit-Bridge reconstruction failed:", e);
                    }
                  }

                  resolve(finalResult);
                } else {
                  resolve({ error: message.error || "Unknown bridge error" });
                }
                this.pendingCalls.delete(message.id);
              } else {
                logger.warn(`No pending call found for TOOL_RESPONSE id: ${message.id}`);
              }
              break;
          }
        } catch (e: unknown) {
          logger.error("WS Message Processing Error:", e);
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

  async call<T = CaliperActionResult>(
    method: CaliperMethod,
    params: Record<string, unknown>,
    retries: number = 1
  ): Promise<T> {
    if (this.startupError) {
      throw new Error(`Caliper Bridge Unavailable: ${this.startupError}`);
    }

    const tab = tabManager.getActiveTab();
    if (!tab) {
      throw new Error("No active browser tab connected to Caliper Bridge. Ensure the browser is open with Caliper enabled.");
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

        tab.ws.send(
          JSON.stringify({
            id: callId,
            method,
            params,
          })
        );
      });
    };

    let lastError: Error | null = null;
    for (let i = 0; i <= retries; i++) {
      try {
        return await callWithTimeout(i);
      } catch (err) {
        lastError = err as Error;
        const isRetryable = lastError instanceof BridgeTimeoutError || lastError instanceof BridgeValidationError;

        if (!isRetryable) {
          throw lastError;
        }

        if (i < retries) {
          const delay = getExponentialBackoff(i, 300);
          logger.warn(`${lastError.message}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
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
