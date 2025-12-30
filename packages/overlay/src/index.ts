import { render } from "solid-js/web";
import { Root } from "./root.jsx";
import type { OverlayOptions } from "./types.js";
import type { OverlayConfig } from "@caliper/core";
import {
  applyTheme,
  mergeCommands,
  mergeAnimation,
  getConfig,
  showVersionInfo,
} from "@caliper/core";
import {
  injectStyles,
  removeStyles,
} from "./style-injector/utils/inject-styles.js";

const IS_BROWSER = typeof window !== "undefined";

declare const process: { env: { VERSION: string } };

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
  if (!IS_BROWSER) {
    return {
      mount: () => { },
      dispose: () => { },
    };
  }

  if (window.__CALIPER_OVERLAY__?.mounted) {
    console.warn(
      "[CALIPER] Overlay is already mounted. Call dispose() on the existing instance before creating a new one."
    );
    return {
      mount: () => { },
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
    animation: { ...config?.animation, ...windowConfig?.animation },
  };

  const commands = mergeCommands(mergedConfig.commands);
  const animation = mergeAnimation(mergedConfig.animation);

  let disposeRender: (() => void) | null = null;

  function mount(container?: HTMLElement) {
    if (window.__CALIPER_OVERLAY__?.mounted) {
      return;
    }

    if (mergedConfig.theme) {
      applyTheme(mergedConfig.theme);
    }

    const target = container || document.body;


    injectStyles();

    const overlayContainer = document.createElement("div");
    overlayContainer.id = "caliper-overlay-root";
    target.appendChild(overlayContainer);

    disposeRender = render(() => Root({ commands, animation }), overlayContainer);

    const disposeFn = () => {
      if (disposeRender) {
        disposeRender();
        disposeRender = null;
      }
      overlayContainer.remove();
      removeStyles();
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

export type { OverlayProps, OverlayOptions } from "./types.js";

if (IS_BROWSER) {
  showVersionInfo(process.env.VERSION).catch(() => {
    // Silently fail
  });

  const windowConfig = getConfig();
  const instance = createOverlay(windowConfig);
  instance.mount();

  (window as any).__CALIPER__ = instance;
}
