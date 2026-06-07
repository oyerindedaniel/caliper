import type { CaliperActionResult, CaliperIntent } from "@oyerinde/caliper-schema";
import { pollUntil } from "@oyerinde/caliper-schema";
import type { CdpSendClient } from "./cdp-page-session.js";
import type { RuntimeEvaluateResponse } from "./cdp-protocol.js";
import {
  APPLY_ENGINE_MANAGED_TRANSPORT_EXPRESSION,
  PREPARE_ENGINE_MANAGED_PAGE_EXPRESSION,
} from "./engine-state-reporter.js";
import { InjectSession } from "./inject-session.js";

export type HarnessPageProbe = {
  dispatchReady: boolean;
  engineInjected: boolean;
  pageCaliperPresent: boolean;
  bridgeBooting: boolean;
};

/** Must match @caliper/core OVERLAY_CONTAINER_ID */
const CALIPER_OVERLAY_ROOT_ID = "caliper-overlay-root";

export class HarnessSession {
  private readonly injectSession: InjectSession;

  constructor(private readonly client: CdpSendClient) {
    this.injectSession = new InjectSession(client);
  }

  async ensureReady(): Promise<void> {
    await this.injectSession.registerCaliperBootstrap();
    await this.client.send<RuntimeEvaluateResponse>("Runtime.evaluate", {
      expression: PREPARE_ENGINE_MANAGED_PAGE_EXPRESSION,
    });

    let probe = await this.probePage();
    if (probe.dispatchReady) {
      await this.applyManagedTransportIfForeignBridge(probe);
      return;
    }

    if (probe.pageCaliperPresent && !probe.engineInjected) {
      if (!probe.bridgeBooting) {
        probe = await pollUntil(
          async () => {
            const next = await this.probePage();
            return next.dispatchReady || next.bridgeBooting ? next : null;
          },
          {
            intervalMs: 100,
            timeoutMs: 2_000,
            errorMessage:
              "Target page has Caliper overlay but CaliperBridge is not enabled. Engine mode requires bridge with dispatchCaliperIntent.",
          }
        );
      }

      if (!probe.dispatchReady) {
        probe = await pollUntil(
          async () => {
            const next = await this.probePage();
            return next.dispatchReady ? next : null;
          },
          {
            intervalMs: 250,
            timeoutMs: 20_000,
            errorMessage:
              "CaliperBridge is booting on the target page but dispatchCaliperIntent never became available.",
          }
        );
      }

      await this.applyManagedTransportIfForeignBridge(probe);
      return;
    }

    if (!probe.engineInjected) {
      await this.injectSession.injectIntoCurrentDocument();
    }

    await pollUntil(
      async () => {
        const next = await this.probePage();
        return next.dispatchReady ? next : null;
      },
      {
        intervalMs: 250,
        timeoutMs: 20_000,
        errorMessage:
          "Caliper harness did not become ready after engine inject. Engine mode requires CaliperBridge.",
      }
    );
  }

  async dispatchIntent(intent: CaliperIntent): Promise<CaliperActionResult> {
    const evaluation = await this.client.send<RuntimeEvaluateResponse>("Runtime.evaluate", {
      expression: `(async () => {
        const intent = ${JSON.stringify(intent)};
        if (typeof window.dispatchCaliperIntent !== "function") {
          return {
            success: false,
            method: intent.method,
            error: "Caliper harness is not available in this tab",
            timestamp: Date.now(),
          };
        }
        return await window.dispatchCaliperIntent(intent);
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });

    if (evaluation.exceptionDetails) {
      throw new Error(
        evaluation.exceptionDetails.exception?.description ??
          evaluation.exceptionDetails.text ??
          "Runtime.evaluate failed"
      );
    }

    const actionResult = evaluation.result?.value;
    if (!actionResult || typeof actionResult !== "object") {
      throw new Error("Caliper harness returned an invalid result");
    }

    return actionResult as CaliperActionResult;
  }

  private async applyManagedTransportIfForeignBridge(probe: HarnessPageProbe): Promise<void> {
    if (probe.engineInjected) {
      return;
    }

    await this.client.send<RuntimeEvaluateResponse>("Runtime.evaluate", {
      expression: APPLY_ENGINE_MANAGED_TRANSPORT_EXPRESSION,
    });
  }

  async probePage(): Promise<HarnessPageProbe> {
    const evaluation = await this.client.send<RuntimeEvaluateResponse>("Runtime.evaluate", {
      expression: `({
        dispatchReady: typeof window.dispatchCaliperIntent === "function",
        engineInjected: window.__CALIPER_ENGINE_INJECTED__ === true,
        bridgeBooting: window.__CALIPER_BRIDGE_BOOTING__ === true,
        pageCaliperPresent:
          window.__CALIPER__?.mounted === true ||
          !!document.getElementById(${JSON.stringify(CALIPER_OVERLAY_ROOT_ID)}),
      })`,
      returnByValue: true,
    });

    const probe = evaluation.result?.value;
    if (!probe || typeof probe !== "object") {
      return emptyHarnessProbe();
    }

    const value = probe as Record<string, unknown>;
    return {
      dispatchReady: value.dispatchReady === true,
      engineInjected: value.engineInjected === true,
      pageCaliperPresent: value.pageCaliperPresent === true,
      bridgeBooting: value.bridgeBooting === true,
    };
  }
}

export function emptyHarnessProbe(): HarnessPageProbe {
  return {
    dispatchReady: false,
    engineInjected: false,
    pageCaliperPresent: false,
    bridgeBooting: false,
  };
}
