import type {
  CaliperRuntimeConsoleEntry,
  CaliperRuntimeExceptionEntry,
  CaliperRuntimeFingerprint,
  CaliperRuntimeLogEntry,
  CaliperRuntimeNetworkFailure,
} from "@oyerinde/caliper-schema";
import { resolveCaliperProjectPaths } from "@oyerinde/caliper-schema/node";
import type { CdpClient } from "./cdp-client.js";
import type {
  LogEntryAddedEvent,
  NetworkLoadingFailedEvent,
  RuntimeConsoleApiCalledEvent,
  RuntimeExceptionThrownEvent,
  RuntimeRemoteObject,
} from "./cdp-protocol.js";
import { RuntimeDiskWriter } from "./runtime-disk.js";

export type RuntimeCaptureSessionOptions = {
  projectRoot?: string;
};

export class RuntimeCaptureSession {
  private readonly diskWriter: RuntimeDiskWriter;
  private networkRequestUrls = new Map<string, string>();
  private enabled = false;

  constructor(
    private readonly client: CdpClient,
    options: RuntimeCaptureSessionOptions = {}
  ) {
    const projectPaths = resolveCaliperProjectPaths(options.projectRoot ?? process.cwd());
    this.diskWriter = new RuntimeDiskWriter({ projectPaths });
  }

  async enable(): Promise<void> {
    if (this.enabled) {
      return;
    }

    await this.client.send("Runtime.enable");
    await this.client.send("Log.enable");
    await this.client.send("Network.enable");

    this.client.onEvent<RuntimeConsoleApiCalledEvent>("Runtime.consoleAPICalled", (event) => {
      this.diskWriter.appendChannel("console", mapConsoleEvent(event));
    });

    this.client.onEvent<RuntimeExceptionThrownEvent>("Runtime.exceptionThrown", (event) => {
      this.diskWriter.appendChannel("exceptions", mapExceptionEvent(event));
    });

    this.client.onEvent<LogEntryAddedEvent>("Log.entryAdded", (event) => {
      this.diskWriter.appendChannel("logs", mapLogEvent(event));
    });

    this.client.onEvent("Network.requestWillBeSent", (params) => {
      const request = params as { requestId?: string; request?: { url?: string } };
      if (request.requestId && request.request?.url) {
        this.networkRequestUrls.set(request.requestId, request.request.url);
      }
    });

    this.client.onEvent<NetworkLoadingFailedEvent>("Network.loadingFailed", (event) => {
      const requestUrl = event.requestId ? this.networkRequestUrls.get(event.requestId) : undefined;
      const networkFailure: CaliperRuntimeNetworkFailure = {
        url: requestUrl ?? "unknown",
        error: event.errorText ?? "unknown",
        resourceType: event.type,
        timestamp: event.timestamp,
      };
      this.diskWriter.appendChannel("networkFailures", networkFailure);
    });

    this.enabled = true;
  }

  clear(): void {
    this.networkRequestUrls.clear();
    this.diskWriter.clearAll();
  }

  getFingerprint(): CaliperRuntimeFingerprint {
    return this.diskWriter.readFingerprint();
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
