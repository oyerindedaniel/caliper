# @caliper/core

Core, framework-agnostic measurement engine used by all Caliper front-ends.

## What it provides

- Measurement state machine and scheduling (`createMeasurementSystem`)
- Selection tracking (`createSelectionSystem`)
- Calculator state + integration (`createCalculatorIntegration`)
- Geometry + scroll-aware rect utilities
- Shared config types/utilities (`OverlayConfig`, `applyTheme`, `mergeCommands`, `getConfig`)

## Install

```bash
npm install @caliper/core
```

## Minimal usage

```ts
import { createMeasurementSystem, createSelectionSystem } from "@caliper/core";

const selectionSystem = createSelectionSystem();
const measurementSystem = createMeasurementSystem(selectionSystem);

// select some element
selectionSystem.select(document.querySelector(".target"));

// measure against cursor
await measurementSystem.measure(selectionSystem.getSelected()!, {
  x: 100,
  y: 200,
});

const result = measurementSystem.getCurrentResult(); // MeasurementResult | null
```

## Important exports (non-exhaustive)

```ts
// systems
export {
  createMeasurementSystem,
  type MeasurementSystem,
  createSelectionSystem,
  type SelectionSystem,
} from "@caliper/core";

// calculator
export {
  createCalculatorIntegration,
  type CalculatorIntegration,
  type CalculatorState,
} from "@caliper/core";

// geometry / scheduling
export * from "@caliper/core/geometry";
export * from "@caliper/core/scheduling";

// config
export type { OverlayConfig, ThemeConfig, CommandsConfig } from "@caliper/core";
export { applyTheme, mergeCommands, getConfig } from "@caliper/core";
```
