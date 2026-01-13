import { DEFAULT_THEME, CALIPER_PREFIX } from "@caliper/core";

/**
 * Raw CSS strings for overlay styles
 * Scoped with unique prefix to avoid collisions
 */

/**
 * Z-INDEX ORDERING NOTE:
 * Elements are stacked from lowest to highest to ensure correct overlap:
 * 1. Boundary Boxes (Secondary: 999997, Selected: 999998)
 * 2. Main Overlay Roots (999999)
 * 3. Measurement Labels (1000000)
 * 4. Selection Metadata Labels (1000001)
 * 5. Calculator (1000005) - Always on top for interaction
 */

export const OVERLAY_STYLES = `
:root {
  interpolate-size: allow-keywords;
  --caliper-primary: ${DEFAULT_THEME.primary};
  --caliper-secondary: ${DEFAULT_THEME.secondary};
  --caliper-calc-bg: ${DEFAULT_THEME.calcBg};
  --caliper-calc-shadow: ${DEFAULT_THEME.calcShadow};
  --caliper-calc-op-highlight: ${DEFAULT_THEME.calcOpHighlight};
  --caliper-calc-text: ${DEFAULT_THEME.calcText};
  --caliper-text: ${DEFAULT_THEME.text};
  --caliper-projection: ${DEFAULT_THEME.projection};
  --caliper-ruler: ${DEFAULT_THEME.ruler};
}

#caliper-overlay-root {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  overflow: visible;
  z-index: 999999;
}

.${CALIPER_PREFIX}viewport-fixed {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  overflow: visible;
}

.${CALIPER_PREFIX}overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 999999;
}

.${CALIPER_PREFIX}ruler-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 1000000;
  touch-action: none;
}

.${CALIPER_PREFIX}alt-mode * {
  pointer-events: none !important;
}

.${CALIPER_PREFIX}line {
  stroke: var(--caliper-secondary);
  stroke-width: 1px;
  pointer-events: auto;
  cursor: pointer;
}

.${CALIPER_PREFIX}projection-line {
  stroke: var(--caliper-projection);
  stroke-width: 2px;
  stroke-dasharray: 4 2;
  pointer-events: auto;
}

.${CALIPER_PREFIX}label {
  position: fixed;
  pointer-events: auto;
  cursor: pointer;
  background: var(--caliper-secondary);
  color: var(--caliper-text);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  white-space: nowrap;
  z-index: 1000000;
  will-change: transform;
}

.${CALIPER_PREFIX}projection-label {
  background: var(--caliper-projection);
  z-index: 1000001;
}

.${CALIPER_PREFIX}selection-label {
  position: fixed;
  pointer-events: none;
  background: var(--caliper-primary);
  color: var(--caliper-text);
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 500;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  white-space: nowrap;
  z-index: 1000001;
  will-change: transform, opacity;
  transition: opacity 0.2s ease-in-out;
}

.${CALIPER_PREFIX}boundary-box {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
  touch-action: none;
}

.${CALIPER_PREFIX}boundary-box-selected {
  border: 2px solid var(--caliper-primary);
  background: transparent;
  z-index: 999998;
  will-change: transform, width, height;
}

.${CALIPER_PREFIX}boundary-box-secondary {
  border: 1px dashed var(--caliper-secondary-50);
  background: var(--caliper-secondary-05);
  z-index: 999997;
}

.${CALIPER_PREFIX}calculator, .${CALIPER_PREFIX}projection-input {
  position: fixed;
  pointer-events: auto;
  background: var(--caliper-calc-bg);
  color: var(--caliper-calc-text);
  padding: 0 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  z-index: 1000005;
  box-shadow: 0 4px 12px var(--caliper-calc-shadow);
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  user-select: none;
  overflow: hidden;
  will-change: transform, width;
  transform-origin: center;
  width: fit-content;
  min-width: 32px;
  white-space: nowrap;
  transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
  border: 1px solid transparent;
}

.${CALIPER_PREFIX}calculator-focused, .${CALIPER_PREFIX}projection-input-focused {
  border-color: var(--caliper-primary);
  box-shadow: 0 0 0 2px var(--caliper-primary-50), 0 4px 12px var(--caliper-calc-shadow);
  background: var(--caliper-calc-bg);
}

.${CALIPER_PREFIX}projection-input {
  border-left: 3px solid var(--caliper-projection);
}

.${CALIPER_PREFIX}projection-direction-tag {
  background: var(--caliper-projection-light);
  color: var(--caliper-projection);
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 2px;
  text-transform: uppercase;
  font-weight: 700;
}

.${CALIPER_PREFIX}calculator-base {
  opacity: 0.7;
  transition: opacity 0.2s;
}

.${CALIPER_PREFIX}calculator-base-active {
  opacity: 1;
}

.${CALIPER_PREFIX}calculator-operation {
  background-color: var(--caliper-calc-op-highlight);
  padding: 4px;
  border-radius: 2px;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  animation: pulse 0.3s ease-in-out;
}

.${CALIPER_PREFIX}calculator-input, .${CALIPER_PREFIX}projection-current-value {
  min-width: 8px;
  text-align: right;
  transition: all 0.2s;
}

.${CALIPER_PREFIX}projection-current-value {
  color: var(--caliper-projection);
  font-weight: bold;
}

.${CALIPER_PREFIX}calculator-result {
  font-weight: bold;
  color: var(--caliper-primary);
  animation: slideIn 0.3s ease-out;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideOut {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(10px);
  }
}

.${CALIPER_PREFIX}line-clickable {
  pointer-events: auto;
  cursor: pointer;
  transition: stroke-width 0.2s;
}

.${CALIPER_PREFIX}line-hit-target {
  stroke: transparent;
  stroke-width: 12px;
  pointer-events: auto;
  cursor: pointer;
}


.${CALIPER_PREFIX}line-clickable:hover {
}

.${CALIPER_PREFIX}ruler-line-visual {
  transition: transform 0.1s ease-out;
  will-change: transform;
  position: fixed;
  background-color: var(--caliper-ruler, var(--caliper-primary, rgba(24, 160, 251, 1)));
  z-index: 1000000;
}

.${CALIPER_PREFIX}ruler-label {
  background: var(--caliper-primary);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  position: fixed;
  z-index: 1000002;
}

.${CALIPER_PREFIX}ruler-bridge-label {
  position: fixed;
  background: var(--caliper-secondary);
  z-index: 1000003;
  color: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
`;

export const PREFIX = CALIPER_PREFIX;
