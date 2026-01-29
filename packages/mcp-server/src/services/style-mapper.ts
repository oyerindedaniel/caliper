import { type InferredStyles, type BoxEdgesString, type SemanticNode, type Framework, type DesignTokenDictionary, type ContextMetrics, DEFAULT_CONTEXT_METRICS } from "@oyerinde/caliper-schema";
import { tokenResolverService } from "./token-resolver-service.js";
import { resolveCalc, toPixels } from "../utils/unit-utils.js";
import {
    SPACING_SCALE,
    FONT_SIZE_SCALE,
    FONT_WEIGHT_MAP,
    BORDER_RADIUS_SCALE,
    LAYOUT_VALUES,
    VIEWPORT_UNITS,
    TAILWIND_COLOR_PALETTE,
    TAILWIND_SHADOW_MAP,
    TAILWIND_DROP_SHADOW_MAP,
    LEADING_SCALE,
    TRACKING_SCALE
} from "../shared/properties.js";
import { parseColor, serializeColor } from "../utils/color-utils.js";


type PartialInferredStyles = Partial<InferredStyles>;

/**
 * Extracts a variable name from Tailwind v3 or v4 syntax.
 * v3: [var(--foo)] or [--foo]
 * v4: (--foo)
 */
function extractVariable(value: string): string | null {
    // v3 Arbitrary with var()
    if (value.startsWith("[var(--") && value.endsWith(")]")) {
        return value.slice(5, -2);
    }
    // v3 Arbitrary shorthand
    if (value.startsWith("[--") && value.endsWith("]")) {
        return value.slice(1, -1);
    }
    // v4 Shorthand
    if (value.startsWith("(--") && value.endsWith(")")) {
        return value.slice(1, -1);
    }
    // Plain var() or --name (for inline styles)
    if (value.startsWith("var(--") && value.endsWith(")")) {
        return value.slice(4, -1);
    }
    if (value.startsWith("--")) {
        return value;
    }
    return null;
}


/**
 * Resolves a value (literal or variable) using the chain:
 * 1. Tokens dictionary
 * 2. Tailwind defaults
 */
const BACKDROP_BLUR_SCALE: Record<string, string> = {
    "none": "blur(0)",
    "xs": "blur(2px)",
    "sm": "blur(4px)",
    "md": "blur(12px)",
    "lg": "blur(16px)",
    "xl": "blur(24px)",
    "2xl": "blur(40px)",
    "3xl": "blur(64px)",
    "DEFAULT": "blur(8px)"
};

function resolveAbsolute(name: string, category: "colors" | "spacing" | "borderRadius", tokens?: DesignTokenDictionary): string | undefined {
    const cleanName = name.startsWith("--") ? name.slice(2) : name;

    // 1. Direct Token Lookup (Preferred and Most Robust)
    if (tokens) {
        const catTokens = tokens[category];
        if (catTokens) {
            const resolved = (catTokens as Record<string, string | number>)[cleanName] || (catTokens as Record<string, string | number>)[name];
            if (resolved !== undefined && resolved !== null) {

                return String(resolved);
            }
        }

        // Fallback to service for complex path resolution
        const options = [cleanName, name, `${category}.${cleanName}`, `${category}.${name}`];
        for (const opt of options) {
            const res = tokenResolverService.resolveToken(tokens, opt);
            if (res) return res;
        }
    }

    // 2. Tailwind Defaults
    let defaultKey = cleanName;
    if (category === "colors" && defaultKey.startsWith("color-")) defaultKey = defaultKey.slice(6);
    let res: string | undefined;
    if (category === "spacing" && defaultKey.startsWith("spacing-")) defaultKey = defaultKey.slice(8);
    if (category === "borderRadius" && defaultKey.startsWith("radius-")) defaultKey = defaultKey.slice(7);

    if (category === "colors") res = TAILWIND_COLOR_PALETTE[defaultKey];
    if (category === "spacing") res = SPACING_SCALE[defaultKey];
    if (category === "borderRadius") res = BORDER_RADIUS_SCALE[defaultKey];

    return res;
}

/**
 * Resolves all var(--name) occurrences in a string.
 */
function resolveVariablesInString(value: string, tokens?: DesignTokenDictionary): string {
    let result = value;
    let iterations = 0;
    while (iterations < 5) {
        let hasChange = false;
        const nextResultSegments: string[] = [];
        let i = 0;

        // 1. Manual deep var() resolution (paren-aware)
        // This handles standard CSS var(--name, fallback) syntax
        while (i < result.length) {
            if (result.startsWith("var(", i)) {
                let depth = 1;
                let j = i + 4;
                while (j < result.length && depth > 0) {
                    if (result[j] === "(") depth++;
                    else if (result[j] === ")") depth--;
                    j++;
                }

                if (depth === 0) {
                    const fullMatch = result.slice(i, j);
                    const content = result.slice(i + 4, j - 1);

                    let commaIdx = -1;
                    let innerDepth = 0;
                    for (let k = 0; k < content.length; k++) {
                        if (content[k] === "(") innerDepth++;
                        else if (content[k] === ")") innerDepth--;
                        else if (content[k] === "," && innerDepth === 0) {
                            commaIdx = k;
                            break;
                        }
                    }

                    let varName = content, fallback: string | undefined;
                    if (commaIdx !== -1) {
                        varName = content.slice(0, commaIdx).trim();
                        fallback = content.slice(commaIdx + 1).trim();
                    } else { varName = content.trim(); }

                    const resolved = resolveAbsolute(varName, "colors", tokens) ||
                        resolveAbsolute(varName, "spacing", tokens) ||
                        resolveAbsolute(varName, "borderRadius", tokens) ||
                        (tokens ? (tokenResolverService.resolveToken(tokens, varName.startsWith("--") ? varName.slice(2) : varName) ||
                            tokenResolverService.resolveToken(tokens, varName)) : undefined);

                    // If resolved, replace the whole var() call. 
                    // If not resolved but we have a fallback, the NEXT iteration will resolve the fallback.
                    const replacement = resolved || (fallback !== undefined ? fallback : undefined);
                    if (replacement !== undefined && replacement !== fullMatch) {
                        nextResultSegments.push(replacement);
                        i = j;
                        hasChange = true;
                        continue;
                    }
                }
            }
            nextResultSegments.push(result[i]!);
            i++;
        }
        result = nextResultSegments.join("");

        // 2. Resolve shorthands (--name) and naked --variables ONLY if they can be resolved
        // Use a more careful boundary check for --variables
        // Ensure shorthand match isn't preceded by 'var'
        let passResult = result;

        // Try shorthands: ( --name )
        passResult = passResult.replace(/(^|[^a-zA-Z0-9_-])\((--[\w-]+)\)/g, (match, prefix, name) => {
            if (prefix.endsWith('var')) return match; // Avoid var(--name) collision

            const resolved = resolveAbsolute(name, "colors", tokens) ||
                resolveAbsolute(name, "spacing", tokens) ||
                resolveAbsolute(name, "borderRadius", tokens) ||
                (tokens ? (tokenResolverService.resolveToken(tokens, name.startsWith("--") ? name.slice(2) : name) ||
                    tokenResolverService.resolveToken(tokens, name)) : undefined);
            if (resolved) {
                hasChange = true;
                return prefix + resolved;
            }
            return match;
        });

        // Try naked variables: --name (with boundary)
        passResult = passResult.replace(/(^|[^\w-])(--[\w-]+)(?![\w-])/g, (match, prefix, name, offset, str) => {
            // Avoid matching inside var() or ( ) shorthand if already processed
            const preceding = str.slice(Math.max(0, offset - 4), offset + prefix.length);
            if (preceding.includes("var(") || preceding.endsWith("(")) return match;

            const resolved = resolveAbsolute(name, "colors", tokens) ||
                resolveAbsolute(name, "spacing", tokens) ||
                resolveAbsolute(name, "borderRadius", tokens) ||
                (tokens ? (tokenResolverService.resolveToken(tokens, name.startsWith("--") ? name.slice(2) : name) ||
                    tokenResolverService.resolveToken(tokens, name)) : undefined);
            if (resolved) {
                hasChange = true;
                return prefix + resolved;
            }
            return match;
        });

        if (!hasChange) break;
        result = passResult;
        iterations++;
    }

    // Final Pass: Wrap any remaining naked --variables in var() if they aren't already
    // This handles unresolvable variables so the output is valid CSS
    const final = result.replace(/(^|[^\w-])(--[\w-]+)(?![\w-])/g, (match, prefix, name, offset, str) => {
        const preceding = str.slice(Math.max(0, offset - 4), offset + prefix.length);
        if (preceding.includes("var(") || (preceding.endsWith("(") && !preceding.includes("calc"))) return match;
        return prefix + `var(${name})`;
    });

    return final;
}

