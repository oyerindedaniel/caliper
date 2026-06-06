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
import {
  isCaptureEnabledOnDisk,
  readCaptureChannelsFromFlag,
  readCaptureEnabledFlag,
  writeCaptureTrippedFlag,
} from "@oyerinde/caliper-schema/node";
import { resolveCaliperProjectPaths } from "@oyerinde/caliper-schema/node";
import { BoundedLruMap } from "./bounded-lru-map.js";
import type { CdpSendClient } from "./cdp-page-session.js";
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

type RuntimeCapturePageState = {
  client: CdpSendClient;
  runtimeDomainEnabled: boolean;
  logDomainEnabled: boolean;
  networkDomainEnabled: boolean;
  unsubscribeHandlers: Array<() => void>;
  networkRequestUrls: BoundedLruMap<string, string>;
};

export class RuntimeCaptureSession {
  private readonly diskWriter: RuntimeDiskWriter;
  private readonly captureGuard: RuntimeCaptureGuard;
  private readonly captureEnabledPath: string;
  private readonly projectRoot: string;
  private readonly maxLineBytes: number;
  private readonly pageStates = new Map<string, RuntimeCapturePageState>();
  private readonly activeChannels = new Set<CaliperRuntimeChannel>();
  private captureActive = false;
  private started = false;
  private tripping = false;
  private captureFlagWatcher: FSWatcher | null = null;
  private transitionChain: Promise<void> = Promise.resolve();

  constructor(options: RuntimeCaptureSessionOptions = {}) {
    const projectPaths = resolveCaliperProjectPaths(options.projectRoot ?? process.cwd());
    this.projectRoot = projectPaths.projectRoot;
    this.captureEnabledPath = projectPaths.captureEnabledPath;
    this.maxLineBytes =
      options.maxLineBytes ?? readMaxRuntimeLineBytesFromEnvironment(DEFAULT_MAX_LINE_BYTES);
    this.diskWriter = new RuntimeDiskWriter({ projectPaths });
    this.captureGuard = new RuntimeCaptureGuard(options.guard);
  }

  async registerPage(pageId: string, client: CdpSendClient): Promise<void> {
    if (this.pageStates.has(pageId)) {
      return;
    }

    const pageState: RuntimeCapturePageState = {
      client,
      runtimeDomainEnabled: false,
      logDomainEnabled: false,
      networkDomainEnabled: false,
      unsubscribeHandlers: [],
      networkRequestUrls: new BoundedLruMap(
        readNetworkUrlMapMaxFromEnvironment(DEFAULT_NETWORK_URL_MAP_MAX)
      ),
    };
    this.pageStates.set(pageId, pageState);

    if (this.captureActive && this.activeChannels.size > 0) {
      const channels = new Set(this.activeChannels);
      await this.syncCdpDomains(pageState, channels);
      this.rebuildEventHandlers(pageState, channels);
    }
  }

