import type { InferredStyles, BoxEdgesString, SemanticNode, Framework, DesignTokenDictionary, ContextMetrics } from "@oyerinde/caliper-schema";
import { tokenResolverService } from "./token-resolver-service.js";
import { resolveCalc, toPixels } from "../utils/unit-utils.js";

type PartialInferredStyles = Partial<InferredStyles>;

const SPACING_SCALE: Record<string, string> = {
    "0": "0px",
    "px": "1px",
    "0.5": "2px",
    "1": "4px",
    "1.5": "6px",
    "2": "8px",
    "2.5": "10px",
    "3": "12px",
    "3.5": "14px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "7": "28px",
    "8": "32px",
    "9": "36px",
    "10": "40px",
    "11": "44px",
    "12": "48px",
    "14": "56px",
    "16": "64px",
    "20": "80px",
    "24": "96px",
    "28": "112px",
    "32": "128px",
    "36": "144px",
    "40": "160px",
    "44": "176px",
    "48": "192px",
    "52": "208px",
    "56": "224px",
    "60": "240px",
    "64": "256px",
    "72": "288px",
    "80": "320px",
    "96": "384px",
};

const VIEWPORT_UNITS: Record<string, string> = {
    "vh": "vh",
    "vw": "vw",
    "vmin": "vmin",
    "vmax": "vmax",
    "dvh": "dvh",
    "dvw": "dvw",
    "svh": "svh",
    "svw": "svw",
    "lvh": "lvh",
    "lvw": "lvw",
    "rem": "rem",
    "em": "em",
    "ch": "ch",
    "ex": "ex",
    "px": "px",
    "cm": "cm",
    "mm": "mm",
    "in": "in",
    "pt": "pt",
    "pc": "pc",
    "cqw": "cqw",
    "cqh": "cqh",
    "cqi": "cqi",
    "cqb": "cqb",
    "cqmin": "cqmin",
    "cqmax": "cqmax",
    "vb": "vb",
    "vi": "vi",
    "rlh": "rlh",
    "lh": "lh",
};

const FONT_SIZE_SCALE: Record<string, string> = {
    "xs": "12px",
    "sm": "14px",
    "base": "16px",
    "lg": "18px",
    "xl": "20px",
    "2xl": "24px",
    "3xl": "30px",
    "4xl": "36px",
    "5xl": "48px",
    "6xl": "60px",
    "7xl": "72px",
    "8xl": "96px",
    "9xl": "128px",
};

const FONT_WEIGHT_MAP: Record<string, string> = {
    "thin": "100",
    "extralight": "200",
    "light": "300",
    "normal": "400",
    "medium": "500",
    "semibold": "600",
    "bold": "700",
    "extrabold": "800",
    "black": "900",
};

const BORDER_RADIUS_SCALE: Record<string, string> = {
    "none": "0px",
    "sm": "2px",
    "": "4px",
    "md": "6px",
    "lg": "8px",
    "xl": "12px",
    "2xl": "16px",
    "3xl": "24px",
    "full": "9999px",
};

function resolveSpacing(value: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): string | undefined {
    // 1. Handle Tailwind Arbitrary Values [12px] or [var(--spacing-md)]
    if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1).replace(/_/g, " ");
        if (inner.startsWith("var(--") && inner.endsWith(")") && tokens) {
            const tokenName = inner.slice(6, -1);
            const resolved = tokenResolverService.resolveToken(tokens, tokenName);
            if (resolved) return resolved;
        }
        // Support for [(--variable)]
        if (inner.startsWith("(--") && inner.endsWith(")") && tokens) {
            const tokenName = inner.slice(3, -1);
            const resolved = tokenResolverService.resolveToken(tokens, tokenName) || tokenResolverService.resolveToken(tokens, `--${tokenName}`);
            if (resolved) return resolved;
        }
        return inner;
    }

    // 2. Handle Tailwind v4.0 Variable Shorthand (e.g. p-(--spacing-md))
    if (value.startsWith("(--") && value.endsWith(")")) {
        const tokenName = value.slice(1, -1); // e.g. "--spacing-md"
        if (tokens) {
            // Try resolving with and without the dashes
            const cleanName = tokenName.startsWith("--") ? tokenName.slice(2) : tokenName;
            const resolved = tokenResolverService.resolveToken(tokens, cleanName) ||
                tokenResolverService.resolveToken(tokens, tokenName);
            if (resolved) return resolved;
        }
        return `var(${tokenName})`;
    }

    // 3. Handle calc()
    if (value.startsWith("calc(") && metrics) {
        return `${resolveCalc(value, metrics, { tokens })}px`;
    }

    // 4. Handle Standard Spacing Scale
    if (SPACING_SCALE[value]) {
        return SPACING_SCALE[value];
    }

    // 5. Handle Units
    for (const unit of Object.keys(VIEWPORT_UNITS)) {
        if (value.endsWith(unit)) return value;
    }

    return undefined;
}

