import { describe, it, expect } from "vitest";
import { resolveCalc, evaluateResolvedMath } from "./unit-utils.js";
import { DEFAULT_CONTEXT_METRICS } from "@oyerinde/caliper-schema";

describe("Unit Utilities", () => {
  const context = DEFAULT_CONTEXT_METRICS;

  describe("evaluateResolvedMath", () => {
    it("should handle basic arithmetic", () => {
      expect(evaluateResolvedMath("10 + 20", context, {})).toBe(30);
      expect(evaluateResolvedMath("100 - 40", context, {})).toBe(60);
      expect(evaluateResolvedMath("5 * 10", context, {})).toBe(50);
      expect(evaluateResolvedMath("50 / 2", context, {})).toBe(25);
    });

    it("should handle operator precedence (PEMDAS)", () => {
      expect(evaluateResolvedMath("10 + 5 * 2", context, {})).toBe(20);
      expect(evaluateResolvedMath("(10 + 5) * 2", context, {})).toBe(30);
    });

    it("should handle floating point and negative numbers", () => {
      expect(evaluateResolvedMath("10.5 + 2.5", context, {})).toBe(13);
      expect(evaluateResolvedMath("0 - 10", context, {})).toBe(-10);
    });

    it("should handle division by zero gracefully", () => {
      expect(evaluateResolvedMath("10 / 0", context, {})).toBe(Infinity);
    });
  });

  describe("resolveCalc", () => {
    it("should resolve simple pixel units", () => {
      expect(resolveCalc("calc(10px + 20px)", context, {})).toBe(30);
    });

    it("should resolve rem units relative to root font size", () => {
      expect(resolveCalc("calc(2rem + 10px)", context, {})).toBe(32 + 10);
    });

    it("should resolve viewport units using default metrics", () => {
      // 10vw of 1920 = 192, 5vh of 1080 = 54. Total 246
      expect(resolveCalc("calc(10vw + 5vh)", context, {})).toBe(246);
    });

    it("should handle nested calc()", () => {
      expect(resolveCalc("calc(10px + calc(5px * 2))", context, {})).toBe(20);
    });

    it("should handle clamp(), min(), max()", () => {
      expect(resolveCalc("clamp(10px, 50px, 100px)", context, {})).toBe(50);
      expect(resolveCalc("min(10px, 20px)", context, {})).toBe(10);
      expect(resolveCalc("max(10px, 20px)", context, {})).toBe(20);
    });

    it("should resolve CSS tokens/variables", () => {
      const options = {
        tokens: {
          colors: {},
          spacing: {
            "spacing-1": "4px",
            "primary-width": "100px",
          },
          typography: {},
          borderRadius: {},
        },
      };
      expect(resolveCalc("calc(var(--spacing-1) * 2)", context, options)).toBe(8);
      expect(resolveCalc("calc(var(--primary-width) - 20px)", context, options)).toBe(80);
    });

    it("should handle token fallbacks", () => {
      const options = {
        tokens: {
          colors: {},
          spacing: {},
          typography: {},
          borderRadius: {},
        },
      };
      expect(resolveCalc("var(--missing, 15px)", context, options)).toBe(15);
    });
  });

  describe("Parameterized Math Edge Cases", () => {
    const cases = [
      ["(1 + 2) * 3", 9],
      ["1 + (2 * 3)", 7],
      ["10 / (5 - 3)", 5],
      ["calc(100% - 20px)", 1900], // Fallback % reference is usually viewport width (1920)
      ["min(10px, 20px, 5px)", 5],
      ["max(1px, 2px, 3px, 4px)", 4],
      ["clamp(0px, 50px, 100px)", 50],
      ["clamp(100px, 50px, 0px)", 100], // clamp(min, val, max) -> max(min, min(val, max)) -> max(100, 0) -> 100
    ];

    it.each(cases)("should correctly evaluate %s to %d", (expression, expected) => {
      expect(resolveCalc(expression as string, context, {})).toBe(expected);
    });
  });
});
