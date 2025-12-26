/**
 * @caliper/react
 *
 * Thin wrapper that imports @caliper/overlay, which auto-mounts on import.
 * This allows npm install usage in React/Next.js/Vite/Webpack apps.
 *
 * Usage options:
 * 1. Import at root: import "@caliper/react"
 * 2. Dynamic import: import("@caliper/react")
 * 3. Next.js Script: <Script src="..." />
 * 4. Script tag: <script type="module">import "@caliper/react"</script>
 */

import "@caliper/overlay";

export type { OverlayConfig } from "@caliper/core";
export { setConfig } from "@caliper/core";
