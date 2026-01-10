import { createOverlay } from "@caliper/overlay";
import { getConfig } from "@caliper/core";

/**
 * Auto-initialization entry point.
 * This file handles automatic setup for global script tag users.
 */
if (typeof window !== "undefined") {
  const windowConfig = getConfig();

  createOverlay(windowConfig);
}
