import { render } from "solid-js/web";
import { Root } from "./root.jsx";
import type { OverlayOptions } from "./types.js";
import type { OverlayConfig } from "@caliper/core";
import {
  applyTheme,
  mergeCommands,
  getConfig,
  showVersionInfo,
} from "@caliper/core";

// Version is injected at build time via rollup replace plugin or read from package.json
const VERSION = "0.0.0";

declare global {
  interface Window {
    __CALIPER_OVERLAY__?: {
      mounted: boolean;
      dispose: () => void;
    };
  }
}

export interface OverlayInstance {
  mount: (container?: HTMLElement) => void;
  dispose: () => void;
}

export function createOverlay(
  config?: OverlayConfig,
  options?: OverlayOptions
): OverlayInstance {
  // options is reserved for future overlay-specific options
  // Currently unused but kept for API consistency
  if (typeof window === "undefined") {
    return {
      mount: () => {},
      dispose: () => {},
    };
  }

  if (window.__CALIPER_OVERLAY__?.mounted) {
    console.warn(
      "[CALIPER] Overlay is already mounted. Call dispose() on the existing instance before creating a new one."
    );
    return {
      mount: () => {},
      dispose: () => {
        window.__CALIPER_OVERLAY__?.dispose();
        delete window.__CALIPER_OVERLAY__;
      },
    };
  }

  const windowConfig = getConfig();
  const mergedConfig: OverlayConfig = {
    theme: { ...config?.theme, ...windowConfig?.theme },
    commands: { ...config?.commands, ...windowConfig?.commands },
  };

  const commands = mergeCommands(mergedConfig.commands);

  let disposeRender: (() => void) | null = null;

  function mount(container?: HTMLElement) {
    if (window.__CALIPER_OVERLAY__?.mounted) {
      return;
    }

    if (mergedConfig.theme) {
      applyTheme(mergedConfig.theme);
    }

    const target = container || document.body;

    const overlayContainer = document.createElement("div");
    overlayContainer.id = "caliper-overlay-root";
    target.appendChild(overlayContainer);

    disposeRender = render(() => Root(commands), overlayContainer);

    const disposeFn = () => {
      if (disposeRender) {
        disposeRender();
        disposeRender = null;
      }
      overlayContainer.remove();
      delete window.__CALIPER_OVERLAY__;
    };

    window.__CALIPER_OVERLAY__ = {
      mounted: true,
      dispose: disposeFn,
    };
  }

  function dispose() {
    window.__CALIPER_OVERLAY__?.dispose();
  }

  return { mount, dispose };
}

export {
  injectStyles,
  removeStyles,
  forceRemoveStyles,
} from "./style-injector/utils/inject-styles.js";
export { PREFIX } from "./css/styles.js";
export type { OverlayProps, OverlayOptions } from "./types.js";

if (typeof window !== "undefined") {
  showVersionInfo(VERSION).catch(() => {
    // Silently fail
  });

  const windowConfig = getConfig();
  const instance = createOverlay(windowConfig);
  instance.mount();

  (window as any).__CALIPER__ = instance;
}
