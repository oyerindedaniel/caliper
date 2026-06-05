import { type FSWatcher, watch } from "node:fs";
import { basename, dirname } from "node:path";
import type {
  CaliperRuntimeChannel,
  CaliperRuntimeChannelEntry,
  CaliperRuntimeConsoleEntry,
  CaliperRuntimeExceptionEntry,
  CaliperRuntimeFingerprint,
  CaliperRuntimeLogEntry,
  CaliperRuntimeTrip,
} from "@oyerinde/caliper-schema";
import { isCaptureEnabledOnDisk, writeCaptureTrippedFlag } from "@oyerinde/caliper-schema/node";
import { resolveCaliperProjectPaths } from "@oyerinde/caliper-schema/node";
import { BoundedLruMap } from "./bounded-lru-map.js";
import type { CdpClient } from "./cdp-client.js";
import type {
  LogEntryAddedEvent,
  NetworkLoadingFailedEvent,
  NetworkRequestWillBeSentEvent,
  RuntimeConsoleApiCalledEvent,
  RuntimeExceptionThrownEvent,
  RuntimeRemoteObject,
} from "./cdp-protocol.js";
import { RuntimeCaptureGuard, type RuntimeCaptureGuardOptions } from "./runtime-capture-guard.js";
import { RuntimeDiskWriter } from "./runtime-disk.js";
import { readMaxRuntimeLineBytesFromEnvironment, truncateRuntimeText } from "./runtime-text.js";

const DEFAULT_MAX_LINE_BYTES = 8 * 1024;
const DEFAULT_NETWORK_URL_MAP_MAX = 500;

export type RuntimeCaptureSessionOptions = {
  projectRoot?: string;
  maxLineBytes?: number;
  networkUrlMapMax?: number;
  guard?: RuntimeCaptureGuardOptions;
};

