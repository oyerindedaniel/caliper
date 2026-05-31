import {
  CALIPER_METHODS,
  CALIPER_VISIBILITY_STATUS,
  type CaliperActionResult,
  type CaliperIntent,
  type CaliperVisibility,
} from "@oyerinde/caliper-schema";
import type { HarnessSession } from "./harness-session.js";
import type { EmulationSession } from "./emulation-session.js";
import { CssVisibilitySession } from "./visibility-css.js";
import { AuditBreakpointsSession } from "./audit-breakpoints.js";
import type { CdpClient } from "./cdp-client.js";

/**
 * Engine-side measurement session: in-page harness dispatch plus CDP layers
 * (viewport emulation, CSS visibility, breakpoint audits).
 */
export class EngineMeasurementSession {
  private readonly cssVisibility: CssVisibilitySession;
  private readonly auditBreakpoints: AuditBreakpointsSession;

  constructor(
    private readonly client: CdpClient,
    private readonly harness: HarnessSession,
    private readonly emulation: EmulationSession
  ) {
    this.cssVisibility = new CssVisibilitySession(client);
    this.auditBreakpoints = new AuditBreakpointsSession(
      client,
      harness,
      emulation,
      this.cssVisibility
    );
  }

  async initialize(): Promise<void> {
    await this.emulation.enable();
    await this.cssVisibility.enable();
  }

  async dispatchIntent(intent: CaliperIntent): Promise<CaliperActionResult> {
    if (intent.method === CALIPER_METHODS.SET_VIEWPORT) {
      return this.emulation.setViewport(intent.params);
    }

    if (intent.method === CALIPER_METHODS.AUDIT_BREAKPOINTS) {
      return this.auditBreakpoints.run(intent.params);
    }

    const result = await this.harness.dispatchIntent(intent);
    return this.finalizeDispatchResult(result);
  }

  private async finalizeDispatchResult(result: CaliperActionResult): Promise<CaliperActionResult> {
    if (!result.success) {
      return result;
    }

    const auditContext = await this.emulation.getAuditContext();

    if (result.method === CALIPER_METHODS.INSPECT) {
      const baseVisibility: CaliperVisibility = result.visibility ?? {
        status: CALIPER_VISIBILITY_STATUS.VISIBLE,
        intersectingViewport: true,
      };

      const visibility = await this.cssVisibility.resolveInspectVisibility(
        result.selector,
        baseVisibility
      );

      const viewportMismatch =
        visibility.status === CALIPER_VISIBILITY_STATUS.HIDDEN &&
        visibility.hiddenBy?.type === "css_media_query";

      return {
        ...result,
        visibility,
        auditContext: {
          ...auditContext,
          viewportMismatch,
        },
      };
    }

    if (
      result.method === CALIPER_METHODS.GET_CONTEXT ||
      result.method === CALIPER_METHODS.MEASURE ||
      result.method === CALIPER_METHODS.WALK_DOM ||
      result.method === CALIPER_METHODS.WALK_AND_MEASURE
    ) {
      return {
        ...result,
        auditContext,
      };
    }

    return result;
  }
}
