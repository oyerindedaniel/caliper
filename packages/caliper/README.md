<img src="https://raw.githubusercontent.com/oyerindedaniel/caliper/main/apps/web/public/caliper_logo.svg" width="144" alt="Caliper Logo" style="margin-bottom: 24px;" />

[![Unpkg Bundle Size](https://img.shields.io/bundlephobia/minzip/@oyerinde/caliper?style=flat-square&color=black&labelColor=black)](https://bundlephobia.com/package/@oyerinde/caliper)
[![NPM Version](https://img.shields.io/npm/v/@oyerinde/caliper?style=flat-square&color=black&labelColor=black)](https://www.npmjs.com/package/@oyerinde/caliper)

**Essential tooling for detail-obsessed design engineers.**

Caliper is a high-precision, framework-agnostic measurement tool that lives in your browser during development. It helps you catch "pixel-drift" and alignment issues before they reach production.

---

## Features 🚀

- **Core Measurement**: High-precision boundary detection and distance calculation between DOM elements.
- **Interactive Overlay**: Real-time measurement lines and labels with smooth, high-fidelity animations.
- **Selection System**: Lock elements for side-by-side comparison (Cmd/Ctrl + Click).
- **Edge Projections**: Check alignment across the entire viewport using relative projections (W/A/S/D).
- **Viewport Rulers**: Draggable guidelines with magnetic snapping and chained distance measurements (Shift + R).
- **Integrated Calculator**: Precise spatial math for complex component spacing (T/R/B/L/G).
- **Full Customization**: Fully configurable shortcuts and theme colors.

---

## Installation 📦

Caliper is designed to be side-effect-free in production and easy to integrate into any modern stack.

### 1. Next.js (App Router)

```tsx
// app/layout.tsx
import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://unpkg.com/@oyerinde/caliper/dist/index.global.js"
            data-config={JSON.stringify({ theme: { primary: "#AC2323" } })}
            strategy="afterInteractive"
          />
        )}
        {children}
      </body>
    </html>
  );
}
```

### 2. Vite

```html
<!-- index.html -->
<script type="module">
  if (import.meta.env.DEV) {
    // Run npm i @oyerinde/caliper then
    import("@oyerinde/caliper").then(({ init }) => {
      init({ theme: { primary: "#AC2323" } });
    });
  }
</script>
```

### 3. HTML (Plain)

```html
<!-- index.html -->
<script type="module">
  const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";

  if (isDev) {
    import("https://unpkg.com/@oyerinde/caliper/dist/index.js").then(({ init }) => {
      init({ theme: { primary: "#AC2323" } });
    });
  }
</script>
```

### 4. Astro

```html
<!-- src/components/Caliper.astro -->
<script type="module" is:inline>
  if (import.meta.env.DEV) {
    // Run npm i @oyerinde/caliper then
    import("@oyerinde/caliper").then(({ init }) => {
      init();
    });
  }
</script>
```

### 5. Nuxt

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  app: {
    head: {
      script: [
        {
          src: "https://unpkg.com/@oyerinde/caliper/dist/index.global.js",
          "data-config": JSON.stringify({ theme: { primary: "#AC2323" } }),
          defer: true,
        },
      ],
    },
  },
});
```

### 6. Vue

```html
<!-- index.html -->
<script type="module">
  if (import.meta.env.DEV) {
    // Run npm i @oyerinde/caliper then
    import("@oyerinde/caliper").then(({ init }) => {
      init({ theme: { primary: "#AC2323" } });
    });
  }
</script>
```

### 7. TanStack Start

```tsx
// root.tsx
import { Meta, Scripts } from "@tanstack/react-router";

export function Root() {
  return (
    <html lang="en">
      <head>
        <Meta />
        {process.env.NODE_ENV === "development" && (
          <script
            src="https://unpkg.com/@oyerinde/caliper/dist/index.global.js"
            data-config={JSON.stringify({ theme: { primary: "#AC2323" } })}
            async
          />
        )}
      </head>
      <body>
        <Scripts />
      </body>
    </html>
  );
}
```

---

## Configuration 🛠️

Caliper can be customized to fit your specific design system and workflow. `init()` automatically mounts the overlay in the browser.

```ts
import { init } from "@oyerinde/caliper";

init({
  theme: {
    primary: "#18A0FB", // Main brand color
    ruler: "#AC2323", // Guideline color
    calcBg: "rgba(0,0,0,0.9)",
  },
  commands: {
    activate: "Alt", // Key to show overlay
    freeze: " ", // Key to lock lines
    ruler: "r", // Key for guideline (Shift+r)
    selectionHoldDuration: 250, // Hold duration to select
  },
  animation: {
    lerpFactor: 0.2, // Smoothness (0-1)
  },
});
```

### Excluding Elements

To prevent Caliper from measuring specific elements (like sidebars, floating buttons, or decorative overlays), add the `data-caliper-ignore` attribute:

```html
<div data-caliper-ignore>
  <!-- This element and its children will be ignored by Caliper -->
</div>
```

---

## Interaction Guide ⌨️

### Measurements

- **Cmd/Ctrl + Click + Hold** (250ms) — Select an element.
- **Hover** — View relative distances to target.
- **Option/Alt** — Hold to reveal the overlay.
- **Space** — Freeze the current state.

### Analysis tools

- **W / A / S / D** — Trigger edge projections.
- **Shift + R** — Create a pair of vertical and horizontal guidelines at the cursor.
- **Numeric Keypad** — Type numbers while projecting to set specific edge distances.
- **Escape** — Clear all active measurements, rulers, and projections.

### Ruler Precision

- **Arrow Keys** — Nudge selected ruler lines by 1px.
- **Shift + Arrows** — Nudge by 10px.
- **Option/Alt + Arrows** — Nudge by 0.1px for sub-pixel auditing.
- **Magnetic Snap** — Rulers automatically snap to active projection lines.
- **Chained Measurement** — Link multiple parallel rulers with **Shift + Click** to reveal gaps.
- **Auto-Focus** — Typing operators (**+ - \* / .**) instantly switches focus to the calculator.

---

## License ⚖️

This project is licensed under the **MIT License**.

- **Allowed**: Personal and commercial use, modification, and distribution.
- **Open**: Completely permissive with no restrictions on derivative works or competition.

---

## Author & Acknowledgement 👤

**Caliper** is built and maintained with precision by **[Daniel Oyerinde](https://danieloyerinde.com)**.

If you find this tool helpful in your design-to-code workflow, consider giving it a star on **[GitHub](https://github.com/oyerindedaniel/caliper)**.

Copyright © 2026 Daniel Oyerinde.
