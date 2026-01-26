import type { InferredStyles, BoxEdgesString, SemanticNode, Framework } from "@oyerinde/caliper-schema";

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

function resolveSpacing(value: string): string | undefined {
    if (value.startsWith("[") && value.endsWith("]")) {
        return value.slice(1, -1).replace(/_/g, " ");
    }

    if (SPACING_SCALE[value]) {
        return SPACING_SCALE[value];
    }

    for (const unit of Object.keys(VIEWPORT_UNITS)) {
        if (value.endsWith(unit)) return value;
    }

    return undefined;
}

function createBoxEdges(top: string, right: string, bottom: string, left: string): BoxEdgesString {
    return { top, right, bottom, left };
}

function parsePaddingClass(className: string): Partial<{ padding: BoxEdgesString }> | null {
    if (className.startsWith("p-")) {
        const value = resolveSpacing(className.slice(2));
        if (value) {
            return { padding: createBoxEdges(value, value, value, value) };
        }
    }
    if (className.startsWith("px-")) {
        const value = resolveSpacing(className.slice(3));
        if (value) {
            return { padding: createBoxEdges("0px", value, "0px", value) };
        }
    }
    if (className.startsWith("py-")) {
        const value = resolveSpacing(className.slice(3));
        if (value) {
            return { padding: createBoxEdges(value, "0px", value, "0px") };
        }
    }
    if (className.startsWith("pt-")) {
        const value = resolveSpacing(className.slice(3));
        if (value) return { padding: createBoxEdges(value, "0px", "0px", "0px") };
    }
    if (className.startsWith("pr-")) {
        const value = resolveSpacing(className.slice(3));
        if (value) return { padding: createBoxEdges("0px", value, "0px", "0px") };
    }
    if (className.startsWith("pb-")) {
        const value = resolveSpacing(className.slice(3));
        if (value) return { padding: createBoxEdges("0px", "0px", value, "0px") };
    }
    if (className.startsWith("pl-")) {
        const value = resolveSpacing(className.slice(3));
        if (value) return { padding: createBoxEdges("0px", "0px", "0px", value) };
    }
    return null;
}

function parseMarginClass(className: string): Partial<{ margin: BoxEdgesString }> | null {
    if (className.startsWith("m-")) {
        const value = resolveSpacing(className.slice(2));
        if (value) {
            return { margin: createBoxEdges(value, value, value, value) };
        }
    }
    if (className.startsWith("mx-")) {
        const value = resolveSpacing(className.slice(3));
        if (value) {
            return { margin: createBoxEdges("0px", value, "0px", value) };
        }
    }
    if (className.startsWith("my-")) {
        const value = resolveSpacing(className.slice(3));
        if (value) {
            return { margin: createBoxEdges(value, "0px", value, "0px") };
        }
    }
    return null;
}

function parseGapClass(className: string): Partial<{ gap: string }> | null {
    if (className.startsWith("gap-")) {
        const value = resolveSpacing(className.slice(4));
        if (value) return { gap: value };
    }
    return null;
}

function parseFontSizeClass(className: string): Partial<{ fontSize: string }> | null {
    if (className.startsWith("text-")) {
        const sizeKey = className.slice(5);
        const value = FONT_SIZE_SCALE[sizeKey];
        if (value) return { fontSize: value };
    }
    return null;
}

function parseFontWeightClass(className: string): Partial<{ fontWeight: string }> | null {
    if (className.startsWith("font-")) {
        const weightKey = className.slice(5);
        const value = FONT_WEIGHT_MAP[weightKey];
        if (value) return { fontWeight: value };
    }
    return null;
}

function parseBorderRadiusClass(className: string): Partial<{ borderRadius: string }> | null {
    if (className === "rounded") {
        return { borderRadius: BORDER_RADIUS_SCALE[""] };
    }
    if (className.startsWith("rounded-")) {
        const key = className.slice(8);
        const value = BORDER_RADIUS_SCALE[key];
        if (value) return { borderRadius: value };
    }
    return null;
}

function parseDisplayClass(className: string): PartialInferredStyles | null {
    switch (className) {
        case "flex": return { display: "flex" };
        case "inline-flex": return { display: "inline-flex" };
        case "grid": return { display: "grid" };
        case "block": return { display: "block" };
        case "inline": return { display: "inline" };
        case "inline-block": return { display: "inline-block" };
        case "hidden": return { display: "none" };
        default: return null;
    }
}

