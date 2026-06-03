import {
  CALIPER_ENGINE_METHODS,
  CALIPER_METHODS,
  type CaliperActionResult,
  type CaliperAuditBreakpointsPayload,
  type CaliperBreakpointAuditMatrix,
} from "@oyerinde/caliper-schema";
import type { HarnessSession } from "./harness-session.js";
import type { EmulationSession } from "./emulation-session.js";
import { CssVisibilitySession } from "./visibility-css.js";
import type { CdpClient } from "./cdp-client.js";
import { finalizeMeasurementResult } from "./finalize-measurement-result.js";
import { resolveAuditViewportHeight } from "./viewport-metrics.js";

type FinalizeMeasurementResult = typeof finalizeMeasurementResult;

export class AuditBreakpointsSession {
  constructor(
    private readonly client: CdpClient,
    private readonly harness: HarnessSession,
    private readonly emulation: EmulationSession,
    private readonly cssVisibility: CssVisibilitySession,
    private readonly finalizeMeasurementResult: FinalizeMeasurementResult
  ) {}

  async run(payload: CaliperAuditBreakpointsPayload): Promise<CaliperActionResult> {
    const height = await resolveAuditViewportHeight(this.client, payload.height);
    const mediaQueries = await this.cssVisibility.listMediaQueries();
    const parsedWidths = extractWidthsFromMediaQueries(mediaQueries.map((media) => media.text));
    const requestedWidths = payload.widths ?? [];
    const breakpoints = dedupeWidths([...requestedWidths, ...parsedWidths]).map((width) => ({
      width,
      height,
      label: describeBreakpointLabel(
        width,
        mediaQueries.map((media) => media.text)
      ),
    }));

    if (breakpoints.length === 0) {
      return {
        success: false,
        method: CALIPER_ENGINE_METHODS.AUDIT_BREAKPOINTS,
        selector: payload.selector,
        error:
          "No breakpoint widths resolved. Page has no px media queries — pass widths explicitly.",
        timestamp: Date.now(),
      };
    }

    const entries: CaliperBreakpointAuditMatrix["entries"] = [];

    try {
      for (const breakpoint of breakpoints) {
        await this.emulation.setViewport({
          width: breakpoint.width,
          height: breakpoint.height,
        });

        await this.client.waitForEvent("Page.frameResized", 2_000).catch(() => undefined);

        const inspectResult = await this.harness.dispatchIntent({
          jsonrpc: "2.0",
          method: CALIPER_METHODS.INSPECT,
          params: { selector: payload.selector },
          id: `audit-${breakpoint.width}`,
        });

        const finalizedInspect = await this.finalizeMeasurementResult(
          inspectResult,
          this.cssVisibility,
          this.emulation
        );

        if (!finalizedInspect.success || finalizedInspect.method !== CALIPER_METHODS.INSPECT) {
          return {
            success: false,
            method: CALIPER_ENGINE_METHODS.AUDIT_BREAKPOINTS,
            selector: payload.selector,
            error:
              finalizedInspect.success === false
                ? finalizedInspect.error
                : "Inspect failed during breakpoint audit",
            timestamp: Date.now(),
          };
        }

        const visibility = finalizedInspect.visibility ?? {
          status: "visible" as const,
          intersectingViewport: true,
        };

        entries.push({
          selector: payload.selector,
          viewport: {
            width: breakpoint.width,
            height: breakpoint.height,
            scrollX: 0,
            scrollY: 0,
          },
          visibility,
          geometry: {
            width: finalizedInspect.distances.horizontal,
            height: finalizedInspect.distances.vertical,
          },
        });
      }
    } finally {
      await this.emulation.clearViewport();
    }

    const audit: CaliperBreakpointAuditMatrix = {
      selector: payload.selector,
      mediaQueries,
      breakpoints,
      entries,
    };

    return {
      success: true,
      method: CALIPER_ENGINE_METHODS.AUDIT_BREAKPOINTS,
      selector: payload.selector,
      audit,
      timestamp: Date.now(),
    };
  }
}

function extractWidthsFromMediaQueries(mediaQueries: string[]): number[] {
  const widths: number[] = [];

  for (const mediaQuery of mediaQueries) {
    const minWidth = mediaQuery.match(/min-width:\s*(\d+)px/i)?.[1];
    const maxWidth = mediaQuery.match(/max-width:\s*(\d+)px/i)?.[1];

    if (minWidth) {
      widths.push(Number.parseInt(minWidth, 10));
      widths.push(Math.max(320, Number.parseInt(minWidth, 10) - 1));
    }

    if (maxWidth) {
      widths.push(Number.parseInt(maxWidth, 10));
      widths.push(Number.parseInt(maxWidth, 10) + 1);
    }
  }

  return widths;
}

function dedupeWidths(widths: number[]): number[] {
  return [...new Set(widths.filter((width) => width >= 320 && width <= 4_000))].sort(
    (left, right) => left - right
  );
}

function describeBreakpointLabel(width: number, mediaQueries: string[]): string | undefined {
  for (const mediaQuery of mediaQueries) {
    const minWidth = mediaQuery.match(/min-width:\s*(\d+)px/i)?.[1];
    if (minWidth && Number.parseInt(minWidth, 10) === width) {
      return mediaQuery;
    }
  }

  return undefined;
}
