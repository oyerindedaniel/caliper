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
  --caliper-success: rgba(74, 222, 128, 1);
  --caliper-font-sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
  --caliper-handoff-note-py: 8px;
  --caliper-handoff-note-font-size: 13px;
  --caliper-handoff-note-line-height: 1.4;
}

#caliper-overlay-root {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  overflow: visible;
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
  font-family: var(--caliper-font-sans);
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
  color: white;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 600;
  font-family: var(--caliper-font-sans);
  white-space: nowrap;
  z-index: 1000001;
  display: flex;
  align-items: center;
  justify-content: center;
  will-change: transform, opacity, background-color;
  transition: opacity 0.2s ease-in-out, background-color 0.2s ease-in-out;
}

.${CALIPER_PREFIX}selection-label-success {
  background: var(--caliper-success);
}

.${CALIPER_PREFIX}selection-label-content {
  display: flex;
  align-items: center;
  justify-content: center;
  animation: caliper-fade-in 0.15s forwards ease-in-out;
}

@keyframes caliper-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes caliper-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
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
  font-family: var(--caliper-font-sans);
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

.${CALIPER_PREFIX}calculator-focused {
  border-color: var(--caliper-primary);
  box-shadow: 0 0 0 2px var(--caliper-primary-50), 0 4px 12px var(--caliper-calc-shadow);
  background: var(--caliper-calc-bg);
}

.${CALIPER_PREFIX}projection-input-focused {
  border-color: var(--caliper-projection);
  box-shadow: 0 4px 12px var(--caliper-calc-shadow);
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

.${CALIPER_PREFIX}handoff-box {
  position: fixed;
  pointer-events: none;
  z-index: 999998;
  box-sizing: border-box;
}

.${CALIPER_PREFIX}handoff-box-inner {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: 2px;
  box-shadow: inset 0 0 0 2px var(--caliper-handoff-item-color, var(--caliper-primary));
}

.${CALIPER_PREFIX}handoff-box-active .${CALIPER_PREFIX}handoff-box-inner {
  background: color-mix(
    in srgb,
    var(--caliper-handoff-item-color, var(--caliper-primary)) 18%,
    transparent
  );
}

.${CALIPER_PREFIX}handoff-box-inner[data-shake] {
  animation: ${CALIPER_PREFIX}handoff-box-shake 380ms ease-in-out;
}

.${CALIPER_PREFIX}handoff-presence[data-side="bottom"][data-align="start"] {
  transform-origin: top left;
}

.${CALIPER_PREFIX}handoff-presence[data-side="bottom"][data-align="center"] {
  transform-origin: top center;
}

.${CALIPER_PREFIX}handoff-presence[data-side="top"][data-align="start"] {
  transform-origin: bottom left;
}

.${CALIPER_PREFIX}handoff-presence[data-side="top"][data-align="center"] {
  transform-origin: bottom center;
}

.${CALIPER_PREFIX}handoff-panel {
  position: fixed;
  top: 0;
  left: 0;
  pointer-events: auto;
  z-index: 1000006;
  display: flex;
  flex-direction: column;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
  scale: 1;
  will-change: translate, scale;
}

.${CALIPER_PREFIX}handoff-panel[data-state="open"] {
  animation: ${CALIPER_PREFIX}handoff-panel-in 120ms ease-out forwards;
}

.${CALIPER_PREFIX}handoff-panel[data-state="closed"] {
  animation: ${CALIPER_PREFIX}handoff-panel-out 100ms ease-out forwards;
}

.${CALIPER_PREFIX}handoff-note-wrap {
  position: relative;
  width: 100%;
  border-radius: 24px;
  background: var(--caliper-handoff-bg, #fff);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  transition: box-shadow 0.15s ease;
}

.${CALIPER_PREFIX}handoff-note-wrap:focus-within {
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.12),
    inset 0 0 0 1px var(--caliper-primary);
}

.${CALIPER_PREFIX}handoff-note-wrap[data-expanded="true"] {
  border-radius: 6px;
}

.${CALIPER_PREFIX}handoff-note-mirror {
  position: absolute;
  inset: 0;
  z-index: 2;
  padding: var(--caliper-handoff-note-py) 14px;
  font-family: var(--caliper-font-sans);
  font-size: var(--caliper-handoff-note-font-size);
  line-height: var(--caliper-handoff-note-line-height);
  color: #1a1a1a;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  overflow: hidden;
  scrollbar-gutter: stable;
  pointer-events: none;
}

.${CALIPER_PREFIX}handoff-textarea {
  display: block;
  width: 100%;
  min-height: calc(
    (var(--caliper-handoff-note-py) * 2) +
    var(--caliper-handoff-note-font-size) * var(--caliper-handoff-note-line-height)
  );
  max-height: 120px;
  resize: none;
  border: none;
  border-radius: inherit;
  padding: var(--caliper-handoff-note-py) 14px;
  font-family: var(--caliper-font-sans);
  font-size: var(--caliper-handoff-note-font-size);
  line-height: var(--caliper-handoff-note-line-height);
  color: #1a1a1a;
  background: transparent;
  box-sizing: border-box;
  overflow-y: auto;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.16) transparent;
  box-shadow: none;
  outline: none;
}

