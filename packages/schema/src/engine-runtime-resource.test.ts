import { describe, expect, it } from "vitest";
import { buildEngineRuntimeResourcePayload } from "./engine-runtime-resource.js";
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
  it("exposes tripped state and disables capture in the resource body", () => {
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
    });

    if ("available" in payload) {
      throw new Error("expected ready payload");
    }

    expect(payload.captureEnabled).toBe(false);
    expect(payload.tripped?.code).toBe("rate_exceeded");
    expect(payload.agentDiscovery.workflow.some((step) => step.includes("tripped"))).toBe(true);
    expect(payload.agentDiscovery.workflow.some((step) => step.includes("CALIPER_RUNTIME_RATE_MAX_EVENTS"))).toBe(
      true
    );
  });
});
