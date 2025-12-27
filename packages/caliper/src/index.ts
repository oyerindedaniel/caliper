/**
 * @aspect/caliper
 *
 * Browser-based measurement tool overlay.
 * This package bundles all dependencies for easy consumption.
 *
 * Usage:
 * 1. Script tag: <script src="caliper/dist/index.global.js"></script>
 * 2. ESM import: import "@aspect/caliper"
 * 3. Dynamic import: import("@aspect/caliper")
 */

export { createOverlay } from "@caliper/overlay";

export type {
    OverlayInstance,
    OverlayProps,
    OverlayOptions,
} from "@caliper/overlay";

export { setConfig, getConfig } from "@caliper/core";
export type { OverlayConfig } from "@caliper/core";

import "@caliper/overlay";

declare const process: { env: { VERSION: string; NODE_ENV: string } };

export const VERSION = process.env.VERSION;

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    console.log(`[Caliper] Version: ${VERSION}`);
}
