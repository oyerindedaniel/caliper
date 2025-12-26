# @caliper/overlay

SolidJS overlay UI for Caliper, exposed via an imperative API.

## What it is

- SolidJS app that renders measurement lines, labels, selection boxes, and calculator
- Mounted via `createOverlay()` so callers never deal with Solid directly
- Reads config from arguments and/or `window.__CALIPER_CONFIG__`

## Install

```bash
npm install @caliper/overlay @caliper/core
```

## Minimal usage

```ts
import { createOverlay } from "@caliper/overlay";
import type { OverlayConfig } from "@caliper/core";

const config: OverlayConfig = {
  theme: { primary: "#3b82f6" },
  commands: { activate: "Alt", freeze: " ", select: "Control" },
};

const overlay = createOverlay(config);
overlay.mount(); // mounts to document.body
// overlay.dispose(); // unmount
```

`OverlayConfig` and helpers (`applyTheme`, `mergeCommands`, `getConfig`) come from `@caliper/core`.

## Runtime contract

- Single overlay instance at a time (guarded via `window.__CALIPER_OVERLAY__`)
- No React types/JSX leaking out; consumers use only the imperative API and TS types
- SSR-safe: `createOverlay` is a no-op on the server
