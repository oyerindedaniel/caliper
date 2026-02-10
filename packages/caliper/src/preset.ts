import type {
  OverlayConfig,
  OverlayInstance,
  CaliperPlugin,
  AgentBridgeConfig,
  ThemeConfig,
  CommandsConfig,
  AnimationConfig,
  CaliperCoreSystems,
  CaliperAgentState,
} from "@caliper/core";
import { init as initCaliper } from "./index.js";
import { CaliperBridge } from "@oyerinde/caliper-bridge";
import { caliperProps } from "@caliper/core";

export { CaliperBridge };
export { caliperProps };

export type {
  OverlayConfig,
  OverlayInstance,
  CaliperPlugin,
  AgentBridgeConfig,
  ThemeConfig,
  CommandsConfig,
  AnimationConfig,
  CaliperCoreSystems,
  CaliperAgentState,
};

/**
 * An extension can be either a simple function that receives the Caliper instance,
 * or a full Plugin object with an `install` method.
 */
type Extension = ((instance: OverlayInstance) => void) | CaliperPlugin;
export type { Extension };

/**
 * High-level initialization for Caliper with support for extensions and plugins.
 * 
 * This "preset" initializer streamlines setting up Caliper in development or 
 * agentic environments by handling both core configuration and plugin injection 
 * in a single call.
 *
 * @example
 * ```ts
 * import { init, CaliperBridge } from "@oyerinde/caliper/preset";
 * 
 * const caliper = await init({
 *   theme: { primary: "#18a0fb" }
 * }, [
 *   (instance) => console.log("Caliper ready!", instance),
 *   new CaliperBridge({ wsPort: 3010 })
 * ]);
 * ```
 *
 * @param configuration - Caliper core configuration (theme, commands, settings).
 * @param extensions - An array of extension functions or Caliper plugins to install immediately.
 * @returns A promise that resolves to the initialized Caliper OverlayInstance.
 */
export async function init(configuration?: OverlayConfig, extensions: Array<Extension> = []) {
  const caliperInstance = initCaliper(configuration);

  if (extensions && Array.isArray(extensions)) {
    extensions.forEach((extension) => {
      if (typeof extension === "function") {
        extension(caliperInstance);
      } else if (extension && typeof extension.install === "function") {
        caliperInstance.use(extension);
      }
    });
  }

  return caliperInstance;
}