function resolveColor(value: string, tokens?: DesignTokenDictionary): string | undefined {
    // 1. Handle Tailwind Arbitrary Values [var(--brand-color)]
    if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1).replace(/_/g, " ");
        if (inner.startsWith("var(--") && inner.endsWith(")") && tokens) {
            const tokenName = inner.slice(6, -1);
            const resolved = tokenResolverService.resolveToken(tokens, tokenName);
            if (resolved) return resolved;
        }
        return inner;
    }

    // 2. Handle Tailwind v4.0 Variable Shorthand (e.g. text-(--brand-color))
    if (value.startsWith("(--") && value.endsWith(")")) {
        const tokenName = value.slice(1, -1);
        if (tokens) {
            const cleanName = tokenName.startsWith("--") ? tokenName.slice(2) : tokenName;
            const resolved = tokenResolverService.resolveToken(tokens, cleanName) ||
                tokenResolverService.resolveToken(tokens, tokenName);
            if (resolved) return resolved;
        }
        return `var(${tokenName})`;
    }

    return value;
}

function createBoxEdges(top: string, right: string, bottom: string, left: string): BoxEdgesString {
    return { top, right, bottom, left };
}

function extractValue(className: string, prefix: string): string | null {
    if (className.startsWith(prefix)) {
        return className.slice(prefix.length);
    }
    return null;
}

function parseBoxEdgesClass(className: string, prefix: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): BoxEdgesString | null {
    const value = extractValue(className, prefix);
    if (!value) return null;

    const resolved = resolveSpacing(value, tokens, metrics);
    if (!resolved) return null;

    if (prefix.endsWith("-x-")) return createBoxEdges("0px", resolved, "0px", resolved);
    if (prefix.endsWith("-y-")) return createBoxEdges(resolved, "0px", resolved, "0px");
    if (prefix.endsWith("-t-")) return createBoxEdges(resolved, "0px", "0px", "0px");
    if (prefix.endsWith("-r-")) return createBoxEdges("0px", resolved, "0px", "0px");
    if (prefix.endsWith("-b-")) return createBoxEdges("0px", "0px", resolved, "0px");
    if (prefix.endsWith("-l-")) return createBoxEdges("0px", "0px", "0px", resolved);

    return createBoxEdges(resolved, resolved, resolved, resolved);
}

function parsePaddingClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): Partial<{ padding: BoxEdgesString }> | null {
    const prefixes = ["p-", "px-", "py-", "pt-", "pr-", "pb-", "pl-"];
    for (const p of prefixes) {
        const edges = parseBoxEdgesClass(className, p, tokens, metrics);
        if (edges) return { padding: edges };
    }
    return null;
}

function parseMarginClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): Partial<{ margin: BoxEdgesString }> | null {
    const prefixes = ["m-", "mx-", "my-", "mt-", "mr-", "mb-", "ml-"];
    for (const p of prefixes) {
        const edges = parseBoxEdgesClass(className, p, tokens, metrics);
        if (edges) return { margin: edges };
    }
    return null;
}

function parseGapClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): Partial<{ gap: string }> | null {
    if (className.startsWith("gap-")) {
        const value = resolveSpacing(className.slice(4), tokens, metrics);
        if (value) return { gap: value };
    }
    return null;
}

function parseFontSizeClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, "text-");
    if (!value) return null;

    const scaleValue = FONT_SIZE_SCALE[value];
    if (scaleValue) return { fontSize: scaleValue };

    const resolved = resolveSpacing(value, tokens, metrics);
    if (resolved) return { fontSize: resolved };

    return null;
}

