import type { OverlayConfig, OverlayInstance } from "@caliper/core";
import { init as initCaliper } from "./index.js";
import { CaliperBridge } from "@oyerinde/caliper-bridge";
import { caliperProps, applyTheme } from "@caliper/core";

export { CaliperBridge, caliperProps, applyTheme };

/**
 * streamlined initialization for development and agentic modes.
 * allows passing configurations and an array of plugin-injectors.
 *
 * @param configuration - Caliper core configuration
 * @param extensions - Array of functions that receive the caliper instance
 */
export async function init(
  configuration?: OverlayConfig,
  extensions: Array<(instance: OverlayInstance) => void> = []
) {
  const caliperInstance = initCaliper(configuration);

  if (extensions && Array.isArray(extensions)) {
    extensions.forEach((extension) => {
      extension(caliperInstance);
    });
  }

  return caliperInstance;
}
