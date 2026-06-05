import type {
  CaliperEngineRuntimeAgentDiscovery,
  CaliperEngineRuntimeChannelResource,
  CaliperEngineRuntimeResource,
} from "./engine-control.js";
import type { CaliperProjectPaths, CaliperRuntimeChannel } from "./caliper-runtime-paths.js";
import type { CaliperRuntimeFingerprint } from "./engine-control.js";
import {
  CALIPER_ENGINE_RUNTIME_CHANNEL_URIS,
  engineRuntimeChannelSubscribeUri,
} from "./engine-runtime-uris.js";

export function buildEngineRuntimeAgentDiscovery(): CaliperEngineRuntimeAgentDiscovery {
  return {
    whyGitignored:
      ".caliper/ is in .gitignore — Glob and ripgrep often return nothing even though files exist.",
    howToRead: [
      "Use the Read tool with the full absolute path in paths (works for gitignored files).",
      "Do not conclude logs are missing because Glob or Grep returned no matches.",
      "Windows: Shell Get-Content -Tail 50 '<paths.console>' or dir '<paths.runtimeDir>'.",
      "Unix: Shell tail -n 50 '<paths.console>' or ls -la '<paths.runtimeDir>'.",
    ],
    format: "NDJSON — one JSON object per line per channel file.",
    workflow: [
      "1. resources/read caliper://engine-runtime for paths, channelSubscribeUris, and workflow.",
      "2. resources/subscribe channel URIs you need (default debug: caliper://engine-runtime/console). Subscribe enables only those CDP channels.",
      "3. On notifications/resources/updated, read the discovery resource or the channel resource for fresh seq.",
      "4. Tail/read the NDJSON path for the channel you subscribed to; compare seq to skip handled batches.",
      "5. If tripped is set, tail logs before resubscribe (resubscribe clears files after a trip). Fix the loop, unsubscribe channel URIs, then subscribe again.",
      "6. Heavy intentional logging: raise Caliper engine env (default → value) — CALIPER_RUNTIME_RATE_MAX_EVENTS 2000, CALIPER_RUNTIME_RATE_WINDOW_MS 10000, CALIPER_RUNTIME_SESSION_MAX_LINES 50000, CALIPER_RUNTIME_SESSION_MAX_BYTES 64MiB (trip/subscribe), CALIPER_RUNTIME_MAX_LINE_BYTES 8192, CALIPER_RUNTIME_MAX_CHANNEL_BYTES 32MiB (file rotation).",
    ],
    redactionNote:
      "Log lines are redacted best-effort before append (keys and common secret patterns). Not compliance-grade; keep files local.",
  };
}

export function buildEngineRuntimeResourcePayload(input: {
  projectPaths: CaliperProjectPaths;
  fingerprint: CaliperRuntimeFingerprint | null;
  captureEnabled: boolean;
  activeChannels: CaliperRuntimeChannel[];
}): CaliperEngineRuntimeResource {
  if (!input.fingerprint) {
    return { available: false };
  }

  return {
    seq: input.fingerprint.seq,
    captureEnabled: input.captureEnabled,
    activeChannels: input.activeChannels,
    channelSubscribeUris: CALIPER_ENGINE_RUNTIME_CHANNEL_URIS,
    projectRoot: input.projectPaths.projectRoot,
    paths: {
      runtimeDir: input.projectPaths.runtimeDir,
      console: input.projectPaths.channelPaths.console,
      exceptions: input.projectPaths.channelPaths.exceptions,
      logs: input.projectPaths.channelPaths.logs,
      networkFailures: input.projectPaths.channelPaths.networkFailures,
      fingerprint: input.projectPaths.fingerprintPath,
      captureEnabledFlag: input.projectPaths.captureEnabledPath,
    },
    counts: input.fingerprint.counts,
    capturedAt: input.fingerprint.capturedAt,
    redactionApplied: input.fingerprint.redactionApplied,
    rotated: input.fingerprint.rotated,
    tripped: input.fingerprint.tripped,
    agentDiscovery: buildEngineRuntimeAgentDiscovery(),
  };
}

export function buildEngineRuntimeChannelResourcePayload(input: {
  channel: CaliperRuntimeChannel;
  projectPaths: CaliperProjectPaths;
  fingerprint: CaliperRuntimeFingerprint | null;
  captureEnabled: boolean;
}): CaliperEngineRuntimeChannelResource {
  if (!input.fingerprint) {
    return { available: false };
  }

  return {
    channel: input.channel,
    subscribeUri: engineRuntimeChannelSubscribeUri(input.channel),
    captureEnabled: input.captureEnabled,
    seq: input.fingerprint.seq,
    path: input.projectPaths.channelPaths[input.channel],
    count: input.fingerprint.counts[input.channel],
    tripped: input.fingerprint.tripped,
  };
}
