import {
  CALIPER_METHODS,
  CALIPER_VISIBILITY_STATUS,
  type CaliperActionResult,
  type CaliperVisibility,
} from "@oyerinde/caliper-schema";
import type { CssVisibilitySession } from "./visibility-css.js";
import type { EmulationSession } from "./emulation-session.js";

export async function finalizeMeasurementResult(
  result: CaliperActionResult,
  cssVisibility: CssVisibilitySession,
  emulation: EmulationSession
): Promise<CaliperActionResult> {
  if (!result.success) {
    return result;
  }

  const auditContext = await emulation.getAuditContext();

  if (result.method === CALIPER_METHODS.INSPECT) {
    const baseVisibility: CaliperVisibility = result.visibility ?? {
      status: CALIPER_VISIBILITY_STATUS.VISIBLE,
      intersectingViewport: true,
    };

    const visibility = await cssVisibility.resolveInspectVisibility(
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
