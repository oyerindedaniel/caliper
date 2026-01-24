import type {
  CaliperActionResult,
  CaliperIntent,
  CaliperAgentState,
  ToolCallMessage,
} from "@oyerinde/caliper-schema";
import { createLogger } from "@oyerinde/caliper/core";

import { DEFAULT_WS_URL, BRIDGE_TAB_ID_KEY } from "./constants.js";

const logger = createLogger("bridge");

interface BridgeOptions {
  onIntent: (intent: CaliperIntent) => Promise<CaliperActionResult>;
  onGetState: () => CaliperAgentState | null;
  wsUrl?: string;
}

export function createWSBridge(options: BridgeOptions) {
  const { onIntent, onGetState, wsUrl = DEFAULT_WS_URL } = options;
  let ws: WebSocket | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

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

          if (message.method === "CALIPER_GET_STATE") {
            const state = onGetState();
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(
                JSON.stringify({
                  type: "TOOL_RESPONSE",
                  id: messageId,
                  result: state,
                })
              );
            }
            return;
          }

          const result = await onIntent(message);

          console.log("result", result);

          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: "TOOL_RESPONSE",
                id: messageId,
                result,
              })
            );
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
          logger.warn("MCP Relay connection closed. Reconnecting in 5s...");
          ws = null;
          scheduleReconnect();
        }
      };

      socket.onerror = () => {
        // Silently fail, server might not be running
        socket.close();
      };
    } catch (e) {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connect, 5000);
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
