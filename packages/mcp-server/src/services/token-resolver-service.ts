import type { DesignTokenDictionary, MissedToken, ContextMetrics } from "@oyerinde/caliper-schema";
import { DEFAULT_CONTEXT_METRICS } from "@oyerinde/caliper-schema";
import { parseColor, calculateDeltaE, NormalizedColor } from "../utils/color-utils.js";
import { toPixels } from "../utils/unit-utils.js";
import {
    PROPERTY_CONFIG,
    FONT_WEIGHT_MAP,
    LAYOUT_VALUES
} from "../shared/properties.js";

export function normalizeValue(property: string, value: string, metrics?: ContextMetrics, percentageReference?: number, tokens?: DesignTokenDictionary): string | number {
    const trimmed = value.trim();
    const lowValue = trimmed.toLowerCase();
    const config = PROPERTY_CONFIG[property];

    if (!config) {
        const camelCase = property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const fallbackConfig = PROPERTY_CONFIG[camelCase];
        if (fallbackConfig) {
            return normalizeValue(camelCase, value, metrics, percentageReference, tokens);
        }
        return lowValue;
    }

    // Global Keywords
    const globals = ["inherit", "initial", "unset", "revert", "revert-layer"];
    if (globals.includes(lowValue)) return lowValue;

    // Symmetric Layout Mapping
    const layoutMap = (LAYOUT_VALUES as Record<string, Record<string, string>>)[property];
    if (layoutMap && layoutMap[lowValue]) {
        return layoutMap[lowValue]!;
    }

    switch (config.valueType) {
        case "color":
            return lowValue;

        case "keyword":
            return lowValue;

        case "number":
            const num = parseFloat(trimmed);
            return isNaN(num) ? lowValue : num;

        case "hybrid":
            // 1. Font Weight Mapping (Priority for fontWeight)
            if (property === "fontWeight") {
                if (FONT_WEIGHT_MAP[lowValue]) return parseInt(FONT_WEIGHT_MAP[lowValue]!, 10);
            }

            // 2. Common Keywords
            if (lowValue === "normal" || lowValue === "auto" || lowValue === "none" || lowValue === "contents") {
                return lowValue;
            }

            // 3. Pure numeric check (z-index, opacity, line-height 1.5)
            const numericValue = parseFloat(trimmed);
            if (!isNaN(numericValue) && trimmed.match(/^-?[\d.]+$/)) {
                return numericValue;
            }

            // 4. Length/Token/Calc check
            if (trimmed.match(/[a-z%]/i) || trimmed.startsWith("var") || trimmed.startsWith("calc")) {
                const ctx = metrics ?? DEFAULT_CONTEXT_METRICS;
                return toPixels(value, ctx, { percentageReference, tokens });
            }

            return lowValue;

        case "length":
            // Length should only call toPixels if it looks like a dimension or number
            if (trimmed.match(/[a-z%]/i) || trimmed.match(/^-?[\d.]+$/) || trimmed.startsWith("var") || trimmed.startsWith("calc")) {
                const ctx = metrics ?? DEFAULT_CONTEXT_METRICS;
                return toPixels(value, ctx, { percentageReference, tokens });
            }
            return lowValue;

        default:
            return lowValue;
    }
}

export class TokenResolverService {
    private colorIndex: Map<string, { name: string, normalized: NormalizedColor }> = new Map();
    private spacingIndex: Array<{ name: string, px: number }> = [];
    private borderRadiusIndex: Array<{ name: string, px: number }> = [];
    private typographyIndex: Array<{ name: string, px: number }> = [];
    private currentMetrics?: ContextMetrics;
    private resolutionCache: Map<string, number> = new Map();