export class RuntimeCaptureSession {
  private readonly diskWriter: RuntimeDiskWriter;
  private readonly captureGuard: RuntimeCaptureGuard;
  private readonly captureEnabledPath: string;
  private readonly projectRoot: string;
  private readonly maxLineBytes: number;
  private readonly networkRequestUrls: BoundedLruMap<string, string>;
  private captureActive = false;
  private started = false;
  private tripping = false;
  private captureFlagWatcher: FSWatcher | null = null;
  private unsubscribeHandlers: Array<() => void> = [];
  private transitionChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: CdpClient,
    options: RuntimeCaptureSessionOptions = {}
  ) {
    const projectPaths = resolveCaliperProjectPaths(options.projectRoot ?? process.cwd());
    this.projectRoot = projectPaths.projectRoot;
    this.captureEnabledPath = projectPaths.captureEnabledPath;
    this.maxLineBytes =
      options.maxLineBytes ?? readMaxRuntimeLineBytesFromEnvironment(DEFAULT_MAX_LINE_BYTES);
    this.networkRequestUrls = new BoundedLruMap(
      options.networkUrlMapMax ?? readNetworkUrlMapMaxFromEnvironment(DEFAULT_NETWORK_URL_MAP_MAX)
    );
    this.diskWriter = new RuntimeDiskWriter({ projectPaths });
    this.captureGuard = new RuntimeCaptureGuard(options.guard);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    await this.applyCaptureFlagFromDisk();
    this.startCaptureFlagWatcher();
  }

  async stop(): Promise<void> {
    this.stopCaptureFlagWatcher();
    await this.runCaptureTransition(() => this.deactivateCapture());
  }

  clear(): void {
    this.networkRequestUrls.clear();
    this.diskWriter.clearAll();
    this.captureGuard.reset();
  }

  getFingerprint(): CaliperRuntimeFingerprint {
    return this.diskWriter.readFingerprint();
  }

  private startCaptureFlagWatcher(): void {
    this.stopCaptureFlagWatcher();

    const runtimeDir = dirname(this.captureEnabledPath);
    const flagFileName = basename(this.captureEnabledPath);

    try {
      this.captureFlagWatcher = watch(runtimeDir, (_eventType, fileName) => {
        if (fileName && fileName !== flagFileName) {
          return;
        }
        void this.applyCaptureFlagFromDisk();
      });
      this.captureFlagWatcher.on("error", () => {
        this.captureFlagWatcher?.close();
        this.captureFlagWatcher = null;
        this.startCaptureFlagPolling();
      });
    } catch {
      this.startCaptureFlagPolling();
    }
  }

  private captureFlagPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastPolledCaptureEnabled: boolean | null = null;

  private startCaptureFlagPolling(): void {
    this.stopCaptureFlagPolling();
    this.captureFlagPollTimer = setInterval(() => {
      const enabled = isCaptureEnabledOnDisk(this.captureEnabledPath);
      if (enabled === this.lastPolledCaptureEnabled) {
        return;
      }
      this.lastPolledCaptureEnabled = enabled;
      void this.applyCaptureFlagFromDisk();
    }, 250);
  }

  private stopCaptureFlagPolling(): void {
    if (!this.captureFlagPollTimer) {
      return;
    }
    clearInterval(this.captureFlagPollTimer);
    this.captureFlagPollTimer = null;
    this.lastPolledCaptureEnabled = null;
  }

  private stopCaptureFlagWatcher(): void {
    this.captureFlagWatcher?.close();
    this.captureFlagWatcher = null;
    this.stopCaptureFlagPolling();
  }

  private async applyCaptureFlagFromDisk(): Promise<void> {
    const enabled = isCaptureEnabledOnDisk(this.captureEnabledPath);
    await this.runCaptureTransition(() =>
      enabled ? this.activateCapture() : this.deactivateCapture()
    );
  }

  private runCaptureTransition(work: () => Promise<void>): Promise<void> {
    const next = this.transitionChain.then(work);
    this.transitionChain = next.catch(() => undefined);
    return next;
  }

  private async activateCapture(): Promise<void> {
    if (this.captureActive) {
      return;
    }

    if (this.diskWriter.readFingerprint().tripped !== undefined) {
      this.diskWriter.clearAll();
    }

    this.captureGuard.reset();
    this.diskWriter.setCaptureEnabled(true);

    await this.client.send("Runtime.enable");
    await this.client.send("Log.enable");
    await this.client.send("Network.enable");

    this.unsubscribeHandlers = [
      this.client.onEvent<RuntimeConsoleApiCalledEvent>("Runtime.consoleAPICalled", (event) => {
        this.ingestMappedEntry("console", mapConsoleEvent(event, this.maxLineBytes));
      }),
      this.client.onEvent<RuntimeExceptionThrownEvent>("Runtime.exceptionThrown", (event) => {
        this.ingestMappedEntry("exceptions", mapExceptionEvent(event, this.maxLineBytes));
      }),
      this.client.onEvent<LogEntryAddedEvent>("Log.entryAdded", (event) => {
        this.ingestMappedEntry("logs", mapLogEvent(event, this.maxLineBytes));
      }),
      this.client.onEvent<NetworkRequestWillBeSentEvent>("Network.requestWillBeSent", (event) => {
        this.networkRequestUrls.set(event.requestId, event.request.url);
      }),
      this.client.onEvent<NetworkLoadingFailedEvent>("Network.loadingFailed", (event) => {
        const requestUrl = event.requestId
          ? this.networkRequestUrls.get(event.requestId)
          : undefined;
        this.ingestMappedEntry("networkFailures", {
          url: requestUrl ?? "unknown",
          error: event.errorText ?? "unknown",
          resourceType: event.type,
          timestamp: event.timestamp,
        });
      }),
    ];

    this.captureActive = true;
  }

  private async deactivateCapture(): Promise<void> {
    for (const unsubscribe of this.unsubscribeHandlers) {
      unsubscribe();
    }
    this.unsubscribeHandlers = [];
    this.networkRequestUrls.clear();

    if (this.captureActive) {
      await this.client.send("Runtime.disable");
      await this.client.send("Log.disable");
      await this.client.send("Network.disable");
      this.captureActive = false;
    }

    this.diskWriter.setCaptureEnabled(false);
    this.tripping = false;
  }

  private ingestMappedEntry<C extends CaliperRuntimeChannel>(
    channel: C,
    entry: CaliperRuntimeChannelEntry[C]
  ): void {
    if (!this.diskWriter.isCaptureEnabled() || this.captureGuard.isTripped()) {
      return;
    }

    const text = extractComparableText(entry);
    const trip = this.captureGuard.evaluateIngest({
      channel,
      text,
      snapshot: this.diskWriter.getGuardSnapshot(),
    });
    if (trip) {
      void this.tripCapture(trip);
      return;
    }

    this.diskWriter.appendChannel(channel, entry);
  }

  private async tripCapture(trip: CaliperRuntimeTrip): Promise<void> {
    if (this.tripping) {
      return;
    }
    this.tripping = true;

    this.diskWriter.recordTrip(trip);
    writeCaptureTrippedFlag(this.captureEnabledPath, trip, this.projectRoot);
    await this.deactivateCapture();
  }
}

