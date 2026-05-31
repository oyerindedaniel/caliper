# Package boundaries

## `@caliper/core`

Engine-reusable browser measurement logic:

- Scroll-aware geometry (`geometry/`)
- Measurement, selection, projection, ruler, calculator state (`measurement-model/`, `calculator-model/`, `ruler-model/`)
- Hit testing and element eligibility (`cursor-context/`, `element-picking/`)
- Frame scheduling (`scheduling/`)
- Agent selector stamping (`buildSelectorInfo`) — contract aligned with `@oyerinde/caliper-schema`

Core assumes a DOM but must not assume a specific UI framework.

Internal imports use the `@/*` path alias (`tsconfig` → `./src/*`). Use `@/shared/types/index.js`, not `../../shared/...`.

## `@caliper/overlay`

Current measurement **engine** (SolidJS):

- `createOverlay`, mount/dispose, CSS, viewport listeners, input controller
- Renders SVG/HTML from core geometry helpers

## `@oyerinde/caliper-bridge`

Agent integration: WebSocket relay, intents, DOM walk harness, state sync.

## `@oyerinde/caliper-schema`

Shared Zod/types for MCP tools and cross-package contracts. Not bundled into core at runtime for external consumers; core bundles schema types at build time.

## `@oyerinde/caliper` (npm)

Published bundle: ships overlay + core + bridge for script-tag and ESM consumers.

## Dependency rule

`overlay` / `bridge` / `caliper` → `core` → `schema`. Never the reverse.