.${CALIPER_PREFIX}handoff-textarea::-webkit-scrollbar {
  width: 4px;
}

.${CALIPER_PREFIX}handoff-textarea::-webkit-scrollbar-track {
  background: transparent;
}

.${CALIPER_PREFIX}handoff-textarea::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.14);
  border-radius: 999px;
}

.${CALIPER_PREFIX}handoff-textarea::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.22);
}

.${CALIPER_PREFIX}handoff-textarea-overlay {
  position: relative;
  z-index: 1;
  color: transparent;
  caret-color: transparent;
  -webkit-text-fill-color: transparent;
}

.${CALIPER_PREFIX}handoff-textarea-overlay::placeholder {
  color: #8a8a8a;
  -webkit-text-fill-color: #8a8a8a;
  opacity: 1;
}

.${CALIPER_PREFIX}handoff-note-caret {
  position: absolute;
  width: 1px;
  background: #1a1a1a;
  pointer-events: none;
  z-index: 3;
  animation: ${CALIPER_PREFIX}handoff-caret-blink 1s step-end infinite;
}

@keyframes ${CALIPER_PREFIX}handoff-caret-blink {
  50% {
    opacity: 0;
  }
}

.${CALIPER_PREFIX}handoff-textarea:focus,
.${CALIPER_PREFIX}handoff-textarea:focus-visible {
  outline: none;
}

.${CALIPER_PREFIX}handoff-mention-popover {
  position: fixed;
  top: 0;
  left: 0;
  pointer-events: auto;
  z-index: 1000007;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 8px;
  background: var(--caliper-handoff-bg, #fff);
  border: 1px solid rgba(0, 0, 0, 0.1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  overflow-y: auto;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scale: 1;
  will-change: translate, scale;
}

.${CALIPER_PREFIX}handoff-mention-popover[data-state="open"] {
  animation: ${CALIPER_PREFIX}handoff-mention-in 100ms ease-out forwards;
}

.${CALIPER_PREFIX}handoff-mention-popover[data-state="closed"] {
  animation: ${CALIPER_PREFIX}handoff-mention-out 80ms ease-in forwards;
}

.${CALIPER_PREFIX}handoff-mention-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  text-align: left;
  font-family: var(--caliper-font-sans);
}

.${CALIPER_PREFIX}handoff-mention-option-active,
.${CALIPER_PREFIX}handoff-mention-option:hover {
  background: rgba(0, 0, 0, 0.03);
}

.${CALIPER_PREFIX}handoff-mention-label {
  font-size: 12px;
  color: #1a1a1a;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.${CALIPER_PREFIX}handoff-mention-pill {
  display: inline-flex;
  align-items: center;
  vertical-align: baseline;
  margin: 0 1px;
  padding: 1px 6px;
  border-radius: 6px;
  border: 1px solid var(--caliper-handoff-pill-color, var(--caliper-primary));
  background: color-mix(
    in srgb,
    var(--caliper-handoff-pill-color, var(--caliper-primary)) 14%,
    transparent
  );
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  line-height: 1.3;
  color: #1a1a1a;
  pointer-events: auto;
  cursor: pointer;
  white-space: nowrap;
}

.${CALIPER_PREFIX}handoff-mention-pill-highlighted {
  background: color-mix(
    in srgb,
    var(--caliper-handoff-pill-color, var(--caliper-primary)) 22%,
    transparent
  );
  box-shadow: 0 0 0 1px
    color-mix(in srgb, var(--caliper-handoff-pill-color, var(--caliper-primary)) 35%, transparent);
}

.${CALIPER_PREFIX}handoff-mention-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: #666;
}

@keyframes ${CALIPER_PREFIX}handoff-panel-in {
  from {
    opacity: 0;
    scale: 0.97;
  }
  to {
    opacity: 1;
    scale: 1;
  }
}

@keyframes ${CALIPER_PREFIX}handoff-panel-out {
  from {
    opacity: 1;
    scale: 1;
  }
  to {
    opacity: 0;
    scale: 0.97;
  }
}

@keyframes ${CALIPER_PREFIX}handoff-mention-in {
  from {
    opacity: 0;
    scale: 0.98;
  }
  to {
    opacity: 1;
    scale: 1;
  }
}

@keyframes ${CALIPER_PREFIX}handoff-box-shake {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }
  20% {
    transform: translate3d(-3px, 0, 0);
  }
  40% {
    transform: translate3d(3px, 0, 0);
  }
  60% {
    transform: translate3d(-2px, 0, 0);
  }
  80% {
    transform: translate3d(2px, 0, 0);
  }
}

@keyframes ${CALIPER_PREFIX}handoff-mention-out {
  from {
    opacity: 1;
    scale: 1;
  }
  to {
    opacity: 0;
    scale: 0.98;
  }
}
`;

export const PREFIX = CALIPER_PREFIX;
