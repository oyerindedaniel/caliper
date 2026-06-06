import { describe, expect, it, afterEach } from "vitest";
import {
  CALIPER_ENGINE_STATE_SSE_PATH,
  CALIPER_METHODS,
  RpcFactory,
  buildEngineHttpUrl,
  DEFAULT_ENGINE_HOST,
  DEFAULT_ENGINE_VIEWPORT_WIDTH,
  DEFAULT_ENGINE_VIEWPORT_HEIGHT,
  DEFAULT_ENGINE_VIEWPORT_DEVICE_SCALE_FACTOR,
  type JSONRPCErrorResponse,
} from "@oyerinde/caliper-schema";
import { CaliperEngineServer } from "./engine-server.js";

describe("CaliperEngineServer", () => {
  let engineServer: CaliperEngineServer | null = null;

  afterEach(async () => {
    await engineServer?.stop();
    engineServer = null;
  });

  it("serves engine health", async () => {
    engineServer = new CaliperEngineServer({ port: 0, targetUrl: "http://localhost:3000" });
    await engineServer.start();

    const response = await fetch(
      buildEngineHttpUrl(DEFAULT_ENGINE_HOST, engineServer.port, "/health")
    );
    expect(response.status).toBe(200);

    const health = await response.json();
    expect(health).toMatchObject({
      ok: true,
      runtime: "engine",
      activeUrl: "http://localhost:3000",
      activePageId: null,
      pages: [],
      defaultViewport: {
        width: DEFAULT_ENGINE_VIEWPORT_WIDTH,
        height: DEFAULT_ENGINE_VIEWPORT_HEIGHT,
        deviceScaleFactor: DEFAULT_ENGINE_VIEWPORT_DEVICE_SCALE_FACTOR,
      },
      chromeConnected: false,
      allowScriptEval: false,
    });
  });

  it("serves engine overlay state snapshot", async () => {
    engineServer = new CaliperEngineServer({ port: 0 });
    await engineServer.start();

    const response = await fetch(
      buildEngineHttpUrl(DEFAULT_ENGINE_HOST, engineServer.port, "/state")
    );
    expect(response.status).toBe(200);

    const state = await response.json();
    expect(state).toMatchObject({
      stateSeq: 0,
      activePageId: null,
      pages: {},
    });
  });

  it("streams state updates over SSE", async () => {
    engineServer = new CaliperEngineServer({ port: 0 });
    await engineServer.start();

    const response = await fetch(
      buildEngineHttpUrl(DEFAULT_ENGINE_HOST, engineServer.port, CALIPER_ENGINE_STATE_SSE_PATH),
      { headers: { accept: "text/event-stream" } }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const pushed = new Promise<Record<string, unknown>>((resolve, reject) => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const timer = setTimeout(() => reject(new Error("Timed out waiting for SSE push")), 5_000);

      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const match = chunk.match(/data: (\{.*\})/);
          if (match) {
            const parsed = JSON.parse(match[1]!) as Record<string, unknown>;
            if (parsed.stateSeq === 1) {
              clearTimeout(timer);
              resolve(parsed);
              await reader.cancel();
              return;
            }
          }
          boundary = buffer.indexOf("\n\n");
        }

        await pump();
      };

      void pump();
    });

    engineServer.publishState({
      stateSeq: 1,
      activePageId: "page-1",
      pages: { "page-1": { pageId: "page-1" } },
    });

    const event = await pushed;
    expect(event).toMatchObject({
      stateSeq: 1,
      activePageId: "page-1",
    });
  });

  it("rejects invalid RPC requests", async () => {
    engineServer = new CaliperEngineServer({ port: 0 });
    await engineServer.start();

    const response = await fetch(
      buildEngineHttpUrl(DEFAULT_ENGINE_HOST, engineServer.port, "/rpc"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "not_a_caliper_method", id: "bad-1" }),
      }
    );

    expect(response.status).toBe(400);

    const payload = (await response.json()) as JSONRPCErrorResponse;
    expect(payload.error?.code).toBe(-32600);
    expect(payload.id).toBe("bad-1");
    expect(payload.error?.data).toBeDefined();
  });

  it("validates RPC requests and rejects unconfigured handlers", async () => {
    engineServer = new CaliperEngineServer({ port: 0 });
    await engineServer.start();

    const request = RpcFactory.request(
      CALIPER_METHODS.INSPECT,
      { selector: "[data-caliper-agent-id='hero']" },
      "rpc-1"
    );

    const response = await fetch(
      buildEngineHttpUrl(DEFAULT_ENGINE_HOST, engineServer.port, "/rpc"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }
    );

    expect(response.status).toBe(501);

    const payload = (await response.json()) as JSONRPCErrorResponse;
    expect(payload.error?.message).toBe("Engine RPC handlers are not configured yet");
  });
});
