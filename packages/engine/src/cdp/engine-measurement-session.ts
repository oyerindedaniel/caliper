import {
  CALIPER_ENGINE_METHODS,
  isCaliperEngineMethod,
  type CaliperActionResult,
  type CaliperEngineRequest,
  type CaliperIntent,
  type EngineRpcRequest,
} from "@oyerinde/caliper-schema";
import type { HarnessSession } from "./harness-session.js";
import type { EmulationSession } from "./emulation-session.js";
import { CssVisibilitySession } from "./visibility-css.js";
import { AuditBreakpointsSession } from "./audit-breakpoints.js";
import type { CdpClient } from "./cdp-client.js";
import { RuntimeCaptureSession } from "./runtime-capture-session.js";
import { NavigationSession } from "./navigation-session.js";
import { StabilizationSession } from "./stabilization-session.js";
import { ScreenshotSession, type ScreenshotSessionOptions } from "./screenshot-session.js";
import { finalizeMeasurementResult } from "./finalize-measurement-result.js";

export type EngineMeasurementSessionOptions = {
  screenshot?: ScreenshotSessionOptions;
};

export class EngineMeasurementSession {
  private readonly cssVisibility: CssVisibilitySession;
  private readonly auditBreakpoints: AuditBreakpointsSession;
  private readonly runtimeCapture: RuntimeCaptureSession;
  private readonly navigation: NavigationSession;
  private readonly stabilization: StabilizationSession;
  private readonly screenshot: ScreenshotSession | null;

  constructor(
    private readonly client: CdpClient,
    private readonly harness: HarnessSession,
    private readonly emulation: EmulationSession,
    options: EngineMeasurementSessionOptions = {}
  ) {
    this.cssVisibility = new CssVisibilitySession(client);
    this.runtimeCapture = new RuntimeCaptureSession(client);
    this.navigation = new NavigationSession(client);
    this.stabilization = new StabilizationSession(client);
    this.screenshot = options.screenshot ? new ScreenshotSession(client, options.screenshot) : null;

    this.auditBreakpoints = new AuditBreakpointsSession(
      client,
      harness,
      emulation,
      this.cssVisibility,
      finalizeMeasurementResult
    );
  }

  getScreenshotSession(): ScreenshotSession | null {
    return this.screenshot;
  }

  async initialize(): Promise<void> {
    await this.emulation.enable();
    await this.cssVisibility.enable();
    await this.runtimeCapture.enable();
  }

  async dispatchRpc(request: EngineRpcRequest): Promise<CaliperActionResult> {
    if (isCaliperEngineMethod(request.method)) {
      return this.dispatchEngineMethod(toEngineRequest(request));
    }

    return this.dispatchHarnessIntent(request as CaliperIntent);
  }

  private async dispatchHarnessIntent(intent: CaliperIntent): Promise<CaliperActionResult> {
    const harnessResult = await this.harness.dispatchIntent(intent);
    return finalizeMeasurementResult(harnessResult, this.cssVisibility, this.emulation);
  }

  private async dispatchEngineMethod(request: CaliperEngineRequest): Promise<CaliperActionResult> {
    const timestamp = Date.now();

    switch (request.method) {
      case CALIPER_ENGINE_METHODS.SET_VIEWPORT:
        return this.emulation.setViewport(request.params);

      case CALIPER_ENGINE_METHODS.AUDIT_BREAKPOINTS:
        return this.auditBreakpoints.run(request.params);

      case CALIPER_ENGINE_METHODS.GET_RUNTIME:
        return {
          success: true,
          method: CALIPER_ENGINE_METHODS.GET_RUNTIME,
          runtime: this.runtimeCapture.getSnapshot(),
          timestamp,
        };

      case CALIPER_ENGINE_METHODS.CLEAR_RUNTIME:
        this.runtimeCapture.clear();
        return {
          success: true,
          method: CALIPER_ENGINE_METHODS.CLEAR_RUNTIME,
          timestamp,
        };

      case CALIPER_ENGINE_METHODS.SCROLL: {
        const position = await this.navigation.scrollTo(
          request.params.scrollX,
          request.params.scrollY
        );
        return {
          success: true,
          method: CALIPER_ENGINE_METHODS.SCROLL,
          scrollX: position.scrollX,
          scrollY: position.scrollY,
          timestamp,
        };
      }

      case CALIPER_ENGINE_METHODS.SCROLL_INTO_VIEW: {
        const position = await this.navigation.scrollIntoView(request.params.selector);
        return {
          success: true,
          method: CALIPER_ENGINE_METHODS.SCROLL_INTO_VIEW,
          selector: request.params.selector,
          scrollX: position.scrollX,
          scrollY: position.scrollY,
          timestamp,
        };
      }

      case CALIPER_ENGINE_METHODS.PAUSE_ANIMATIONS: {
        const pauseResult = await this.stabilization.pauseAnimations();
        return {
          success: true,
          method: CALIPER_ENGINE_METHODS.PAUSE_ANIMATIONS,
          paused: true,
          playbackRate: pauseResult.playbackRate,
          timestamp,
        };
      }

      case CALIPER_ENGINE_METHODS.RESUME_ANIMATIONS: {
        const resumeResult = await this.stabilization.resumeAnimations();
        return {
          success: true,
          method: CALIPER_ENGINE_METHODS.RESUME_ANIMATIONS,
          paused: false,
          playbackRate: resumeResult.playbackRate,
          timestamp,
        };
      }

      case CALIPER_ENGINE_METHODS.SCREENSHOT: {
        if (!this.screenshot) {
          return {
            success: false,
            method: CALIPER_ENGINE_METHODS.SCREENSHOT,
            error: "Screenshot capture is not configured for this engine session",
            timestamp,
          };
        }

        const capture = await this.screenshot.capture({
          fullPage: request.params.fullPage,
          format: request.params.format,
        });

        return {
          success: true,
          method: CALIPER_ENGINE_METHODS.SCREENSHOT,
          capture,
          timestamp,
        };
      }
    }
  }
}
function toEngineRequest(request: EngineRpcRequest): CaliperEngineRequest {
  return {
    method: request.method,
    params: request.params ?? {},
  } as CaliperEngineRequest;
}
