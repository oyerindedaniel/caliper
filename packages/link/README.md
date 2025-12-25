# @caliper/link

Script-tag integration for the Caliper measurement tool.

## Overview

This package provides a standalone bundle that can be included via a `<script>` tag, automatically mounting the Caliper overlay when loaded. Perfect for quick integration without a build step.

## Features

- **Zero Configuration**: Works out of the box
- **Auto-Mount**: Automatically mounts overlay on load
- **Global API**: Exposes `window.__CALIPER__` for manual control
- **Global Config**: Supports `window.__CALIPER_CONFIG__` for configuration

## Usage

### Basic Setup

Include the script in your HTML:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My App</title>
  </head>
  <body>
    <!-- Your content -->

    <!-- Include Caliper -->
    <script src="https://unpkg.com/@caliper/link/dist/caliper.js"></script>
  </body>
</html>
```

The overlay will automatically mount when the script loads.

### Configuration

Configure Caliper before the script loads:

```html
<script>
  window.__CALIPER_CONFIG__ = {
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
</script>
<script src="https://unpkg.com/@caliper/link/dist/caliper.js"></script>
```

### Manual Control

Access the overlay instance via `window.__CALIPER__`:

```html
<script src="https://unpkg.com/@caliper/link/dist/caliper.js"></script>
<script>
  // Get the instance
  const caliper = window.__CALIPER__;

  // Manually dispose
  caliper.dispose();

  // Remount
  caliper.mount();
</script>
```

## API

### `window.__CALIPER__`

The overlay instance is exposed on the global `window` object:

```typescript
interface OverlayInstance {
  mount: (container?: HTMLElement) => void;
  dispose: () => void;
}
```

### `window.__CALIPER_CONFIG__`

Set global configuration before the script loads:

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
    activate?: string; // Default: "Alt"
    freeze?: string; // Default: " "
    select?: string; // Default: "Control"
  };
}
```

## Build

This package is built with Rollup to create a single bundled file:

```bash
pnpm run build
```

Output: `dist/caliper.js`

## Dependencies

- `@caliper/core` - Core measurement logic
- `@caliper/overlay` - SolidJS overlay UI

Both are bundled into the output file.

## Examples

### Custom Theme

```html
<script>
  window.__CALIPER_CONFIG__ = {
    theme: {
      primary: "#ff6b6b",
      secondary: "#4ecdc4",
      calcBg: "rgba(255, 107, 107, 0.95)",
    },
  };
</script>
<script src="https://unpkg.com/@caliper/link/dist/caliper.js"></script>
```

### Custom Keybindings

```html
<script>
  window.__CALIPER_CONFIG__ = {
    commands: {
      activate: "Shift",
      freeze: "f",
      select: "Meta",
    },
  };
</script>
<script src="https://unpkg.com/@caliper/link/dist/caliper.js"></script>
```

### Conditional Loading

```html
<script>
  // Only load Caliper in development
  if (window.location.hostname === "localhost") {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@caliper/link/dist/caliper.js";
    document.body.appendChild(script);
  }
</script>
```

## Development

For local development:

```bash
# Build
pnpm run build

# Watch mode
pnpm run build:watch
```

## Bundle Size

The bundled file includes:

- Core measurement logic
- Overlay UI (SolidJS)
- All dependencies

Typical bundle size: ~XX KB (gzipped) - _Note: Actual size depends on build output_

## Browser Support

- Modern browsers with ES module support
- Requires `requestAnimationFrame` API
- Requires `getBoundingClientRect` API

## Notes

- The overlay automatically mounts to `document.body`
- Only one overlay instance can exist at a time (singleton)
- The script is SSR-safe (guards against server-side rendering)
