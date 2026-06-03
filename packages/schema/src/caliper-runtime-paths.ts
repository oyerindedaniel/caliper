export const CALIPER_RUNTIME_CHANNEL_FILES = {
  console: "console.ndjson",
  exceptions: "exceptions.ndjson",
  logs: "logs.ndjson",
  networkFailures: "network-failures.ndjson",
} as const;

export type CaliperRuntimeChannel = keyof typeof CALIPER_RUNTIME_CHANNEL_FILES;

export type CaliperProjectPaths = {
  projectRoot: string;
  caliperDir: string;
  runtimeDir: string;
  capturesDir: string;
  fingerprintPath: string;
  captureEnabledPath: string;
  channelPaths: Record<CaliperRuntimeChannel, string>;
};
