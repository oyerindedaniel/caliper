import {
  CALIPER_ENGINE_METHODS,
  type CaliperActionResult,
  type CaliperEngineRpcRequest,
  type CaliperIntent,
  type CaliperPageScopedEngineMethod,
} from "@oyerinde/caliper-schema";
import type { HarnessSession } from "./harness-session.js";
import type { EmulationSession } from "./emulation-session.js";
import { CssVisibilitySession } from "./visibility-css.js";
import { AuditBreakpointsSession } from "./audit-breakpoints.js";
import type { CdpSendClient } from "./cdp-page-session.js";
import { NavigationSession } from "./navigation-session.js";
import { StabilizationSession } from "./stabilization-session.js";
import { ScreenshotSession, type ScreenshotSessionOptions } from "./screenshot-session.js";
import { ScriptEvalSession } from "./script-eval-session.js";
import { TrustedInputSession } from "./trusted-input-session.js";
import { finalizeMeasurementResult } from "./finalize-measurement-result.js";

type CaliperPageScopedEngineRpcRequest = Extract<
  CaliperEngineRpcRequest,
  { method: CaliperPageScopedEngineMethod }
>;

export type EngineMeasurementSessionOptions = {
  screenshot?: ScreenshotSessionOptions;
  projectRoot?: string;
  allowScriptEval?: boolean;
};

export class EngineMeasurementSession {
  private readonly cssVisibility: CssVisibilitySession;
  private readonly auditBreakpoints: AuditBreakpointsSession;
  private readonly navigation: NavigationSession;
  private readonly stabilization: StabilizationSession;
  private readonly screenshot: ScreenshotSession | null;
  private readonly scriptEval: ScriptEvalSession;
  private readonly trustedInput: TrustedInputSession;

  constructor(
    private readonly client: CdpSendClient,
    private readonly harness: HarnessSession,
    private readonly emulation: EmulationSession,
    options: EngineMeasurementSessionOptions = {}
  ) {
    this.cssVisibility = new CssVisibilitySession(client);
    this.navigation = new NavigationSession(client);
    this.stabilization = new StabilizationSession(client);
    this.screenshot = options.screenshot ? new ScreenshotSession(client, options.screenshot) : null;
    const allowPageAutomation = options.allowScriptEval ?? false;
    this.scriptEval = new ScriptEvalSession(client, {
      allowScriptEval: allowPageAutomation,
    });
    this.trustedInput = new TrustedInputSession(client, this.navigation, {
      allowPageAutomation,
    });

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
  }

  async dispatchRpc(intent: CaliperIntent): Promise<CaliperActionResult> {
    const harnessResult = await this.harness.dispatchIntent(intent);
    return finalizeMeasurementResult(harnessResult, this.cssVisibility, this.emulation);
  }

  async dispatchPageScopedEngineRpc(
    request: CaliperPageScopedEngineRpcRequest
  ): Promise<CaliperActionResult> {
    const timestamp = Date.now();

    switch (request.method) {
      case CALIPER_ENGINE_METHODS.SET_VIEWPORT:
        return this.emulation.setViewport(request.params);

      case CALIPER_ENGINE_METHODS.AUDIT_BREAKPOINTS:
        return this.auditBreakpoints.run(request.params);

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
          selector: request.params.selector,
          format: request.params.format,
        });

        return {
          success: true,
          method: CALIPER_ENGINE_METHODS.SCREENSHOT,
          capture,
          timestamp,
        };
      }

      case CALIPER_ENGINE_METHODS.EVAL_SCRIPT:
        return this.scriptEval.evaluate(request.params);

      case CALIPER_ENGINE_METHODS.CLICK_AT:
        return this.trustedInput.clickAt(request.params);

      case CALIPER_ENGINE_METHODS.PRESS_KEY:
        return this.trustedInput.pressKey(request.params);
    }
  }
}
