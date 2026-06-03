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
  type CaliperRuntimeChannelCounts,
  type CaliperRuntimeChannelRotation,
  type CaliperRuntimeChannelTimestamps,
  type CaliperRuntimeFingerprint,
  CaliperRuntimeCaptureEnabledSchema,
  CaliperRuntimeFingerprintSchema,
} from "@oyerinde/caliper-schema";
import { isRuntimeRedactionEnabled, redactRuntimeLine } from "./runtime-redact.js";

const DEFAULT_MAX_CHANNEL_BYTES = 32 * 1024 * 1024;
const CAPTURE_FLAG_CACHE_MS = 250;

export type RuntimeDiskWriterOptions = {
  projectPaths: CaliperProjectPaths;
  maxChannelBytes?: number;
};

type ChannelState = {
  lineCount: number;
  lastTimestamp?: number;
  rotated: boolean;
};

export class RuntimeDiskWriter {
  private readonly projectPaths: CaliperProjectPaths;
  private readonly maxChannelBytes: number;
  private fingerprintSeq = 0;
  private fingerprintWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private captureFlagCache: { checkedAt: number; enabled: boolean } | null = null;
  private readonly channelState: Record<CaliperRuntimeChannel, ChannelState> = {
    console: { lineCount: 0, rotated: false },
    exceptions: { lineCount: 0, rotated: false },
    logs: { lineCount: 0, rotated: false },
    networkFailures: { lineCount: 0, rotated: false },
  };

  constructor(options: RuntimeDiskWriterOptions) {
    this.projectPaths = options.projectPaths;
    this.maxChannelBytes = options.maxChannelBytes ?? readMaxChannelBytesFromEnvironment();
    mkdirSync(this.projectPaths.runtimeDir, { recursive: true });
    this.hydrateCountsFromDisk();
  }

  isCaptureEnabled(): boolean {
    const now = Date.now();
    if (this.captureFlagCache && now - this.captureFlagCache.checkedAt < CAPTURE_FLAG_CACHE_MS) {
      return this.captureFlagCache.enabled;
    }

    let enabled = false;
    try {
      const raw = readFileSync(this.projectPaths.captureEnabledPath, "utf8");
      const parsed = CaliperRuntimeCaptureEnabledSchema.parse(JSON.parse(raw));
      enabled = parsed.enabled;
    } catch {
      enabled = false;
    }

    this.captureFlagCache = { checkedAt: now, enabled };
    return enabled;
  }

  appendChannel(channel: CaliperRuntimeChannel, entry: unknown): void {
    if (!this.isCaptureEnabled()) {
      return;
    }

    const line = redactRuntimeLine(JSON.stringify(entry));
    const filePath = this.projectPaths.channelPaths[channel];
    this.rotateChannelIfNeeded(channel, filePath);
    appendFileSync(filePath, line, "utf8");

    const state = this.channelState[channel];
    state.lineCount += 1;
    const timestamp = extractEntryTimestamp(entry);
    if (timestamp !== undefined) {
      state.lastTimestamp = timestamp;
    }

    this.scheduleFingerprintWrite();
  }

  clearAll(): void {
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
    } catch {
      this.fingerprintSeq = 0;
    }
  }

  private rotateChannelIfNeeded(channel: CaliperRuntimeChannel, filePath: string): void {
    if (!existsSync(filePath)) {
      return;
    }

    const size = statSync(filePath).size;
    if (size < this.maxChannelBytes) {
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

  private scheduleFingerprintWrite(): void {
    this.fingerprintSeq += 1;

    if (this.fingerprintWriteTimer) {
      clearTimeout(this.fingerprintWriteTimer);
    }

    this.fingerprintWriteTimer = setTimeout(() => {
      this.fingerprintWriteTimer = null;
      this.writeFingerprintFile();
    }, 100);
  }

  private writeFingerprintFile(): void {
    const fingerprint = this.buildFingerprint(Date.now());
    mkdirSync(dirname(this.projectPaths.fingerprintPath), { recursive: true });
    writeFileSync(this.projectPaths.fingerprintPath, JSON.stringify(fingerprint, null, 2), "utf8");
  }

  private buildFingerprint(capturedAt: number): CaliperRuntimeFingerprint {
    const counts: CaliperRuntimeChannelCounts = {
      console: this.channelState.console.lineCount,
      exceptions: this.channelState.exceptions.lineCount,
      logs: this.channelState.logs.lineCount,
      networkFailures: this.channelState.networkFailures.lineCount,
    };

    const lastTimestamps: CaliperRuntimeChannelTimestamps = {
      console: this.channelState.console.lastTimestamp,
      exceptions: this.channelState.exceptions.lastTimestamp,
      logs: this.channelState.logs.lastTimestamp,
      networkFailures: this.channelState.networkFailures.lastTimestamp,
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

function extractEntryTimestamp(entry: unknown): number | undefined {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const timestamp = (entry as { timestamp?: unknown }).timestamp;
  return typeof timestamp === "number" ? timestamp : undefined;
}
