# @caliper/link

Script-tag entrypoint for Caliper. Ships a single bundle that mounts the overlay in the page.

## What it does

- Bundles `@caliper/core` + `@caliper/overlay` into `dist/caliper.js`
- On load (in the browser), creates an overlay and mounts it
- Exposes the instance on `window.__CALIPER__`
- Reads config from `window.__CALIPER_CONFIG__` if present

## Basic HTML usage

```html
<script>
  window.__CALIPER_CONFIG__ = {
    theme: { primary: "#3b82f6" },
    commands: { activate: "Alt", freeze: " ", select: "Control" },
  };
</script>
<script src="https://unpkg.com/@caliper/link/dist/caliper.js"></script>
```

At runtime:

```js
const caliper = window.__CALIPER__; // OverlayInstance
caliper.dispose();
caliper.mount();
```

## Local build

```bash
pnpm run build      # produces dist/caliper.js
pnpm run build:watch
```
