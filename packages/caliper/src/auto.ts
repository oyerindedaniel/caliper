import { createOverlay } from "@caliper/overlay";
import { getConfig, type OverlayInstance } from "@caliper/core";
import { CaliperBridge } from "@oyerinde/caliper-bridge";

declare global {
  interface Window {
    CaliperInstance?: OverlayInstance;
  }
}

/**
 * Auto-initialization entry point.
 * This file handles automatic setup for global script tag users.
 */
if (typeof window !== "undefined") {
  const config = getConfig();
  const caliper = createOverlay(config);

  window.CaliperInstance = caliper;

  if (config.bridge) {
    caliper.use(CaliperBridge(config.bridge));
  }
}
