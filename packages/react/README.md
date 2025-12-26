# @caliper/react

React wrapper around the Caliper overlay.

## What it does

- Owns the lifecycle of the SolidJS overlay via `@caliper/overlay`
- Exposes a context provider (`CaliperProvider`) and a hook (`useCaliper`)
- Lets you pass `OverlayConfig` from React into the overlay

## Install

```bash
npm install @caliper/react @caliper/overlay @caliper/core
```

## Minimal usage

```tsx
import { CaliperProvider } from "@caliper/react";
import type { OverlayConfig } from "@caliper/core";

const config: OverlayConfig = {
  theme: { primary: "#3b82f6" },
};

export function App() {
  return (
    <CaliperProvider config={config} enabled>
      <YourApp />
    </CaliperProvider>
  );
}
```

Hook-only usage (no provider):

```tsx
import { useCaliper } from "@caliper/react";

function Page() {
  const overlay = useCaliper({ enabled: true });
  // overlay is OverlayInstance | null
  return <div>...</div>;
}
```

## API surface

- `CaliperProvider(props)`
  - `config?: OverlayConfig`
  - `enabled?: boolean` (default `true`)

- `useCaliper(options?)`
  - `options.enabled?: boolean`
  - `options.config?: OverlayConfig`
  - returns `OverlayInstance | null`

React never touches SolidJS directly; it only talks to `createOverlay`.
