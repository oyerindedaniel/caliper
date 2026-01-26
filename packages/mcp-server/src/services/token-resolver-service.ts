import type { DesignTokenDictionary, MissedToken } from "@oyerinde/caliper-schema";

function normalizeColorValue(value: string): string {
    const trimmed = value.trim().toLowerCase();

    if (trimmed.startsWith("rgb")) {
        const match = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
        if (match) {
            const r = parseInt(match[1]!, 10).toString(16).padStart(2, "0");
            const g = parseInt(match[2]!, 10).toString(16).padStart(2, "0");
            const b = parseInt(match[3]!, 10).toString(16).padStart(2, "0");
            return `#${r}${g}${b}`;
        }
    }

    if (trimmed.startsWith("#")) {
        if (trimmed.length === 4) {
            return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
        }
        return trimmed.slice(0, 7);
    }

    return trimmed;
}

function normalizeSpacingValue(value: string): string {
    const trimmed = value.trim().toLowerCase();

    if (trimmed.endsWith("rem")) {
        const num = parseFloat(trimmed);
        return `${num * 16}px`;
    }

    if (trimmed.endsWith("em")) {
        const num = parseFloat(trimmed);
        return `${num * 16}px`;
    }

    return trimmed;
}

function normalizeValue(property: string, value: string): string {
    const colorProps = ["color", "background-color", "backgroundColor", "border-color", "borderColor"];
    if (colorProps.includes(property)) {
        return normalizeColorValue(value);
    }

    const spacingProps = [
        "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
        "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
        "gap", "width", "height", "border-radius", "font-size"
    ];
    if (spacingProps.includes(property)) {
        return normalizeSpacingValue(value);
    }

    return value.trim().toLowerCase();
}

export class TokenResolverService {
    private colorIndex: Map<string, string> = new Map();
    private spacingIndex: Map<string, string> = new Map();
    private borderRadiusIndex: Map<string, string> = new Map();

    buildIndex(tokens: DesignTokenDictionary): void {
        this.colorIndex.clear();
        this.spacingIndex.clear();
        this.borderRadiusIndex.clear();

        for (const [name, value] of Object.entries(tokens.colors)) {
            const normalized = normalizeColorValue(value);
            this.colorIndex.set(normalized, name);
        }

        for (const [name, value] of Object.entries(tokens.spacing)) {
            const normalized = normalizeSpacingValue(value);
            this.spacingIndex.set(normalized, name);
        }

        for (const [name, value] of Object.entries(tokens.borderRadius)) {
            const normalized = normalizeSpacingValue(value);
            this.borderRadiusIndex.set(normalized, name);
        }
    }

    findTokenByValue(
        tokens: DesignTokenDictionary,
        property: string,
        value: string
    ): string | null {
        const normalized = normalizeValue(property, value);

        const colorProps = ["color", "background-color", "backgroundColor", "border-color", "borderColor"];
        if (colorProps.includes(property)) {
            return this.colorIndex.get(normalized) ?? null;
        }

        const spacingProps = [
            "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
            "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
            "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
            "marginTop", "marginRight", "marginBottom", "marginLeft",
            "gap", "width", "height", "fontSize", "font-size"
        ];
        if (spacingProps.includes(property)) {
            return this.spacingIndex.get(normalized) ?? null;
        }

        if (property === "border-radius" || property === "borderRadius") {
            return this.borderRadiusIndex.get(normalized) ?? null;
        }

        return null;
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
        selector: string
    ): { isMatch: boolean; tokenName?: string; missedToken?: MissedToken } {
        const normalizedExpected = normalizeValue(property, expectedValue);
        const normalizedActual = normalizeValue(property, actualValue);

        if (normalizedExpected === normalizedActual) {
            const tokenName = this.findTokenByValue(tokens, property, expectedValue);
            return { isMatch: true, tokenName: tokenName ?? undefined };
        }

        const tokenName = this.findTokenByValue(tokens, property, expectedValue);
        if (tokenName) {
            const tokenCategory = this.getTokenCategory(property);
            return {
                isMatch: false,
                tokenName,
                missedToken: {
                    tokenName,
                    tokenCategory,
                    expectedValue: normalizedExpected,
                    actualValue: normalizedActual,
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
