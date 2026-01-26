import type {
  CaliperActionResult,
  CaliperIntent,
  ToolCallMessage,
} from "@oyerinde/caliper-schema";
import { BitBridge } from "@oyerinde/caliper-schema";
import { createLogger, BRIDGE_TAB_ID_KEY } from "@oyerinde/caliper/core";

import { DEFAULT_WS_URL } from "./constants.js";

const logger = createLogger("bridge");

interface BridgeOptions {
  onIntent: (intent: CaliperIntent) => Promise<CaliperActionResult>;
  wsUrl?: string;
}

export function createWSBridge(options: BridgeOptions) {
  const { onIntent, wsUrl = DEFAULT_WS_URL } = options;
  let ws: WebSocket | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

  const BASE_DELAY = 1000; // 1s
  const MAX_DELAY = 30000; // 30s

  let tabId = sessionStorage.getItem(BRIDGE_TAB_ID_KEY);
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem(BRIDGE_TAB_ID_KEY, tabId);
  }

  function connect() {
    try {
      const socket = new WebSocket(wsUrl);
      ws = socket;

      socket.onopen = () => {
        logger.info("Connected to MCP Relay Server");
        reconnectAttempts = 0;

        socket.send(
          JSON.stringify({
            type: "REGISTER_TAB",
            payload: {
              tabId,
              url: window.location.href,
              title: document.title,
              isFocused: !document.hidden,
            },
          })
        );
      };

      socket.onmessage = async (event) => {
        let messageId: string | undefined;
        try {
          const message = JSON.parse(event.data) as ToolCallMessage;
          messageId = message.id;


          const result = await onIntent(message);

          if (socket.readyState === WebSocket.OPEN) {
            if ("binaryPayload" in result && result.binaryPayload instanceof Uint8Array) {
              const { binaryPayload, ...metadata } = result;
              const json = JSON.stringify({
                type: "TOOL_RESPONSE",
                id: messageId,
                result: metadata,
              });
              socket.send(BitBridge.packEnvelope(json, binaryPayload));
            } else {
              socket.send(
                JSON.stringify({
                  type: "TOOL_RESPONSE",
                  id: messageId,
                  result,
                })
              );
            }
          }
        } catch (e) {
          logger.error("Failed to handle MCP message:", e);
          if (messageId && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: "TOOL_RESPONSE",
                id: messageId,
                error: e instanceof Error ? e.message : String(e),
              })
            );
          }
        }
      };

      socket.onclose = () => {
        if (ws === socket) {
          ws = null;
          scheduleReconnect();
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    } catch (e) {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    const exponent = Math.min(reconnectAttempts, 6);
    const delay = Math.min(BASE_DELAY * Math.pow(2, exponent), MAX_DELAY);
    const jitter = Math.random() * (delay * 0.1);
    const finalDelay = delay + jitter;

    reconnectAttempts++;

    logger.warn(`MCP Relay connection lost. Reconnecting in ${Math.round(finalDelay / 1000)}s... (Attempt ${reconnectAttempts})`);
    reconnectTimeout = setTimeout(connect, finalDelay);
  }

  function sendUpdate() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "TAB_UPDATE",
          payload: {
            isFocused: !document.hidden,
          },
        })
      );
    }
  }

  document.addEventListener("visibilitychange", sendUpdate);

  connect();

  return {
    destroy: () => {
      document.removeEventListener("visibilitychange", sendUpdate);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}