/**
 * Resolves segments of a CSS/Tailwind value (lengths, math) to pixels while preserving structure.
 */
function resolveValueSegments(inner: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): string {
    if (!metrics) return inner;

    const resultSegments: string[] = [];
    let currentToken = "";
    let parenDepth = 0;

    const flushToken = (token: string): string => {
        const t = token.trim();
        if (!t) return token;

        // 1. Math Resolution (Starts with calc/clamp/min/max)
        if (/^-?(?:calc|clamp|min|max)\(/.test(t)) {
            try {
                const val = toPixels(t, metrics, { tokens });
                // Smart Unit Appending: only add 'px' if expression contained a length unit
                const lengthUnits = ["px", "rem", "em", "vh", "vw", "vmin", "vmax", "svh", "svw", "dvh", "dvw", "lvh", "lvw", "pt", "pc", "in", "cm", "mm", "ch", "ex", "cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax", "%"];
                const hasUnit = lengthUnits.some(u => new RegExp(`\\d${u.replace('%', '\\%')}\\b`, 'i').test(t));
                return hasUnit ? `${val}px` : `${val}`;
            } catch (e) {
                return t;
            }
        }

        // 2. Function Arguments (Recursive resolution): blur(2rem), brightness(calc(0.5+0.3)), etc.
        if (t.includes('(')) {
            const firstParen = t.indexOf('(');
            const lastParen = t.lastIndexOf(')');
            if (firstParen !== -1 && lastParen > firstParen) {
                const name = t.slice(0, firstParen);
                const args = t.slice(firstParen + 1, lastParen);
                const rest = t.slice(lastParen + 1);
                return `${name}(${resolveValueSegments(args, tokens, metrics)})${rest}`;
            }
        }

        // 3. Literal Length Resolution: 2rem, 50vh, etc.
        const isLength = /^[-+]?(?:\d+\.?\d*|\.\d+)(px|rem|em|vh|vw|vmin|vmax|svh|svw|dvh|dvw|lvh|lvw|pt|pc|in|cm|mm|ch|ex|cqw|cqh|cqi|cqb|cqmin|cqmax|%)$/i.test(t);

        if (isLength) {
            try {
                const px = toPixels(t, metrics, { tokens });
                return `${px}px`;
            } catch (e) {
                return t;
            }
        }

        // 4. Color Resolution: #fff, rgb(...), oklch(...), and named colors
        // But skip relative color syntax (from) which requires context.
        if (!t.includes('from')) {
            const parsed = parseColor(t);
            // We only resolve if it's a concrete color found by parseColor
            // and NOT just the fallback (alpha: 0). 
            // Also exclude common non-color keywords that might overlap (none, transparent is ok)
            if (!isNaN(parsed.l) && parsed.alpha > 0) {
                return serializeColor(parsed);
            }
            if (t.toLowerCase() === 'transparent') return 'transparent';
        }

        return t;
    };

    for (let i = 0; i < inner.length; i++) {
        const char = inner[i];
        if (char === "(") parenDepth++;
        if (char === ")") parenDepth--;

        const isSeparator = (char === " " || char === "," || char === "\t" || char === "\n") && parenDepth === 0;

        if (isSeparator) {
            resultSegments.push(flushToken(currentToken));
            resultSegments.push(char!); // Preserve original separator
            currentToken = "";
        } else {
            currentToken += char;
        }
    }
    resultSegments.push(flushToken(currentToken));

    return resultSegments.join("");
}

/**
 * Cleans a Tailwind arbitrary value:
 * 1. Strips [ ]
 * 2. Replaces underscores with spaces
 * 3. Strips type hints (e.g. color:, length:)
 * 4. Resolves variables
 */
function cleanArbitraryValue(value: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics, options: { preserveCommas?: boolean } = {}): string {
    if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("(") && value.endsWith(")"))) {
        let inner = value.slice(1, -1);

        // Step 1: Mask underscores inside quotes and url() to protect them
        inner = inner.replace(/('[^']*')|("[^"]*")|(url\((?:[^)(]|\((?:[^)(]+|\([^)(]*\))*\))*\))/g, (match) => {
            return match.replace(/_/g, "\x00UNDERSCORE\x00");
        });

        // Step 2: Replace underscores with spaces (Tailwind syntax), handle escaped underscores
        inner = inner.split("\\_").map(part => part.replace(/_/g, " ")).join("_");

        // Step 3: Unmask protected underscores
        inner = inner.replace(/\x00UNDERSCORE\x00/g, "_");

        // Step 4: Strip type hints (e.g. [color:#fff], [length:10px])
        if (inner.includes(":")) {
            const parts = inner.split(":");
            const possibleHint = parts[0]!.toLowerCase();
            const validHints = ["color", "length", "percentage", "number", "angle", "time", "url", "image"] as const;
            if ((validHints as readonly string[]).includes(possibleHint)) {
                inner = parts.slice(1).join(":");
            }
        }

        // Step 5: Replace top-level commas with spaces (v4 support for [a,b,c])
        const smartInnerSegments: string[] = [];
        let depth = 0;
        for (let i = 0; i < inner.length; i++) {
            const char = inner[i];
            if (char === "(") depth++;
            if (char === ")") depth--;
            if (char === "," && depth === 0 && !options.preserveCommas) {
                smartInnerSegments.push(" ");
            } else {
                smartInnerSegments.push(char!);
            }
        }
        inner = smartInnerSegments.join("");

        // Step 6: Handle v4 shorthand variable syntax (--name) -> var(--name)
        if (value.startsWith("(") && inner.startsWith("--")) {
            inner = `var(${inner})`;
        }

        // 4. Resolve variables in the string
        inner = resolveVariablesInString(inner, tokens);

        // Step 8: Segment-Aware Resolution (Lengths/Math -> Pixels)
        const final = resolveValueSegments(inner, tokens, metrics);
        return final;
    }
    return value;
}

