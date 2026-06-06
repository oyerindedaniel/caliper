import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CaliperScreenshotRef } from "@oyerinde/caliper-schema";
import type { CdpSendClient } from "./cdp-page-session.js";
import type {
  DomGetBoxModelResponse,
  PageCaptureScreenshotResponse,
  PageGetLayoutMetricsResponse,
} from "./cdp-protocol.js";
import { resolveSelectorToNodeId } from "./dom-resolver.js";
import { readWindowScrollPosition } from "./window-scroll.js";

export type ScreenshotSessionOptions = {
  capturesDirectory: string;
  captureBaseUrl: string;
};

type ScreenshotClip = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export class ScreenshotSession {
  constructor(
    private readonly client: CdpSendClient,
    private readonly options: ScreenshotSessionOptions
  ) {
    mkdirSync(options.capturesDirectory, { recursive: true });
  }

  async capture(options: {
    fullPage?: boolean;
    selector?: string;
    format?: "png" | "jpeg";
  }): Promise<CaliperScreenshotRef> {
    const format = options.format ?? "png";
    const scrollPosition = await readWindowScrollPosition(this.client, { onMissing: "zero" });
    const metrics = await this.client.send<PageGetLayoutMetricsResponse>("Page.getLayoutMetrics");

    let clip: ScreenshotClip | undefined;
    let captureWidth = metrics.layoutViewport.clientWidth;
    let captureHeight = metrics.layoutViewport.clientHeight;

    if (options.selector) {
      clip = await this.resolveSelectorClip(options.selector);
      captureWidth = Math.round(clip.width);
      captureHeight = Math.round(clip.height);
    } else if (options.fullPage) {
      const contentSize = metrics.contentSize ?? metrics.cssContentSize;
      if (contentSize) {
        captureWidth = Math.round(contentSize.width);
        captureHeight = Math.round(contentSize.height);
      }
    }

    const response = await this.client.send<PageCaptureScreenshotResponse>(
      "Page.captureScreenshot",
      {
        format,
        captureBeyondViewport: options.fullPage ?? false,
        fromSurface: true,
        clip,
      }
    );

    const captureId = randomUUID();
    const extension = format === "jpeg" ? "jpeg" : "png";
    const fileName = `${captureId}.${extension}`;
    const filePath = join(this.options.capturesDirectory, fileName);
    writeFileSync(filePath, Buffer.from(response.data, "base64"));

    const capturedAt = Date.now();
    const url = `${this.options.captureBaseUrl}/captures/${fileName}`;

    return {
      captureId,
      url,
      width: captureWidth,
      height: captureHeight,
      scrollX: scrollPosition.scrollX,
      scrollY: scrollPosition.scrollY,
      fullPage: options.fullPage ?? false,
      capturedAt,
    };
  }

  resolveCapturePath(fileName: string): string | null {
    if (!fileName.endsWith(".png") && !fileName.endsWith(".jpeg")) {
      return null;
    }
    return join(this.options.capturesDirectory, fileName);
  }

  private async resolveSelectorClip(selector: string): Promise<ScreenshotClip> {
    const nodeId = await resolveSelectorToNodeId(this.client, selector);
    if (!nodeId) {
      throw new Error(`Screenshot selector not found: ${selector}`);
    }

    const boxModel = await this.client.send<DomGetBoxModelResponse>("DOM.getBoxModel", {
      nodeId,
    });
    const contentQuad = boxModel.model.content;
    const xValues = [
      contentQuad[0] ?? 0,
      contentQuad[2] ?? 0,
      contentQuad[4] ?? 0,
      contentQuad[6] ?? 0,
    ];
    const yValues = [
      contentQuad[1] ?? 0,
      contentQuad[3] ?? 0,
      contentQuad[5] ?? 0,
      contentQuad[7] ?? 0,
    ];
    const left = Math.min(...xValues);
    const top = Math.min(...yValues);
    const right = Math.max(...xValues);
    const bottom = Math.max(...yValues);

    return {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      scale: 1,
    };
  }
}
