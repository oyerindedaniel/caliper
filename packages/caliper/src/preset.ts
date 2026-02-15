import type {
  CaliperConfig,
  OverlayInstance,
  CaliperPlugin,
  ThemeConfig,
  CommandsConfig,
  AnimationConfig,
  CaliperCoreSystems,
  CaliperAgentState,
} from "@caliper/core";
export { CaliperAgentStateSchema } from "@oyerinde/caliper-schema";
import { init as initCaliper } from "./index.js";
import { CaliperBridge } from "@oyerinde/caliper-bridge";
import { caliperProps } from "@caliper/core";

export { CaliperBridge };
export { caliperProps };

export type {
  CaliperConfig,
  OverlayInstance,
  CaliperPlugin,
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
 * It accepts two types of extensions:
 * 1. Simple callback functions: `(instance: OverlayInstance) => void`
 * 2. Formal Caliper plugins: Objects with an `install(instance: OverlayInstance)` method.
 *
 * @example
 * ```ts
 * import { init, CaliperBridge } from "@oyerinde/caliper/preset";
 *
 * const caliper = init({
 *   theme: { primary: "#18a0fb" }
 * }, [
 *   (instance) => console.log("Caliper ready!", instance),
 *   CaliperBridge({ wsPort: 3010 })
 * ]);
 * ```
 *
 * @param configuration - Caliper core configuration (theme, commands, settings).
 * @param extensions - An array of functions or plugin objects to install immediately.
 * @returns The initialized Caliper OverlayInstance.
 */
export function init(
  configuration?: CaliperConfig,
  extensions: Array<Extension> = []
): OverlayInstance {
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