function resolveSpacing(value: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): string | undefined {
    const isNegative = value.startsWith("-");
    const absValue = isNegative ? value.slice(1) : value;

    // 1. Handle Arbitrary Values [10px], [calc(1rem+1px)]
    if ((absValue.startsWith("[") && absValue.endsWith("]")) || (absValue.startsWith("(") && absValue.endsWith(")"))) {
        const cleaned = cleanArbitraryValue(absValue, tokens, metrics);
        return isNegative ? (cleaned.startsWith("-") ? cleaned.slice(1) : `-${cleaned}`) : cleaned;
    }

    // 2. Handle Variables (v3/v4)
    const varName = extractVariable(absValue);
    if (varName) {
        let res = resolveAbsolute(varName, "spacing", tokens);
        if (res) {
            if (metrics) {
                try {
                    const px = toPixels(res, metrics, { tokens });
                    res = `${px}px`;
                } catch (e) { }
            }
            return isNegative ? (res.startsWith("-") ? res.slice(1) : `-${res}`) : res;
        }
        // If not found in spacing, it might be a literal var(--name) that resolveVariablesInString should handle
        const fallback = resolveVariablesInString(absValue, tokens);
        return fallback;
    }

    // 3. Handle calc() directly if not in brackets
    if (absValue.startsWith("calc(") && metrics) {
        const res = `${resolveCalc(absValue, metrics, { tokens })}px`;
        return isNegative ? `calc(-1 * ${res})` : res;
    }

    // 4. Standard Case / Token check
    let resolved = resolveAbsolute(absValue, "spacing", tokens);
    if (resolved) {
        if (metrics) {
            try {
                const px = toPixels(resolved, metrics, { tokens });
                resolved = `${px}px`;
            } catch (e) { }
        }
        return isNegative ? (resolved.startsWith("-") ? resolved.slice(1) : `-${resolved}`) : resolved;
    }

    // 5. Handle Units fallback (attempt toPixels if metrics available)
    if (metrics) {
        try {
            const pixels = toPixels(absValue, metrics, { tokens });
            return isNegative ? `-${pixels}px` : `${pixels}px`;
        } catch (e) {
        }
    }

    // Direct unit fallback if no metrics or toPixels failed
    for (const unit of Object.keys(VIEWPORT_UNITS)) {
        if (absValue.endsWith(unit)) {
            return isNegative ? `calc(-1 * ${absValue})` : absValue;
        }
    }

    return undefined;
}

function resolveColor(value: string, tokens?: DesignTokenDictionary, opacity?: string, metrics?: ContextMetrics): string | undefined {
    let colorPart = value;
    let effectiveOpacity = opacity;

    // Only split by slash if it's not inside balanced parens or brackets (Tailwind v3 vs modern CSS Conflict)
    if (!effectiveOpacity && (value.includes("/") || value.includes("_/"))) {
        let depth = 0;
        let slashIdx = -1;
        for (let i = value.length - 1; i >= 0; i--) {
            const char = value[i];
            if (char === ")" || char === "]") depth++;
            else if (char === "(" || char === "[") depth--;
            else if (char === "/" && depth === 0) {
                slashIdx = i;
                break;
            }
        }
        if (slashIdx !== -1) {
            colorPart = value.slice(0, slashIdx).replace(/_$/, "");
            effectiveOpacity = value.slice(slashIdx + 1);
        }
    }

    let resolvedColor: string | undefined;

    // 1. Handle Variables (v3/v4) - specifically for the primary color part
    const varName = extractVariable(colorPart);

    if (varName) {
        const rawResolved = resolveAbsolute(varName, "colors", tokens) || `var(${varName})`;
        resolvedColor = resolveVariablesInString(rawResolved, tokens);
    }
    // 2. Handle Tailwind Arbitrary Literals [#fff]
    else if (colorPart.startsWith("[") && colorPart.endsWith("]")) {
        resolvedColor = cleanArbitraryValue(colorPart, tokens, metrics);
    }
    // 3. Standard Case / Token check
    else {
        resolvedColor = resolveAbsolute(colorPart, "colors", tokens);
    }

    // 4. Fallback to parseColor check (if literal CSS color)
    if (!resolvedColor) {
        const parsed = parseColor(colorPart);
        if (parsed.alpha !== 0 || ["black", "transparent", "#000", "white"].includes(colorPart.toLowerCase())) {
            resolvedColor = colorPart;
        }
    }

    // 5. If it's an arbitrary value color function (oklch, rgb, hsl, color())
    if (!resolvedColor && (colorPart.startsWith("oklch(") || colorPart.startsWith("rgb(") || colorPart.startsWith("hsl(") || colorPart.startsWith("color("))) {
        resolvedColor = colorPart;
    }

    if (!resolvedColor) return undefined;

    let finalColor = resolvedColor;
    if (effectiveOpacity) {
        const opValue = parseFloat(effectiveOpacity);
        const opPercent = (opValue <= 1 && effectiveOpacity.includes(".")) ? (opValue * 100) : (effectiveOpacity.endsWith("%") ? parseFloat(effectiveOpacity) : opValue);

        const parsedBase = parseColor(resolvedColor);
        parsedBase.alpha *= (opPercent / 100);
        finalColor = serializeColor(parsedBase);
    } else if ((finalColor.includes("(") || finalColor.startsWith("#")) && !finalColor.includes("from")) {
        // Evaluate any hex, rgb, oklch, or color-mix into standard computed rgb/rgba
        // But skip relative color syntax (from) which requires context we don't have
        const parsed = parseColor(finalColor);
        if (!isNaN(parsed.l)) {
            finalColor = serializeColor(parsed);
        }
    }

    return finalColor;
}