function parseFlexDirectionClass(className: string): PartialInferredStyles | null {
    switch (className) {
        case "flex-row": return { flexDirection: "row" };
        case "flex-col": return { flexDirection: "column" };
        case "flex-row-reverse": return { flexDirection: "row-reverse" };
        case "flex-col-reverse": return { flexDirection: "column-reverse" };
        default: return null;
    }
}

function parseJustifyClass(className: string): PartialInferredStyles | null {
    if (className.startsWith("justify-")) {
        const value = className.slice(8);
        const mapping: Record<string, string> = {
            "start": "flex-start",
            "end": "flex-end",
            "center": "center",
            "between": "space-between",
            "around": "space-around",
            "evenly": "space-evenly",
        };
        if (mapping[value]) return { justifyContent: mapping[value] };
    }
    return null;
}

function parseAlignItemsClass(className: string): PartialInferredStyles | null {
    if (className.startsWith("items-")) {
        const value = className.slice(6);
        const mapping: Record<string, string> = {
            "start": "flex-start",
            "end": "flex-end",
            "center": "center",
            "baseline": "baseline",
            "stretch": "stretch",
        };
        if (mapping[value]) return { alignItems: mapping[value] };
    }
    return null;
}

function parseWidthClass(className: string): PartialInferredStyles | null {
    if (className.startsWith("w-")) {
        const value = className.slice(2);
        if (value === "full") return { width: "100%" };
        if (value === "screen") return { width: "100vw" };
        if (value === "min") return { width: "min-content" };
        if (value === "max") return { width: "max-content" };
        if (value === "fit") return { width: "fit-content" };
        if (value === "auto") return { width: "auto" };

        for (const unit of Object.keys(VIEWPORT_UNITS)) {
            if (value.endsWith(unit)) return { width: value };
        }

        const spacing = resolveSpacing(value);
        if (spacing) return { width: spacing };
    }
    return null;
}

function parseHeightClass(className: string): PartialInferredStyles | null {
    if (className.startsWith("h-")) {
        const value = className.slice(2);
        if (value === "full") return { height: "100%" };
        if (value === "screen") return { height: "100vh" };
        if (value === "min") return { height: "min-content" };
        if (value === "max") return { height: "max-content" };
        if (value === "fit") return { height: "fit-content" };
        if (value === "auto") return { height: "auto" };

        for (const unit of Object.keys(VIEWPORT_UNITS)) {
            if (value.endsWith(unit)) return { height: value };
        }

        const spacing = resolveSpacing(value);
        if (spacing) return { height: spacing };
    }
    return null;
}

const TAILWIND_PARSERS = [
    parseDisplayClass,
    parseFlexDirectionClass,
    parseJustifyClass,
    parseAlignItemsClass,
    parsePaddingClass,
    parseMarginClass,
    parseGapClass,
    parseFontSizeClass,
    parseFontWeightClass,
    parseBorderRadiusClass,
    parseWidthClass,
    parseHeightClass,
];

export function inferStylesFromClasses(classes: string[], framework: Framework): InferredStyles {
    if (!framework.endsWith("-tailwind")) {
        return {};
    }

    const result: InferredStyles = {};

    for (const className of classes) {
        for (const parser of TAILWIND_PARSERS) {
            const parsed = parser(className);
            if (parsed) {
                Object.assign(result, parsed);
                break;
            }
        }
    }

    return result;
}

export function parseInlineStyles(styleString: string): InferredStyles {
    const result: InferredStyles = {};
    const declarations = styleString.split(";").filter(Boolean);

    for (const decl of declarations) {
        const [prop, value] = decl.split(":").map(s => s.trim());
        if (!prop || !value) continue;

        const camelProp = prop.replace(/-([a-z])/g, g => g[1]!.toUpperCase());

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

        const stringProps = ["justifyContent", "alignItems", "gap", "fontSize", "fontWeight", "borderRadius", "backgroundColor", "color", "width", "height"] as const;
        type StringPropKey = typeof stringProps[number];

        if ((stringProps as readonly string[]).includes(camelProp)) {
            result[camelProp as StringPropKey] = value;
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

export function applyInferredStylesToTree(node: SemanticNode, framework: Framework): void {
    const classStyles = inferStylesFromClasses(node.classes, framework);
    const inlineStyles = node.rawStyles ? parseInlineStyles(node.rawStyles) : {};

    node.inferredStyles = {
        ...classStyles,
        ...inlineStyles,
    };

    for (const child of node.children) {
        applyInferredStylesToTree(child, framework);
    }
}
