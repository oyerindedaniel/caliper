# @caliper/overlay

SolidJS-based overlay UI for the Caliper measurement tool.

## Overview

This package provides the visual overlay interface that renders measurement lines, labels, boundary boxes, and calculator UI. It uses SolidJS for fine-grained reactivity and is designed to be framework-agnostic through an imperative API.

## Features

- **Imperative API**: `createOverlay()` returns a mountable instance
- **SolidJS UI**: Reactive measurement visualization
- **Calculator UI**: Interactive calculator for measurement operations
- **Theme Support**: CSS variable-based theming
- **Singleton Pattern**: Prevents multiple overlay instances
- **SSR Safe**: Guards against server-side rendering

## API

### `createOverlay(config?, options?)`

Creates an overlay instance. Returns an `OverlayInstance` with:
- `mount(container?)` - Mount the overlay to the DOM
- `dispose()` - Unmount and clean up the overlay

```typescript
import { createOverlay } from "@caliper/overlay";
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

const instance = createOverlay(config);
instance.mount(); // Mount to document.body
// ... later
instance.dispose(); // Clean up
```

### Configuration

The overlay accepts an `OverlayConfig` object:

```typescript
interface OverlayConfig {
  theme?: {
    primary?: string;
    secondary?: string;
    calcBg?: string;
    calcShadow?: string;
    calcOpHighlight?: string;
    calcText?: string;
    text?: string;
  };
  commands?: {
    activate?: string;  // Default: "Alt"
    freeze?: string;    // Default: " "
    select?: string;    // Default: "Control"
  };
}
```

### Global Configuration

For script-tag usage, you can set global config:

```typescript
window.__CALIPER_CONFIG__ = {
  theme: { primary: "#ff0000" },
  commands: { activate: "Shift" },
};
```

## Architecture

### Root Component

The `Root` component (`root.tsx`) is the main SolidJS component that:
- Sets up measurement and selection systems
- Handles keyboard and mouse events
- Subscribes to state changes
- Renders the overlay UI

### UI Components

- **Overlay**: Main container component
- **BoundaryBoxes**: Visual feedback for selected/secondary elements
- **MeasurementLines**: SVG lines showing distances
- **MeasurementLabels**: Distance labels positioned at cursor
- **Calculator**: Interactive calculator UI

### Event Handling

The overlay handles:
- **Alt + Mouse Move**: Measure from selected element to cursor
- **Space**: Freeze current measurement
- **Ctrl/Cmd + Click**: Select element
- **Line Click**: Open calculator with line value

## Styling

Styles are injected automatically via CSS-in-JS. All classes are prefixed with `caliper-` to avoid collisions.

CSS variables can be customized via theme config:
- `--caliper-primary`
- `--caliper-secondary`
- `--caliper-calc-bg`
- etc.

## Dependencies

- `@caliper/core` - Core measurement logic
- `solid-js` - Reactive UI framework

## Internal Structure

```
src/
├── root.tsx                    # Main SolidJS component
├── index.ts                    # Public API (createOverlay)
├── types.ts                    # Type definitions
├── css/
│   └── styles.ts              # CSS-in-JS styles
├── style-injector/            # Style injection utilities
└── ui/
    └── utils/
        ├── render-overlay.tsx         # Overlay container
        ├── render-boundary-boxes.tsx  # Boundary box rendering
        ├── render-lines-with-calculator.tsx  # Measurement lines
        ├── render-labels.tsx          # Distance labels
        └── calculator.tsx              # Calculator UI
```

## Usage with React

See `@caliper/react` for React integration.

## Usage with Script Tag

See `@caliper/link` for script-tag integration.

