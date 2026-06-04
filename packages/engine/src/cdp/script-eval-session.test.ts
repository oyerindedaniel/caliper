import { describe, expect, it, vi } from "vitest";
import {
  CALIPER_ENGINE_METHODS,
  CALIPER_ENGINE_EVAL_SCRIPT_MAX_SOURCE_LENGTH,
  CALIPER_ENGINE_EVAL_SCRIPT_MAX_TIMEOUT_MS,
  CaliperEngineEvalScriptPayloadSchema,
  isCaliperActionResultMethod,
} from "@oyerinde/caliper-schema";
import type { CdpClient } from "./cdp-client.js";
import type { RuntimeEvaluateResponse } from "./cdp-protocol.js";
import { PAGE_AUTOMATION_DISABLED_MESSAGE } from "./page-automation.js";
import {
  ScriptEvalSession,
  formatRuntimeException,
  wrapEvalSource,
} from "./script-eval-session.js";

type RuntimeEvaluateParams = Record<string, unknown>;

function createEvalMock(response: RuntimeEvaluateResponse | (() => RuntimeEvaluateResponse)) {
  let lastEvaluateParams: RuntimeEvaluateParams | undefined;

  const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "Runtime.evaluate") {
      lastEvaluateParams = params;
      return typeof response === "function" ? response() : response;
    }
    throw new Error(`unexpected CDP method: ${method}`);
  });

  const client = { send } as unknown as CdpClient;

  return {
    client,
    getLastEvaluateParams: () => lastEvaluateParams,
  };
}

function createRejectingMock(error: Error) {
  const send = vi.fn(async () => {
    throw error;
  });
  return { send } as unknown as CdpClient;
}

function assertEvalSuccess(
  result: Awaited<ReturnType<ScriptEvalSession["evaluate"]>>
): asserts result is Extract<
  Awaited<ReturnType<ScriptEvalSession["evaluate"]>>,
  { success: true; method: typeof CALIPER_ENGINE_METHODS.EVAL_SCRIPT }
> {
  if (!isCaliperActionResultMethod(result, CALIPER_ENGINE_METHODS.EVAL_SCRIPT)) {
    throw new Error("expected EVAL_SCRIPT result");
  }
  if (!result.success) {
    throw new Error(result.error);
  }
}

function expectEvalFailure(
  result: Awaited<ReturnType<ScriptEvalSession["evaluate"]>>,
  expectedError: string
): void {
  expect(result.success).toBe(false);
  if (result.success) {
    return;
  }
  expect(isCaliperActionResultMethod(result, CALIPER_ENGINE_METHODS.EVAL_SCRIPT)).toBe(true);
  expect(result.error).toBe(expectedError);
}

describe("wrapEvalSource", () => {
  it("wraps source in an async IIFE", () => {
    expect(wrapEvalSource("return 1 + 1;")).toBe("(async () => {\nreturn 1 + 1;\n})()");
  });
});

describe("formatRuntimeException", () => {
  it("uses exception description when present", () => {
    const message = formatRuntimeException({
      exceptionId: 1,
      text: "Uncaught",
      lineNumber: 0,
      columnNumber: 0,
      exception: { type: "object", description: "TypeError: boom" },
    });

    expect(message).toBe("TypeError: boom");
  });

  it("falls back to text when exception description is missing", () => {
    const message = formatRuntimeException({
      exceptionId: 1,
      text: "Uncaught SyntaxError",
      lineNumber: 0,
      columnNumber: 0,
    });

    expect(message).toBe("Uncaught SyntaxError");
  });

  it("uses a default message when text and description are empty", () => {
    const message = formatRuntimeException({
      exceptionId: 1,
      text: "   ",
      lineNumber: 0,
      columnNumber: 0,
    });

    expect(message).toBe("Runtime.evaluate failed");
  });

  it("appends stack frames when present", () => {
    const message = formatRuntimeException({
      exceptionId: 1,
      text: "Uncaught",
      lineNumber: 0,
      columnNumber: 0,
      exception: { type: "object", description: "TypeError: boom" },
      stackTrace: {
        callFrames: [
          {
            functionName: "run",
            url: "http://localhost/app.js",
            lineNumber: 4,
            columnNumber: 2,
          },
        ],
      },
    });

    expect(message).toContain("TypeError: boom");
    expect(message).toContain("at run (http://localhost/app.js:5:3)");
  });

  it("formats anonymous frames with missing url", () => {
    const message = formatRuntimeException({
      exceptionId: 1,
      text: "fail",
      lineNumber: 0,
      columnNumber: 0,
      stackTrace: {
        callFrames: [{ functionName: "", lineNumber: 0, columnNumber: 0 }],
      },
    });

    expect(message).toContain("at <anonymous> (:1:1)");
  });
});