  async unregisterPage(pageId: string): Promise<void> {
    const pageState = this.pageStates.get(pageId);
    if (!pageState) {
      return;
    }

    await this.teardownPageHandlers(pageState);
    this.pageStates.delete(pageId);
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
    for (const pageState of this.pageStates.values()) {
      pageState.networkRequestUrls.clear();
    }
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
  private lastPolledFlagSignature: string | null = null;

  private startCaptureFlagPolling(): void {
    this.stopCaptureFlagPolling();
    this.captureFlagPollTimer = setInterval(() => {
      const signature = this.readCaptureFlagSignature();
      if (signature === this.lastPolledFlagSignature) {
        return;
      }
      this.lastPolledFlagSignature = signature;
      void this.applyCaptureFlagFromDisk();
    }, 250);
  }

  private stopCaptureFlagPolling(): void {
    if (!this.captureFlagPollTimer) {
      return;
    }
    clearInterval(this.captureFlagPollTimer);
    this.captureFlagPollTimer = null;
    this.lastPolledFlagSignature = null;
  }

  private stopCaptureFlagWatcher(): void {
    this.captureFlagWatcher?.close();
    this.captureFlagWatcher = null;
    this.stopCaptureFlagPolling();
  }

  private readDesiredChannels(): CaliperRuntimeChannel[] {
    return readCaptureChannelsFromFlag(this.captureEnabledPath);
  }

  private readCaptureFlagSignature(): string {
    const flag = readCaptureEnabledFlag(this.captureEnabledPath);
    return JSON.stringify({
      enabled: flag?.enabled ?? false,
      channels: flag?.channels ?? [],
      trippedAt: flag?.trippedAt ?? null,
    });
  }

  private async applyCaptureFlagFromDisk(): Promise<void> {
    const desiredChannels = this.readDesiredChannels();
    await this.runCaptureTransition(() => this.syncCaptureChannels(desiredChannels));
  }

  private runCaptureTransition(work: () => Promise<void>): Promise<void> {
    const next = this.transitionChain.then(work);
    this.transitionChain = next.catch(() => undefined);
    return next;
  }

  private channelsMatch(desired: CaliperRuntimeChannel[]): boolean {
    if (desired.length !== this.activeChannels.size) {
      return false;
    }
    return desired.every((channel) => this.activeChannels.has(channel));
  }

  private async syncCaptureChannels(desiredChannels: CaliperRuntimeChannel[]): Promise<void> {
    if (desiredChannels.length === 0 || !isCaptureEnabledOnDisk(this.captureEnabledPath)) {
      await this.deactivateCapture();
      return;
    }

    const desiredSet = new Set(desiredChannels);
    if (this.captureActive && this.channelsMatch(desiredChannels)) {
      return;
    }

    if (!this.captureActive) {
      if (this.diskWriter.readFingerprint().tripped !== undefined) {
        this.diskWriter.clearAll();
      }
      this.captureGuard.reset();
      this.diskWriter.setCaptureEnabled(true);
      this.captureActive = true;
    }

    for (const pageState of this.pageStates.values()) {
      await this.syncCdpDomains(pageState, desiredSet);
      this.rebuildEventHandlers(pageState, desiredSet);
    }

    this.activeChannels.clear();
    for (const channel of desiredSet) {
      this.activeChannels.add(channel);
    }
  }

  private needsRuntimeDomain(channels: Set<CaliperRuntimeChannel>): boolean {
    return channels.has("console") || channels.has("exceptions");
  }

  private async syncCdpDomains(
    pageState: RuntimeCapturePageState,
    channels: Set<CaliperRuntimeChannel>
  ): Promise<void> {
    const needRuntime = this.needsRuntimeDomain(channels);
    const needLog = channels.has("logs");
    const needNetwork = channels.has("networkFailures");

    if (needRuntime && !pageState.runtimeDomainEnabled) {
      await pageState.client.send("Runtime.enable");
      pageState.runtimeDomainEnabled = true;
    } else if (!needRuntime && pageState.runtimeDomainEnabled) {
      await pageState.client.send("Runtime.disable");
      pageState.runtimeDomainEnabled = false;
    }

    if (needLog && !pageState.logDomainEnabled) {
      await pageState.client.send("Log.enable");
      pageState.logDomainEnabled = true;
    } else if (!needLog && pageState.logDomainEnabled) {
      await pageState.client.send("Log.disable");
      pageState.logDomainEnabled = false;
    }

    if (needNetwork && !pageState.networkDomainEnabled) {
      await pageState.client.send("Network.enable");
      pageState.networkDomainEnabled = true;
    } else if (!needNetwork && pageState.networkDomainEnabled) {
      await pageState.client.send("Network.disable");
      pageState.networkDomainEnabled = false;
    }
  }

  private rebuildEventHandlers(
    pageState: RuntimeCapturePageState,
    channels: Set<CaliperRuntimeChannel>
  ): void {
    for (const unsubscribe of pageState.unsubscribeHandlers) {
      unsubscribe();
    }
    pageState.unsubscribeHandlers = [];

    const pageId = this.pageIdForState(pageState);
    if (!pageId) {
      return;
    }

    if (channels.has("console")) {
      pageState.unsubscribeHandlers.push(
        pageState.client.onEvent<RuntimeConsoleApiCalledEvent>(
          "Runtime.consoleAPICalled",
          (event) => {
            this.ingestMappedEntry(pageId, "console", mapConsoleEvent(event, this.maxLineBytes));
          }
        )
      );
    }

    if (channels.has("exceptions")) {
      pageState.unsubscribeHandlers.push(
        pageState.client.onEvent<RuntimeExceptionThrownEvent>(
          "Runtime.exceptionThrown",
          (event) => {
            this.ingestMappedEntry(
              pageId,
              "exceptions",
              mapExceptionEvent(event, this.maxLineBytes)
            );
          }
        )
      );
    }

    if (channels.has("logs")) {
      pageState.unsubscribeHandlers.push(
        pageState.client.onEvent<LogEntryAddedEvent>("Log.entryAdded", (event) => {
          this.ingestMappedEntry(pageId, "logs", mapLogEvent(event, this.maxLineBytes));
        })
      );
    }

    if (channels.has("networkFailures")) {
      pageState.unsubscribeHandlers.push(
        pageState.client.onEvent<NetworkRequestWillBeSentEvent>(
          "Network.requestWillBeSent",
          (event) => {
            pageState.networkRequestUrls.set(event.requestId, event.request.url);
          }
        ),
        pageState.client.onEvent<NetworkLoadingFailedEvent>("Network.loadingFailed", (event) => {
          const requestUrl = event.requestId
            ? pageState.networkRequestUrls.get(event.requestId)
            : undefined;
          this.ingestMappedEntry(pageId, "networkFailures", {
            url: requestUrl ?? "unknown",
            error: event.errorText ?? "unknown",
            resourceType: event.type,
            timestamp: event.timestamp,
          });
        })
      );
    }
  }

  private pageIdForState(pageState: RuntimeCapturePageState): string | null {
    for (const [pageId, state] of this.pageStates.entries()) {
      if (state === pageState) {
        return pageId;
      }
    }
    return null;
  }

  private async teardownPageHandlers(pageState: RuntimeCapturePageState): Promise<void> {
    for (const unsubscribe of pageState.unsubscribeHandlers) {
      unsubscribe();
    }
    pageState.unsubscribeHandlers = [];
    pageState.networkRequestUrls.clear();

    if (pageState.runtimeDomainEnabled) {
      await pageState.client.send("Runtime.disable");
      pageState.runtimeDomainEnabled = false;
    }
    if (pageState.logDomainEnabled) {
      await pageState.client.send("Log.disable");
      pageState.logDomainEnabled = false;
    }
    if (pageState.networkDomainEnabled) {
      await pageState.client.send("Network.disable");
      pageState.networkDomainEnabled = false;
    }
  }

  private async deactivateCapture(): Promise<void> {
    for (const pageState of this.pageStates.values()) {
      await this.teardownPageHandlers(pageState);
    }
    this.activeChannels.clear();
    this.captureActive = false;
    this.diskWriter.setCaptureEnabled(false);
    this.tripping = false;
  }

  private ingestMappedEntry<C extends CaliperRuntimeChannel>(
    pageId: string,
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

    this.diskWriter.appendChannel(channel, { ...entry, pageId });
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
