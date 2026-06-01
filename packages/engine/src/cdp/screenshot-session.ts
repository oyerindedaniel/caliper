import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CaliperScreenshotRef } from "@oyerinde/caliper-schema";
import type { CdpClient } from "./cdp-client.js";
import type { PageCaptureScreenshotResponse } from "./cdp-protocol.js";
import { readWindowScrollPosition } from "./window-scroll.js";

export type ScreenshotSessionOptions = {
  capturesDirectory: string;
  captureBaseUrl: string;
};

export class ScreenshotSession {
  constructor(
    private readonly client: CdpClient,
    private readonly options: ScreenshotSessionOptions
  ) {
    mkdirSync(options.capturesDirectory, { recursive: true });
  }

  async capture(options: {
    fullPage?: boolean;
    format?: "png" | "jpeg";
  }): Promise<CaliperScreenshotRef> {
    const format = options.format ?? "png";
    const scrollPosition = await readWindowScrollPosition(this.client, { onMissing: "zero" });

    const response = await this.client.send<PageCaptureScreenshotResponse>("Page.captureScreenshot", {
      format,
      captureBeyondViewport: options.fullPage ?? false,
      fromSurface: true,
    });

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
      width: 0,
      height: 0,
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
}
