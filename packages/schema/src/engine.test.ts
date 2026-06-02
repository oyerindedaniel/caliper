import { describe, expect, it } from "vitest";
import {
  CALIPER_METHODS,
  parseCaliperRpcRequest,
  RpcFactory,
} from "./bridge.js";
import {
  buildEngineHttpUrl,
  CALIPER_MEASUREMENT_ROUTING,
  CALIPER_RUNTIME_MODES,
  DEFAULT_ENGINE_HOST,
  DEFAULT_ENGINE_PORT,
  CaliperConnectionTargetSchema,
  CaliperMeasurementRoutingSchema,
  EngineHealthSchema,
  isLoopbackHost,
} from "./engine.js";

describe("engine schema", () => {
  it("parses engine health", () => {
    const health = EngineHealthSchema.parse({
      ok: true,
      runtime: CALIPER_RUNTIME_MODES.ENGINE,
      version: "0.0.0",
      sessionId: "session-1",
      activeUrl: "http://localhost:3000",
      chromeConnected: false,
      startedAt: 1_700_000_000_000,
    });

    expect(health.chromeConnected).toBe(false);
  });

  it("parses connection targets for attached and engine runtimes", () => {
    expect(
      CaliperConnectionTargetSchema.parse({
        runtime: CALIPER_RUNTIME_MODES.ATTACHED,
        tabId: "tab-1",
      }).runtime
    ).toBe("attached");

    expect(
      CaliperConnectionTargetSchema.parse({
        runtime: CALIPER_RUNTIME_MODES.ENGINE,
        sessionId: "session-1",
        activeUrl: null,
      }).runtime
    ).toBe("engine");
  });

  it("accepts Caliper RPC requests and rejects unrelated methods", () => {
    const request = RpcFactory.request(
      CALIPER_METHODS.INSPECT,
      { selector: "[data-caliper-agent-id='hero']" },
      "rpc-1"
    );

    expect(parseCaliperRpcRequest(request)?.method).toBe(CALIPER_METHODS.INSPECT);

    const invalidRequest = {
      jsonrpc: "2.0",
      id: "rpc-2",
      method: "tools/list",
      params: {},
    };

    expect(parseCaliperRpcRequest(invalidRequest)).toBeNull();
  });

  it("parses measurement routing modes", () => {
    expect(CaliperMeasurementRoutingSchema.parse(CALIPER_MEASUREMENT_ROUTING.AUTO)).toBe("auto");
    expect(CaliperMeasurementRoutingSchema.parse(CALIPER_MEASUREMENT_ROUTING.ATTACHED)).toBe(
      "attached"
    );
    expect(CaliperMeasurementRoutingSchema.parse(CALIPER_MEASUREMENT_ROUTING.ENGINE)).toBe(
      "engine"
    );
    expect(CaliperMeasurementRoutingSchema.safeParse("hybrid").success).toBe(false);
  });

  it("builds loopback engine URLs from shared host constants", () => {
    expect(buildEngineHttpUrl(DEFAULT_ENGINE_HOST, DEFAULT_ENGINE_PORT, "/health")).toBe(
      `http://${DEFAULT_ENGINE_HOST}:${DEFAULT_ENGINE_PORT}/health`
    );
    expect(isLoopbackHost(DEFAULT_ENGINE_HOST)).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
  });
});
