import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { BridgeMessageSchema, CaliperActionResult, CaliperMethod, CaliperAgentState } from "../schemas/bridge.js";
import { tabManager } from "./tab-manager.js";
import { createLogger } from "../utils/logger.js";
import { generateId } from "../utils/id.js";
import { DEFAULT_BRIDGE_PORT, BRIDGE_REQUEST_TIMEOUT_MS } from "../shared/constants.js";

const logger = createLogger("mcp-bridge");

export class BridgeService {
  private wss: WebSocketServer | null = null;
  private pendingCalls = new Map<
    string,
    (result: CaliperActionResult | CaliperAgentState | { error: string }) => void
  >();

  constructor() { }

  start(port: number = DEFAULT_BRIDGE_PORT) {
    if (this.wss) return;
    this.wss = new WebSocketServer({ port });
    this.init();
  }

  private init() {
    if (!this.wss) return;
    this.wss.on("connection", (ws: WebSocket) => {
      let tabId: string | null = null;

      ws.on("message", (data) => {
        try {
          const rawMessage = JSON.parse(data.toString());
          const result = BridgeMessageSchema.safeParse(rawMessage);

          if (!result.success) {
            logger.error("Invalid WS message format:", z.treeifyError(result.error));
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
                  resolve(message.result);
                } else {
                  resolve({ error: message.error || "Unknown bridge error" });
                }
                this.pendingCalls.delete(message.id);
              }
              break;
          }
        } catch (e) {
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
    retries: number = 2
  ): Promise<T> {
    const tab = tabManager.getActiveTab();
    if (!tab) {
      throw new Error("No active browser tab connected to Caliper Bridge. Ensure the browser is open with Caliper enabled.");
    }

    const callWithTimeout = async (attempt: number): Promise<T> => {
      const callId = generateId("mcp-call");

      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingCalls.delete(callId);
          const errorMsg = attempt < retries
            ? `Bridge request timed out for method: ${method}. Retrying... (Attempt ${attempt + 1}/${retries + 1})`
            : `Bridge request timed out for method: ${method}. The bridge is connected, but the operation took too long.`;
          reject(new Error(errorMsg));
        }, BRIDGE_REQUEST_TIMEOUT_MS);

        this.pendingCalls.set(callId, (res) => {
          clearTimeout(timeout);
          if ("error" in res && !("success" in res)) {
            reject(new Error(res.error));
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
        if (!lastError.message.includes("timed out")) {
          throw lastError;
        }
        if (i < retries) {
          logger.warn(lastError.message);
          await new Promise(r => setTimeout(r, 1000));
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
