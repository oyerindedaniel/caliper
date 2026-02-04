import {
  type CaliperActionResult,
  type CaliperIntent,
  type NullableId,
  RpcFactory,
  type JsonRpcRequest,
  CALIPER_METHODS,
  BitBridge, type CaliperAgentState
} from "@oyerinde/caliper-schema";
import { createLogger, BRIDGE_TAB_ID_KEY } from "@caliper/core";
import { DEFAULT_WS_PORT } from "./constants.js";

const logger = createLogger("bridge");

interface BridgeOptions {
  onIntent: (intent: CaliperIntent) => Promise<CaliperActionResult>;
  wsUrl?: string;
}

export function createWSBridge(options: BridgeOptions) {
  const { onIntent, wsUrl = `ws://localhost:${DEFAULT_WS_PORT}` } = options;
  let activeSocket: WebSocket | null = null;
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
      activeSocket = socket;

      socket.onopen = () => {
        logger.info("Connected to MCP Relay Server");
        reconnectAttempts = 0;

        socket.send(
          JSON.stringify(
            RpcFactory.notification(CALIPER_METHODS.REGISTER_TAB, {
              tabId,
              url: window.location.href,
              title: document.title,
              isFocused: !document.hidden,
            })
          )
        );
      };

      socket.onmessage = async (event) => {
        let messageId: NullableId = null;
        try {
          const message = JSON.parse(event.data) as JsonRpcRequest;
          messageId = message.id;

          const result = await onIntent(message as CaliperIntent);

          if (socket.readyState === WebSocket.OPEN) {
            const id = messageId ?? null;

            if ("binaryPayload" in result && result.binaryPayload instanceof Uint8Array) {
              const { binaryPayload, ...metadata } = result;
              const json = JSON.stringify(RpcFactory.response(id, metadata));
              socket.send(BitBridge.packEnvelope(json, binaryPayload));
            } else {
              socket.send(JSON.stringify(RpcFactory.response(id, result)));
            }
          }
        } catch (error) {
          logger.error("Failed to handle MCP message:", error);
          if (messageId && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify(
                RpcFactory.error(
                  messageId,
                  -32603,
                  error instanceof Error ? error.message : String(error)
                )
              )
            );
          }
        }
      };

      socket.onclose = () => {
        if (activeSocket === socket) {
          activeSocket = null;
          scheduleReconnect();
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    } catch (error) {
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

    logger.warn(
      `MCP Relay connection lost. Reconnecting in ${Math.round(finalDelay / 1000)}s... (Attempt ${reconnectAttempts})`
    );
    reconnectTimeout = setTimeout(connect, finalDelay);
  }

  function sendUpdate() {
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      activeSocket.send(
        JSON.stringify(
          RpcFactory.notification(CALIPER_METHODS.TAB_UPDATE, {
            isFocused: !document.hidden,
          })
        )
      );
    }
  }

  document.addEventListener("visibilitychange", sendUpdate);

  connect();

  function sendStateUpdate(state: CaliperAgentState) {
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      activeSocket.send(
        JSON.stringify(
          RpcFactory.notification(CALIPER_METHODS.STATE_UPDATE, state)
        )
      );
    }
  }

  return {
    destroy: () => {
      document.removeEventListener("visibilitychange", sendUpdate);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (activeSocket) {
        activeSocket.close();
        activeSocket = null;
      }
    },
    sendStateUpdate,
  };
}
