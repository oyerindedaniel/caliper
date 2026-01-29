import { describe, it, expect, beforeEach } from "vitest";
import { tokenResolverService, normalizeValue } from "./token-resolver-service.js";
import { DEFAULT_CONTEXT_METRICS } from "@oyerinde/caliper-schema";

describe("TokenResolver - normalizeValue", () => {
    it("should handle global keywords regardless of property", () => {
        const globals = ["inherit", "initial", "unset", "revert"];
        for (const kw of globals) {
            expect(normalizeValue("width", kw)).toBe(kw);
            expect(normalizeValue("color", kw.toUpperCase())).toBe(kw);
            expect(normalizeValue("fontWeight", kw)).toBe(kw);
        }
    });

    it("should map font-weight keywords to numbers", () => {
        expect(normalizeValue("fontWeight", "bold")).toBe(700);
        expect(normalizeValue("fontWeight", "NORMAL")).toBe(400);
        expect(normalizeValue("fontWeight", "light")).toBe(300);
        expect(normalizeValue("fontWeight", "black")).toBe(900);
    });

    it("should handle unitless numbers for hybrid properties", () => {
        expect(normalizeValue("lineHeight", "1.5")).toBe(1.5);
        expect(normalizeValue("zIndex", "999")).toBe(999);
        expect(normalizeValue("opacity", "0.5")).toBe(0.5);
    });

    it("should handle auto/normal/none for hybrid properties", () => {
        expect(normalizeValue("width", "auto")).toBe("auto");
        expect(normalizeValue("lineHeight", "normal")).toBe("normal");
        expect(normalizeValue("boxShadow", "none")).toBe("none");
    });

    it("should normalize color keywords and hex values", () => {
        expect(normalizeValue("color", "REd")).toBe("red");
        expect(normalizeValue("backgroundColor", "#FFFFFF")).toBe("#ffffff");
    });

    it("should convert lengths to pixels using metrics", () => {
        const metrics = { ...DEFAULT_CONTEXT_METRICS, rootFontSize: 16 };
        expect(normalizeValue("width", "1rem", metrics)).toBe(16);
        expect(normalizeValue("paddingTop", "16px", metrics)).toBe(16);
    });

    it("should handle percentage values with reference", () => {
        const metrics = DEFAULT_CONTEXT_METRICS;
        expect(normalizeValue("width", "50%", metrics, 1000)).toBe(500);
    });

    it("should handle unknown properties by returning lowercase trimmed value", () => {
        expect(normalizeValue("unknown-prop", "  VAL  ")).toBe("val");
    });
});

describe("TokenResolverService Integration", () => {
    const tokens = {
        colors: {
            "brand-red": "#ff0000",
            "brand-blue": "#0000ff"
        },
        spacing: {
            "1": "4px",
            "2": "8px",
            "4": "16px",
            "8": "32px"
        },
        typography: {
            "text-base": { fontSize: 16, fontWeight: 400, lineHeight: 24 },
            "text-bold": { fontSize: 16, fontWeight: 700, lineHeight: 24 }
        },
        borderRadius: {
            "sm": "2px",
            "md": "4px",
            "lg": "8px"
        }
    };

    beforeEach(() => {
        tokenResolverService.buildIndex(tokens, DEFAULT_CONTEXT_METRICS);
    });

    it("should correctly find color tokens", () => {
        expect(tokenResolverService.findTokenByValue(tokens, "color", "#ff0000")).toBe("brand-red");
        // Perceptually close (if DeltaE < 0.05 logic holds)
        expect(tokenResolverService.findTokenByValue(tokens, "color", "#fe0000")).toBe("brand-red");
    });

    it("should correctly find spacing tokens", () => {
        expect(tokenResolverService.findTokenByValue(tokens, "paddingTop", "16px")).toBe("4");
        // Unitless interpretation for hybrid/mixed properties
        expect(tokenResolverService.findTokenByValue(tokens, "width", "16")).toBe("4");
    });

    it("should find nearest spacing token within threshold", () => {
        expect(tokenResolverService.findTokenByValue(tokens, "gap", "15px")).toBe("4"); // Close to 16px
        expect(tokenResolverService.findTokenByValue(tokens, "gap", "20px")).toBe(null); // Too far from 16 or 32
    });

    it("should find radius tokens", () => {
        expect(tokenResolverService.findTokenByValue(tokens, "borderRadius", "4px")).toBe("md");
    });

    it("should compare with tokens and return matches", () => {
        const result = tokenResolverService.compareWithTokens(
            "paddingTop",
            "16px", // Expected (from tokens)
            "16px", // Actual
            tokens,
            ".test"
        );
        expect(result.isMatch).toBe(true);
        expect(result.tokenName).toBe("4");
    });

    it("should detect missed tokens", () => {
        const result = tokenResolverService.compareWithTokens(
            "paddingTop",
            "16px", // Expected (should be token '4')
            "20px", // Actual (mismatch)
            tokens,
            ".test"
        );
        expect(result.isMatch).toBe(false);
        expect(result.tokenName).toBe("4");
        expect(result.missedToken?.actualValue).toBe("20");
        expect(result.missedToken?.expectedValue).toBe("16");
    });
});
