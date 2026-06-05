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
import type {
  CaliperProjectPaths,
  CaliperRuntimeChannel,
  CaliperRuntimeConsoleEntry,
} from "@oyerinde/caliper-schema";
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

function readChannelLines(
  projectPaths: CaliperProjectPaths,
  channel: CaliperRuntimeChannel
): string[] {
  const filePath = projectPaths.channelPaths[channel];
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function createWriter(
  projectPaths: CaliperProjectPaths,
  overrides: {
    maxChannelBytes?: number;
    flushDebounceMs?: number;
    maxBatchLines?: number;
    maxBatchBytes?: number;
  } = {}
): RuntimeDiskWriter {
  return new RuntimeDiskWriter({
    projectPaths,
    flushDebounceMs: 150,
    maxBatchLines: 32,
    maxBatchBytes: 32 * 1024,
    ...overrides,
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

  describe("capture gate", () => {
    it("drops appends while capture is disabled", () => {
      const writer = createWriter(projectPaths);
      expect(writer.isCaptureEnabled()).toBe(false);

      writer.appendChannel("console", { level: "log", text: "ignored" });

      expect(readChannelLines(projectPaths, "console")).toHaveLength(0);
      expect(existsSync(projectPaths.fingerprintPath)).toBe(false);
    });

    it("accepts appends only after setCaptureEnabled(true)", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths);
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "hello", timestamp: 100 });
      await vi.advanceTimersByTimeAsync(150);

      const lines = readChannelLines(projectPaths, "console");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({
        level: "log",
        text: "hello",
        timestamp: 100,
      });
    });

    it("flushes pending data synchronously when capture is disabled", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths);
      writer.setCaptureEnabled(true);
      writer.appendChannel("console", { level: "log", text: "pending" });

      writer.setCaptureEnabled(false);

      expect(readChannelLines(projectPaths, "console")).toHaveLength(1);
      writer.appendChannel("console", { level: "log", text: "after-disable" });
      expect(readChannelLines(projectPaths, "console")).toHaveLength(1);
    });
  });

  describe("batched flush", () => {
    it("buffers appends and writes one NDJSON block after debounce", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths, { flushDebounceMs: 150 });
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "one" });
      writer.appendChannel("console", { level: "log", text: "two" });

      expect(readChannelLines(projectPaths, "console")).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(150);

      const lines = readChannelLines(projectPaths, "console");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toMatchObject({ text: "one" });
      expect(JSON.parse(lines[1]!)).toMatchObject({ text: "two" });
    });

    it("increments seq once per batch flush, not per event", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths, { flushDebounceMs: 150 });
      writer.setCaptureEnabled(true);

      for (let index = 0; index < 5; index += 1) {
        writer.appendChannel("console", { level: "log", text: `line-${index}` });
      }

      await vi.advanceTimersByTimeAsync(150);

      const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
      expect(fingerprint.counts.console).toBe(5);
      expect(fingerprint.seq).toBe(1);
    });

    it("resets debounce timer on each append", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths, { flushDebounceMs: 150 });
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "first" });
      await vi.advanceTimersByTimeAsync(100);
      writer.appendChannel("console", { level: "log", text: "second" });

      expect(readChannelLines(projectPaths, "console")).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(100);
      expect(readChannelLines(projectPaths, "console")).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(50);
      expect(readChannelLines(projectPaths, "console")).toHaveLength(2);
    });

    it("flushes only after the full debounce window passes with no new appends", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths, { flushDebounceMs: 150 });
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "quiet-batch" });
      await vi.advanceTimersByTimeAsync(149);

      expect(readChannelLines(projectPaths, "console")).toHaveLength(0);
      expect(existsSync(projectPaths.fingerprintPath)).toBe(false);

      await vi.advanceTimersByTimeAsync(1);

      expect(readChannelLines(projectPaths, "console")).toHaveLength(1);
      expect(existsSync(projectPaths.fingerprintPath)).toBe(true);
    });

    it("flushes multiple channels in one debounce window with a single seq bump", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths, { flushDebounceMs: 150 });
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "c" });
      writer.appendChannel("logs", { source: "browser", level: "info", text: "l" });

      await vi.advanceTimersByTimeAsync(150);

      expect(readChannelLines(projectPaths, "console")).toHaveLength(1);
      expect(readChannelLines(projectPaths, "logs")).toHaveLength(1);

      const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
      expect(fingerprint.counts.console).toBe(1);
      expect(fingerprint.counts.logs).toBe(1);
      expect(fingerprint.seq).toBe(1);
    });
  });

  describe("hard flush thresholds", () => {
    it("flushes immediately when maxBatchLines is reached", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths, { flushDebounceMs: 500, maxBatchLines: 3 });
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "1" });
      writer.appendChannel("console", { level: "log", text: "2" });
      expect(readChannelLines(projectPaths, "console")).toHaveLength(0);

      writer.appendChannel("console", { level: "log", text: "3" });

      expect(readChannelLines(projectPaths, "console")).toHaveLength(3);

      const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
      expect(fingerprint.seq).toBe(1);

      writer.appendChannel("console", { level: "log", text: "4" });
      expect(readChannelLines(projectPaths, "console")).toHaveLength(3);

      await vi.advanceTimersByTimeAsync(500);
      expect(readChannelLines(projectPaths, "console")).toHaveLength(4);
      expect(JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8")).seq).toBe(2);
    });

    it("flushes at line threshold while rapid appends keep resetting debounce", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths, {
        flushDebounceMs: 500,
        maxBatchLines: 5,
      });
      writer.setCaptureEnabled(true);

      for (let index = 0; index < 4; index += 1) {
        writer.appendChannel("console", { level: "log", text: `burst-${index}` });
        await vi.advanceTimersByTimeAsync(10);
      }

      expect(readChannelLines(projectPaths, "console")).toHaveLength(0);

      writer.appendChannel("console", { level: "log", text: "threshold-line" });

      expect(readChannelLines(projectPaths, "console")).toHaveLength(5);
      expect(JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8")).seq).toBe(1);

      writer.appendChannel("console", { level: "log", text: "after-threshold" });
      expect(readChannelLines(projectPaths, "console")).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(500);
      expect(readChannelLines(projectPaths, "console")).toHaveLength(6);
      expect(JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8")).seq).toBe(2);
    });

    it("flushes immediately when maxBatchBytes is reached", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths, {
        flushDebounceMs: 500,
        maxBatchBytes: 120,
      });
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "small" });
      expect(readChannelLines(projectPaths, "console")).toHaveLength(0);

      writer.appendChannel("console", {
        level: "log",
        text: "z".repeat(80),
      });

      expect(readChannelLines(projectPaths, "console")).toHaveLength(2);
      expect(JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8")).seq).toBe(1);
    });
  });

  describe("fingerprint and hydration", () => {
    it("includes pending lines in readFingerprint counts before debounce flush", () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths);
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "buffered" });

      const fingerprint = writer.readFingerprint();
      expect(fingerprint.counts.console).toBe(1);
      expect(readChannelLines(projectPaths, "console")).toHaveLength(0);
    });

    it("hydrates line counts and seq from existing files on startup", async () => {
      vi.useFakeTimers();
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

      const writer = createWriter(projectPaths);
      writer.setCaptureEnabled(true);
      writer.appendChannel("console", { level: "log", text: "new" });
      await vi.advanceTimersByTimeAsync(150);

      const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
      expect(fingerprint.counts.console).toBe(2);
      expect(fingerprint.seq).toBe(10);
    });

    it("marks rotated when a .1 generation file already exists", () => {
      ensureRuntimeDir(projectPaths);
      writeFileSync(projectPaths.channelPaths.console, "x".repeat(20), "utf8");
      writeFileSync(`${projectPaths.channelPaths.console}.1`, "rotated-data", "utf8");

      const writer = createWriter(projectPaths);
      const fingerprint = writer.readFingerprint();

      expect(fingerprint.rotated?.console).toBe(true);
    });

    it("returns a built snapshot when fingerprint file is missing", () => {
      const writer = createWriter(projectPaths);
      const fingerprint = writer.readFingerprint();

      expect(fingerprint.seq).toBe(0);
      expect(fingerprint.counts.console).toBe(0);
      expect(fingerprint.capturedAt).toBeGreaterThan(0);
    });
  });

  describe("redaction and routing", () => {
    it("redacts sensitive fields before buffering", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths);
      writer.setCaptureEnabled(true);

      const entryWithSecret = {
        level: "log",
        text: "ok",
        password: "hunter2",
      } as CaliperRuntimeConsoleEntry;
      writer.appendChannel("console", entryWithSecret);
      await vi.advanceTimersByTimeAsync(150);

      const line = readChannelLines(projectPaths, "console")[0]!;
      expect(line).toContain('"password":"[REDACTED]"');
      expect(line).not.toContain("hunter2");
    });

    it("routes channels to separate files", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths);
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "c" });
      writer.appendChannel("exceptions", { text: "e", timestamp: 1 });
      writer.appendChannel("logs", { source: "browser", level: "info", text: "l" });
      writer.appendChannel("networkFailures", { url: "https://x", error: "fail" });
      await vi.advanceTimersByTimeAsync(150);

      expect(readChannelLines(projectPaths, "console")).toHaveLength(1);
      expect(readChannelLines(projectPaths, "exceptions")).toHaveLength(1);
      expect(readChannelLines(projectPaths, "logs")).toHaveLength(1);
      expect(readChannelLines(projectPaths, "networkFailures")).toHaveLength(1);
    });
  });

  describe("guard snapshot", () => {
    it("tracks flushed and pending line counts for the capture guard", () => {
      const writer = createWriter(projectPaths);
      writer.setCaptureEnabled(true);
      writer.appendChannel("console", { level: "log", text: "one", timestamp: 1 });
      writer.appendChannel("logs", {
        source: "network",
        level: "error",
        text: "two",
        timestamp: 2,
      });

      expect(writer.getGuardSnapshot()).toEqual({
        flushedLines: 0,
        flushedBytes: 0,
        pendingLines: 2,
      });

      writer.flushAll();
      const snapshot = writer.getGuardSnapshot();
      expect(snapshot.flushedLines).toBe(2);
      expect(snapshot.pendingLines).toBe(0);
      expect(snapshot.flushedBytes).toBeGreaterThan(0);
    });
  });

  describe("capture trip", () => {
    it("recordTrip flushes pending lines writes tripped fingerprint and disables capture", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths);
      writer.setCaptureEnabled(true);
      writer.appendChannel("console", { level: "log", text: "pending-trip" });

      writer.recordTrip({
        code: "rate_exceeded",
        at: 99,
        message: "too fast",
      });

      expect(writer.isCaptureEnabled()).toBe(false);
      expect(readChannelLines(projectPaths, "console")).toHaveLength(1);

      const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
      expect(fingerprint.tripped).toMatchObject({
        code: "rate_exceeded",
        at: 99,
        message: "too fast",
      });
      expect(fingerprint.seq).toBeGreaterThan(0);

      writer.appendChannel("console", { level: "log", text: "ignored-after-trip" });
      expect(readChannelLines(projectPaths, "console")).toHaveLength(1);
    });
  });

  describe("clearAll and rotation", () => {
    it("clearAll cancels pending buffers and truncates channel files", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths);
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "pending" });
      writeFileSync(`${projectPaths.channelPaths.console}.1`, "old-generation", "utf8");

      writer.clearAll();

      expect(readChannelLines(projectPaths, "console")).toHaveLength(0);
      expect(readFileSync(`${projectPaths.channelPaths.console}.1`, "utf8")).toBe("");

      const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
      expect(fingerprint.counts.console).toBe(0);
      expect(fingerprint.seq).toBe(0);
    });

    it("flushAll writes any remaining pending lines", () => {
      const writer = createWriter(projectPaths);
      writer.setCaptureEnabled(true);
      writer.appendChannel("console", { level: "log", text: "sync-flush" });

      writer.flushAll();

      expect(readChannelLines(projectPaths, "console")).toHaveLength(1);
    });

    it("rotates channel file when flushed batch would exceed maxChannelBytes", async () => {
      vi.useFakeTimers();
      const writer = createWriter(projectPaths, {
        maxChannelBytes: 48,
        maxBatchLines: 10,
      });
      writer.setCaptureEnabled(true);

      writer.appendChannel("console", { level: "log", text: "123456789012345678901234567890" });
      await vi.advanceTimersByTimeAsync(150);

      writer.appendChannel("console", { level: "log", text: "after-rotate" });
      await vi.advanceTimersByTimeAsync(150);

      expect(existsSync(`${projectPaths.channelPaths.console}.1`)).toBe(true);
      expect(statSync(projectPaths.channelPaths.console).size).toBeGreaterThan(0);
      expect(statSync(`${projectPaths.channelPaths.console}.1`).size).toBeGreaterThan(40);

      const activeLines = readChannelLines(projectPaths, "console");
      expect(activeLines.some((line) => line.includes("after-rotate"))).toBe(true);

      const fingerprint = JSON.parse(readFileSync(projectPaths.fingerprintPath, "utf8"));
      expect(fingerprint.rotated?.console).toBe(true);
    });
  });
});
