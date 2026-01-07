# <p align="center"><img src="apps/web/public/caliper_logo.svg" alt="Caliper" width="200" /></p>

<p align="center">Essential tooling for detail-obsessed design engineer.</p>

---

## How to Use

1. **Ctrl + Click** — Select an element to begin
2. **Hover** — Change focus or view relative distances
3. **Alt** — Hold to reveal the measurement overlay
4. **Space** — Freeze the current measurements
5. **T, R, B, L, D** — Open side calculator for selection

---

## Installation

### Next.js

Add the Caliper overlay to your root layout:

```tsx
// app/layout.tsx
import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://unpkg.com/@caliper/overlay/dist/index.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        {children}
      </body>
    </html>
  );
}
```

### Vite

Invoke Caliper in your entry file:

```tsx
// main.tsx
// Only invoke in development
if (import.meta.env.DEV) {
  import("@caliper/overlay")
}
```

---

## Command Palette

| Action | Shortcut |
| :--- | :--- |
| **Activate** | `Alt` |
| **Freeze/Unfreeze** | `Space` |
| **Select Element** | `Control + Click` |
| **Clear Selection** | `Escape` |
| **Calculator: Top** | `t` |
| **Calculator: Right** | `r` |
| **Calculator: Bottom** | `b` |
| **Calculator: Left** | `l` |
| **Calculator: Distance** | `d` |


