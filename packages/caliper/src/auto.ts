import { createOverlay } from "@caliper/overlay";
import { getConfig } from "@caliper/core";
import type { AgentBridgeConfig } from "@caliper/core";
import { CaliperBridge } from "@oyerinde/caliper-bridge";

/**
 * Auto-initialization entry point.
 * This file handles automatic setup for global script tag users.
 *
 */
if (typeof window !== "undefined") {
  const caliperConfig = getConfig();
  const bridgeConfig = parseBridgeConfig();
  const caliper = createOverlay(caliperConfig);

  if (bridgeConfig?.enabled) {
    caliper.use(CaliperBridge(bridgeConfig));
  }
}

/**
 * Extract bridge config from the data-config attribute.
 * This is the only place bridge config is read from static HTML attributes.
 */
function parseBridgeConfig(): AgentBridgeConfig | undefined {
  try {
    const scriptEl =
      (document.currentScript as HTMLScriptElement) ??
      document.querySelector("script[data-config]");
    const raw = scriptEl?.getAttribute("data-config");
    if (!raw) return undefined;

    const parsed = JSON.parse(raw);
    return parsed?.bridge as AgentBridgeConfig | undefined;
  } catch {
    return undefined;
  }
}
