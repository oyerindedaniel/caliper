import { createOverlay } from "@caliper/overlay";
import { getConfig } from "@caliper/core";

/**
 * Auto-initialization entry point.
 * This file is intended to be used as the entry point for the global browser bundle.
 * It automatically reads configuration from window.__CALIPER_CONFIG__ or 
 * script data-attributes and mounts the overlay.
 */
if (typeof window !== "undefined") {
    const windowConfig = getConfig();
    const instance = createOverlay(windowConfig);

    (window as any).__CALIPER__ = instance;

    instance.mount();
}
