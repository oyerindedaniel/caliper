import type { CaliperEngineDefaultViewport } from "@oyerinde/caliper-schema";
import { CALIPER_ENGINE_STATE_BINDING } from "@oyerinde/caliper-schema";
import { EmulationSession } from "./emulation-session.js";
import {
  EngineMeasurementSession,
  type EngineMeasurementSessionOptions,
} from "./engine-measurement-session.js";
import { HarnessSession } from "./harness-session.js";
import type { CdpPageSession } from "./cdp-page-session.js";
import type { RuntimeCaptureSession } from "./runtime-capture-session.js";

export class PageHandle {
  readonly measurementSession: EngineMeasurementSession;
  private readonly harness: HarnessSession;
  private readonly emulation: EmulationSession;
  private initialized = false;
  private viewportApplied = false;

  constructor(
    readonly pageId: string,
    readonly client: CdpPageSession,
    public url: string,
    public title: string,
    measurementOptions: EngineMeasurementSessionOptions,
    private readonly runtimeCapture: RuntimeCaptureSession,
    private readonly defaultViewport: CaliperEngineDefaultViewport
  ) {
    this.harness = new HarnessSession(client);
    this.emulation = new EmulationSession(client);
    this.measurementSession = new EngineMeasurementSession(
      client,
      this.harness,
      this.emulation,
      measurementOptions
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.client.send("Page.enable");
    await this.client.send("Runtime.enable");
    await this.client.send("Runtime.addBinding", { name: CALIPER_ENGINE_STATE_BINDING });

    await this.applyDefaultViewport();
    await this.measurementSession.initialize();
    await this.runtimeCapture.registerPage(this.pageId, this.client);
    await this.harness.ensureReady();
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    await this.runtimeCapture.unregisterPage(this.pageId);
    this.initialized = false;
  }

  async applyDefaultViewport(): Promise<void> {
    if (this.viewportApplied || this.emulation.isEmulated()) {
      return;
    }

    await this.emulation.setViewport({
      width: this.defaultViewport.width,
      height: this.defaultViewport.height,
      deviceScaleFactor: this.defaultViewport.deviceScaleFactor,
    });
    this.viewportApplied = true;
  }
}