function extractComparableText(
  entry: CaliperRuntimeChannelEntry[CaliperRuntimeChannel]
): string | undefined {
  if ("text" in entry && typeof entry.text === "string") {
    return entry.text;
  }
  return undefined;
}

function readNetworkUrlMapMaxFromEnvironment(defaultMax: number): number {
  const raw = process.env.CALIPER_RUNTIME_NETWORK_URL_MAP_MAX;
  if (!raw) {
    return defaultMax;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMax;
}

function mapConsoleEvent(
  event: RuntimeConsoleApiCalledEvent,
  maxLineBytes: number
): CaliperRuntimeConsoleEntry {
  const stackFrame = event.stackTrace?.callFrames?.[0];
  const text = truncateRuntimeText(formatRemoteObjects(event.args ?? []), maxLineBytes);
  return {
    level: normalizeConsoleLevel(event.type),
    text,
    url: stackFrame?.url,
    line: stackFrame?.lineNumber,
    column: stackFrame?.columnNumber,
    timestamp: event.timestamp,
  };
}

function mapExceptionEvent(
  event: RuntimeExceptionThrownEvent,
  maxLineBytes: number
): CaliperRuntimeExceptionEntry {
  const details = event.exceptionDetails;
  const text = truncateRuntimeText(details.exception?.description ?? details.text, maxLineBytes);
  return {
    text,
    url: details.url,
    line: details.lineNumber,
    column: details.columnNumber,
    stack: formatStackTrace(details),
    timestamp: event.timestamp,
  };
}

function mapLogEvent(event: LogEntryAddedEvent, maxLineBytes: number): CaliperRuntimeLogEntry {
  return {
    source: event.entry.source ?? "unknown",
    level: event.entry.level ?? "unknown",
    text: truncateRuntimeText(event.entry.text ?? "", maxLineBytes),
    timestamp: event.entry.timestamp,
  };
}

function normalizeConsoleLevel(type: string): CaliperRuntimeConsoleEntry["level"] {
  if (type === "warning") {
    return "warn";
  }
  if (type === "log" || type === "error" || type === "info" || type === "debug") {
    return type;
  }
  return "log";
}

function formatRemoteObjects(objects: RuntimeRemoteObject[]): string {
  const parts: string[] = [];
  for (const object of objects) {
    if (object.unserializableValue) {
      parts.push(object.unserializableValue);
      continue;
    }
    if (object.value !== undefined) {
      parts.push(typeof object.value === "string" ? object.value : JSON.stringify(object.value));
      continue;
    }
    if (object.description) {
      parts.push(object.description);
    }
  }
  return parts.join(" ");
}

function formatStackTrace(
  details: RuntimeExceptionThrownEvent["exceptionDetails"]
): string | undefined {
  const stackTrace = details.stackTrace;
  if (!stackTrace?.callFrames?.length) {
    return undefined;
  }

  return stackTrace.callFrames
    .map((frame) => {
      const name = frame.functionName || "<anonymous>";
      const url = frame.url ?? "";
      const line = frame.lineNumber ?? 0;
      return `${name} (${url}:${line})`;
    })
    .join("\n");
}