function extractValue(className: string, prefix: string): string | null {
    if (className.startsWith(prefix)) {
        return className.slice(prefix.length);
    }
    if (className.startsWith("-") && className.slice(1).startsWith(prefix)) {
        return `-${className.slice(prefix.length + 1)}`;
    }
    return null;
}

/**
 * Splits a box-shadow string by comma, correctly ignoring commas inside functions (rgb, var, calc, etc.)
 */
function splitShadows(value: string): string[] {
    const result: string[] = [];
    let current = "";
    let parenCount = 0;
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (char === "(") parenCount++;
        if (char === ")") parenCount--;
        if (char === "," && parenCount === 0) {
            result.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }
    if (current) result.push(current.trim());
    return result.filter(Boolean);
}

/**
 * Parentheses-aware helper to remove colors (hex, rgb, named) from a CSS string.
 */
function stripColors(value: string): string {
    // 1. Remove color functions: rgb(), rgba(), hsl(), hsla(), etc.
    // We use a manual loop to handle nested parentheses.
    let result = "";
    let i = 0;
    while (i < value.length) {
        // Check if we are at the start of a color function
        const match = value.slice(i).match(/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
        if (match) {
            i += match[0].length;
            let depth = 1;
            while (depth > 0 && i < value.length) {
                if (value[i] === "(") depth++;
                else if (value[i] === ")") depth--;
                i++;
            }
            continue;
        }

        // Hex colors
        const hexMatch = value.slice(i).match(/^#[a-fA-F0-9]{3,8}\b/i);
        if (hexMatch) {
            i += hexMatch[0].length;
            continue;
        }

        result += value[i];
        i++;
    }

    // 2. Remove named colors (only as separate words)
    const colorNames = [
        "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow", "yellowgreen"
    ];
    const nameRegex = new RegExp(`\\b(?:${colorNames.join("|")})\\b`, "gi");

    return result.replace(nameRegex, "").replace(/\s+/g, " ").trim();
}

/**
 * Re-colors a shadow string by injecting a new color.
 */
function recolorShadow(shadow: string, color: string): string {
    const shadows = splitShadows(shadow);
    return shadows.map(s => {
        const isInset = s.toLowerCase().includes("inset");
        const cleanBase = stripColors(s.replace(/\binset\b/gi, "").trim());
        return `${isInset ? "inset " : ""}${cleanBase} ${color}`.trim();
    }).join(", ");
}

/**
 * Re-colors a drop-shadow filter string by injecting a new color.
 */
function recolorDropShadow(filter: string, color: string): string {
    // We split by "drop-shadow(" and handle each part
    const parts = filter.split(/drop-shadow\(/gi);
    const resultParts: string[] = [];

    // The first part is usually empty or whitespace if it starts with drop-shadow
    if (parts[0]?.trim()) resultParts.push(parts[0]);

    for (let i = 1; i < parts.length; i++) {
        const part = parts[i]!;
        // Find the balanced closing paren
        let depth = 1;
        let j = 0;
        while (depth > 0 && j < part.length) {
            if (part[j] === "(") depth++;
            else if (part[j] === ")") depth--;
            j++;
        }

        const content = part.slice(0, j - 1);
        const rest = part.slice(j);

        const cleanBase = stripColors(content);
        resultParts.push(`drop-shadow(${cleanBase} ${color})${rest}`);
    }

    return resultParts.join("");
}



function createBoxEdges(top?: string, right?: string, bottom?: string, left?: string): Partial<BoxEdgesString> {
    const result: Partial<BoxEdgesString> = {};
    if (top !== undefined) result.top = top;
    if (right !== undefined) result.right = right;
    if (bottom !== undefined) result.bottom = bottom;
    if (left !== undefined) result.left = left;
    return result;
}

function parseBoxEdgesClass(className: string, prefix: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): Partial<BoxEdgesString> | null {
    const value = extractValue(className, prefix);
    if (!value) return null;
    const resolved = resolveSpacing(value, tokens, metrics);
    if (!resolved) return null;

    // Handle multi-value arbitrary inputs (e.g. p-[1vh_2vw])
    // Use paren-aware split
    const values: string[] = [];
    let current = "";
    let pDepth = 0;
    for (let i = 0; i < resolved.length; i++) {
        const char = resolved[i];
        if (char === "(") pDepth++;
        if (char === ")") pDepth--;
        if ((char === " " || char === ",") && pDepth === 0) {
            if (current) values.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    if (current) values.push(current);

    if (values.length > 1 && (prefix === "p-" || prefix === "m-" || prefix === "-m-")) {
        let top, right, bottom, left;
        if (values.length === 2) {
            top = bottom = values[0];
            right = left = values[1];
        } else if (values.length === 3) {
            top = values[0];
            right = left = values[1];
            bottom = values[2];
        } else if (values.length >= 4) {
            top = values[0];
            right = values[1];
            bottom = values[2];
            left = values[3];
        }
        return createBoxEdges(top, right, bottom, left);
    }

    const val = values[0] || resolved;
    if (prefix.includes("x-")) return createBoxEdges(undefined, val, undefined, val);
    if (prefix.includes("y-")) return createBoxEdges(val, undefined, val, undefined);
    if (prefix.includes("t-")) return createBoxEdges(val, undefined, undefined, undefined);
    if (prefix.includes("r-")) return createBoxEdges(undefined, val, undefined, undefined);
    if (prefix.includes("b-")) return createBoxEdges(undefined, undefined, val, undefined);
    if (prefix.includes("l-")) return createBoxEdges(undefined, undefined, undefined, val);

    return createBoxEdges(val, val, val, val);
}

function parsePaddingClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const prefixes = ["p-", "px-", "py-", "pt-", "pr-", "pb-", "pl-"];
    for (const prefix of prefixes) {
        const edges = parseBoxEdgesClass(className, prefix, tokens, metrics);
        if (edges) return { padding: edges as BoxEdgesString };
    }
    return null;
}

function parseMarginClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const prefixes = ["m-", "mx-", "my-", "mt-", "mr-", "mb-", "ml-", "-m-", "-mx-", "-my-", "-mt-", "-mr-", "-mb-", "-ml-"];
    for (const prefix of prefixes) {
        const edges = parseBoxEdgesClass(className, prefix, tokens, metrics);
        if (edges) return { margin: edges as BoxEdgesString };
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

    if (tokens && tokens.typography[value]) {
        const def = tokens.typography[value]!;
        return {
            fontSize: `${def.fontSize}px`,
            fontWeight: String(def.fontWeight),
            fontFamily: def.fontFamily,
            lineHeight: def.lineHeight !== undefined ? `${def.lineHeight}px` : undefined,
            letterSpacing: def.letterSpacing !== undefined ? `${def.letterSpacing}px` : undefined,
        };
    }

    const scaleValue = FONT_SIZE_SCALE[value];
    if (scaleValue) return { fontSize: scaleValue };

    // Don't call resolveSpacing here - if it's not a known font size, return null
    // so the text color parser can handle it
    return null;
}


function parseLineHeightClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, "leading-");
    if (!value) return null;
    if (LEADING_SCALE[value]) return { lineHeight: LEADING_SCALE[value] };

    const spacing = resolveSpacing(value, tokens, metrics);
    if (spacing) return { lineHeight: spacing };

    return null;
}

function parseLetterSpacingClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, "tracking-");
    if (!value) return null;
    if (TRACKING_SCALE[value]) return { letterSpacing: TRACKING_SCALE[value] };

    // Resolve spacing (arbitrary or tokens) for tracking
    const resolved = resolveSpacing(value, tokens, metrics);
    if (resolved) return { letterSpacing: resolved };

    return null;
}

function parseFontWeightClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, "font-");
    if (!value) return null;
    if (FONT_WEIGHT_MAP[value]) return { fontWeight: FONT_WEIGHT_MAP[value] };

    // Arbitrary weight font-[700]
    if (value.startsWith("[") || value.startsWith("(")) {
        return { fontWeight: cleanArbitraryValue(value, tokens, metrics) };
    }

    return null;
}

function parseBorderRadiusClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = className === "rounded" ? "" : extractValue(className, "rounded-");
    if (value === null) return null;

    // 1. Handle Variables (v3/v4) or Arbitrary
    if (value.startsWith("[") || value.startsWith("(")) {
        return { borderRadius: cleanArbitraryValue(value, tokens, metrics) };
    }

    const varName = extractVariable(value);
    if (varName) {
        const resolved = resolveAbsolute(varName, "borderRadius", tokens);
        if (resolved) return { borderRadius: resolved };
        return { borderRadius: `var(${varName})` };
    }

    // 2. Standard Case / Token check
    const resolved = resolveAbsolute(value, "borderRadius", tokens);
    if (resolved) return { borderRadius: resolved };

    // 3. v4 numeric shorthand (rounded-12)
    if (/^\d+(\.\d+)?$/.test(value)) {
        return { borderRadius: `${value}px` };
    }

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

function parseNumericUtility(className: string, prefix: string, prop: keyof InferredStyles, factor: number = 1, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, prefix);
    if (!value) return null;

    // Support arbitrary values [0.5], [var(--op)], [calc(10/20)]
    let rawValue = value;
    let actualFactor = factor;
    if (value.startsWith("[") || value.startsWith("(")) {
        rawValue = cleanArbitraryValue(value, tokens, metrics);
        actualFactor = 1; // Arbitrary values are already decimals or percentages
    }

    // Percentage handling
    if (rawValue.endsWith("%")) {
        const num = parseFloat(rawValue.slice(0, -1));
        if (!isNaN(num)) return { [prop]: num / 100 };
    }

    const num = parseFloat(rawValue);
    if (!isNaN(num)) return { [prop]: num / actualFactor };

    return null;
}

function parseOpacityClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    return parseNumericUtility(className, "opacity-", "opacity", 100, tokens, metrics);
}

function parseZIndexClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    return parseNumericUtility(className, "z-", "zIndex", 1, tokens, metrics);
}

function parseSpecificOpacityClass(className: string, prefix: string): PartialInferredStyles | null {

    const value = extractValue(className, prefix);
    if (!value) return null;
    const num = parseInt(value, 10);
    if (isNaN(num)) return null;

    // Return a marker that inferStylesFromClasses will use to merge
    const prop = prefix.startsWith("bg-") ? "backgroundColor" : (prefix.startsWith("text-") ? "color" : "borderColor");
    return { [prop]: `__OPACITY__:${num}` };
}


function parseColorUtility(className: string, prefix: string, prop: keyof InferredStyles, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, prefix);
    if (!value) return null;

    const resolved = resolveColor(value, tokens, undefined, metrics);
    if (resolved) return { [prop]: resolved };
    return null;
}

function parseBackgroundColorClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    return parseColorUtility(className, "bg-", "backgroundColor", tokens, metrics);
}

function parseTextColorClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, "text-");
    if (!value || FONT_SIZE_SCALE[value]) return null;
    return parseColorUtility(className, "text-", "color", tokens, metrics);
}

function parseBorderColorClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, "border-");
    if (!value || /^\d+|[trblxy]$/.test(value)) return null;
    return parseColorUtility(className, "border-", "borderColor", tokens, metrics);
}

function parseOutlineColorClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, "outline-");
    if (!value || /^\d+|none$/.test(value)) return null;
    return parseColorUtility(className, "outline-", "outlineColor", tokens, metrics);
}

function parseShadowClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const shadowValue = extractValue(className, "shadow-") ?? (className === "shadow" ? "" : null);

    if (className === "shadow-none") return { boxShadow: "none" };

    // 1. Handle Variables (v3/v4 shorthand) or Arbitrary
    if (className.startsWith("shadow-[")) {
        const cleaned = cleanArbitraryValue(className.slice(7), tokens, metrics, { preserveCommas: true });
        // Normalize spacing (splitShadows will work now because commas are preserved)
        const normalized = splitShadows(cleaned).join(", ");
        return { boxShadow: normalized };
    }

    const varName = extractVariable(shadowValue || "");
    if (varName) {
        const resolved = resolveAbsolute(varName, "colors", tokens) ||
            resolveAbsolute(varName, "spacing", tokens);
        if (resolved) return { boxShadow: resolved };
        return { boxShadow: `var(${varName})` };
    }

    // 2. Standard Shadow Mapping (Precise)
    if (shadowValue !== null && TAILWIND_SHADOW_MAP[shadowValue] !== undefined) {
        return { boxShadow: TAILWIND_SHADOW_MAP[shadowValue] };
    }

    // 4. Shadow Color shadow-red-500
    if (className.startsWith("shadow-")) {
        const value = className.slice(7);
        const resolved = resolveColor(value, tokens, undefined, metrics);
        if (resolved) {
            return { boxShadow: `__COLOR__:${resolved}` };
        }
    }

    return null;
}



function parseDropShadowClass(className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): PartialInferredStyles | null {
    const value = extractValue(className, "drop-shadow-") ?? (className === "drop-shadow" ? "" : null);
    if (value === null) return null;

    // 1. Handle Variables (v3/v4) or Arbitrary
    if (className.startsWith("drop-shadow-[")) {
        const cleaned = cleanArbitraryValue(className.slice(12), tokens, metrics, { preserveCommas: true });
        // Normalize: each layer should be wrapped in drop-shadow()
        const normalized = splitShadows(cleaned)
            .map(s => `drop-shadow(${s.trim()})`)
            .join(" ");
        return { filter: normalized };
    }

    const varName = extractVariable(value);
    if (varName) {
        const resolved = resolveAbsolute(varName, "colors", tokens); // Usually a color or filter var
        if (resolved) return { filter: `drop-shadow(${resolved})` };
        return { filter: `drop-shadow(var(${varName}))` };
    }

    // 2. Precise Standard Mapping
    if (TAILWIND_DROP_SHADOW_MAP[value] !== undefined) {
        return { filter: TAILWIND_DROP_SHADOW_MAP[value] };
    }

    // 4. Color check
    const color = resolveColor(value, tokens, undefined, metrics);
    if (color) {
        return { filter: `__COLOR__:${color}` };
    }
    return null;
}

