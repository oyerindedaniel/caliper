import type { DesignTokenDictionary, MissedToken, ContextMetrics } from "@oyerinde/caliper-schema";
import { parseColor, calculateDeltaE, NormalizedColor } from "../utils/color-utils.js";
import { toPixels } from "../utils/unit-utils.js";

function normalizeValue(property: string, value: string, metrics?: ContextMetrics, percentageReference?: number, tokens?: DesignTokenDictionary): string | number {
    const trimmed = value.trim().toLowerCase();

    const colorProps = ["color", "background-color", "backgroundColor", "border-color", "borderColor", "outline-color", "outlineColor"];
    if (colorProps.includes(property)) {
        return trimmed;
    }

    const spacingProps = [
        "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
        "marginTop", "marginRight", "marginBottom", "marginLeft",
        "gap", "width", "height", "fontSize", "font-size", "border-radius", "borderRadius",
        "letter-spacing", "letterSpacing", "line-height", "lineHeight", "outline-width", "outlineWidth"
    ];
    if (spacingProps.includes(property)) {
        const ctx = metrics ?? { rootFontSize: 16, devicePixelRatio: 1, viewportWidth: 1920, viewportHeight: 1080 };
        return toPixels(value, ctx, { percentageReference, tokens });
    }

    return trimmed;
}

export class TokenResolverService {
    private colorIndex: Map<string, { name: string, normalized: NormalizedColor }> = new Map();
    private spacingIndex: Array<{ name: string, px: number }> = [];
    private borderRadiusIndex: Array<{ name: string, px: number }> = [];
    private currentMetrics?: ContextMetrics;
    private resolutionCache: Map<string, number> = new Map();

    buildIndex(tokens: DesignTokenDictionary, metrics?: ContextMetrics): void {
        this.colorIndex.clear();
        this.spacingIndex = [];
        this.borderRadiusIndex = [];
        this.resolutionCache.clear();
        this.currentMetrics = metrics;

        const ctx = metrics ?? { rootFontSize: 16, devicePixelRatio: 1, viewportWidth: 1920, viewportHeight: 1080 };

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
    }

    findTokenByValue(
        tokens: DesignTokenDictionary,
        property: string,
        value: string,
        percentageReference?: number
    ): string | null {
        const trimmed = value.trim().toLowerCase();

        const colorProps = ["color", "background-color", "backgroundColor", "border-color", "borderColor"];
        if (colorProps.includes(property)) {
            if (this.colorIndex.has(trimmed)) return this.colorIndex.get(trimmed)!.name;

            return this.findNearestColorToken(trimmed);
        }

        const spacingProps = [
            "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
            "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
            "gap", "width", "height", "fontSize", "font-size", "borderRadius", "border-radius"
        ];
        if (spacingProps.includes(property)) {
            const pxValue = this.getCachedPx(value, this.currentMetrics ?? { rootFontSize: 16, devicePixelRatio: 1, viewportWidth: 1920, viewportHeight: 1080 }, { tokens, percentageReference });
            return this.findNearestSpacingToken(pxValue, property.includes("radius") ? "radius" : "spacing");
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

    private findNearestSpacingToken(pxValue: number, category: "spacing" | "radius"): string | null {
        const sortedList = category === "radius" ? this.borderRadiusIndex : this.spacingIndex;
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
        const colorProps = ["color", "background-color", "backgroundColor", "border-color", "borderColor"];
        if (colorProps.includes(property)) return "colors";

        if (property === "border-radius" || property === "borderRadius") return "borderRadius";

        if (property === "font-size" || property === "fontSize") return "typography";

        return "spacing";
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
