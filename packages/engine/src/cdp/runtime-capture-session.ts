import type {
  CaliperRuntimeBlock,
  CaliperRuntimeConsoleEntry,
  CaliperRuntimeExceptionEntry,
  CaliperRuntimeLogEntry,
  CaliperRuntimeNetworkFailure,
} from "@oyerinde/caliper-schema";
import type { CdpClient } from "./cdp-client.js";
import type {
  LogEntryAddedEvent,
  NetworkLoadingFailedEvent,
  RuntimeConsoleApiCalledEvent,
  RuntimeExceptionThrownEvent,
  RuntimeRemoteObject,
} from "./cdp-protocol.js";

const MAX_CONSOLE_ENTRIES = 30;
const MAX_EXCEPTION_ENTRIES = 10;
const MAX_LOG_ENTRIES = 20;
const MAX_NETWORK_FAILURE_ENTRIES = 10;

export class RuntimeCaptureSession {
  private consoleEntries: CaliperRuntimeConsoleEntry[] = [];
  private exceptionEntries: CaliperRuntimeExceptionEntry[] = [];
  private logEntries: CaliperRuntimeLogEntry[] = [];
  private networkFailureEntries: CaliperRuntimeNetworkFailure[] = [];
  private networkRequestUrls = new Map<string, string>();
  private enabled = false;

  constructor(private readonly client: CdpClient) {}

  async enable(): Promise<void> {
    if (this.enabled) {
      return;
    }

    await this.client.send("Runtime.enable");
    await this.client.send("Log.enable");
    await this.client.send("Network.enable");

    this.client.onEvent<RuntimeConsoleApiCalledEvent>("Runtime.consoleAPICalled", (event) => {
      this.consoleEntries.push(mapConsoleEvent(event));
      trimBuffer(this.consoleEntries, MAX_CONSOLE_ENTRIES);
    });

    this.client.onEvent<RuntimeExceptionThrownEvent>("Runtime.exceptionThrown", (event) => {
      this.exceptionEntries.push(mapExceptionEvent(event));
      trimBuffer(this.exceptionEntries, MAX_EXCEPTION_ENTRIES);
    });

    this.client.onEvent<LogEntryAddedEvent>("Log.entryAdded", (event) => {
      this.logEntries.push(mapLogEvent(event));
      trimBuffer(this.logEntries, MAX_LOG_ENTRIES);
    });

    this.client.onEvent("Network.requestWillBeSent", (params) => {
      const request = params as { requestId?: string; request?: { url?: string } };
      if (request.requestId && request.request?.url) {
        this.networkRequestUrls.set(request.requestId, request.request.url);
      }
    });

    this.client.onEvent<NetworkLoadingFailedEvent>("Network.loadingFailed", (event) => {
      const requestUrl = event.requestId
        ? this.networkRequestUrls.get(event.requestId)
        : undefined;
      this.networkFailureEntries.push({
        url: requestUrl ?? "unknown",
        error: event.errorText ?? "unknown",
        resourceType: event.type,
        timestamp: event.timestamp,
      });
      trimBuffer(this.networkFailureEntries, MAX_NETWORK_FAILURE_ENTRIES);
    });

    this.enabled = true;
  }

  clear(): void {
    this.consoleEntries = [];
    this.exceptionEntries = [];
    this.logEntries = [];
    this.networkFailureEntries = [];
    this.networkRequestUrls.clear();
  }

  getSnapshot(): CaliperRuntimeBlock {
    const capturedAt = Date.now();
    const truncated =
      this.consoleEntries.length >= MAX_CONSOLE_ENTRIES ||
      this.exceptionEntries.length >= MAX_EXCEPTION_ENTRIES ||
      this.logEntries.length >= MAX_LOG_ENTRIES ||
      this.networkFailureEntries.length >= MAX_NETWORK_FAILURE_ENTRIES;

    return {
      console: [...this.consoleEntries],
      exceptions: [...this.exceptionEntries],
      logs: [...this.logEntries],
      networkFailures: [...this.networkFailureEntries],
      capturedAt,
      truncated: truncated || undefined,
    };
  }
}

function mapConsoleEvent(event: RuntimeConsoleApiCalledEvent): CaliperRuntimeConsoleEntry {
  const stackFrame = event.stackTrace?.callFrames?.[0];
  return {
    level: normalizeConsoleLevel(event.type),
    text: formatRemoteObjects(event.args ?? []),
    url: stackFrame?.url,
    line: stackFrame?.lineNumber,
    column: stackFrame?.columnNumber,
    timestamp: event.timestamp,
  };
}

function mapExceptionEvent(event: RuntimeExceptionThrownEvent): CaliperRuntimeExceptionEntry {
  const details = event.exceptionDetails;
  return {
    text: details.exception?.description ?? details.text,
    url: details.url,
    line: details.lineNumber,
    column: details.columnNumber,
    stack: formatStackTrace(details),
    timestamp: event.timestamp,
  };
}

function mapLogEvent(event: LogEntryAddedEvent): CaliperRuntimeLogEntry {
  return {
    source: event.entry.source ?? "unknown",
    level: event.entry.level ?? "unknown",
    text: event.entry.text ?? "",
    timestamp: event.entry.timestamp,
  };
}

function normalizeConsoleLevel(
  type: string
): CaliperRuntimeConsoleEntry["level"] {
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

function formatStackTrace(details: RuntimeExceptionThrownEvent["exceptionDetails"]): string | undefined {
  const stackTrace = details.stackTrace as
    | { callFrames?: Array<{ functionName?: string; url?: string; lineNumber?: number }> }
    | undefined;
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

function trimBuffer<T>(buffer: T[], maxEntries: number): void {
  if (buffer.length > maxEntries) {
    buffer.splice(0, buffer.length - maxEntries);
  }
}
