import type { ContextMetrics, DesignTokenDictionary } from "@oyerinde/caliper-schema";

const PHYSICAL_UNITS: Record<string, number> = {
    "pt": 4 / 3, // 1pt = 1.333px
    "pc": 16,     // 1pc = 16px
    "in": 96,     // 1in = 96px
    "cm": 96 / 2.54,
    "mm": 96 / 25.4,
};

/**
 * Resolves a CSS value to absolute pixels.
 */
export function toPixels(
    value: string,
    context: ContextMetrics,
    options: CalcOptions = {}
): number {
    const trimmed = value.trim().toLowerCase();

    // 1. Handle calc(), clamp(), min(), max()
    const mathFunctions = ["calc(", "clamp(", "min(", "max("];
    if (mathFunctions.some(mathFunction => trimmed.startsWith(mathFunction))) {
        return resolveCalc(trimmed, context, options);
    }

    // 2. Handle var(--token-name) or var(--token-name, fallback)
    if (trimmed.startsWith("var(--") && trimmed.endsWith(")") && options.tokens) {
        const content = trimmed.slice(4, -1); // "--token-name" or "--token-name, fallback"
        const commaIdx = content.indexOf(",");
        const tokenPart = commaIdx !== -1 ? content.slice(0, commaIdx).trim() : content.trim();
        const fallbackPart = commaIdx !== -1 ? content.slice(commaIdx + 1).trim() : undefined;

        const tokenName = tokenPart.startsWith("--") ? tokenPart.slice(2) : tokenPart;

        const visited = options.visited ?? new Set<string>();
        if (visited.has(tokenName)) return 0;

        visited.add(tokenName);
        const newOptions = { ...options, visited };

        const resolved = options.tokens.spacing[tokenName] ||
            options.tokens.borderRadius[tokenName] ||
            options.tokens.colors[tokenName] ||
            (options.tokens.typography[tokenName] ? `${options.tokens.typography[tokenName]!.fontSize}px` : undefined);

        if (resolved) {
            const result = toPixels(resolved, context, newOptions);
            visited.delete(tokenName);
            return result;
        }

        visited.delete(tokenName);

        if (fallbackPart) {
            return toPixels(fallbackPart, context, options);
        }

        return 0;
    }

    // 3. Handle simple numeric values
    const num = parseFloat(trimmed);
    if (isNaN(num)) return 0;

    // 4. Handle Units
    if (trimmed.endsWith("px")) return num;
    if (trimmed.endsWith("rem")) return num * context.rootFontSize;
    if (trimmed.endsWith("em")) return num * (options.parentFontSize ?? context.rootFontSize);
    if (trimmed.endsWith("%")) {
        // Use the provided reference (e.g. parent width/height)
        // or fallback to Viewport Width (browser default for many top-level items).
        return (num / 100) * (options.percentageReference ?? context.viewportWidth);
    }

    if (trimmed.endsWith("vw")) return (num / 100) * context.viewportWidth;
    if (trimmed.endsWith("vh")) return (num / 100) * context.viewportHeight;
    if (trimmed.endsWith("vmin")) return (num / 100) * Math.min(context.viewportWidth, context.viewportHeight);
    if (trimmed.endsWith("vmax")) return (num / 100) * Math.max(context.viewportWidth, context.viewportHeight);

    if (trimmed.endsWith("svw") || trimmed.endsWith("lvw")) return (num / 100) * context.viewportWidth;
    if (trimmed.endsWith("svh") || trimmed.endsWith("lvh")) return (num / 100) * context.viewportHeight;

    // Dynamic Viewport Units (Use visualViewport if available)
    if (trimmed.endsWith("dvw")) return (num / 100) * (context.visualViewportWidth ?? context.viewportWidth);
    if (trimmed.endsWith("dvh")) return (num / 100) * (context.visualViewportHeight ?? context.viewportHeight);

    // Container Query Units (Fallback to small viewport units as per spec if no container)
    if (trimmed.endsWith("cqw") || trimmed.endsWith("cqi")) return (num / 100) * context.viewportWidth;
    if (trimmed.endsWith("cqh") || trimmed.endsWith("cqb")) return (num / 100) * context.viewportHeight;
    if (trimmed.endsWith("cqmin")) return (num / 100) * Math.min(context.viewportWidth, context.viewportHeight);
    if (trimmed.endsWith("cqmax")) return (num / 100) * Math.max(context.viewportWidth, context.viewportHeight);

    // Physical Units
    for (const [unit, factor] of Object.entries(PHYSICAL_UNITS)) {
        if (trimmed.endsWith(unit)) return num * factor;
    }

    // Relative Character Units (Estimation)
    if (trimmed.endsWith("ch")) return num * (context.rootFontSize * 0.5);
    if (trimmed.endsWith("ex")) return num * (context.rootFontSize * 0.45);

    return num;
}

