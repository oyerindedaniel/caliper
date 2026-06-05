import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  CALIPER_RUNTIME_CHANNEL_FILES,
  type CaliperProjectPaths,
  type CaliperRuntimeChannel,
  type CaliperRuntimeChannelEntry,
  type CaliperRuntimeChannelCounts,
  type CaliperRuntimeChannelRotation,
  type CaliperRuntimeChannelTimestamps,
  type CaliperRuntimeFingerprint,
  type CaliperRuntimeTrip,
  CaliperRuntimeFingerprintSchema,
} from "@oyerinde/caliper-schema";
import type { RuntimeCaptureGuardSnapshot } from "./runtime-capture-guard.js";
import { isRuntimeRedactionEnabled, redactRuntimeLine } from "./runtime-redact.js";

const DEFAULT_MAX_CHANNEL_BYTES = 32 * 1024 * 1024;
const DEFAULT_FLUSH_DEBOUNCE_MS = 150;
const DEFAULT_MAX_BATCH_LINES = 32;
const DEFAULT_MAX_BATCH_BYTES = 32 * 1024;

export type RuntimeDiskWriterOptions = {
  projectPaths: CaliperProjectPaths;
  maxChannelBytes?: number;
  flushDebounceMs?: number;
  maxBatchLines?: number;
  maxBatchBytes?: number;
};

type ChannelState = {
  lineCount: number;
  lastTimestamp?: number;
  rotated: boolean;
};

type PendingChannel = {
  lines: string[];
  byteLength: number;
  lastTimestamp?: number;
};

export class RuntimeDiskWriter {
  private readonly projectPaths: CaliperProjectPaths;
  private readonly maxChannelBytes: number;
  private readonly flushDebounceMs: number;
  private readonly maxBatchLines: number;
  private readonly maxBatchBytes: number;
  private fingerprintSeq = 0;
  private captureEnabled = false;
  private flushedBytes = 0;
  private guardBaselineLines = 0;
  private guardBaselineBytes = 0;
  private tripped: CaliperRuntimeTrip | undefined;
  private flushDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly channelState: Record<CaliperRuntimeChannel, ChannelState> = {
    console: { lineCount: 0, rotated: false },
    exceptions: { lineCount: 0, rotated: false },
    logs: { lineCount: 0, rotated: false },
    networkFailures: { lineCount: 0, rotated: false },
  };
  private readonly pending: Record<CaliperRuntimeChannel, PendingChannel> = {
    console: { lines: [], byteLength: 0 },
    exceptions: { lines: [], byteLength: 0 },
    logs: { lines: [], byteLength: 0 },
    networkFailures: { lines: [], byteLength: 0 },
  };

  constructor(options: RuntimeDiskWriterOptions) {
    this.projectPaths = options.projectPaths;
    this.maxChannelBytes = options.maxChannelBytes ?? readMaxChannelBytesFromEnvironment();
    this.flushDebounceMs = options.flushDebounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS;
    this.maxBatchLines = options.maxBatchLines ?? DEFAULT_MAX_BATCH_LINES;
    this.maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;
    mkdirSync(this.projectPaths.runtimeDir, { recursive: true });
    this.hydrateCountsFromDisk();
  }

  isCaptureEnabled(): boolean {
    return this.captureEnabled;
  }

  setCaptureEnabled(enabled: boolean): void {
    if (enabled) {
      const clearingTrip = this.tripped !== undefined;
      this.captureEnabled = true;
      this.tripped = undefined;
      this.resetGuardBaselines();
      if (clearingTrip) {
        this.fingerprintSeq += 1;
        this.writeFingerprintFile();
      }
      return;
    }

    this.flushAll();
    this.captureEnabled = false;
  }

  appendChannel<C extends CaliperRuntimeChannel>(
    channel: C,
    entry: CaliperRuntimeChannelEntry[C]
  ): void {
    if (!this.captureEnabled) {
      return;
    }

    const line = `${redactRuntimeLine(JSON.stringify(entry))}\n`;
    const pending = this.pending[channel];
    pending.lines.push(line);
    pending.byteLength += Buffer.byteLength(line, "utf8");
    if (entry.timestamp !== undefined) {
      pending.lastTimestamp = entry.timestamp;
    }

    if (this.shouldFlushImmediately(pending)) {
      this.cancelDebouncedFlush();
      this.flushChannelsAndNotify([channel]);
      return;
    }

    this.scheduleDebouncedFlush();
  }

