import { readFileSync, writeFileSync } from "node:fs";
import type { CaliperRuntimeChannel } from "./caliper-runtime-paths.js";
import type { CaliperRuntimeCaptureEnabled, CaliperRuntimeTrip } from "./engine-control.js";
import { CaliperRuntimeCaptureEnabledSchema } from "./engine-control.js";

export function readCaptureEnabledFlag(captureEnabledPath: string): CaliperRuntimeCaptureEnabled | null {
  try {
    const raw = readFileSync(captureEnabledPath, "utf8");
    return CaliperRuntimeCaptureEnabledSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function readCaptureChannelsFromFlag(captureEnabledPath: string): CaliperRuntimeChannel[] {
  const flag = readCaptureEnabledFlag(captureEnabledPath);
  if (!flag?.enabled) {
    return [];
  }
  return flag.channels ?? [];
}

export function isCaptureEnabledOnDisk(captureEnabledPath: string): boolean {
  const flag = readCaptureEnabledFlag(captureEnabledPath);
  return flag?.enabled === true && (flag.channels?.length ?? 0) > 0;
}

export function writeCaptureEnabledFlag(
  captureEnabledPath: string,
  payload: CaliperRuntimeCaptureEnabled
): void {
  writeFileSync(captureEnabledPath, JSON.stringify(payload, null, 2), "utf8");
}

export function writeCaptureSubscribeFlag(
  captureEnabledPath: string,
  projectRoot: string,
  channels: readonly CaliperRuntimeChannel[]
): void {
  const uniqueChannels = [...new Set(channels)];
  writeCaptureEnabledFlag(captureEnabledPath, {
    enabled: true,
    channels: uniqueChannels,
    subscribedAt: Date.now(),
    projectRoot,
  });
}

export function writeCaptureTrippedFlag(
  captureEnabledPath: string,
  trip: CaliperRuntimeTrip,
  projectRoot: string
): void {
  writeCaptureEnabledFlag(captureEnabledPath, {
    enabled: false,
    projectRoot,
    trippedAt: trip.at,
    tripCode: trip.code,
    tripMessage: trip.message,
    trippedBy: "engine",
  });
}
