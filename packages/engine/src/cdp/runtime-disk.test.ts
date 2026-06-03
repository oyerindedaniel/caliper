import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaliperProjectPaths, CaliperRuntimeChannel } from "@oyerinde/caliper-schema";
import { RuntimeDiskWriter } from "./runtime-disk.js";

function createTestProjectPaths(rootDirectory: string): CaliperProjectPaths {
  const caliperDir = join(rootDirectory, ".caliper");
  const runtimeDir = join(caliperDir, "runtime");
  return {
    projectRoot: rootDirectory,
    caliperDir,
    runtimeDir,
    capturesDir: join(caliperDir, "captures"),
    fingerprintPath: join(runtimeDir, "fingerprint.json"),
    captureEnabledPath: join(runtimeDir, "capture.enabled.json"),
    channelPaths: {
      console: join(runtimeDir, "console.ndjson"),
      exceptions: join(runtimeDir, "exceptions.ndjson"),
      logs: join(runtimeDir, "logs.ndjson"),
      networkFailures: join(runtimeDir, "network-failures.ndjson"),
    },
  };
}

function ensureRuntimeDir(projectPaths: CaliperProjectPaths): void {
  mkdirSync(projectPaths.runtimeDir, { recursive: true });
}

function writeCaptureEnabledFlag(projectPaths: CaliperProjectPaths, enabled: boolean): void {
  ensureRuntimeDir(projectPaths);
  writeFileSync(
    projectPaths.captureEnabledPath,
    JSON.stringify({ enabled, projectRoot: projectPaths.projectRoot }),
    "utf8"
  );
}

