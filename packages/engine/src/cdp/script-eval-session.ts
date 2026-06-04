import {
  CALIPER_ENGINE_METHODS,
  type CaliperActionResult,
  type CaliperEngineEvalScriptPayload,
} from "@oyerinde/caliper-schema";
import type { CdpClient } from "./cdp-client.js";
import type { RuntimeEvaluateResponse, RuntimeExceptionDetails } from "./cdp-protocol.js";

import { PAGE_AUTOMATION_DISABLED_MESSAGE } from "./page-automation.js";

/** Wrap agent script as an async IIFE so top-level await and promise returns work with CDP awaitPromise. */
export function wrapEvalSource(source: string): string {
  return `(async () => {\n${source}\n})()`;
}

export function formatRuntimeException(details: RuntimeExceptionDetails): string {
  const primary =
    details.exception?.description?.trim() || details.text?.trim() || "Runtime.evaluate failed";

  const frames = details.stackTrace?.callFrames ?? [];
  if (frames.length === 0) {
    return primary;
  }

  const stackLines = frames.map((frame) => {
    const name = frame.functionName?.trim() || "<anonymous>";
    const url = frame.url ?? "";
    const line = typeof frame.lineNumber === "number" ? frame.lineNumber + 1 : "?";
    const column = typeof frame.columnNumber === "number" ? frame.columnNumber + 1 : "?";
    return `    at ${name} (${url}:${line}:${column})`;
  });

  return `${primary}\n${stackLines.join("\n")}`;
}

export type ScriptEvalSessionOptions = {
  allowScriptEval: boolean;
};

export class ScriptEvalSession {
  constructor(
    private readonly client: CdpClient,
    private readonly options: ScriptEvalSessionOptions
  ) {}

  async evaluate(payload: CaliperEngineEvalScriptPayload): Promise<CaliperActionResult> {
    const timestamp = Date.now();

    if (!this.options.allowScriptEval) {
      return {
        success: false,
        method: CALIPER_ENGINE_METHODS.EVAL_SCRIPT,
        error: PAGE_AUTOMATION_DISABLED_MESSAGE,
        timestamp,
      };
    }

    const evaluateParams: Record<string, unknown> = {
      expression: wrapEvalSource(payload.source),
      awaitPromise: payload.awaitPromise ?? true,
      returnByValue: true,
    };

    if (payload.timeoutMs !== undefined) {
      evaluateParams.timeout = payload.timeoutMs;
    }

    const evaluation = await this.client.send<RuntimeEvaluateResponse>(
      "Runtime.evaluate",
      evaluateParams
    );

    if (evaluation.exceptionDetails) {
      return {
        success: false,
        method: CALIPER_ENGINE_METHODS.EVAL_SCRIPT,
        error: formatRuntimeException(evaluation.exceptionDetails),
        timestamp,
      };
    }

    return {
      success: true,
      method: CALIPER_ENGINE_METHODS.EVAL_SCRIPT,
      value: evaluation.result?.value,
      timestamp,
    };
  }
}