type ParserFn = (className: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics) => PartialInferredStyles | null;

const PREFIX_PARSERS: Record<string, ParserFn> = {
    "p-": parsePaddingClass, "px-": parsePaddingClass, "py-": parsePaddingClass, "pt-": parsePaddingClass, "pr-": parsePaddingClass, "pb-": parsePaddingClass, "pl-": parsePaddingClass,
    "m-": parseMarginClass, "mx-": parseMarginClass, "my-": parseMarginClass, "mt-": parseMarginClass, "mr-": parseMarginClass, "mb-": parseMarginClass, "ml-": parseMarginClass,
    "gap-": parseGapClass,
    "text-": (className, tokens, metrics) => parseFontSizeClass(className, tokens, metrics) || parseTextColorClass(className, tokens, metrics),
    "font-": parseFontWeightClass,
    "rounded": parseBorderRadiusClass,
    "rounded-": parseBorderRadiusClass,
    "w-": parseWidthClass,
    "h-": parseHeightClass,
    "opacity-": parseOpacityClass,
    "bg-opacity-": (className, tokens, metrics) => parseSpecificOpacityClass(className, "bg-opacity-"),
    "text-opacity-": (className, tokens, metrics) => parseSpecificOpacityClass(className, "text-opacity-"),
    "border-opacity-": (className, tokens, metrics) => parseSpecificOpacityClass(className, "border-opacity-"),
    "z-": parseZIndexClass,

    "shadow": parseShadowClass,
    "shadow-": parseShadowClass,
    "-m-": parseMarginClass,
    "-mx-": parseMarginClass,
    "-my-": parseMarginClass,
    "-mt-": parseMarginClass,
    "-mr-": parseMarginClass,
    "-mb-": parseMarginClass,
    "-ml-": parseMarginClass,
    "leading-": parseLineHeightClass,
    "tracking-": parseLetterSpacingClass,
    "bg-": (className, tokens, metrics) => {
        const val = extractValue(className, "bg-");
        if (val?.startsWith("[") && val.includes("url")) {
            return { backgroundImage: cleanArbitraryValue(val, tokens, metrics) };
        }
        return parseBackgroundColorClass(className, tokens, metrics);
    },
    "content-": (className, tokens, metrics) => {
        const val = extractValue(className, "content-");
        if (val?.startsWith("[")) return { content: cleanArbitraryValue(val, tokens, metrics) };
        return null;
    },
    "border-": parseBorderColorClass,
    "outline-": parseOutlineColorClass,
    "drop-shadow": parseDropShadowClass,
    "drop-shadow-": parseDropShadowClass,
    "grid-cols-": (className, tokens, metrics) => {
        const val = extractValue(className, "grid-cols-");
        if (!val) return null;
        if (val.startsWith("[") || val.startsWith("(")) return { gridTemplateColumns: cleanArbitraryValue(val, tokens, metrics) };
        if (val === "none") return { gridTemplateColumns: "none" };
        if (val === "subgrid") return { gridTemplateColumns: "subgrid" };
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 1 && num <= 12) return { gridTemplateColumns: `repeat(${num}, minmax(0, 1fr))` };
        return null;
    },
    "grid-rows-": (className, tokens, metrics) => {
        const val = extractValue(className, "grid-rows-");
        if (!val) return null;
        if (val.startsWith("[") || val.startsWith("(")) return { gridTemplateRows: cleanArbitraryValue(val, tokens, metrics) };
        if (val === "none") return { gridTemplateRows: "none" };
        if (val === "subgrid") return { gridTemplateRows: "subgrid" };
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 1 && num <= 12) return { gridTemplateRows: `repeat(${num}, minmax(0, 1fr))` };
        return null;
    },
    "blur-": (className, tokens, metrics) => ({ filter: `blur(${cleanArbitraryValue(extractValue(className, "blur-") || "", tokens, metrics)})` }),
    "backdrop-": (className, tokens, metrics) => {
        const val = extractValue(className, "backdrop-");
        if (!val) return null;
        // Handle backdrop-blur-md, backdrop-blur-[...], backdrop-blur-(...)
        if (val.startsWith("blur")) {
            const blurVal = val.startsWith("blur-") ? val.slice(5) : (val === "blur" ? "DEFAULT" : null);
            if (blurVal) {
                if (blurVal.startsWith("[") || blurVal.startsWith("(")) {
                    // Pass wrapper chars to cleanArbitraryValue so it can do variable resolution
                    return { backdropFilter: `blur(${cleanArbitraryValue(blurVal, tokens, metrics)})` };
                }
                const scaleValue = BACKDROP_BLUR_SCALE[blurVal];
                if (scaleValue) return { backdropFilter: scaleValue };
            }
        }
        // Handle general backdrop-[...] or backdrop-(...)
        if (val.startsWith("[") || val.startsWith("(")) {
            return { backdropFilter: cleanArbitraryValue(val, tokens, metrics) };
        }
        return null;
    },
    "filter-": (className, tokens, metrics) => {
        const val = extractValue(className, "filter-");
        if (val?.startsWith("[") || val?.startsWith("(")) {
            return { filter: cleanArbitraryValue(val, tokens, metrics) };
        }
        return null;
    }
};

const STATIC_PARSERS: Record<string, PartialInferredStyles> = {
    ...(LAYOUT_VALUES.display ? Object.entries(LAYOUT_VALUES.display).reduce((acc, [k, v]) => ({ ...acc, [k]: { display: v } }), {}) : {}),
    ...(LAYOUT_VALUES.position ? Object.entries(LAYOUT_VALUES.position).reduce((acc, [k, v]) => ({ ...acc, [k]: { position: v } }), {}) : {}),
    ...(LAYOUT_VALUES.boxSizing ? Object.entries(LAYOUT_VALUES.boxSizing).reduce((acc, [k, v]) => ({ ...acc, [k]: { boxSizing: v } }), {}) : {}),
    ...(LAYOUT_VALUES.flexDirection ? Object.entries(LAYOUT_VALUES.flexDirection).reduce((acc, [k, v]) => ({ ...acc, [k]: { flexDirection: v } }), {}) : {}),
    ...(LAYOUT_VALUES.justifyContent ? Object.entries(LAYOUT_VALUES.justifyContent).reduce((acc, [k, v]) => ({ ...acc, [k]: { justifyContent: v } }), {}) : {}),
    ...(LAYOUT_VALUES.alignItems ? Object.entries(LAYOUT_VALUES.alignItems).reduce((acc, [k, v]) => ({ ...acc, [k]: { alignItems: v } }), {}) : {}),
    ...(LAYOUT_VALUES.overflow ? Object.entries(LAYOUT_VALUES.overflow).reduce((acc, [k, v]) => ({ ...acc, [k]: { overflow: v } }), {}) : {}),
    ...(LAYOUT_VALUES.overflowX ? Object.entries(LAYOUT_VALUES.overflowX).reduce((acc, [k, v]) => ({ ...acc, [k]: { overflowX: v } }), {}) : {}),
    ...(LAYOUT_VALUES.overflowY ? Object.entries(LAYOUT_VALUES.overflowY).reduce((acc, [k, v]) => ({ ...acc, [k]: { overflowY: v } }), {}) : {}),
};

