import { describe, expect, it } from "vitest";
import {
  buildEngineRuntimeChannelResourcePayload,
  buildEngineRuntimeResourcePayload,
} from "./engine-runtime-resource.js";
import { CALIPER_ENGINE_RUNTIME_CHANNEL_URIS } from "./engine-runtime-uris.js";
import type { CaliperProjectPaths } from "./caliper-runtime-paths.js";

const projectPaths: CaliperProjectPaths = {
  projectRoot: "/tmp/project",
  caliperDir: "/tmp/project/.caliper",
  runtimeDir: "/tmp/project/.caliper/runtime",
  capturesDir: "/tmp/project/.caliper/captures",
  fingerprintPath: "/tmp/project/.caliper/runtime/fingerprint.json",
  captureEnabledPath: "/tmp/project/.caliper/runtime/capture.enabled.json",
  channelPaths: {
    console: "/tmp/project/.caliper/runtime/console.ndjson",
    exceptions: "/tmp/project/.caliper/runtime/exceptions.ndjson",
    logs: "/tmp/project/.caliper/runtime/logs.ndjson",
    networkFailures: "/tmp/project/.caliper/runtime/network-failures.ndjson",
  },
};

describe("buildEngineRuntimeResourcePayload", () => {
  it("exposes tripped state, channel URIs, and active channels", () => {
    const payload = buildEngineRuntimeResourcePayload({
      projectPaths,
      fingerprint: {
        seq: 4,
        counts: { console: 10, exceptions: 0, logs: 0, networkFailures: 0 },
        capturedAt: 100,
        tripped: {
          code: "rate_exceeded",
          at: 200,
          message: "Ingest rate exceeded",
        },
      },
      captureEnabled: false,
      activeChannels: [],
    });

    if ("available" in payload) {
      throw new Error("expected ready payload");
    }

    expect(payload.captureEnabled).toBe(false);
    expect(payload.tripped?.code).toBe("rate_exceeded");
    expect(payload.channelSubscribeUris).toEqual(CALIPER_ENGINE_RUNTIME_CHANNEL_URIS);
    expect(payload.agentDiscovery.workflow.some((step) => step.includes("channelSubscribeUris"))).toBe(true);
    expect(payload.agentDiscovery.workflow.some((step) => step.includes("CALIPER_RUNTIME_RATE_MAX_EVENTS"))).toBe(
      true
    );
  });
});

describe("buildEngineRuntimeChannelResourcePayload", () => {
  it("returns channel-specific subscribe metadata", () => {
    const payload = buildEngineRuntimeChannelResourcePayload({
      channel: "console",
      projectPaths,
      fingerprint: {
        seq: 2,
        counts: { console: 3, exceptions: 0, logs: 0, networkFailures: 0 },
        capturedAt: 50,
      },
      captureEnabled: true,
    });

    if ("available" in payload) {
      throw new Error("expected ready payload");
    }

    expect(payload.channel).toBe("console");
    expect(payload.subscribeUri).toBe(CALIPER_ENGINE_RUNTIME_CHANNEL_URIS.console);
    expect(payload.path).toBe(projectPaths.channelPaths.console);
    expect(payload.count).toBe(3);
  });
});