function parseFontWeightClass(className: string): PartialInferredStyles | null {
    const value = extractValue(className, "font-");
    if (value && FONT_WEIGHT_MAP[value]) return { fontWeight: FONT_WEIGHT_MAP[value] };
    return null;
}

function parseBorderRadiusClass(className: string): PartialInferredStyles | null {
    if (className === "rounded") return { borderRadius: BORDER_RADIUS_SCALE[""] };
    const value = extractValue(className, "rounded-");
    if (value && BORDER_RADIUS_SCALE[value]) return { borderRadius: BORDER_RADIUS_SCALE[value] };
    return null;
}

function parseKeywordClass(className: string, mapping: Record<string, any>, prop: keyof InferredStyles): PartialInferredStyles | null {
    if (mapping[className]) return { [prop]: mapping[className] };
    return null;
}

function parseDisplayClass(className: string): PartialInferredStyles | null {
    const mapping = {
        "flex": "flex", "inline-flex": "inline-flex", "grid": "grid",
        "block": "block", "inline": "inline", "inline-block": "inline-block", "hidden": "none"
    };
    return parseKeywordClass(className, mapping, "display");
}

function parseFlexDirectionClass(className: string): PartialInferredStyles | null {
    const mapping = {
        "flex-row": "row", "flex-col": "column",
        "flex-row-reverse": "row-reverse", "flex-col-reverse": "column-reverse"
    };
    return parseKeywordClass(className, mapping, "flexDirection");
}

function parseJustifyClass(className: string): PartialInferredStyles | null {
    const value = extractValue(className, "justify-");
    if (!value) return null;
    const mapping: Record<string, string> = {
        "start": "flex-start", "end": "flex-end", "center": "center",
        "between": "space-between", "around": "space-around", "evenly": "space-evenly",
    };
    if (mapping[value]) return { justifyContent: mapping[value] };
    return null;
}

function parseAlignItemsClass(className: string): PartialInferredStyles | null {
    const value = extractValue(className, "items-");
    if (!value) return null;
    const mapping: Record<string, string> = {
        "start": "flex-start", "end": "flex-end", "center": "center",
        "baseline": "baseline", "stretch": "stretch",
    };
    if (mapping[value]) return { alignItems: mapping[value] };
    return null;
}

function parseDimensionClass(className: string, prefix: "w-" | "h-", tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, prefix);
    if (!value) return null;

    const key = prefix === "w-" ? "width" : "height";
    const viewportUnit = prefix === "w-" ? "100vw" : "100vh";

    if (value === "full") return { [key]: "100%" };
    if (value === "screen") return { [key]: viewportUnit };
    if (value === "min") return { [key]: "min-content" };
    if (value === "max") return { [key]: "max-content" };
    if (value === "fit") return { [key]: "fit-content" };
    if (value === "auto") return { [key]: "auto" };

    for (const unit of Object.keys(VIEWPORT_UNITS)) {
        if (value.endsWith(unit)) return { [key]: value };
    }

    const spacing = resolveSpacing(value, tokens, metrics);
    if (spacing) return { [key]: spacing };

    return null;
}

function parseWidthClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    return parseDimensionClass(className, "w-", tokens, metrics);
}

function parseHeightClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    return parseDimensionClass(className, "h-", tokens, metrics);
}

function parseNumericUtility(className: string, prefix: string, prop: keyof InferredStyles, factor: number = 1): PartialInferredStyles | null {
    const value = extractValue(className, prefix);
    if (!value) return null;
    const num = parseInt(value, 10);
    if (!isNaN(num)) return { [prop]: num / factor };
    return null;
}

function parseOpacityClass(className: string): PartialInferredStyles | null {
    return parseNumericUtility(className, "opacity-", "opacity", 100);
}

function parseZIndexClass(className: string): PartialInferredStyles | null {
    return parseNumericUtility(className, "z-", "zIndex");
}

function parseColorUtility(className: string, prefix: string, prop: keyof InferredStyles, tokens?: DesignTokenDictionary): PartialInferredStyles | null {
    const value = extractValue(className, prefix);
    if (!value) return null;

    const resolved = resolveColor(value, tokens);
    if (resolved) return { [prop]: resolved };
    return null;
}

