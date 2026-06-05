import { describe, expect, it } from "vitest";
import { truncateRuntimeText } from "./runtime-text.js";

describe("truncateRuntimeText", () => {
  it("returns the original text when under the byte budget", () => {
    expect(truncateRuntimeText("hello", 32)).toBe("hello");
  });

  it("truncates oversized text and appends a marker", () => {
    const text = "x".repeat(200);
    const truncated = truncateRuntimeText(text, 32);

    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(32);
    expect(truncated.endsWith("…[truncated]")).toBe(true);
    expect(truncated.startsWith("x")).toBe(true);
  });
});