type TrieNode = {
    children: Record<string, TrieNode>;
    prefix?: string;
};

const PREFIX_TRIE: TrieNode = { children: {} };

// Build Trie from PREFIX_PARSERS keys
for (const p of Object.keys(PREFIX_PARSERS)) {
    let node = PREFIX_TRIE;
    for (const char of p) {
        if (!node.children[char]) node.children[char] = { children: {} };
        node = node.children[char]!;
    }
    node.prefix = p;
}

/**
 * Finds the longest matching prefix for a utility class.
 */
function findLongestPrefix(name: string): string | null {
    let node = PREFIX_TRIE;
    let longest: string | null = null;
    for (const char of name) {
        if (node.children[char]) {
            node = node.children[char]!;
            if (node.prefix) longest = node.prefix;
        } else break;
    }
    return longest;
}

const CLASS_STYLE_CACHE = new Map<string, PartialInferredStyles>();

export function clearStyleCache(): void {
    CLASS_STYLE_CACHE.clear();
}

export function inferStylesFromClasses(classes: string[], framework: Framework, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): InferredStyles {
    // Default to standard metrics if not provided
    const effectiveMetrics = metrics ?? DEFAULT_CONTEXT_METRICS;

    if (!framework.endsWith("-tailwind")) {
        return {};
    }

    const result: InferredStyles = {};
    const importantProps = new Set<string>();

    let pendingShadowColor: string | null = null;
    let baseShadow: string | null = null;
    let pendingDropShadowColor: string | null = null;
    let baseDropShadow: string | null = null;

    // v3 Opacity Merging
    let bgOpacity: number | null = null;
    let textOpacity: number | null = null;
    let borderOpacity: number | null = null;

    const tokensHash = tokens ? JSON.stringify(tokens) : "";
    const metricsHash = metrics?.rootFontSize ?? DEFAULT_CONTEXT_METRICS.rootFontSize;

    for (let className of classes) {
        let isImportant = false;

        // Handle Tailwind important modifier (v3: !prefix, v4: postfix!)
        if (className.startsWith("!")) {
            isImportant = true;
            className = className.slice(1);
        } else if (className.endsWith("!")) {
            isImportant = true;
            className = className.slice(0, -1);
        }

        const cacheKey = `${className}|${framework}|${metricsHash}|${tokensHash}`;

        let parsed: PartialInferredStyles | null = null;
        if (CLASS_STYLE_CACHE.has(cacheKey)) {
            parsed = CLASS_STYLE_CACHE.get(cacheKey)!;
        } else if (STATIC_PARSERS[className]) {
            parsed = STATIC_PARSERS[className]!;
            CLASS_STYLE_CACHE.set(cacheKey, parsed);
        } else {
            const isNegative = className.startsWith("-");
            const searchName = isNegative ? className.slice(1) : className;
            const foundPrefix = findLongestPrefix(searchName);

            const parser = foundPrefix ? PREFIX_PARSERS[foundPrefix] : PREFIX_PARSERS[className];
            if (parser) {
                parsed = parser(className, tokens, effectiveMetrics);
                if (parsed) CLASS_STYLE_CACHE.set(cacheKey, parsed);
            }

            // Generic arbitrary properties [prop:value]
            if (!parsed && className.startsWith("[") && className.endsWith("]") && className.includes(":")) {
                const cleaned = cleanArbitraryValue(className, tokens);
                const colonIndex = cleaned.indexOf(":");
                if (colonIndex > 0) {
                    const prop = cleaned.slice(0, colonIndex);
                    const val = cleaned.slice(colonIndex + 1);
                    //  CamelCase: no regex if no hyphens
                    const camelProp = prop.includes("-")
                        ? prop.replace(/-([a-z])/g, (_, p1) => p1.toUpperCase())
                        : prop;
                    parsed = { [camelProp]: val };
                    CLASS_STYLE_CACHE.set(cacheKey, parsed);
                }
            }
        }

        if (parsed) {
            const { boxShadow, padding, margin, filter, ...restProps } = parsed;

            // Handle v3 Opacity Markers
            if (restProps.backgroundColor?.startsWith("__OPACITY__:")) {
                if (!(importantProps.has("backgroundColor") && !isImportant)) {
                    bgOpacity = parseInt(restProps.backgroundColor.slice(12), 10);
                }
                delete restProps.backgroundColor;
            }
            if (restProps.color?.startsWith("__OPACITY__:")) {
                if (!(importantProps.has("color") && !isImportant)) {
                    textOpacity = parseInt(restProps.color.slice(12), 10);
                }
                delete restProps.color;
            }
            if (restProps.borderColor?.startsWith("__OPACITY__:")) {
                if (!(importantProps.has("borderColor") && !isImportant)) {
                    borderOpacity = parseInt(restProps.borderColor.slice(12), 10);
                }
                delete restProps.borderColor;
            }

            // Assign remaining standard properties
            for (const [prop, val] of Object.entries(restProps)) {
                if (importantProps.has(prop) && !isImportant) continue;
                if (isImportant) importantProps.add(prop);
                (result as Record<string, unknown>)[prop] = val;
            }

            // Merge Directional properties
            if (padding) {
                if (!result.padding) {
                    result.padding = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
                }
                const p = padding as BoxEdgesString;
                for (const edge of Object.keys(p) as (keyof BoxEdgesString)[]) {
                    const fullProp = `padding.${edge}`;
                    if (importantProps.has(fullProp) && !isImportant) continue;
                    if (isImportant) importantProps.add(fullProp);
                    result.padding[edge] = p[edge];
                }
            }
            if (margin) {
                if (!result.margin) {
                    result.margin = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
                }
                const m = margin as BoxEdgesString;
                for (const edge of Object.keys(m) as (keyof BoxEdgesString)[]) {
                    const fullProp = `margin.${edge}`;
                    if (importantProps.has(fullProp) && !isImportant) continue;
                    if (isImportant) importantProps.add(fullProp);
                    result.margin[edge] = m[edge];
                }
            }

            // Track shadow and filter components
            if (boxShadow) {
                if (!(importantProps.has("boxShadow") && !isImportant)) {
                    if (isImportant) importantProps.add("boxShadow");
                    if (boxShadow.startsWith("__COLOR__:")) {
                        pendingShadowColor = boxShadow.slice(10);
                    } else if (boxShadow === "none") {
                        baseShadow = "none";
                    } else {
                        baseShadow = boxShadow;
                    }
                }
            }

            if (filter) {
                if (!(importantProps.has("filter") && !isImportant)) {
                    if (isImportant) importantProps.add("filter");
                    if (filter.startsWith("__COLOR__:")) {
                        pendingDropShadowColor = filter.slice(10);
                    } else if (filter === "none") {
                        baseDropShadow = "none";
                    } else {
                        baseDropShadow = filter;
                    }
                }
            }
        }
    }

    if (baseShadow) {
        if (baseShadow === "none") {
            result.boxShadow = "none";
        } else if (pendingShadowColor) {
            result.boxShadow = recolorShadow(baseShadow, pendingShadowColor);
        } else {
            result.boxShadow = baseShadow;
        }
    } else if (pendingShadowColor) {
        const defaultBase = TAILWIND_SHADOW_MAP[""];
        result.boxShadow = recolorShadow(defaultBase as string, pendingShadowColor as string);
    }

    if (baseDropShadow) {
        if (baseDropShadow === "none") {
            result.filter = "none";
        } else if (pendingDropShadowColor) {
            result.filter = recolorDropShadow(baseDropShadow, pendingDropShadowColor);
        } else {
            result.filter = baseDropShadow;
        }
    } else if (pendingDropShadowColor) {
        const defaultBase = TAILWIND_DROP_SHADOW_MAP[""];
        result.filter = recolorDropShadow(defaultBase as string, pendingDropShadowColor as string);
    }

    // Apply v3 Opacities
    if (bgOpacity !== null && result.backgroundColor) {
        const parsed = parseColor(result.backgroundColor);
        parsed.alpha *= (bgOpacity / 100);
        result.backgroundColor = serializeColor(parsed);
    }
    if (textOpacity !== null && result.color) {
        const parsed = parseColor(result.color);
        parsed.alpha *= (textOpacity / 100);
        result.color = serializeColor(parsed);
    }
    if (borderOpacity !== null && result.borderColor) {
        const parsed = parseColor(result.borderColor);
        parsed.alpha *= (borderOpacity / 100);
        result.borderColor = serializeColor(parsed);
    }
    return result;
}

