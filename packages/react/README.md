# @caliper/react

React integration for the Caliper measurement tool.

## Overview

This package provides React hooks and components for integrating Caliper into React applications. It manages the lifecycle of the SolidJS overlay while keeping React and SolidJS completely separated.

## Features

- **React Context Provider**: `CaliperProvider` for app-wide configuration
- **React Hook**: `useCaliper` for component-level usage
- **Lifecycle Management**: Automatic mount/unmount with React lifecycle
- **Type Safe**: Full TypeScript support

## Installation

```bash
npm install @caliper/react @caliper/core @caliper/overlay
```

## Peer Dependencies

- `react` ^18.0.0 || ^19.0.0
- `react-dom` ^18.0.0 || ^19.0.0

## Usage

### Provider Pattern (Recommended)

Wrap your app with `CaliperProvider`:

```tsx
import { CaliperProvider } from "@caliper/react";
import type { OverlayConfig } from "@caliper/core";

const config: OverlayConfig = {
  theme: {
    primary: "#3b82f6",
    secondary: "#10b981",
  },
  commands: {
    activate: "Alt",
    freeze: " ",
    select: "Control",
  },
};

function App() {
  return (
    <CaliperProvider config={config} enabled={true}>
      <YourApp />
    </CaliperProvider>
  );
}
```

### Hook Pattern

Use `useCaliper` hook in components:

```tsx
import { useCaliper } from "@caliper/react";
import type { OverlayConfig } from "@caliper/core";

function MyComponent() {
  const config: OverlayConfig = {
    theme: { primary: "#ff0000" },
  };

  const instance = useCaliper({ enabled: true, config });

  // instance is an OverlayInstance with mount() and dispose() methods
  // (though you typically don't need to call these manually)

  return <div>Your content</div>;
}
```

### Conditional Enabling

Disable Caliper conditionally:

```tsx
function App() {
  const [enabled, setEnabled] = useState(false);

  return (
    <CaliperProvider enabled={enabled}>
      <button onClick={() => setEnabled(!enabled)}>Toggle Caliper</button>
      <YourApp />
    </CaliperProvider>
  );
}
```

## API

### `CaliperProvider`

React Context Provider component.

**Props:**

- `children: React.ReactNode` - React children
- `config?: OverlayConfig` - Overlay configuration (theme, commands)
- `enabled?: boolean` - Enable/disable overlay (default: `true`)

### `useCaliper(options?)`

React hook for accessing Caliper overlay.

**Options:**

- `enabled?: boolean` - Enable/disable overlay
- `config?: OverlayConfig` - Overlay configuration

**Returns:** `OverlayInstance | null`

The hook will:

- Use the instance from `CaliperProvider` if available (context)
- Create its own instance if no provider exists
- Automatically mount/unmount based on `enabled` flag

## Architecture

This package acts as a **thin lifecycle wrapper**:

1. **No Direct SolidJS Integration**: React components don't render SolidJS components
2. **Imperative API**: Uses `createOverlay()` from `@caliper/overlay`
3. **Lifecycle Management**: Mounts on mount, disposes on unmount
4. **Context Sharing**: Provider shares instance via React Context

## TypeScript

Full TypeScript support with exported types:

```typescript
import type { UseCaliperOptions, OverlayConfig } from "@caliper/react";
```

## Dependencies

- `@caliper/core` - Core measurement logic
- `@caliper/overlay` - SolidJS overlay UI
- `react` - React framework (peer dependency)

## Examples

### Basic Setup

```tsx
import { CaliperProvider } from "@caliper/react";

function App() {
  return (
    <CaliperProvider>
      <YourApp />
    </CaliperProvider>
  );
}
```

### Custom Theme

```tsx
import { CaliperProvider } from "@caliper/react";

const customTheme = {
  theme: {
    primary: "#ff6b6b",
    secondary: "#4ecdc4",
    calcBg: "rgba(255, 107, 107, 0.95)",
  },
};

function App() {
  return (
    <CaliperProvider config={customTheme}>
      <YourApp />
    </CaliperProvider>
  );
}
```

### Custom Keybindings

```tsx
import { CaliperProvider } from "@caliper/react";

const customCommands = {
  commands: {
    activate: "Shift", // Use Shift instead of Alt
    freeze: "f", // Use 'f' instead of Space
    select: "Meta", // Use Cmd on Mac
  },
};

function App() {
  return (
    <CaliperProvider config={customCommands}>
      <YourApp />
    </CaliperProvider>
  );
}
```
