import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CdpClient } from "./cdp-client.js";
import type {
  LogEntryAddedEvent,
  NetworkLoadingFailedEvent,
  NetworkRequestWillBeSentEvent,
  RuntimeConsoleApiCalledEvent,
} from "./cdp-protocol.js";
import { RuntimeCaptureSession } from "./runtime-capture-session.js";

type EventHandler = (params: unknown) => void;

function captureEnabledPath(projectRoot: string): string {
  return join(projectRoot, ".caliper", "runtime", "capture.enabled.json");
}

function consoleChannelPath(projectRoot: string): string {
  return join(projectRoot, ".caliper", "runtime", "console.ndjson");
}

function readChannelLines(projectRoot: string): unknown[] {
  const path = consoleChannelPath(projectRoot);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function writeCaptureEnabledFlag(projectRoot: string, enabled: boolean): void {
  const flagPath = captureEnabledPath(projectRoot);
  mkdirSync(join(projectRoot, ".caliper", "runtime"), { recursive: true });
  writeFileSync(
    flagPath,
    JSON.stringify({ enabled, subscribedAt: Date.now(), projectRoot }),
    "utf8"
  );
}

function removeCaptureEnabledFlag(projectRoot: string): void {
  try {
    unlinkSync(captureEnabledPath(projectRoot));
  } catch {
    writeFileSync(captureEnabledPath(projectRoot), JSON.stringify({ enabled: false }), "utf8");
  }
}

function createMockCdpClient() {
  const handlers = new Map<string, Set<EventHandler>>();
  const send = vi.fn(async (method: string) => {
    if (
      method === "Runtime.enable" ||
      method === "Log.enable" ||
      method === "Network.enable" ||
      method === "Runtime.disable" ||
      method === "Log.disable" ||
      method === "Network.disable"
    ) {
      return {};
    }
    throw new Error(`unexpected CDP method: ${method}`);
  });

  const onEvent = vi.fn((method: string, handler: EventHandler) => {
    const bucket = handlers.get(method) ?? new Set<EventHandler>();
    bucket.add(handler);
    handlers.set(method, bucket);
    return () => {
      bucket.delete(handler);
    };
  });

  const client = { send, onEvent } as unknown as CdpClient;

  return {
    client,
    send,
    onEvent,
    dispatch(method: string, params: unknown): void {
      const bucket = handlers.get(method);
      if (!bucket) {
        return;
      }
      for (const handler of bucket) {
        handler(params);
      }
    },
    handlerCount(method: string): number {
      return handlers.get(method)?.size ?? 0;
    },
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 1_000,
  intervalMs = 10
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("condition not met before timeout");
}

describe("RuntimeCaptureSession", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "caliper-runtime-capture-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("does not enable CDP domains on start when capture flag is absent", async () => {
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });

    await session.start();

    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.handlerCount("Runtime.consoleAPICalled")).toBe(0);
  });

  it("activates capture immediately when capture flag already exists", async () => {
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });

    await session.start();

    expect(mock.send).toHaveBeenCalledWith("Runtime.enable");
    expect(mock.send).toHaveBeenCalledWith("Log.enable");
    expect(mock.send).toHaveBeenCalledWith("Network.enable");
    expect(mock.handlerCount("Runtime.consoleAPICalled")).toBe(1);
    expect(mock.handlerCount("Network.requestWillBeSent")).toBe(1);
  });

  it("activates capture when capture flag is written after start", async () => {
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();

    writeCaptureEnabledFlag(tempRoot, true);

    await waitUntil(() => mock.send.mock.calls.some((call) => call[0] === "Runtime.enable"), 2_000);

    expect(mock.handlerCount("Runtime.consoleAPICalled")).toBe(1);
  });

  it("deactivates capture and disables CDP domains when flag is removed", async () => {
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();
    await waitUntil(() => mock.handlerCount("Runtime.consoleAPICalled") === 1);

    removeCaptureEnabledFlag(tempRoot);

    await waitUntil(() => mock.send.mock.calls.some((call) => call[0] === "Runtime.disable"));

    expect(mock.handlerCount("Runtime.consoleAPICalled")).toBe(0);
    expect(mock.send).toHaveBeenCalledWith("Log.disable");
    expect(mock.send).toHaveBeenCalledWith("Network.disable");
  });

  it("ignores invalid capture flag payloads", async () => {
    mkdirSync(join(tempRoot, ".caliper", "runtime"), { recursive: true });
    writeFileSync(captureEnabledPath(tempRoot), "{not-json", "utf8");

    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();

    expect(mock.send).not.toHaveBeenCalled();
  });

  it("batches CDP console events through handlers into the disk writer debounce pipeline", async () => {
    vi.useFakeTimers();
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();

    for (const text of ["one", "two", "three"]) {
      mock.dispatch("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "string", value: text }],
        timestamp: 1,
      } satisfies RuntimeConsoleApiCalledEvent);
    }

    expect(existsSync(consoleChannelPath(tempRoot))).toBe(false);

    await vi.advanceTimersByTimeAsync(150);

    const lines = readFileSync(consoleChannelPath(tempRoot), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(3);
    expect(session.getFingerprint().counts.console).toBe(3);
  });

  it("writes console events to disk only while capture is active", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();

    mock.dispatch("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "hello" }],
      timestamp: 42,
    } satisfies RuntimeConsoleApiCalledEvent);

    await vi.advanceTimersByTimeAsync(150);

    const lines = readFileSync(consoleChannelPath(tempRoot), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ text: "hello", timestamp: 42 });

    removeCaptureEnabledFlag(tempRoot);
    await waitUntil(() => mock.handlerCount("Runtime.consoleAPICalled") === 0);

    mock.dispatch("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "ignored" }],
      timestamp: 99,
    } satisfies RuntimeConsoleApiCalledEvent);

    await vi.advanceTimersByTimeAsync(150);

    expect(lines).toHaveLength(1);
  });

  it("resolves network failure URLs from requestWillBeSent events", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();

    mock.dispatch("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.test/app.js" },
    } satisfies NetworkRequestWillBeSentEvent);

    mock.dispatch("Network.loadingFailed", {
      requestId: "req-1",
      errorText: "net::ERR_FAILED",
      type: "Script",
      timestamp: 7,
    } satisfies NetworkLoadingFailedEvent);

    await vi.advanceTimersByTimeAsync(150);

    const networkPath = join(tempRoot, ".caliper", "runtime", "network-failures.ndjson");
    expect(existsSync(networkPath)).toBe(true);
    const line = readFileSync(networkPath, "utf8").trim();
    expect(JSON.parse(line)).toMatchObject({
      url: "https://example.test/app.js",
      error: "net::ERR_FAILED",
    });
  });

  it("flushes pending runtime lines when capture is deactivated", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();

    mock.dispatch("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "flush-on-disable" }],
      timestamp: 1,
    } satisfies RuntimeConsoleApiCalledEvent);

    removeCaptureEnabledFlag(tempRoot);
    await waitUntil(() => mock.send.mock.calls.some((call) => call[0] === "Runtime.disable"));

    const lines = readFileSync(consoleChannelPath(tempRoot), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ text: "flush-on-disable" });
  });

  it("clear removes buffered and flushed runtime data", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();

    mock.dispatch("Log.entryAdded", {
      entry: { source: "network", level: "error", text: "boom", timestamp: 3 },
    } satisfies LogEntryAddedEvent);

    await vi.advanceTimersByTimeAsync(150);
    session.clear();

    const logsPath = join(tempRoot, ".caliper", "runtime", "logs.ndjson");
    expect(readFileSync(logsPath, "utf8")).toBe("");
    expect(session.getFingerprint().counts.logs).toBe(0);
  });

  it("stop closes watcher and deactivates capture", async () => {
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();
    await waitUntil(() => mock.handlerCount("Runtime.consoleAPICalled") === 1);

    await session.stop();

    expect(mock.send).toHaveBeenCalledWith("Runtime.disable");
    expect(mock.handlerCount("Runtime.consoleAPICalled")).toBe(0);
  });

  it("serializes subscribe, unsubscribe, and resubscribe transitions", async () => {
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();

    writeCaptureEnabledFlag(tempRoot, true);
    await waitUntil(() => mock.send.mock.calls.some((call) => call[0] === "Runtime.enable"));

    removeCaptureEnabledFlag(tempRoot);
    await waitUntil(() => mock.send.mock.calls.some((call) => call[0] === "Runtime.disable"));
    expect(mock.handlerCount("Runtime.consoleAPICalled")).toBe(0);

    writeCaptureEnabledFlag(tempRoot, true);
    await waitUntil(
      () => mock.send.mock.calls.filter((call) => call[0] === "Runtime.enable").length >= 2,
      2_000
    );

    expect(mock.handlerCount("Runtime.consoleAPICalled")).toBe(1);
  });

  it("trips capture on ingest overrun writes tripped flag and stays silent", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, {
      projectRoot: tempRoot,
      guard: {
        rateMaxEvents: 2,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 1_000,
      },
    });
    await session.start();
    await waitUntil(() => mock.handlerCount("Runtime.consoleAPICalled") === 1);

    for (let index = 0; index < 3; index += 1) {
      mock.dispatch("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "string", value: `line-${index}` }],
        timestamp: index + 1,
      });
    }

    await waitUntil(() => session.getFingerprint().tripped?.code === "rate_exceeded", 2_000);

    expect(mock.send).toHaveBeenCalledWith("Runtime.disable");
    expect(mock.handlerCount("Runtime.consoleAPICalled")).toBe(0);

    const flagPath = join(tempRoot, ".caliper", "runtime", "capture.enabled.json");
    const flag = JSON.parse(readFileSync(flagPath, "utf8"));
    expect(flag.enabled).toBe(false);
    expect(flag.tripCode).toBe("rate_exceeded");

    mock.dispatch("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "after-trip" }],
      timestamp: 99,
    });
    await vi.advanceTimersByTimeAsync(200);

    const consolePath = join(tempRoot, ".caliper", "runtime", "console.ndjson");
    const lines = readFileSync(consolePath, "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("resets guard budgets when capture is reactivated after a new subscribe", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, {
      projectRoot: tempRoot,
      guard: {
        rateMaxEvents: 2,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 1_000,
      },
    });
    await session.start();
    await waitUntil(() => mock.handlerCount("Runtime.consoleAPICalled") === 1);

    for (let index = 0; index < 3; index += 1) {
      mock.dispatch("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "string", value: `trip-${index}` }],
        timestamp: index + 1,
      });
    }
    await waitUntil(() => session.getFingerprint().tripped !== undefined, 2_000);

    removeCaptureEnabledFlag(tempRoot);
    await waitUntil(() => mock.handlerCount("Runtime.consoleAPICalled") === 0);

    writeCaptureEnabledFlag(tempRoot, true);
    await waitUntil(
      () => mock.send.mock.calls.filter((call) => call[0] === "Runtime.enable").length >= 2,
      2_000
    );
    expect(session.getFingerprint().tripped).toBeUndefined();

    mock.dispatch("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "fresh-session" }],
      timestamp: 50,
    });
    await vi.advanceTimersByTimeAsync(200);

    const lines = readChannelLines(tempRoot) as Array<{ text: string }>;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("fresh-session");
  });

  it("clears runtime channel files when capture reactivates after a trip", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, {
      projectRoot: tempRoot,
      guard: { rateMaxEvents: 1, sessionMaxLines: 10_000, duplicateStreakCount: 1_000 },
    });
    await session.start();
    await waitUntil(() => mock.handlerCount("Runtime.consoleAPICalled") === 1);

    mock.dispatch("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "before-trip" }],
      timestamp: 1,
    });
    mock.dispatch("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "trip-trigger" }],
      timestamp: 2,
    });
    await waitUntil(() => session.getFingerprint().tripped !== undefined, 2_000);
    await vi.advanceTimersByTimeAsync(200);
    expect(readChannelLines(tempRoot).length).toBeGreaterThan(0);

    writeCaptureEnabledFlag(tempRoot, true);
    await waitUntil(
      () => mock.send.mock.calls.filter((call) => call[0] === "Runtime.enable").length >= 2,
      2_000
    );

    expect(readChannelLines(tempRoot)).toHaveLength(0);
    expect(session.getFingerprint().tripped).toBeUndefined();
    expect(session.getFingerprint().counts.console).toBe(0);
  });

  it("keeps runtime channel files when resubscribing without a prior trip", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    writeCaptureEnabledFlag(tempRoot, true);
    const mock = createMockCdpClient();
    const session = new RuntimeCaptureSession(mock.client, { projectRoot: tempRoot });
    await session.start();
    await waitUntil(() => mock.handlerCount("Runtime.consoleAPICalled") === 1);

    mock.dispatch("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "first-session" }],
      timestamp: 1,
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(readChannelLines(tempRoot)).toHaveLength(1);

    removeCaptureEnabledFlag(tempRoot);
    await waitUntil(() => mock.handlerCount("Runtime.consoleAPICalled") === 0);

    writeCaptureEnabledFlag(tempRoot, true);
    await waitUntil(
      () => mock.send.mock.calls.filter((call) => call[0] === "Runtime.enable").length >= 2,
      2_000
    );

    mock.dispatch("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "second-session" }],
      timestamp: 2,
    });
    await vi.advanceTimersByTimeAsync(200);

    const lines = readChannelLines(tempRoot) as Array<{ text: string }>;
    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toBe("first-session");
    expect(lines[1]?.text).toBe("second-session");
  });
});
