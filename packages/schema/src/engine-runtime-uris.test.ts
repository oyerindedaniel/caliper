import { describe, expect, it } from "vitest";
import {
  CALIPER_ENGINE_RUNTIME_CHANNEL_URIS,
  engineRuntimeChannelSubscribeUri,
  parseEngineRuntimeChannelSubscribeUri,
} from "./engine-runtime-uris.js";

describe("engine-runtime channel URIs", () => {
  it("maps each channel to a stable subscribe URI", () => {
    expect(engineRuntimeChannelSubscribeUri("console")).toBe(CALIPER_ENGINE_RUNTIME_CHANNEL_URIS.console);
    expect(parseEngineRuntimeChannelSubscribeUri(CALIPER_ENGINE_RUNTIME_CHANNEL_URIS.logs)).toBe("logs");
  });

  it("returns null for non-channel engine-runtime URIs", () => {
    expect(parseEngineRuntimeChannelSubscribeUri("caliper://engine-runtime")).toBeNull();
    expect(parseEngineRuntimeChannelSubscribeUri("caliper://runtime")).toBeNull();
  });
});
