import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALIPER_METHODS, RpcFactory } from "@oyerinde/caliper-schema";
import type { CdpSendClient } from "./cdp-page-session.js";
import {
  CaliperHarnessLoadError,
  HarnessSession,
  type HarnessPageProbe,
  emptyHarnessProbe,
} from "./harness-session.js";

const injectIntoCurrentDocument = vi.fn(async () => undefined);
const registerCaliperBootstrap = vi.fn(async () => undefined);

vi.mock("./inject-session.js", () => ({
  InjectSession: class {
    registerCaliperBootstrap = registerCaliperBootstrap;
    injectIntoCurrentDocument = injectIntoCurrentDocument;
  },
}));

type MockHarnessOptions = {
  probes?: HarnessPageProbe[];
  injectThrows?: boolean;
};

function createMockClient(options: MockHarnessOptions = {}): CdpSendClient {
  const probes = [...(options.probes ?? [])];
  const transportExpressions: string[] = [];

  return {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Page.enable") {
        return {};
      }

      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        return { identifier: "bootstrap-1" };
      }

      if (method === "Runtime.evaluate") {
        const expression = String(params?.expression ?? "");

        if (params?.awaitPromise) {
          return {
            result: {
              type: "object",
              value: {
                success: true,
                method: CALIPER_METHODS.MEASURE,
                timestamp: Date.now(),
              },
            },
          };
        }

        if (expression.includes("dispatchReady:")) {
          const probe = probes.length > 0 ? probes.shift()! : emptyHarnessProbe();
          return {
            result: {
              type: "object",
              value: probe,
            },
          };
        }

        if (
          expression.includes("__CALIPER_ENGINE_MANAGED__") ||
          expression.includes("__CALIPER_ENGINE_REPORT_STATE__") ||
          expression.includes("__CALIPER_ENGINE_APPLY_MANAGED_TRANSPORT__")
        ) {
          transportExpressions.push(expression);
        }

        if (options.injectThrows && expression.includes("__CALIPER_ENGINE_INJECTED__")) {
          throw new Error("inject failed");
        }
      }

      return {};
    }),
    onEvent: vi.fn(() => () => undefined),
    waitForEvent: vi.fn(async () => undefined),
    getTransportExpressions: () => transportExpressions,
  } as CdpSendClient & { getTransportExpressions: () => string[] };
}

describe("HarnessSession.ensureReady", () => {
  beforeEach(() => {
    registerCaliperBootstrap.mockClear();
    injectIntoCurrentDocument.mockClear();
  });

  it("always registers bootstrap and marks the page engine-managed", async () => {
    const client = createMockClient({
      probes: [
        {
          dispatchReady: true,
          engineInjected: true,
          pageCaliperPresent: true,
          bridgeBooting: false,
        },
      ],
    });

    const mockClient = client as CdpSendClient & { getTransportExpressions: () => string[] };
    await new HarnessSession(mockClient).ensureReady();

    expect(registerCaliperBootstrap).toHaveBeenCalledOnce();
    expect(mockClient.getTransportExpressions().length).toBeGreaterThan(0);
    expect(
      mockClient.getTransportExpressions().some((expression: string) =>
        expression.includes("__CALIPER_ENGINE_MANAGED__")
      )
    ).toBe(true);
  });

  it("applies managed transport for pre-existing Caliper pages", async () => {
    const client = createMockClient({
      probes: [
        {
          dispatchReady: true,
          engineInjected: false,
          pageCaliperPresent: true,
          bridgeBooting: false,
        },
      ],
    });

    const mockClient = client as CdpSendClient & { getTransportExpressions: () => string[] };
    await expect(new HarnessSession(mockClient).ensureReady()).resolves.toBeUndefined();
    expect(injectIntoCurrentDocument).not.toHaveBeenCalled();
    expect(
      mockClient.getTransportExpressions().some((expression: string) =>
        expression.includes("__CALIPER_ENGINE_APPLY_MANAGED_TRANSPORT__")
      )
    ).toBe(true);
  });

  it("skips managed transport apply when engine bootstrap already injected", async () => {
    const client = createMockClient({
      probes: [
        {
          dispatchReady: true,
          engineInjected: true,
          pageCaliperPresent: true,
          bridgeBooting: false,
        },
      ],
    });

    const mockClient = client as CdpSendClient & { getTransportExpressions: () => string[] };
    await expect(new HarnessSession(mockClient).ensureReady()).resolves.toBeUndefined();
    expect(
      mockClient.getTransportExpressions().some((expression: string) =>
        expression.includes("__CALIPER_ENGINE_APPLY_MANAGED_TRANSPORT__")
      )
    ).toBe(false);
  });

  it("waits for CaliperBridge boot then applies managed transport", async () => {
    const client = createMockClient({
      probes: [
        {
          dispatchReady: false,
          engineInjected: false,
          pageCaliperPresent: true,
          bridgeBooting: false,
        },
        {
          dispatchReady: true,
          engineInjected: false,
          pageCaliperPresent: true,
          bridgeBooting: false,
        },
      ],
    });

    await expect(new HarnessSession(client).ensureReady()).resolves.toBeUndefined();
    expect(injectIntoCurrentDocument).not.toHaveBeenCalled();
  });

  it("fails when overlay never exposes dispatch", async () => {
    vi.useFakeTimers();
    try {
      const client = createMockClient({
        probes: Array.from({ length: 200 }, () => ({
          dispatchReady: false,
          engineInjected: false,
          pageCaliperPresent: true,
          bridgeBooting: false,
        })),
      });

      const pending = new HarnessSession(client).ensureReady();
      const rejection = expect(pending).rejects.toBeInstanceOf(CaliperHarnessLoadError);
      await vi.runAllTimersAsync();
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("injects on blank pages and waits for dispatch", async () => {
    const readyProbe: HarnessPageProbe = {
      dispatchReady: true,
      engineInjected: true,
      pageCaliperPresent: true,
      bridgeBooting: false,
    };

    const client = createMockClient({
      probes: [emptyHarnessProbe(), readyProbe, readyProbe],
    });

    await expect(new HarnessSession(client).ensureReady()).resolves.toBeUndefined();
    expect(injectIntoCurrentDocument).toHaveBeenCalledOnce();
  });
});

describe("HarnessSession.dispatchIntent", () => {
  it("returns harness errors when dispatch is unavailable", async () => {
    const client = createMockClient();
    (client.send as ReturnType<typeof vi.fn>).mockImplementation(
      async (method: string, params?: Record<string, unknown>) => {
        if (method === "Runtime.evaluate" && params?.awaitPromise) {
          return {
            result: {
              type: "object",
              value: {
                success: false,
                method: CALIPER_METHODS.MEASURE,
                error: "Caliper harness is not available in this tab",
                timestamp: 1,
              },
            },
          };
        }
        return {};
      }
    );

    const result = await new HarnessSession(client).dispatchIntent(
      RpcFactory.request(
        CALIPER_METHODS.MEASURE,
        {
          pageId: "page-1",
          primarySelector: "a",
          secondarySelector: "b",
        },
        "req-1"
      ) as Parameters<HarnessSession["dispatchIntent"]>[0]
    );

    expect(result.success).toBe(false);
  });
});
