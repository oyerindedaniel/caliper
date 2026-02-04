import type { OverlayConfig, OverlayInstance, CaliperPlugin } from "@caliper/core";
import { init as initCaliper } from "./index.js";
import { CaliperBridge } from "@oyerinde/caliper-bridge";
import { caliperProps } from "@caliper/core";

export { CaliperBridge, caliperProps };

type Extension = ((instance: OverlayInstance) => void) | CaliperPlugin;

/**
 * streamlined initialization for development and agentic modes.
 * allows passing configurations and an array of plugin-injectors.
 *
 * @param configuration - Caliper core configuration
 * @param extensions - Array of functions that receive the caliper instance
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
