import { createOverlay } from "@caliper/overlay";
import { getConfig, type OverlayInstance } from "@caliper/core";
import { CaliperBridge } from "@oyerinde/caliper-bridge";

/**
 * Auto-initialization entry point.
 * This file handles automatic setup for global script tag users.
 */
if (typeof window !== "undefined") {
  const config = getConfig();
  const caliper = createOverlay(config);

  if (config.bridge) {
    caliper.use(CaliperBridge(config.bridge));
  }
}
