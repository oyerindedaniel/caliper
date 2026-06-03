import { DEFAULT_AUDIT_VIEWPORT_HEIGHT } from "@oyerinde/caliper-schema";
import type { CdpClient } from "./cdp-client.js";
import type { PageGetLayoutMetricsResponse } from "./cdp-protocol.js";

export async function resolveAuditViewportHeight(
  client: CdpClient,
  explicitHeight?: number
): Promise<number> {
  if (explicitHeight !== undefined) {
    return explicitHeight;
  }

  const metrics = await client.send<PageGetLayoutMetricsResponse>("Page.getLayoutMetrics");
  const layoutHeight = metrics.layoutViewport.clientHeight;
  return layoutHeight > 0 ? layoutHeight : DEFAULT_AUDIT_VIEWPORT_HEIGHT;
}