interface CalcOptions {
    parentFontSize?: number;
    percentageReference?: number;
    tokens?: DesignTokenDictionary;
    visited?: Set<string>;
}

/**
 * calc() evaluator.
 */
export function resolveCalc(
    calcStr: string,
    context: ContextMetrics,
    options: CalcOptions = {}
): number {
    const trimmed = calcStr.trim();
    let expression = trimmed.startsWith("calc(") ? trimmed.slice(5, -1) : trimmed;

    if (options.tokens) {
        // Match var(--name) or var(--name, fallback)
        // This handles recursive/nested parens to some extent, but for calc it's mostly simple tokens
        expression = expression.replace(/var\(--([a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\)/g, (match) => {
            return toPixels(match, context, options).toString();
        });
    }

    return new LinearMathEvaluator(expression, context, options).evaluate();
}

class LinearMathEvaluator {
    private pos = 0;
    private tokens: string[] = [];

    constructor(
        private expression: string,
        private context: ContextMetrics,
        private options: CalcOptions
    ) {
        this.tokenize();
    }

    private tokenize() {
        const regex = /([+\-*/(),])|(-?\d*\.?\d+(?:[a-z]{1,4}|%)?)|([a-z-]+\()/gi;
        let match;
        while ((match = regex.exec(this.expression)) !== null) {
            this.tokens.push(match[0]);
        }
    }

    evaluate(): number {
        return this.parseExpression();
    }

    private parseExpression(): number {
        let result = this.parseTerm();
        while (this.pos < this.tokens.length) {
            const op = this.tokens[this.pos];
            if (op !== "+" && op !== "-") break;
            this.pos++;
            const term = this.parseTerm();
            result = op === "+" ? result + term : result - term;
        }
        return result;
    }

    private parseTerm(): number {
        let result = this.parseFactor();
        while (this.pos < this.tokens.length) {
            const op = this.tokens[this.pos];
            if (op !== "*" && op !== "/") break;
            this.pos++;
            const factor = this.parseFactor();
            result = op === "*" ? result * factor : result / factor;
        }
        return result;
    }

    private parseFactor(): number {
        const token = this.tokens[this.pos++];
        if (!token) return 0;

        if (token === "(") {
            const result = this.parseExpression();
            if (this.tokens[this.pos] === ")") this.pos++;
            return result;
        }

        if (token.endsWith("(")) {
            const fnName = token.slice(0, -1).toLowerCase();
            const args: number[] = [];

            while (this.pos < this.tokens.length && this.tokens[this.pos] !== ")") {
                args.push(this.parseExpression());
                if (this.tokens[this.pos] === ",") this.pos++;
            }
            if (this.tokens[this.pos] === ")") this.pos++;

            switch (fnName) {
                case "min": return Math.min(...args);
                case "max": return Math.max(...args);
                case "clamp": return args.length >= 3 ? Math.max(args[0]!, Math.min(args[1]!, args[2]!)) : (args[0] ?? 0);
                default: return args[0] ?? 0;
            }
        }

        // It's a value (with or without units)
        return toPixels(token, this.context, this.options);
    }
}

export function evaluateResolvedMath(expression: string, context: ContextMetrics, options: CalcOptions): number {
    return new LinearMathEvaluator(expression, context, options).evaluate();
}
