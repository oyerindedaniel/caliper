import type { CaliperEngineRuntimeAgentDiscovery, CaliperEngineRuntimeResource } from "./engine-control.js";
import type { CaliperProjectPaths } from "./caliper-runtime-paths.js";
import type { CaliperRuntimeFingerprint } from "./engine-control.js";

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
      "1. resources/subscribe caliper://engine-runtime (enables capture and notifications).",
      "2. On notifications/resources/updated, read this resource again for fresh paths and seq.",
      "3. Read or tail the channel files you need; compare seq to skip already-handled batches.",
      "4. Subscribe before repro — events before subscribe are not captured to disk.",
    ],
    redactionNote:
      "Log lines are redacted best-effort before append (keys and common secret patterns). Not compliance-grade; keep files local.",
  };
}

export function buildEngineRuntimeResourcePayload(input: {
  projectPaths: CaliperProjectPaths;
  fingerprint: CaliperRuntimeFingerprint | null;
  captureEnabled: boolean;
}): CaliperEngineRuntimeResource {
  if (!input.fingerprint) {
    return { available: false };
  }

  return {
    seq: input.fingerprint.seq,
    captureEnabled: input.captureEnabled,
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
    agentDiscovery: buildEngineRuntimeAgentDiscovery(),
  };
}
