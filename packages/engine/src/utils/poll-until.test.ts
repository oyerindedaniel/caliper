import { describe, expect, it } from "vitest";
import { pollUntil } from "./poll-until.js";

describe("pollUntil", () => {
  it("returns the first successful value", async () => {
    let attempts = 0;
    const value = await pollUntil(
      async () => {
        attempts += 1;
        return attempts >= 3 ? "ready" : null;
      },
      { intervalMs: 1, timeoutMs: 100 }
    );

    expect(value).toBe("ready");
    expect(attempts).toBe(3);
  });

  it("throws when the deadline passes", async () => {
    await expect(
      pollUntil(async () => null, {
        intervalMs: 1,
        timeoutMs: 20,
        errorMessage: "not ready",
      })
    ).rejects.toThrow("not ready");
  });
});
