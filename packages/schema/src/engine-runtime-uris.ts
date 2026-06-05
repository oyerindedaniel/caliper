import type { CaliperRuntimeChannel } from "./caliper-runtime-paths.js";

export const CALIPER_ENGINE_RUNTIME_URI = "caliper://engine-runtime";

export const CALIPER_ENGINE_RUNTIME_CHANNEL_URIS = {
  console: "caliper://engine-runtime/console",
  exceptions: "caliper://engine-runtime/exceptions",
  logs: "caliper://engine-runtime/logs",
  networkFailures: "caliper://engine-runtime/network-failures",
} as const satisfies Record<CaliperRuntimeChannel, string>;

const CHANNEL_BY_URI = new Map<string, CaliperRuntimeChannel>(
  (Object.entries(CALIPER_ENGINE_RUNTIME_CHANNEL_URIS) as Array<[CaliperRuntimeChannel, string]>).map(
    ([channel, uri]) => [uri, channel]
  )
);

export function engineRuntimeChannelSubscribeUri(channel: CaliperRuntimeChannel): string {
  return CALIPER_ENGINE_RUNTIME_CHANNEL_URIS[channel];
}

export function parseEngineRuntimeChannelSubscribeUri(uri: string): CaliperRuntimeChannel | null {
  return CHANNEL_BY_URI.get(uri) ?? null;
}

export function isEngineRuntimeChannelSubscribeUri(uri: string): boolean {
  return CHANNEL_BY_URI.has(uri);
}
