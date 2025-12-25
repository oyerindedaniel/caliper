# @caliper/core

Core measurement engine and utilities for the Caliper measurement tool.

## Overview

This package provides the foundational logic for measuring distances between DOM elements, managing selection state, handling calculator operations, and performing geometric calculations. It is framework-agnostic and contains no UI code.

## Features

- **Measurement System**: Core logic for measuring distances between elements
- **Selection System**: Tracks selected elements and their bounding rectangles
- **Calculator Integration**: Mathematical operations on measurement values
- **Geometry Utilities**: Scroll-aware rect calculations, distance computations
- **Scheduling**: Read/write phase separation for optimal performance
- **Configuration**: Theme and command keybinding configuration

## Architecture

### Measurement System

The measurement system uses a state machine to manage measurement lifecycle:

- `IDLE` → `ARMED` → `MEASURING` → `FROZEN` → `IDLE`

It implements read/write phase separation to prevent layout thrashing:

- **Read phase**: Batches all DOM reads (getBoundingClientRect, etc.)
- **Write phase**: Updates UI in a separate frame using cached data

### Selection System

Tracks selected DOM elements and their bounding rectangles:

- Stores only primitive data (DOMRect), not DOM references (GC-friendly)
- Uses post-RAF pattern for DOM reads
- Provides event emitter for rect updates

### Calculator

State machine-based calculator for performing operations on measurement values:

- Supports basic arithmetic operations (+, -, \*, /)
- Operates on measurement line values
- Provides result calculation

## Exports

### Core Systems

```typescript
import {
  createMeasurementSystem,
  createSelectionSystem,
  createCalculatorIntegration,
} from "@caliper/core";
```

### Types

```typescript
import type {
  MeasurementSystem,
  SelectionSystem,
  CalculatorIntegration,
  MeasurementResult,
  MeasurementLine,
  CalculatorState,
  OverlayConfig,
} from "@caliper/core";
```

### Utilities

- `getScrollAwareRect()` - Get bounding rect accounting for scroll containers
- `clipToViewport()` - Clip rect to viewport boundaries
- `applyTheme()` - Apply CSS variable theme
- `mergeCommands()` - Merge command keybindings with defaults

## Usage

```typescript
import { createMeasurementSystem, createSelectionSystem } from "@caliper/core";

// Create systems
const selectionSystem = createSelectionSystem();
const measurementSystem = createMeasurementSystem(selectionSystem);

// Select an element
selectionSystem.select(document.querySelector(".target"));

// Measure from selected element to cursor
await measurementSystem.measure(selectionSystem.getSelected()!, {
  x: 100,
  y: 200,
});

// Get measurement result
const result = measurementSystem.getCurrentResult();
```

## Dependencies

This package has no runtime dependencies. It's a pure TypeScript library.

## Internal Structure

```
src/
├── calculator-model/     # Calculator state machine
├── cursor-context/        # Context detection (parent/child/sibling)
├── element-picking/       # Element filtering utilities
├── geometry/              # Rect math and distance calculations
├── measurement-model/     # Core measurement logic
├── scheduling/            # Read/write phase management
└── shared/                # Shared types, config, constants
```
