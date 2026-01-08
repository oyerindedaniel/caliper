# Caliper 📐

**Essential tooling for detail-obsessed design engineers.**

Caliper is a high-precision, framework-agnostic measurement tool that lives in your browser during development. It helps you catch "pixel-drift" and alignment issues before they reach production.

---

## Features 🚀

- **Core Measurement**: High-precision boundary detection and distance calculation between DOM elements.
- **Interactive Overlay**: Real-time measurement lines and labels with smooth, high-fidelity animations.
- **Selection System**: Lock elements for side-by-side comparison (Ctrl + Click).
- **Edge Projections**: Check alignment across the entire viewport using relative projections (W/A/S/D).
- **Viewport Rulers**: Draggable guidelines for auditing complex layout grids (Shift + R).
- **Integrated Calculator**: Precise spatial math for complex component spacing (T/R/B/L/D).
- **Full Customization**: Fully configurable shortcuts and theme colors.

---

## Installation 📦

Caliper is designed to be side-effect-free in production and easy to integrate into any modern stack.

### Method 1: NPM (Recommended)

```bash
npm install @aspect/caliper
```

**Next.js (App Router)**
```tsx
// app/layout.tsx
import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://unpkg.com/@aspect/caliper/dist/index.global.js"
            data-config={JSON.stringify({ theme: { primary: '#18A0FB' } })}
            strategy="afterInteractive"
          />
        )}
        {children}
      </body>
    </html>
  );
}
```

### Method 2: Script Tag (Zero Config)

```html
<!-- Automatically mounts in development -->
<script 
  src="https://unpkg.com/@aspect/caliper/dist/index.global.js"
  data-config='{"theme": {"primary": "#18A0FB"}}'
></script>
```

---

## Configuration 🛠️

Caliper can be customized to fit your specific design system and workflow.

```ts
import { init } from "@aspect/caliper";

const caliper = init({
  theme: {
    primary: "#18A0FB",    // Main brand color
    ruler: "#AC2323",      // Guideline color
    calcBg: "rgba(0,0,0,0.9)" 
  },
  commands: {
    activate: "Alt",       // Key to show overlay
    freeze: " ",           // Key to lock lines
    ruler: "r"             // Key for guideline (Shift+r)
  },
  animation: {
    lerpFactor: 0.2        // Smoothness (0-1)
  }
});

caliper.mount();
```

---

## Usage ⌨️

- **Ctrl + Click** — Select an element.
- **Hover** — View relative distances to target.
- **Alt** — Hold to reveal the overlay.
- **Space** — Freeze the current state.
- **W / A / S / D** — Trigger edge projections.
- **Shift + R** — Drag rulers from edges.
- **Escape** — Clear all.

---

## License ⚖️

This project is licensed under the **Polyform Shield License 1.0.0**. 

- **Allowed**: Personal and commercial use, modification, and distribution.
- **Restricted**: You cannot use this source code to build a competing product or service.

Copyright © 2026 Daniel Oyerinde.