  recordTrip(trip: CaliperRuntimeTrip): void {
    this.cancelDebouncedFlush();
    this.flushChannelsAndNotify(this.channelsWithPending());
    this.tripped = trip;
    this.captureEnabled = false;
    this.fingerprintSeq += 1;
    this.writeFingerprintFile();
  }

  getGuardSnapshot(): RuntimeCaptureGuardSnapshot {
    let pendingLines = 0;
    for (const channel of Object.keys(this.pending) as CaliperRuntimeChannel[]) {
      pendingLines += this.pending[channel].lines.length;
    }

    let flushedLines = 0;
    for (const channel of Object.keys(this.channelState) as CaliperRuntimeChannel[]) {
      flushedLines += this.channelState[channel].lineCount;
    }

    return {
      flushedLines: Math.max(0, flushedLines - this.guardBaselineLines),
      flushedBytes: Math.max(0, this.flushedBytes - this.guardBaselineBytes),
      pendingLines,
    };
  }

  private resetGuardBaselines(): void {
    let flushedLines = 0;
    for (const channel of Object.keys(this.channelState) as CaliperRuntimeChannel[]) {
      flushedLines += this.channelState[channel].lineCount;
    }
    this.guardBaselineLines = flushedLines;
    this.guardBaselineBytes = this.flushedBytes;
  }

  flushAll(): void {
    this.cancelDebouncedFlush();
    this.flushChannelsAndNotify(this.channelsWithPending());
  }

  clearAll(): void {
    this.cancelDebouncedFlush();
    this.resetPending();
    this.flushedBytes = 0;
    this.tripped = undefined;

    for (const channel of Object.keys(CALIPER_RUNTIME_CHANNEL_FILES) as CaliperRuntimeChannel[]) {
      const filePath = this.projectPaths.channelPaths[channel];
      if (existsSync(filePath)) {
        truncateSync(filePath, 0);
      }
      const rotatedPath = `${filePath}.1`;
      if (existsSync(rotatedPath)) {
        truncateSync(rotatedPath, 0);
      }
      this.channelState[channel] = { lineCount: 0, rotated: false };
    }

    this.fingerprintSeq = 0;
    this.writeFingerprintFile();
  }

  readFingerprint(): CaliperRuntimeFingerprint {
    try {
      const raw = readFileSync(this.projectPaths.fingerprintPath, "utf8");
      return CaliperRuntimeFingerprintSchema.parse(JSON.parse(raw));
    } catch {
      return this.buildFingerprint(Date.now());
    }
  }

  private hydrateCountsFromDisk(): void {
    for (const channel of Object.keys(CALIPER_RUNTIME_CHANNEL_FILES) as CaliperRuntimeChannel[]) {
      const filePath = this.projectPaths.channelPaths[channel];
      if (!existsSync(filePath)) {
        continue;
      }
      const contents = readFileSync(filePath, "utf8");
      const lines = contents.split("\n").filter((line) => line.trim().length > 0);
      this.channelState[channel].lineCount = lines.length;
      if (existsSync(`${filePath}.1`)) {
        this.channelState[channel].rotated = true;
      }
    }

    try {
      const existing = this.readFingerprint();
      this.fingerprintSeq = existing.seq;
      this.tripped = existing.tripped;
    } catch {
      this.fingerprintSeq = 0;
    }
  }

  private shouldFlushImmediately(pending: PendingChannel): boolean {
    return pending.lines.length >= this.maxBatchLines || pending.byteLength >= this.maxBatchBytes;
  }

  private scheduleDebouncedFlush(): void {
    if (this.flushDebounceTimer) {
      clearTimeout(this.flushDebounceTimer);
    }

    this.flushDebounceTimer = setTimeout(() => {
      this.flushDebounceTimer = null;
      this.flushChannelsAndNotify(this.channelsWithPending());
    }, this.flushDebounceMs);
  }

  private cancelDebouncedFlush(): void {
    if (!this.flushDebounceTimer) {
      return;
    }
    clearTimeout(this.flushDebounceTimer);
    this.flushDebounceTimer = null;
  }

  private channelsWithPending(): CaliperRuntimeChannel[] {
    return (Object.keys(this.pending) as CaliperRuntimeChannel[]).filter(
      (channel) => this.pending[channel].lines.length > 0
    );
  }

