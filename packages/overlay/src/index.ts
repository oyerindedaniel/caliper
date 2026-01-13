import { render } from "solid-js/web";
import { Root } from "./root.jsx";
import type { OverlayConfig } from "@caliper/core";
import {
  applyTheme,
  mergeCommands,
  mergeAnimation,
  mergeTheme,
  getConfig,
  showVersionInfo,
} from "@caliper/core";
import { injectStyles, removeStyles } from "./style-injector/utils/inject-styles.js";

const IS_BROWSER = typeof window !== "undefined";

declare const process: { env: { VERSION: string } };

export interface OverlayInstance {
  mount: (container?: HTMLElement) => void;
  dispose: () => void;
  mounted: boolean;
}

declare global {
  interface Window {
    __CALIPER__?: OverlayInstance;
  }
}

let activeInstance: OverlayInstance | null = null;

export function createOverlay(config?: OverlayConfig): OverlayInstance {
  if (!IS_BROWSER) {
    return {
      mount: () => { },
      dispose: () => { },
      mounted: false,
    };
  }

  if (activeInstance?.mounted) {
    return activeInstance;
  }

  // Sync with global window object if someone else set it
  if (window.__CALIPER__?.mounted) {
    activeInstance = window.__CALIPER__;
    return activeInstance;
  }

  const windowConfig = getConfig();
  const mergedConfig: OverlayConfig = {
    theme: { ...windowConfig?.theme, ...config?.theme },
    commands: {
      ...windowConfig?.commands,
      ...config?.commands,
      calculator: {
        ...windowConfig?.commands?.calculator,
        ...config?.commands?.calculator,
      },
      projection: {
        ...windowConfig?.commands?.projection,
        ...config?.commands?.projection,
      },
    },
    animation: { ...windowConfig?.animation, ...config?.animation },
  };

  const commands = mergeCommands(mergedConfig.commands);
  const animation = mergeAnimation(mergedConfig.animation);
  const theme = mergeTheme(mergedConfig.theme);

  let cleanup: (() => void) | null = null;

  const instance: OverlayInstance = {
    mounted: false,
    mount: (container?: HTMLElement) => {
      if (instance.mounted) return;

      if (document.getElementById("caliper-overlay-root")) {
        instance.mounted = true;
        return;
      }

      applyTheme(theme);

      const target = container || document.body;
      injectStyles();

      const overlayContainer = document.createElement("div");
      overlayContainer.id = "caliper-overlay-root";
      target.appendChild(overlayContainer);

      const disposeRender = render(() => Root({ commands, animation }), overlayContainer);

      cleanup = () => {
        disposeRender();
        overlayContainer.remove();
        removeStyles();
        instance.mounted = false;
        if (activeInstance === instance) activeInstance = null;
      };

      instance.mounted = true;
    },
    dispose: () => {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
    },
  };

  activeInstance = instance;
  window.__CALIPER__ = instance;

  // Auto-mount in browser
  if (IS_BROWSER) {
    instance.mount();
  }

  return instance;
}

export type { OverlayProps } from "./types.js";

if (IS_BROWSER) {
  showVersionInfo(process.env.VERSION).catch(() => {
    // Silently fail
  });
}
