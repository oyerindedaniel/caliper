import { afterEach, describe, expect, it } from "vitest";
import { isRuntimeRedactionEnabled, redactRuntimeEntry, redactRuntimeLine } from "./runtime-redact.js";

const originalRedactFlag = process.env.CALIPER_RUNTIME_REDACT;

afterEach(() => {
  if (originalRedactFlag === undefined) {
    delete process.env.CALIPER_RUNTIME_REDACT;
  } else {
    process.env.CALIPER_RUNTIME_REDACT = originalRedactFlag;
  }
});

describe("runtime-redact", () => {
  it("redacts common key name variants including nested objects", () => {
    const redacted = redactRuntimeEntry({
      userApiKey: "sk_live_secret",
      Authorization: "Bearer abc.def.ghi",
      password: "hunter2",
      message: "ok",
      session: {
        refresh_token: "rt-abc",
        userId: "user-1",
      },
    }) as Record<string, unknown>;

    expect(redacted.userApiKey).toBe("[REDACTED]");
    expect(redacted.Authorization).toBe("[REDACTED]");
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.message).toBe("ok");

    const session = redacted.session as Record<string, unknown>;
    expect(session.refresh_token).toBe("[REDACTED]");
    expect(session.userId).toBe("user-1");
  });

  it("redacts bearer tokens embedded in text fields", () => {
    const line = redactRuntimeLine(
      JSON.stringify({
        level: "log",
        text: "failed auth Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
      })
    );
    expect(line).toContain("Bearer [REDACTED]");
    expect(line).not.toContain("eyJhbGci");
  });

  it("redacts URL query secrets and database-style connection strings in text", () => {
    const redacted = redactRuntimeEntry({
      text: "GET https://api.example.com/data?token=supersecret&page=1",
      url: "postgres://admin:localpass@localhost:5432/app",
    }) as Record<string, unknown>;

    expect(redacted.text).toContain("token=[REDACTED]");
    expect(redacted.text).toContain("page=1");
    expect(redacted.url).toContain("admin:[REDACTED]@");
    expect(redacted.url).not.toContain("localpass");
  });

  it("does not redact benign keys that only resemble sensitive names", () => {
    const redacted = redactRuntimeEntry({
      message: "authentication failed",
      selector: "#main-cta",
      timestamp: 1_234,
    }) as Record<string, unknown>;

    expect(redacted.message).toBe("authentication failed");
    expect(redacted.selector).toBe("#main-cta");
    expect(redacted.timestamp).toBe(1_234);
  });

  it("passes through entries unchanged when redaction is disabled", () => {
    process.env.CALIPER_RUNTIME_REDACT = "0";

    expect(isRuntimeRedactionEnabled()).toBe(false);

    const entry = { password: "visible", api_key: "sk_test_123" };
    expect(redactRuntimeEntry(entry)).toEqual(entry);
    expect(redactRuntimeLine(JSON.stringify(entry))).toBe(JSON.stringify(entry));
  });

  it("redacts malformed JSON lines as plain text", () => {
    const line = redactRuntimeLine("not-json Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig");
    expect(line).toContain("Bearer [REDACTED]");
    expect(line).not.toContain("eyJhbGci");
  });

  it("stops recursing and emits MAX_DEPTH for extremely nested payloads", () => {
    let value: unknown = { password: "secret" };
    for (let index = 0; index < 13; index += 1) {
      value = { nested: value };
    }

    const redacted = redactRuntimeEntry(value);
    expect(JSON.stringify(redacted)).toContain("[MAX_DEPTH]");
    expect(JSON.stringify(redacted)).not.toContain("secret");
  });
});
