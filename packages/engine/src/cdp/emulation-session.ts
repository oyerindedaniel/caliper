import {
  CALIPER_ENGINE_METHODS,
  type CaliperActionResult,
  type CaliperAuditContext,
  type CaliperSetViewportPayload,
} from "@oyerinde/caliper-schema";
import type { CdpClient } from "./cdp-client.js";
import type { PageGetLayoutMetricsResponse } from "./cdp-protocol.js";
import { resolveAuditViewportHeight } from "./viewport-metrics.js";

export class EmulationSession {
  private emulated = false;
  private currentWidth = 0;
  private currentHeight = 0;
  private currentDeviceScaleFactor = 1;

  constructor(private readonly client: CdpClient) {}

  isEmulated(): boolean {
    return this.emulated;
  }

  async enable(): Promise<void> {
    // Emulation domain has no explicit enable command; commands are available once connected.
  }

  async setViewport(payload: CaliperSetViewportPayload): Promise<CaliperActionResult> {
    const height = await resolveAuditViewportHeight(this.client, payload.height);
    const deviceScaleFactor = payload.deviceScaleFactor ?? 1;

    await this.client.send("Emulation.setDeviceMetricsOverride", {
      width: payload.width,
      height,
      deviceScaleFactor,
      mobile: payload.width <= 480,
      screenWidth: payload.width,
      screenHeight: height,
    });

    this.emulated = true;
    this.currentWidth = payload.width;
    this.currentHeight = height;
    this.currentDeviceScaleFactor = deviceScaleFactor;

    return {
      success: true,
      method: CALIPER_ENGINE_METHODS.SET_VIEWPORT,
      viewport: {
        width: payload.width,
        height,
        scrollX: 0,
        scrollY: 0,
      },
      deviceScaleFactor,
      emulated: true,
      timestamp: Date.now(),
    };
  }

  async clearViewport(): Promise<void> {
    if (!this.emulated) {
      return;
    }

    await this.client.send("Emulation.clearDeviceMetricsOverride");
    this.emulated = false;
    this.currentWidth = 0;
    this.currentHeight = 0;
    this.currentDeviceScaleFactor = 1;
  }

  async getAuditContext(): Promise<CaliperAuditContext> {
    const metrics = await this.client.send<PageGetLayoutMetricsResponse>("Page.getLayoutMetrics");
    const viewport = metrics.layoutViewport;

    return {
      viewport: {
        width: this.emulated ? this.currentWidth : viewport.clientWidth,
        height: this.emulated ? this.currentHeight : viewport.clientHeight,
        scrollX: viewport.pageX,
        scrollY: viewport.pageY,
      },
      deviceScaleFactor: this.emulated ? this.currentDeviceScaleFactor : 1,
      emulated: this.emulated,
    };
  }
}
