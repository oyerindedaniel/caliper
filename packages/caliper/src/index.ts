/**
 * @oyerinde/caliper
 *
 * Browser-based measurement tool overlay.
 * This package bundles all dependencies for easy consumption.
 *
 * Usage:
 * 1. Script tag (Auto-mount): <script src="@oyerinde/caliper/dist/index.global.js"></script>
 * 2. ESM import (Manual): import { init } from "@oyerinde/caliper"
 * 3. Initialize: const caliper = init();
 */

export { createOverlay as init } from "@caliper/overlay";
export { setConfig, getConfig } from "@caliper/core";
export type { OverlayConfig, OverlayInstance, CaliperPlugin, CaliperCoreSystems as Systems } from "@caliper/core";

declare const process: { env: { VERSION: string; NODE_ENV: string } };

export const VERSION = process.env.VERSION;
