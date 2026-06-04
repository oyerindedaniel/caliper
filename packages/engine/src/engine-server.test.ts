import { describe, expect, it, afterEach } from "vitest";
import {
  CALIPER_METHODS,
  RpcFactory,
  buildEngineHttpUrl,
  DEFAULT_ENGINE_HOST,
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
      chromeConnected: false,
      allowScriptEval: false,
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