function parseBackgroundColorClass(className: string, tokens?: DesignTokenDictionary): PartialInferredStyles | null {
    return parseColorUtility(className, "bg-", "backgroundColor", tokens);
}

function parseTextColorClass(className: string, tokens?: DesignTokenDictionary): PartialInferredStyles | null {
    const value = extractValue(className, "text-");
    if (!value || FONT_SIZE_SCALE[value]) return null;
    return parseColorUtility(className, "text-", "color", tokens);
}

function parseBorderColorClass(className: string, tokens?: DesignTokenDictionary): PartialInferredStyles | null {
    const value = extractValue(className, "border-");
    if (!value || /^\d+|[trblxy]$/.test(value)) return null;
    return parseColorUtility(className, "border-", "borderColor", tokens);
}

function parseOutlineColorClass(className: string, tokens?: DesignTokenDictionary): PartialInferredStyles | null {
    const value = extractValue(className, "outline-");
    if (!value || /^\d+|none$/.test(value)) return null;
    return parseColorUtility(className, "outline-", "outlineColor", tokens);
}

function parseShadowClass(className: string, tokens?: DesignTokenDictionary): PartialInferredStyles | null {
    const shadows: Record<string, string> = {
        "shadow-sm": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "shadow": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        "shadow-md": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        "shadow-lg": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
        "shadow-xl": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
        "shadow-2xl": "0 25px 50px -12px rgb(0 0 0 / 0.5)",
        "shadow-inner": "inset 0 2px 4px 0 rgb(0 0 0 / 0.05)",
        "shadow-none": "0 0 #0000",
    };
    if (shadows[className]) return { boxShadow: shadows[className] };

    if (className.startsWith("shadow-")) {
        const value = className.slice(7);
        const resolved = resolveColor(value, tokens);
        if (resolved) return { boxShadow: `0 0 0 1px ${resolved}` }; // Estimation for custom shadow vars
    }

    return null;
}

type ParserFn = (className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics) => PartialInferredStyles | null;

const PREFIX_PARSERS: Record<string, ParserFn> = {
    "p-": parsePaddingClass, "px-": parsePaddingClass, "py-": parsePaddingClass, "pt-": parsePaddingClass, "pr-": parsePaddingClass, "pb-": parsePaddingClass, "pl-": parsePaddingClass,
    "m-": parseMarginClass, "mx-": parseMarginClass, "my-": parseMarginClass, "mt-": parseMarginClass, "mr-": parseMarginClass, "mb-": parseMarginClass, "ml-": parseMarginClass,
    "gap-": parseGapClass,
    "text-": (c, t, m) => parseFontSizeClass(c, t, m) || parseTextColorClass(c, t),
    "font-": parseFontWeightClass,
    "rounded": parseBorderRadiusClass,
    "w-": parseWidthClass,
    "h-": parseHeightClass,
    "opacity-": parseOpacityClass,
    "z-": parseZIndexClass,
    "shadow": parseShadowClass,
    "bg-": parseBackgroundColorClass,
    "border-": parseBorderColorClass,
    "outline-": parseOutlineColorClass,
};

const STATIC_PARSERS: Record<string, PartialInferredStyles> = {
    "flex": { display: "flex" },
    "inline-flex": { display: "inline-flex" },
    "grid": { display: "grid" },
    "block": { display: "block" },
    "inline": { display: "inline" },
    "inline-block": { display: "inline-block" },
    "hidden": { display: "none" },
    "flex-row": { flexDirection: "row" },
    "flex-col": { flexDirection: "column" },
    "flex-row-reverse": { flexDirection: "row-reverse" },
    "flex-col-reverse": { flexDirection: "column-reverse" },
};

const CLASS_STYLE_CACHE = new Map<string, PartialInferredStyles>();

