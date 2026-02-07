# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-02-08

### Added

- **Agent Bridge**: Support for AI agents and programmatic audits via `@oyerinde/caliper/bridge`.
- **MCP Server**: Integrated MCP server for AI auditing (activate via `npx @oyerinde/caliper`).
  - **MCP tools**: `caliper_list_tabs`, `caliper_get_context`, `caliper_switch_tab`, `caliper_inspect`, `caliper_measure`, `caliper_clear`, `caliper_walk_dom`, and `caliper_walk_and_measure`.
  - **Accessibility Tools**: `caliper_check_contrast` and `caliper_delta_e`.
  - **MCP prompts**: `caliper-selector-audit` and `caliper-selectors-compare`.
  - **MCP resources**: `caliper://tabs` and `caliper://state`.
- **Context Menu**: Right-click selected elements to copy metadata.

### Fixed

- **Geometry Engine**: Improved coordinate tracking for `fixed` and `sticky` elements and nested scroll containers.
  - Fix: Precision tracking for sticky elements across complex DOM hierarchies.
  - Fix: Deep scroll resolution for nested overflow containers.
  - Fix: Real-time clipping path calculation for partially visible elements.

## [0.1.4] - 2026-01-16

### Fixed

- Fixed selection triggering underlying element click events (buttons, links, etc.).

### Removed

- Removed double-click to remove rulers (use Delete/Backspace instead).

## [0.1.3] - 2026-01-13

### Improved

- Shortcuts now function while editable elements are focused.

## [0.1.2] - 2026-01-13

### Fixed

- Removed omitted debug logs.

## [0.1.1] - 2026-01-13

### Fixed

- Rulers now maintain their proportional position when the browser window is resized.
- Fixed an issue where the `Alt` key could still trigger activation even when the activate command was reconfigured.
- Improved measurement value formatting and display consistency.
- Fixed theme configuration to support both Hex and RGBA formats (previously limited to specific RGBA structures).

### Improved

- Optimized performance by adding `isActive` guards to reactive cycles and keyboard event handlers.
- Reduced resource overhead by disabling `ResizeObserver` and scroll listeners when the tool is inactive.

## [0.1.0] - 2026-01-10

### Added

- **Core Measurement System**: High-precision boundary detection and distance calculation between DOM elements.
- **Interactive Overlay**: Real-time measurement lines and labels with smooth animations.
- **Selection System**: Ability to focus and lock elements for side-by-side comparison.
- **Viewport Rulers**: Draggable horizontal and vertical guidelines for design layout audits.
- **Projection Visualizer**: Automatic edge projection for checking alignment across the entire viewport.
- **Integrated Calculator**: Precise spatial math and side-to-side distance calculations.
- **Configurable Commands**: Custom keyboard shortcuts for all major features (Alt, Shift + R, etc.).
- **Theme Support**: Custom primary colors and UI styling via CSS variables.
- **Two-Entry Distribution**: Separate `index.js` for module-based usage and `index.global.js` for self-mounting script tags.
- **Next.js Integration**: Support for Next.js Script component with data-attribute configuration.
