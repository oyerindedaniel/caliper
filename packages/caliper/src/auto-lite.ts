import { createOverlay } from "@caliper/overlay";

/**
 * Auto-initialization entry point (Lite version).
 */
if (typeof window !== "undefined") {
  createOverlay();
}