    buildIndex(tokens: DesignTokenDictionary, metrics?: ContextMetrics): void {
        this.colorIndex.clear();
        this.spacingIndex = [];
        this.borderRadiusIndex = [];
        this.typographyIndex = [];
        this.resolutionCache.clear();
        this.currentMetrics = metrics;

        const ctx = metrics ?? DEFAULT_CONTEXT_METRICS;

        for (const [name, value] of Object.entries(tokens.colors)) {
            const normalized = parseColor(value);
            this.colorIndex.set(value.toLowerCase(), { name, normalized });
        }

        const spacingList: Array<{ name: string, px: number }> = [];
        for (const [name, value] of Object.entries(tokens.spacing)) {
            const px = toPixels(value, ctx, { tokens });
            spacingList.push({ name, px });
        }
        this.spacingIndex = spacingList.sort((a, b) => a.px - b.px);

        const radiusList: Array<{ name: string, px: number }> = [];
        for (const [name, value] of Object.entries(tokens.borderRadius)) {
            const px = toPixels(value, ctx, { tokens });
            radiusList.push({ name, px });
        }
        this.borderRadiusIndex = radiusList.sort((a, b) => a.px - b.px);

        const typographyList: Array<{ name: string, px: number }> = [];
        for (const [name, def] of Object.entries(tokens.typography)) {
            typographyList.push({ name, px: def.fontSize });
        }
        this.typographyIndex = typographyList.sort((a, b) => a.px - b.px);
    }

    findTokenByValue(
        tokens: DesignTokenDictionary,
        property: string,
        value: string,
        percentageReference?: number
    ): string | null {
        const trimmed = value.trim().toLowerCase();
        const config = PROPERTY_CONFIG[property];

        if (!config) {
            const camelCase = property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            if (PROPERTY_CONFIG[camelCase]) {
                return this.findTokenByValue(tokens, camelCase, value, percentageReference);
            }
            return null;
        }

        if (config.valueType === "color") {
            if (this.colorIndex.has(trimmed)) {
                return this.colorIndex.get(trimmed)!.name;
            }
            return this.findNearestColorToken(trimmed);
        }

        if (config.valueType === "length") {
            const pxValue = this.getCachedPx(
                value,
                this.currentMetrics ?? DEFAULT_CONTEXT_METRICS,
                { tokens, percentageReference }
            );

            if (config.category === "borderRadius") {
                return this.findNearestSpacingToken(pxValue, "radius");
            } else if (config.category === "typography") {
                return this.findNearestSpacingToken(pxValue, "typography");
            } else {
                return this.findNearestSpacingToken(pxValue, "spacing");
            }
        }

        // Hybrid values (fontWeight, lineHeight, etc.) - try to match if numeric
        if (config.valueType === "hybrid") {
            const numericValue = parseFloat(trimmed);
            if (!isNaN(numericValue)) {
                // Determine if we should treat it as a tokenizable length
                // fontWeight (typography) usually doesn't have tokens for numbers
                // width/height/gap (spacing) usually DO have tokens
                const pxValue = this.getCachedPx(
                    value,
                    this.currentMetrics ?? DEFAULT_CONTEXT_METRICS,
                    { tokens, percentageReference }
                );

                if (config.category === "borderRadius") {
                    return this.findNearestSpacingToken(pxValue, "radius");
                } else if (config.category === "spacing") {
                    return this.findNearestSpacingToken(pxValue, "spacing");
                }
            }
        }

        return null;
    }

    private findNearestColorToken(value: string): string | null {
        const target = parseColor(value);
        let bestMatch: string | null = null;
        let minDistance = Infinity;

        for (const { name, normalized } of this.colorIndex.values()) {
            const distance = calculateDeltaE(target, normalized);
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = name;
            }
        }