function readChannelLines(projectPaths: CaliperProjectPaths, channel: CaliperRuntimeChannel): string[] {
  const filePath = projectPaths.channelPaths[channel];
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function waitForFingerprint(
  projectPaths: CaliperProjectPaths,
  predicate?: (fingerprint: { seq: number; counts: { console: number } }) => boolean,
  timeoutMs = 500
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (existsSync(projectPaths.fingerprintPath)) {
        if (!predicate) {
          resolve();
          return;
        }
        try {
          const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
          if (predicate(fingerprint)) {
            resolve();
            return;
          }
        } catch {
          // keep polling until parse succeeds
        }
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("fingerprint.json did not match predicate in time"));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

describe("RuntimeDiskWriter", () => {
  let tempRoot: string;
  let projectPaths: CaliperProjectPaths;
  const originalRedactFlag = process.env.CALIPER_RUNTIME_REDACT;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "caliper-runtime-disk-"));
    projectPaths = createTestProjectPaths(tempRoot);
    process.env.CALIPER_RUNTIME_REDACT = "1";
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalRedactFlag === undefined) {
      delete process.env.CALIPER_RUNTIME_REDACT;
    } else {
      process.env.CALIPER_RUNTIME_REDACT = originalRedactFlag;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("does not append when capture.enabled.json is missing", () => {
    const writer = new RuntimeDiskWriter({ projectPaths });
    expect(writer.isCaptureEnabled()).toBe(false);

    writer.appendChannel("console", { level: "log", text: "ignored" });

    expect(readChannelLines(projectPaths, "console")).toHaveLength(0);
  });

  it("does not append when capture flag is disabled", () => {
    writeCaptureEnabledFlag(projectPaths, false);
    const writer = new RuntimeDiskWriter({ projectPaths });

    writer.appendChannel("console", { level: "log", text: "ignored" });

    expect(readChannelLines(projectPaths, "console")).toHaveLength(0);
  });

  it("appends one NDJSON line per event to the channel file when capture is enabled", async () => {
    writeCaptureEnabledFlag(projectPaths, true);
    const writer = new RuntimeDiskWriter({ projectPaths });

    writer.appendChannel("console", { level: "log", text: "hello", timestamp: 100 });
    await waitForFingerprint(projectPaths);

    const lines = readChannelLines(projectPaths, "console");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "log", text: "hello", timestamp: 100 });

    const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
    expect(fingerprint.counts.console).toBe(1);
    expect(fingerprint.seq).toBeGreaterThan(0);
  });

  it("routes channels to separate files", async () => {
    writeCaptureEnabledFlag(projectPaths, true);
    const writer = new RuntimeDiskWriter({ projectPaths });

    writer.appendChannel("console", { level: "log", text: "c" });
    writer.appendChannel("exceptions", { text: "e", timestamp: 1 });
    writer.appendChannel("logs", { source: "browser", level: "info", text: "l" });
    writer.appendChannel("networkFailures", { url: "https://x", error: "fail" });
    await waitForFingerprint(projectPaths);

    expect(readChannelLines(projectPaths, "console")).toHaveLength(1);
    expect(readChannelLines(projectPaths, "exceptions")).toHaveLength(1);
    expect(readChannelLines(projectPaths, "logs")).toHaveLength(1);
    expect(readChannelLines(projectPaths, "networkFailures")).toHaveLength(1);
  });

  it("redacts sensitive fields in appended lines", async () => {
    writeCaptureEnabledFlag(projectPaths, true);
    const writer = new RuntimeDiskWriter({ projectPaths });

    writer.appendChannel("console", { password: "hunter2", message: "ok" });
    await waitForFingerprint(projectPaths);

    const line = readChannelLines(projectPaths, "console")[0]!;
    expect(line).toContain('"password":"[REDACTED]"');
    expect(line).toContain('"message":"ok"');
    expect(line).not.toContain("hunter2");
  });

  it("hydrates line counts and seq from existing files on startup", async () => {
    writeCaptureEnabledFlag(projectPaths, true);
    ensureRuntimeDir(projectPaths);
    writeFileSync(
      projectPaths.channelPaths.console,
      `${JSON.stringify({ level: "log", text: "existing" })}\n`,
      "utf8"
    );
    writeFileSync(
      projectPaths.fingerprintPath,
      JSON.stringify({
        seq: 9,
        counts: { console: 1, exceptions: 0, logs: 0, networkFailures: 0 },
        capturedAt: 1,
      }),
      "utf8"
    );

    const writer = new RuntimeDiskWriter({ projectPaths });
    writer.appendChannel("console", { level: "log", text: "new" });
    await waitForFingerprint(projectPaths, (fingerprint) => fingerprint.counts.console === 2);

    const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
    expect(fingerprint.counts.console).toBe(2);
    expect(fingerprint.seq).toBeGreaterThan(9);
  });

  it("marks rotated when a .1 generation file already exists", () => {
    ensureRuntimeDir(projectPaths);
    writeFileSync(projectPaths.channelPaths.console, "x".repeat(20), "utf8");
    writeFileSync(`${projectPaths.channelPaths.console}.1`, "rotated-data", "utf8");

    const writer = new RuntimeDiskWriter({ projectPaths });
    const fingerprint = writer.readFingerprint();

    expect(fingerprint.rotated?.console).toBe(true);
  });

  it("debounces fingerprint writes and increments seq", async () => {
    vi.useFakeTimers();
    writeCaptureEnabledFlag(projectPaths, true);
    const writer = new RuntimeDiskWriter({ projectPaths });

    writer.appendChannel("console", { level: "log", text: "one" });
    writer.appendChannel("console", { level: "log", text: "two" });

    expect(existsSync(projectPaths.fingerprintPath)).toBe(false);

    await vi.advanceTimersByTimeAsync(100);

    expect(existsSync(projectPaths.fingerprintPath)).toBe(true);
    const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
    expect(fingerprint.counts.console).toBe(2);
    expect(fingerprint.seq).toBe(2);
  });

  it("clearAll truncates channel files and rotated generations", async () => {
    writeCaptureEnabledFlag(projectPaths, true);
    const writer = new RuntimeDiskWriter({ projectPaths });

    writer.appendChannel("console", { level: "log", text: "stay-brief" });
    await waitForFingerprint(projectPaths);
    writeFileSync(`${projectPaths.channelPaths.console}.1`, "old-generation", "utf8");

    writer.clearAll();

    expect(readChannelLines(projectPaths, "console")).toHaveLength(0);
    expect(readFileSync(`${projectPaths.channelPaths.console}.1`, "utf8")).toBe("");

    const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
    expect(fingerprint.counts.console).toBe(0);
    expect(fingerprint.seq).toBe(0);
  });

  it("rotates channel file when size exceeds maxChannelBytes", async () => {
    writeCaptureEnabledFlag(projectPaths, true);
    const writer = new RuntimeDiskWriter({
      projectPaths,
      maxChannelBytes: 48,
    });

    writer.appendChannel("console", { level: "log", text: "123456789012345678901234567890" });
    writer.appendChannel("console", { level: "log", text: "after-rotate" });
    await waitForFingerprint(projectPaths);

    expect(existsSync(`${projectPaths.channelPaths.console}.1`)).toBe(true);
    expect(statSync(projectPaths.channelPaths.console).size).toBeGreaterThan(0);
    expect(statSync(`${projectPaths.channelPaths.console}.1`).size).toBeGreaterThan(40);

    const activeLines = readChannelLines(projectPaths, "console");
    expect(activeLines.some((line) => line.includes("after-rotate"))).toBe(true);

    const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
    expect(fingerprint.rotated?.console).toBe(true);
  });

  it("caches capture.enabled reads within the cache window", () => {
    vi.useFakeTimers();
    writeCaptureEnabledFlag(projectPaths, true);
    const writer = new RuntimeDiskWriter({ projectPaths });
    expect(writer.isCaptureEnabled()).toBe(true);

    writeCaptureEnabledFlag(projectPaths, false);

    expect(writer.isCaptureEnabled()).toBe(true);

    vi.advanceTimersByTime(300);
    expect(writer.isCaptureEnabled()).toBe(false);
  });

  it("readFingerprint returns a built snapshot when fingerprint file is missing", () => {
    const writer = new RuntimeDiskWriter({ projectPaths });
    const fingerprint = writer.readFingerprint();

    expect(fingerprint.seq).toBe(0);
    expect(fingerprint.counts.console).toBe(0);
    expect(fingerprint.capturedAt).toBeGreaterThan(0);
  });
});
