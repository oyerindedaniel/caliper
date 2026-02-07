import { render } from "solid-js/web";
import { Root } from "./root.jsx";
import type {
  OverlayConfig,
  CaliperCoreSystems as Systems,
  OverlayInstance,
  CaliperPlugin,
} from "@caliper/core";
import {
  applyTheme,
  mergeCommands,
  mergeAnimation,
  mergeTheme,
  getConfig,
  showVersionInfo,
  OVERLAY_CONTAINER_ID,
  MAX_SAFE_Z_INDEX,
} from "@caliper/core";

import { injectStyles, removeStyles } from "./style-injector/utils/inject-styles.js";

const IS_BROWSER = typeof window !== "undefined";

declare const process: { env: { VERSION: string } };

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
      getSystems: () => null,
      waitForSystems: () => new Promise(() => { }),
      use: () => instance,
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
  let systems: Systems | null = null;
  const plugins = new Map<string, CaliperPlugin>();

  const pendingSystemsResolvers: {
    resolve: (systems: Systems) => void;
    reject: (error: Error) => void;
  }[] = [];
  const waitForSystems = (): Promise<Systems> => {
    if (systems) return Promise.resolve(systems);
    return new Promise((resolve, reject) => pendingSystemsResolvers.push({ resolve, reject }));
  };

  const instance: OverlayInstance = {
    mounted: false,
    mount: (container?: HTMLElement) => {
      if (instance.mounted) return;

      if (document.getElementById(OVERLAY_CONTAINER_ID)) {
        instance.mounted = true;
        return;
      }

      const target = container || document.documentElement;
      injectStyles();

      const overlayContainer = document.createElement("div");
      overlayContainer.id = OVERLAY_CONTAINER_ID;
      overlayContainer.style.zIndex = MAX_SAFE_Z_INDEX.toString();
      target.appendChild(overlayContainer);

      applyTheme(theme, overlayContainer);

      const disposeRender = render(
        () =>
          Root({
            commands,
            animation,
            onSystemsReady: (readySystems) => {
              systems = readySystems;
              const currentResolvers = [...pendingSystemsResolvers];
              pendingSystemsResolvers.length = 0;
              currentResolvers.forEach(({ resolve }) => resolve(readySystems));
            },
          }),
        overlayContainer
      );

      cleanup = () => {
        disposeRender();
        overlayContainer.remove();
        removeStyles();
        instance.mounted = false;
        systems = null;

        plugins.forEach((plugin) => plugin.dispose?.());
        plugins.clear();

        pendingSystemsResolvers.forEach(({ reject }) => reject(new Error("Overlay disposed")));
        pendingSystemsResolvers.length = 0;

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
    getSystems: () => systems,
    waitForSystems,
    use: (plugin: CaliperPlugin) => {
      if (plugins.has(plugin.name)) {
        return instance;
      }
      plugins.set(plugin.name, plugin);
      plugin.install(instance);
      return instance;
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