        // Only return if it's "close enough" (perceptually similar)
        return minDistance < 0.05 ? bestMatch : null;
    }

    private findNearestSpacingToken(pxValue: number, category: "spacing" | "radius" | "typography"): string | null {
        let sortedList = this.spacingIndex;
        if (category === "radius") sortedList = this.borderRadiusIndex;
        if (category === "typography") sortedList = this.typographyIndex;

        if (sortedList.length === 0) return null;

        let low = 0;
        let high = sortedList.length - 1;
        let bestIdx = 0;
        let minDiff = Infinity;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const midItem = sortedList[mid]!;
            const diff = Math.abs(midItem.px - pxValue);

            if (diff < minDiff) {
                minDiff = diff;
                bestIdx = mid;
            }

            if (midItem.px < pxValue) {
                low = mid + 1;
            } else if (midItem.px > pxValue) {
                high = mid - 1;
            } else {
                return midItem.name; // Exact match
            }
        }

        return minDiff <= 2 ? sortedList[bestIdx]!.name : null;
    }

    private getCachedPx(value: string, metrics: ContextMetrics, options: { percentageReference?: number, tokens?: DesignTokenDictionary }): number {
        const cacheKey = `${value}|${metrics.viewportWidth}|${metrics.rootFontSize}|${options.percentageReference ?? 0}`;
        if (this.resolutionCache.has(cacheKey)) return this.resolutionCache.get(cacheKey)!;
        const result = toPixels(value, metrics, options);
        this.resolutionCache.set(cacheKey, result);
        return result;
    }

    resolveToken(tokens: DesignTokenDictionary, tokenName: string): string | null {
        if (tokens.colors[tokenName]) return tokens.colors[tokenName]!;
        if (tokens.spacing[tokenName]) return tokens.spacing[tokenName]!;
        if (tokens.borderRadius[tokenName]) return tokens.borderRadius[tokenName]!;
        if (tokens.typography[tokenName]) return `${tokens.typography[tokenName]!.fontSize}px`;
        return null;
    }

    compareWithTokens(
        property: string,
        expectedValue: string,
        actualValue: string,
        tokens: DesignTokenDictionary,
        selector: string,
        metrics?: ContextMetrics,
        percentageReference?: number
    ): { isMatch: boolean; tokenName?: string; missedToken?: MissedToken } {
        const normExpected = normalizeValue(property, expectedValue, metrics, percentageReference, tokens);
        const normActual = normalizeValue(property, actualValue, metrics, percentageReference, tokens);

        if (normExpected === normActual) {
            const tokenName = this.findTokenByValue(tokens, property, expectedValue, percentageReference);
            return { isMatch: true, tokenName: tokenName ?? undefined };
        }

        const tokenName = this.findTokenByValue(tokens, property, expectedValue, percentageReference);
        if (tokenName) {
            const tokenCategory = this.getTokenCategory(property);
            return {
                isMatch: false,
                tokenName,
                missedToken: {
                    tokenName,
                    tokenCategory,
                    expectedValue: String(normExpected),
                    actualValue: String(normActual),
                    property,
                    selector,
                },
            };
        }

        return { isMatch: false };
    }

    private getTokenCategory(property: string): "colors" | "spacing" | "typography" | "borderRadius" {
        const config = PROPERTY_CONFIG[property];

        if (!config) {
            // Try kebab-case to camelCase conversion
            const camelCase = property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            const fallbackConfig = PROPERTY_CONFIG[camelCase];
            if (fallbackConfig) {
                return this.getTokenCategory(camelCase);
            }
            return "spacing"; // Default fallback
        }

        // Map layout category to spacing (layout properties don't have tokens)
        if (config.category === "layout") {
            return "spacing";
        }

        return config.category;
    }

    generateCssRecommendation(
        property: string,
        value: string,
        tokenName: string | undefined
    ): string {
        const cssProp = this.toCssProperty(property);
        if (tokenName) {
            const cssVarName = this.toKebabCase(tokenName);
            return `${cssProp}: var(--${cssVarName}); /* ${value} */`;
        }
        return `${cssProp}: ${value};`;
    }

    private toCssProperty(property: string): string {
        return property.replace(/([A-Z])/g, "-$1").toLowerCase();
    }

    private toKebabCase(str: string): string {
        return str
            .replace(/([a-z])([A-Z])/g, "$1-$2")
            .replace(/[\s_/]+/g, "-")
            .toLowerCase();
    }
}

export const tokenResolverService = new TokenResolverService();