export function inferStylesFromClasses(classes: string[], framework: Framework, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): InferredStyles {
    if (!framework.endsWith("-tailwind")) {
        return {};
    }

    const result: InferredStyles = {};

    for (const className of classes) {
        const cacheKey = `${className}|${framework}|${metrics?.rootFontSize ?? 16}`;
        if (CLASS_STYLE_CACHE.has(cacheKey)) {
            Object.assign(result, CLASS_STYLE_CACHE.get(cacheKey));
            continue;
        }

        if (STATIC_PARSERS[className]) {
            const parsed = STATIC_PARSERS[className]!;
            CLASS_STYLE_CACHE.set(cacheKey, parsed);
            Object.assign(result, parsed);
            continue;
        }

        if (className.startsWith("justify-") || className.startsWith("items-")) {
            const parsed = parseJustifyClass(className) || parseAlignItemsClass(className);
            if (parsed) {
                CLASS_STYLE_CACHE.set(cacheKey, parsed);
                Object.assign(result, parsed);
                continue;
            }
        }

        const dashIdx = className.indexOf("-");
        const prefix = dashIdx !== -1 ? className.slice(0, dashIdx + 1) : className;

        const parser = PREFIX_PARSERS[prefix];
        if (parser) {
            const parsed = parser(className, tokens, metrics);
            if (parsed) {
                CLASS_STYLE_CACHE.set(cacheKey, parsed);
                Object.assign(result, parsed);
                continue;
            }
        }
    }

    return result;
}

export function parseInlineStyles(styleString: string): InferredStyles {
    const result: InferredStyles = {};
    const declarations = styleString.split(";").filter(Boolean);

    for (const decl of declarations) {
        const [prop, value] = decl.split(":").map(segment => segment.trim());
        if (!prop || !value) continue;

        const camelProp = prop.replace(/-([a-z])/g, match => match[1]!.toUpperCase());

        if (camelProp === "display") {
            const valid = ["flex", "grid", "block", "inline", "inline-flex", "inline-block", "none"] as const;
            if ((valid as readonly string[]).includes(value)) result.display = value as typeof valid[number];
            continue;
        }

        if (camelProp === "flexDirection") {
            const valid = ["row", "column", "row-reverse", "column-reverse"] as const;
            if ((valid as readonly string[]).includes(value)) result.flexDirection = value as typeof valid[number];
            continue;
        }

        const stringProps = ["justifyContent", "alignItems", "gap", "fontSize", "fontWeight", "borderRadius", "backgroundColor", "color", "width", "height", "boxShadow", "outline", "letterSpacing"] as const;
        type StringPropKey = typeof stringProps[number];

        if ((stringProps as readonly string[]).includes(camelProp)) {
            result[camelProp as StringPropKey] = value;
            continue;
        }

        if (camelProp === "opacity" || camelProp === "zIndex") {
            const num = parseFloat(value);
            if (!isNaN(num)) result[camelProp as "opacity" | "zIndex"] = num;
            continue;
        }

        if (camelProp === "lineHeight") {
            result.lineHeight = /^\d+(\.\d+)?$/.test(value) ? parseFloat(value) : value;
            continue;
        }

        if (camelProp === "padding" || camelProp === "margin") {
            const parts = value.split(/\s+/);
            const edges: BoxEdgesString = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
            if (parts.length === 1) {
                edges.top = edges.right = edges.bottom = edges.left = parts[0]!;
            } else if (parts.length === 2) {
                edges.top = edges.bottom = parts[0]!;
                edges.right = edges.left = parts[1]!;
            } else if (parts.length === 4) {
                edges.top = parts[0]!;
                edges.right = parts[1]!;
                edges.bottom = parts[2]!;
                edges.left = parts[3]!;
            }

            if (camelProp === "padding") result.padding = edges;
            if (camelProp === "margin") result.margin = edges;
        }
    }

    return result;
}

export function applyInferredStylesToTree(node: SemanticNode, framework: Framework, tokens?: DesignTokenDictionary, metrics?: ContextMetrics, inheritedFontSize?: number): void {
    const classStyles = inferStylesFromClasses(node.classes, framework, tokens, metrics);
    const inlineStyles = node.rawStyles ? parseInlineStyles(node.rawStyles) : {};

    node.inferredStyles = {
        ...classStyles,
        ...inlineStyles,
    };

    let currentFontSize = inheritedFontSize ?? (metrics?.rootFontSize || 16);
    if (node.inferredStyles.fontSize) {
        currentFontSize = toPixels(node.inferredStyles.fontSize, metrics ?? { rootFontSize: 16, devicePixelRatio: 1, viewportWidth: 1920, viewportHeight: 1080 }, { parentFontSize: inheritedFontSize, tokens });
    }

    for (const child of node.children) {
        applyInferredStylesToTree(child, framework, tokens, metrics, currentFontSize);
    }
}