  private flushChannelsAndNotify(channels: CaliperRuntimeChannel[]): void {
    let flushedAny = false;

    for (const channel of channels) {
      if (this.flushChannel(channel)) {
        flushedAny = true;
      }
    }

    if (!flushedAny) {
      return;
    }

    this.fingerprintSeq += 1;
    this.writeFingerprintFile();
  }

  private flushChannel(channel: CaliperRuntimeChannel): boolean {
    const pending = this.pending[channel];
    if (pending.lines.length === 0) {
      return false;
    }

    const filePath = this.projectPaths.channelPaths[channel];
    const payload = pending.lines.join("");
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    this.rotateChannelIfNeeded(channel, filePath, payloadBytes);
    appendFileSync(filePath, payload, "utf8");
    this.flushedBytes += payloadBytes;

    const state = this.channelState[channel];
    state.lineCount += pending.lines.length;
    if (pending.lastTimestamp !== undefined) {
      state.lastTimestamp = pending.lastTimestamp;
    }

    pending.lines = [];
    pending.byteLength = 0;
    pending.lastTimestamp = undefined;
    return true;
  }

  private resetPending(): void {
    for (const channel of Object.keys(this.pending) as CaliperRuntimeChannel[]) {
      this.pending[channel] = { lines: [], byteLength: 0 };
    }
  }

  private rotateChannelIfNeeded(
    channel: CaliperRuntimeChannel,
    filePath: string,
    incomingBytes: number
  ): void {
    if (!existsSync(filePath)) {
      return;
    }

    const size = statSync(filePath).size;
    if (size + incomingBytes < this.maxChannelBytes) {
      return;
    }

    const rotatedPath = `${filePath}.1`;
    if (existsSync(rotatedPath)) {
      truncateSync(rotatedPath, 0);
    }
    renameSync(filePath, rotatedPath);
    writeFileSync(filePath, "", "utf8");
    this.channelState[channel].rotated = true;
  }

  private writeFingerprintFile(): void {
    const fingerprint = this.buildFingerprint(Date.now());
    mkdirSync(dirname(this.projectPaths.fingerprintPath), { recursive: true });
    writeFileSync(this.projectPaths.fingerprintPath, JSON.stringify(fingerprint, null, 2), "utf8");
  }

  private buildFingerprint(capturedAt: number): CaliperRuntimeFingerprint {
    const counts: CaliperRuntimeChannelCounts = {
      console: this.channelState.console.lineCount + this.pending.console.lines.length,
      exceptions: this.channelState.exceptions.lineCount + this.pending.exceptions.lines.length,
      logs: this.channelState.logs.lineCount + this.pending.logs.lines.length,
      networkFailures:
        this.channelState.networkFailures.lineCount + this.pending.networkFailures.lines.length,
    };

    const lastTimestamps: CaliperRuntimeChannelTimestamps = {
      console: this.pending.console.lastTimestamp ?? this.channelState.console.lastTimestamp,
      exceptions:
        this.pending.exceptions.lastTimestamp ?? this.channelState.exceptions.lastTimestamp,
      logs: this.pending.logs.lastTimestamp ?? this.channelState.logs.lastTimestamp,
      networkFailures:
        this.pending.networkFailures.lastTimestamp ??
        this.channelState.networkFailures.lastTimestamp,
    };

    const rotated: CaliperRuntimeChannelRotation = {};
    if (this.channelState.console.rotated) {
      rotated.console = true;
    }
    if (this.channelState.exceptions.rotated) {
      rotated.exceptions = true;
    }
    if (this.channelState.logs.rotated) {
      rotated.logs = true;
    }
    if (this.channelState.networkFailures.rotated) {
      rotated.networkFailures = true;
    }

    return {
      seq: this.fingerprintSeq,
      counts,
      lastTimestamps,
      capturedAt,
      redactionApplied: isRuntimeRedactionEnabled(),
      rotated: Object.keys(rotated).length > 0 ? rotated : undefined,
      tripped: this.tripped,
    };
  }
}

function readMaxChannelBytesFromEnvironment(): number {
  const raw = process.env.CALIPER_RUNTIME_MAX_CHANNEL_BYTES;
  if (!raw) {
    return DEFAULT_MAX_CHANNEL_BYTES;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CHANNEL_BYTES;
}
