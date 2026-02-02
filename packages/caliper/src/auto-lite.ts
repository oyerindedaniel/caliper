import { createOverlay } from "@caliper/overlay";
import { getConfig, type OverlayInstance } from "@caliper/core";

declare global {
  interface Window {
    CaliperInstance?: OverlayInstance;
  }
}

/**
 * Auto-initialization entry point (Lite version).
 */
if (typeof window !== "undefined") {
  const config = getConfig();
  const caliper = createOverlay(config);

  window.CaliperInstance = caliper;
}