export function parseInlineStyles(styleString: string, tokens?: DesignTokenDictionary, metrics?: ContextMetrics): InferredStyles {
    const effectiveMetrics = metrics ?? DEFAULT_CONTEXT_METRICS;
    const result: InferredStyles = {};
    const declarations = styleString.split(";").filter(Boolean);
    const importantSet = new Set<string>();

    for (const decl of declarations) {
        const [prop, rawValue] = decl.split(":").map(segment => segment.trim());
        if (!prop || !rawValue) continue;

        let value = resolveVariablesInString(rawValue, tokens);
        value = resolveValueSegments(value, tokens, effectiveMetrics);
        let isImportant = false;

        // Strip !important if present
        if (value.toLowerCase().includes("!important")) {
            value = value.replace(/\s*!important\s*$/i, "").trim();
            isImportant = true;
        }

        const camelProp = prop.replace(/-([a-z])/g, match => match[1]!.toUpperCase());

        // Priority Logic: 
        // 1. Regular declarations overwrite regular ones (default).
        // 2. !important declaration overwrites regular ones.
        // 3. !important declaration overwrites previous !important ones.
        // 4. Regular declaration CANNOT overwrite an !important one.
        if (importantSet.has(camelProp) && !isImportant) continue;
        if (isImportant) importantSet.add(camelProp);

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

        const stringProps = ["justifyContent", "alignItems", "gap", "fontSize", "fontWeight", "borderRadius", "backgroundColor", "color", "width", "height", "boxShadow", "outline", "letterSpacing", "filter", "backdropFilter", "transform", "gridTemplateColumns", "gridTemplateRows"] as const;

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
            const parts: string[] = [];
            let current = "";
            let pDepth = 0;
            for (let i = 0; i < value.length; i++) {
                const char = value[i];
                if (char === "(") pDepth++;
                if (char === ")") pDepth--;
                if (char === " " && pDepth === 0) {
                    if (current) parts.push(current);
                    current = "";
                } else {
                    current += char;
                }
            }
            if (current) parts.push(current);

            const edges: BoxEdgesString = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
            if (parts.length === 1) {
                edges.top = edges.right = edges.bottom = edges.left = parts[0]!;
            } else if (parts.length === 2) {
                edges.top = edges.bottom = parts[0]!;
                edges.right = edges.left = parts[1]!;
            } else if (parts.length === 3) {
                edges.top = parts[0]!;
                edges.right = edges.left = parts[1]!;
                edges.bottom = parts[2]!;
            } else if (parts.length === 4) {
                edges.top = parts[0]!;
                edges.right = parts[1]!;
                edges.bottom = parts[2]!;
                edges.left = parts[3]!;
            }

            if (camelProp === "padding") result.padding = edges;
            if (camelProp === "margin") result.margin = edges;
            continue;
        }

        // Handle individual edges (marginTop, paddingRight, etc.)
        const edgeMatch = camelProp.match(/^(padding|margin)(Top|Right|Bottom|Left)$/);
        if (edgeMatch) {
            const key = edgeMatch[1] as "padding" | "margin";
            const edge = edgeMatch[2]!.toLowerCase() as keyof BoxEdgesString;
            if (!result[key]) {
                result[key] = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
            }
            result[key]![edge] = value;
            continue;
        }
    }

    return result;
}

export function applyInferredStylesToTree(node: SemanticNode, framework: Framework, tokens?: DesignTokenDictionary, metrics?: ContextMetrics, inheritedFontSize?: number): void {
    const classStyles = inferStylesFromClasses(node.classes, framework, tokens, metrics);
    const inlineStyles = node.rawStyles ? parseInlineStyles(node.rawStyles, tokens) : {};


    node.inferredStyles = {
        ...classStyles,
        ...inlineStyles,
    };

    let currentFontSize = inheritedFontSize ?? (metrics?.rootFontSize || DEFAULT_CONTEXT_METRICS.rootFontSize);
    if (node.inferredStyles.fontSize) {
        currentFontSize = toPixels(node.inferredStyles.fontSize, metrics ?? { rootFontSize: 16, devicePixelRatio: 1, viewportWidth: 1920, viewportHeight: 1080 }, { parentFontSize: inheritedFontSize, tokens });
    }

    for (const child of node.children) {
        applyInferredStylesToTree(child, framework, tokens, metrics, currentFontSize);
    }
}
