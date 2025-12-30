/**
 * Raw CSS strings for overlay styles
 * Scoped with unique prefix to avoid collisions
 */
const CALIPER_PREFIX = "caliper-";

export const OVERLAY_STYLES = `
:root {
  --caliper-primary: #3b82f6;
  --caliper-primary-90: rgba(59, 130, 246, 0.9);
  --caliper-primary-95: rgba(59, 130, 246, 0.95);
  --caliper-primary-50: rgba(59, 130, 246, 0.5);
  --caliper-primary-05: rgba(59, 130, 246, 0.05);
  --caliper-secondary: #10b981;
  --caliper-secondary-50: rgba(16, 185, 129, 0.5);
  --caliper-secondary-05: rgba(16, 185, 129, 0.05);
  --caliper-calc-bg: rgba(59, 130, 246, 0.95);
  --caliper-calc-shadow: rgba(0, 0, 0, 0.2);
  --caliper-calc-op-highlight: rgba(255, 255, 255, 0.3);
  --caliper-calc-text: white;
  --caliper-text: white;
}

.${CALIPER_PREFIX}overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 999999;
  contain: layout paint size;
  will-change: transform;
}

.${CALIPER_PREFIX}line {
  stroke: var(--caliper-primary);
  stroke-width: 1px;
  stroke-dasharray: 4, 4;
  pointer-events: none;
}

.${CALIPER_PREFIX}label {
  position: fixed;
  pointer-events: none;
  background: var(--caliper-primary-90);
  color: var(--caliper-text);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
  font-family: system-ui, -apple-system, sans-serif;
  white-space: nowrap;
  z-index: 1000000;
  will-change: transform;
  contain: layout paint;
}

.${CALIPER_PREFIX}boundary-box {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
  contain: layout paint size;
}

.${CALIPER_PREFIX}boundary-box-selected {
  border: 2px solid var(--caliper-primary);
  background: var(--caliper-primary-05);
  z-index: 999998;
  will-change: transform, width, height;
}

.${CALIPER_PREFIX}boundary-box-secondary {
  border: 1px dashed var(--caliper-secondary-50);
  background: var(--caliper-secondary-05);
  z-index: 999997;
}

.${CALIPER_PREFIX}calculator {
  position: fixed;
  pointer-events: auto;
  background: var(--caliper-calc-bg);
  color: var(--caliper-calc-text);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 14px;
  font-family: 'Courier New', monospace;
  z-index: 1000002;
  box-shadow: 0 2px 8px var(--caliper-calc-shadow);
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 200px;
  user-select: none;
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
  padding: 2px 6px;
  border-radius: 2px;
  font-weight: bold;
  transition: all 0.2s;
  animation: pulse 0.3s ease-in-out;
}

.${CALIPER_PREFIX}calculator-input {
  min-width: 40px;
  text-align: right;
  transition: all 0.2s;
}

.${CALIPER_PREFIX}calculator-result {
  margin-left: 8px;
  font-weight: bold;
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
  stroke-width: 2px;
}
`;

export const PREFIX = CALIPER_PREFIX;
