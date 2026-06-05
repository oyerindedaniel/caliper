import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isCaptureEnabledOnDisk,
  readCaptureChannelsFromFlag,
  writeCaptureSubscribeFlag,
} from "./caliper-runtime-capture-flag.js";

describe("caliper-runtime-capture-flag", () => {
  let tempRoot: string;
  let flagPath: string;

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "caliper-capture-flag-"));
    flagPath = join(tempRoot, "capture.enabled.json");
    mkdirSync(tempRoot, { recursive: true });
  });

  it("requires channels when capture is enabled", () => {
    writeFileSync(flagPath, JSON.stringify({ enabled: true }), "utf8");
    expect(isCaptureEnabledOnDisk(flagPath)).toBe(false);
    expect(readCaptureChannelsFromFlag(flagPath)).toEqual([]);
  });

  it("writes and reads subscribed channels", () => {
    writeCaptureSubscribeFlag(flagPath, tempRoot, ["console", "logs"]);
    expect(isCaptureEnabledOnDisk(flagPath)).toBe(true);
    expect(readCaptureChannelsFromFlag(flagPath)).toEqual(["console", "logs"]);
    expect(JSON.parse(readFileSync(flagPath, "utf8"))).toMatchObject({
      enabled: true,
      channels: ["console", "logs"],
    });
  });
});