describe("ScriptEvalSession", () => {
  it("rejects evaluation when script eval is disabled", async () => {
    const send = vi.fn();
    const session = new ScriptEvalSession({ send } as unknown as CdpClient, {
      allowScriptEval: false,
    });

    const result = await session.evaluate({ source: "return 1;" });

    expectEvalFailure(result, PAGE_AUTOMATION_DISABLED_MESSAGE);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns value on successful Runtime.evaluate", async () => {
    const { client, getLastEvaluateParams } = createEvalMock({
      result: { type: "number", value: 42 },
    });

    const session = new ScriptEvalSession(client, { allowScriptEval: true });
    const result = await session.evaluate({ source: "return 42;" });

    assertEvalSuccess(result);
    expect(result.value).toBe(42);

    const params = getLastEvaluateParams();
    expect(params).toMatchObject({
      expression: wrapEvalSource("return 42;"),
      awaitPromise: true,
      returnByValue: true,
    });
    expect(params).not.toHaveProperty("timeout");
  });

  it("passes awaitPromise false when requested", async () => {
    const { client, getLastEvaluateParams } = createEvalMock({
      result: { type: "number", value: 1 },
    });

    const session = new ScriptEvalSession(client, { allowScriptEval: true });
    await session.evaluate({ source: "1", awaitPromise: false });

    expect(getLastEvaluateParams()?.awaitPromise).toBe(false);
  });

  it("passes timeout when timeoutMs is set", async () => {
    const { client, getLastEvaluateParams } = createEvalMock({
      result: { type: "number", value: 1 },
    });

    const session = new ScriptEvalSession(client, { allowScriptEval: true });
    await session.evaluate({ source: "return 1;", timeoutMs: 5_000 });

    expect(getLastEvaluateParams()?.timeout).toBe(5_000);
  });

  it("returns undefined value when CDP result has no serializable value", async () => {
    const { client } = createEvalMock({
      result: { type: "object", objectId: "obj-1" },
    });

    const session = new ScriptEvalSession(client, { allowScriptEval: true });
    const result = await session.evaluate({ source: "({})" });

    assertEvalSuccess(result);
    expect(result.value).toBeUndefined();
  });

  it("maps exceptionDetails to a failed action result", async () => {
    const { client } = createEvalMock({
      exceptionDetails: {
        exceptionId: 2,
        text: "Uncaught",
        lineNumber: 0,
        columnNumber: 0,
        exception: { type: "object", description: "ReferenceError: missing" },
      },
    });

    const session = new ScriptEvalSession(client, { allowScriptEval: true });
    const result = await session.evaluate({ source: "missing();" });

    expectEvalFailure(result, "ReferenceError: missing");
  });

  it("maps exceptionDetails using text when description is absent", async () => {
    const { client } = createEvalMock({
      exceptionDetails: {
        exceptionId: 3,
        text: "Uncaught EvalError",
        lineNumber: 1,
        columnNumber: 0,
      },
    });

    const session = new ScriptEvalSession(client, { allowScriptEval: true });
    const result = await session.evaluate({ source: "throw 1" });

    expectEvalFailure(result, "Uncaught EvalError");
  });

  it("propagates when CDP send rejects", async () => {
    const session = new ScriptEvalSession(createRejectingMock(new Error("WebSocket closed")), {
      allowScriptEval: true,
    });

    await expect(session.evaluate({ source: "return 1" })).rejects.toThrow("WebSocket closed");
  });
});

describe("CaliperEngineEvalScriptPayloadSchema", () => {
  it("rejects empty source", () => {
    expect(CaliperEngineEvalScriptPayloadSchema.safeParse({ source: "" }).success).toBe(false);
  });

  it("rejects oversized source", () => {
    const oversized = "x".repeat(CALIPER_ENGINE_EVAL_SCRIPT_MAX_SOURCE_LENGTH + 1);
    expect(CaliperEngineEvalScriptPayloadSchema.safeParse({ source: oversized }).success).toBe(
      false
    );
  });

  it("rejects timeout above the cap", () => {
    expect(
      CaliperEngineEvalScriptPayloadSchema.safeParse({
        source: "return 1",
        timeoutMs: CALIPER_ENGINE_EVAL_SCRIPT_MAX_TIMEOUT_MS + 1,
      }).success
    ).toBe(false);
  });

  it("accepts minimal valid payload", () => {
    const parsed = CaliperEngineEvalScriptPayloadSchema.safeParse({ source: "return 1" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.awaitPromise).toBeUndefined();
    expect(parsed.data.timeoutMs).toBeUndefined();
  });
});
