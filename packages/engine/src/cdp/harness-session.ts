import type { CaliperActionResult, CaliperIntent } from "@oyerinde/caliper-schema";
import { pollUntil } from "@engine/utils/poll-until.js";
import type { CdpClient } from "./cdp-client.js";
import { InjectSession } from "./inject-session.js";

type RuntimeEvaluateResult = {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
};

export class HarnessSession {
  private readonly injectSession: InjectSession;

  constructor(private readonly client: CdpClient) {
    this.injectSession = new InjectSession(client);
  }

  async ensureReady(): Promise<void> {
    // Inject before any new document loads.
    await this.injectSession.registerCaliperBootstrap();

    if (await this.isReady()) {
      // App already ships CaliperBridge — no current-document inject needed.
      return;
    }

    // Current document: addScriptToEvaluateOnNewDocument does not run here.
    await this.injectSession.injectIntoCurrentDocument();

    // Bundle init is async (waitForSystems); poll until dispatchCaliperIntent exists.
    await pollUntil(async () => (await this.isReady()) || null, {
      intervalMs: 250,
      timeoutMs: 20_000,
      errorMessage:
        "Caliper harness is not available in the page. Enable CaliperBridge in your app or ship a Caliper inject bundle.",
    });
  }

  async dispatchIntent(intent: CaliperIntent): Promise<CaliperActionResult> {
    const evaluation = await this.client.send<RuntimeEvaluateResult>("Runtime.evaluate", {
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
      const description =
        evaluation.exceptionDetails.exception?.description ??
        evaluation.exceptionDetails.text ??
        "Runtime.evaluate failed";
      throw new Error(description);
    }

    const actionResult = evaluation.result?.value;
    if (!actionResult || typeof actionResult !== "object") {
      throw new Error("Caliper harness returned an invalid result");
    }

    return actionResult as CaliperActionResult;
  }

  private async isReady(): Promise<boolean> {
    const evaluation = await this.client.send<RuntimeEvaluateResult>("Runtime.evaluate", {
      expression: "typeof window.dispatchCaliperIntent === 'function'",
      returnByValue: true,
    });

    return evaluation.result?.value === true;
  }
}
