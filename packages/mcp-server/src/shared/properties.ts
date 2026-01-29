import type { PropertyConfig, PropertyDefinition } from "../types/index.js";

export const PROPERTY_REGISTRY: PropertyDefinition[] = [
    // Layout properties
    { id: "display", inferredKey: "display", actualValue: node => node.styles.display, category: "layout" },
    { id: "position", inferredKey: "position", actualValue: node => node.styles.position, category: "layout" },
    { id: "boxSizing", inferredKey: "boxSizing", actualValue: node => node.styles.boxSizing, category: "layout" },
    { id: "flexDirection", inferredKey: "flexDirection", actualValue: node => node.styles.flexDirection || null, category: "layout" },
    { id: "justifyContent", inferredKey: "justifyContent", actualValue: node => node.styles.justifyContent || null, category: "layout" },
    { id: "alignItems", inferredKey: "alignItems", actualValue: node => node.styles.alignItems || null, category: "layout" },

    // Spacing properties
    { id: "gap", inferredKey: "gap", actualValue: node => node.styles.gap !== null ? `${node.styles.gap}px` : null, percentageBasis: width => width, category: "spacing" },
    { id: "paddingTop", inferredKey: "padding", actualValue: node => `${node.styles.padding.top}px`, percentageBasis: width => width, category: "spacing" },
    { id: "paddingRight", inferredKey: "padding", actualValue: node => `${node.styles.padding.right}px`, percentageBasis: width => width, category: "spacing" },
    { id: "paddingBottom", inferredKey: "padding", actualValue: node => `${node.styles.padding.bottom}px`, percentageBasis: width => width, category: "spacing" },
    { id: "paddingLeft", inferredKey: "padding", actualValue: node => `${node.styles.padding.left}px`, percentageBasis: width => width, category: "spacing" },
    { id: "marginTop", inferredKey: "margin", actualValue: node => `${node.styles.margin.top}px`, percentageBasis: width => width, category: "spacing" },
    { id: "marginRight", inferredKey: "margin", actualValue: node => `${node.styles.margin.right}px`, percentageBasis: width => width, category: "spacing" },
    { id: "marginBottom", inferredKey: "margin", actualValue: node => `${node.styles.margin.bottom}px`, percentageBasis: width => width, category: "spacing" },
    { id: "marginLeft", inferredKey: "margin", actualValue: node => `${node.styles.margin.left}px`, percentageBasis: width => width, category: "spacing" },
    { id: "width", inferredKey: "width", actualValue: node => `${node.rect.width}px`, percentageBasis: width => width, category: "spacing" },
    { id: "height", inferredKey: "height", actualValue: node => `${node.rect.height}px`, percentageBasis: (_, height) => height, category: "spacing" },

    // Typography properties
    { id: "fontSize", inferredKey: "fontSize", actualValue: node => `${node.styles.fontSize}px`, percentageBasis: (_, __, node) => node.styles.fontSize, category: "typography" },
    { id: "fontWeight", inferredKey: "fontWeight", actualValue: node => node.styles.fontWeight, category: "typography" },
    { id: "fontFamily", inferredKey: "fontFamily", actualValue: node => node.styles.fontFamily, category: "typography" },
    { id: "lineHeight", inferredKey: "lineHeight", actualValue: node => node.styles.lineHeight === "normal" || node.styles.lineHeight === null ? "normal" : `${node.styles.lineHeight}px`, percentageBasis: (_, __, node) => node.styles.fontSize, category: "typography" },
    { id: "letterSpacing", inferredKey: "letterSpacing", actualValue: node => node.styles.letterSpacing === "normal" ? "normal" : `${node.styles.letterSpacing}px`, percentageBasis: (_, __, node) => node.styles.fontSize, category: "typography" },

    // Color properties
    { id: "color", inferredKey: "color", actualValue: node => node.styles.color, category: "colors" },
    { id: "backgroundColor", inferredKey: "backgroundColor", actualValue: node => node.styles.backgroundColor, category: "colors" },
    { id: "borderColor", inferredKey: "borderColor", actualValue: node => node.styles.borderColor || null, category: "colors" },
    { id: "outlineColor", inferredKey: "outlineColor", actualValue: node => node.styles.outlineColor || null, category: "colors" },

    // Visual properties
    { id: "borderRadius", inferredKey: "borderRadius", actualValue: node => node.styles.borderRadius, percentageBasis: width => width, category: "borderRadius" },
    { id: "boxShadow", inferredKey: "boxShadow", actualValue: node => node.styles.boxShadow || "none", category: "spacing" },
    { id: "opacity", inferredKey: "opacity", actualValue: node => String(node.styles.opacity), category: "spacing" },
    { id: "outline", inferredKey: "outline", actualValue: node => node.styles.outline || "none", category: "spacing" },
    { id: "zIndex", inferredKey: "zIndex", actualValue: node => node.styles.zIndex === null || node.styles.zIndex === "auto" ? "auto" : String(node.styles.zIndex), category: "spacing" },

    // Overflow properties
    { id: "overflow", inferredKey: "overflow", actualValue: node => node.styles.overflow, category: "layout" },
    { id: "overflowX", inferredKey: "overflowX", actualValue: node => node.styles.overflowX, category: "layout" },
    { id: "overflowY", inferredKey: "overflowY", actualValue: node => node.styles.overflowY, category: "layout" },
];

export const SPACING_SCALE: Record<string, string> = {
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

export const FONT_SIZE_SCALE: Record<string, string> = {
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

export const FONT_WEIGHT_MAP: Record<string, string> = {
    "thin": "100",
    "hairline": "100", // v3 legacy
    "extralight": "200",
    "ultralight": "200", // v3 legacy
    "light": "300",
    "normal": "400",
    "regular": "400",
    "medium": "500",
    "semibold": "600",
    "demibold": "600",
    "bold": "700",
    "extrabold": "800",
    "ultrabold": "800",
    "black": "900",
    "heavy": "900",
};

export const VIEWPORT_UNITS: Record<string, string> = {
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

export const BORDER_RADIUS_SCALE: Record<string, string> = {
    "none": "0px",
    "xs": "2px", // v4
    "sm": "2px", // v3
    "": "4px",
    "md": "6px",
    "lg": "8px",
    "xl": "12px",
    "2xl": "16px",
    "3xl": "24px",
    "full": "9999px",
};

export const LEADING_SCALE: Record<string, number | string> = {
    "none": 1,
    "tight": 1.25,
    "snug": 1.375,
    "normal": 1.5,
    "relaxed": 1.625,
    "loose": 2,
};

export const TRACKING_SCALE: Record<string, string> = {
    "tighter": "-0.05em",
    "tight": "-0.025em",
    "normal": "0em",
    "wide": "0.025em",
    "wider": "0.05em",
    "widest": "0.1em",
};

export const LAYOUT_VALUES = {
    display: {
        "flex": "flex",
        "inline-flex": "inline-flex",
        "grid": "grid",
        "block": "block",
        "inline": "inline",
        "inline-block": "inline-block",
        "hidden": "none",
        "contents": "contents",
        "none": "none",
    },
    position: {
        "static": "static",
        "relative": "relative",
        "absolute": "absolute",
        "fixed": "fixed",
        "sticky": "sticky",
    },
    boxSizing: {
        "box-border": "border-box",
        "box-content": "content-box",
        "border-box": "border-box",
        "content-box": "content-box",
    },
    flexDirection: {
        "flex-row": "row",
        "flex-col": "column",
        "flex-row-reverse": "row-reverse",
        "flex-col-reverse": "column-reverse",
    },
    justifyContent: {
        "justify-start": "flex-start",
        "justify-end": "flex-end",
        "justify-center": "center",
        "justify-between": "space-between",
        "justify-around": "space-around",
        "justify-evenly": "space-evenly",
    },
    alignItems: {
        "items-start": "flex-start",
        "items-end": "flex-end",
        "items-center": "center",
        "items-baseline": "baseline",
        "items-stretch": "stretch",
    },
    overflow: {
        "overflow-auto": "auto",
        "overflow-hidden": "hidden",
        "overflow-clip": "clip",
        "overflow-visible": "visible",
        "overflow-scroll": "scroll",
    },
    overflowX: {
        "overflow-x-auto": "auto",
        "overflow-x-hidden": "hidden",
        "overflow-x-clip": "clip",
        "overflow-x-visible": "visible",
        "overflow-x-scroll": "scroll",
    },
    overflowY: {
        "overflow-y-auto": "auto",
        "overflow-y-hidden": "hidden",
        "overflow-y-clip": "clip",
        "overflow-y-visible": "visible",
        "overflow-y-scroll": "scroll",
    }
} as const;

// Todo infer this id from computedstyes
export const PROPERTY_CONFIG: Record<string, PropertyConfig> = {
    // Color properties
    color: { category: "colors", valueType: "color" },
    backgroundColor: { category: "colors", valueType: "color" },
    borderColor: { category: "colors", valueType: "color" },
    outlineColor: { category: "colors", valueType: "color" },

    // Spacing properties (hybrid to handle auto/normal)
    padding: { category: "spacing", valueType: "length" },
    paddingTop: { category: "spacing", valueType: "length" },
    paddingRight: { category: "spacing", valueType: "length" },
    paddingBottom: { category: "spacing", valueType: "length" },
    paddingLeft: { category: "spacing", valueType: "length" },
    margin: { category: "spacing", valueType: "length" },
    marginTop: { category: "spacing", valueType: "length" },
    marginRight: { category: "spacing", valueType: "length" },
    marginBottom: { category: "spacing", valueType: "length" },
    marginLeft: { category: "spacing", valueType: "length" },
    gap: { category: "spacing", valueType: "hybrid" },
    width: { category: "spacing", valueType: "hybrid" },
    height: { category: "spacing", valueType: "hybrid" },

    // Typography properties
    fontSize: { category: "typography", valueType: "length" },
    fontWeight: { category: "typography", valueType: "hybrid" }, // 100-900 or keywords (normal, bold)
    fontFamily: { category: "typography", valueType: "keyword" },
    lineHeight: { category: "typography", valueType: "hybrid" }, // unitless number, length, or "normal"
    letterSpacing: { category: "typography", valueType: "hybrid" }, // length or "normal"

    // Border radius
    borderRadius: { category: "borderRadius", valueType: "length" },

    // Layout properties (keyword-based)
    display: { category: "layout", valueType: "keyword" },
    position: { category: "layout", valueType: "keyword" },
    boxSizing: { category: "layout", valueType: "keyword" },
    flexDirection: { category: "layout", valueType: "keyword" },
    justifyContent: { category: "layout", valueType: "keyword" },
    alignItems: { category: "layout", valueType: "keyword" },
    overflow: { category: "layout", valueType: "keyword" },
    overflowX: { category: "layout", valueType: "keyword" },
    overflowY: { category: "layout", valueType: "keyword" },

    // Spacing properties (hybrid to handle auto/normal)
    boxShadow: { category: "spacing", valueType: "hybrid" }, // Complex value, treat as keyword
    opacity: { category: "spacing", valueType: "number" }, // 0-1 numeric
    zIndex: { category: "spacing", valueType: "hybrid" }, // number or "auto"
    outline: { category: "spacing", valueType: "keyword" },
};

export const TAILWIND_COLOR_PALETTE: Record<string, string> = {
    "black": "#000000",
    "white": "#ffffff",
    "transparent": "transparent",
    "current": "currentColor",
    // v3 Default Palette
    "slate-50": "#f8fafc", "slate-100": "#f1f5f9", "slate-200": "#e2e8f0", "slate-300": "#cbd5e1", "slate-400": "#94a3b8", "slate-500": "#64748b", "slate-600": "#475569", "slate-700": "#334155", "slate-800": "#1e293b", "slate-900": "#0f172a", "slate-950": "#020617",
    "gray-50": "#f9fafb", "gray-100": "#f3f4f6", "gray-200": "#e5e7eb", "gray-300": "#d1d5db", "gray-400": "#9ca3af", "gray-500": "#6b7280", "gray-600": "#4b5563", "gray-700": "#374151", "gray-800": "#1f2937", "gray-900": "#111827", "gray-950": "#030712",
    "zinc-50": "#fafafa", "zinc-100": "#f4f4f5", "zinc-200": "#e4e4e7", "zinc-300": "#d4d4d8", "zinc-400": "#a1a1aa", "zinc-500": "#71717a", "zinc-600": "#52525b", "zinc-700": "#3f3f46", "zinc-800": "#27272a", "zinc-900": "#18181b", "zinc-950": "#09090b",
    "neutral-50": "#fafafa", "neutral-100": "#f5f5f5", "neutral-200": "#e5e5e5", "neutral-300": "#d4d4d4", "neutral-400": "#a3a3a3", "neutral-500": "#737373", "neutral-600": "#525252", "neutral-700": "#404040", "neutral-800": "#262626", "neutral-900": "#171717", "neutral-950": "#0a0a0a",
    "stone-50": "#fafaf9", "stone-100": "#f5f5f4", "stone-200": "#e7e5e4", "stone-300": "#d6d3d1", "stone-400": "#a8a29e", "stone-500": "#78716c", "stone-600": "#57534e", "stone-700": "#44403c", "stone-800": "#292524", "stone-900": "#1c1917", "stone-950": "#0c0a09",
    "red-50": "#fef2f2", "red-100": "#fee2e2", "red-200": "#fecaca", "red-300": "#fca5a5", "red-400": "#f87171", "red-500": "#ef4444", "red-600": "#dc2626", "red-700": "#b91c1c", "red-800": "#991b1b", "red-900": "#7f1d1d", "red-950": "#450a0a",
    "orange-50": "#fff7ed", "orange-100": "#ffedd5", "orange-200": "#fed7aa", "orange-300": "#fdba74", "orange-400": "#fb923c", "orange-500": "#f97316", "orange-600": "#ea580c", "orange-700": "#c2410c", "orange-800": "#9a3412", "orange-900": "#7c2d12", "orange-950": "#431407",
    "amber-50": "#fffbeb", "amber-100": "#fef3c7", "amber-200": "#fde68a", "amber-300": "#fcd34d", "amber-400": "#fbbf24", "amber-500": "#f59e0b", "amber-600": "#d97706", "amber-700": "#b45309", "amber-800": "#92400e", "amber-900": "#78350f", "amber-950": "#451a03",
    "yellow-50": "#fefce8", "yellow-100": "#fef9c3", "yellow-200": "#fef08a", "yellow-300": "#fde047", "yellow-400": "#facc15", "yellow-500": "#eab308", "yellow-600": "#ca8a04", "yellow-700": "#a16207", "yellow-800": "#854d09", "yellow-900": "#713f12", "yellow-950": "#422006",
    "lime-50": "#f7fee7", "lime-100": "#ecfccb", "lime-200": "#d9f99d", "lime-300": "#bef264", "lime-400": "#a3e635", "lime-500": "#84cc16", "lime-600": "#65a30d", "lime-700": "#4d7c0f", "lime-800": "#3f6212", "lime-900": "#365314", "lime-950": "#1a2e05",
    "green-50": "#f0fdf4", "green-100": "#dcfce7", "green-200": "#bbf7d0", "green-300": "#86efac", "green-400": "#4ade80", "green-500": "#22c55e", "green-600": "#16a34a", "green-700": "#15803d", "green-800": "#166534", "green-900": "#14532d", "green-950": "#0f2b1d",
    "emerald-50": "#ecfdf5", "emerald-100": "#d1fae5", "emerald-200": "#a7f3d0", "emerald-300": "#6ee7b7", "emerald-400": "#34d399", "emerald-500": "#10b981", "emerald-600": "#059669", "emerald-700": "#047857", "emerald-800": "#065f46", "emerald-900": "#064e3b", "emerald-950": "#022c22",
    "teal-50": "#f0fdfa", "teal-100": "#ccfbf1", "teal-200": "#99f6e4", "teal-300": "#5eead4", "teal-400": "#2dd4bf", "teal-500": "#14b8a6", "teal-600": "#0d9488", "teal-700": "#0f766e", "teal-800": "#115e59", "teal-900": "#134e4a", "teal-950": "#042f2e",
    "cyan-50": "#ecfeff", "cyan-100": "#cffafe", "cyan-200": "#a5f3fc", "cyan-300": "#67e8f9", "cyan-400": "#22d3ee", "cyan-500": "#06b6d4", "cyan-600": "#0891b2", "cyan-700": "#0e7490", "cyan-800": "#155e75", "cyan-900": "#164e63", "cyan-950": "#083344",
    "sky-50": "#f0f9ff", "sky-100": "#e0f2fe", "sky-200": "#bae6fd", "sky-300": "#7dd3fc", "sky-400": "#38bdf8", "sky-500": "#0ea5e9", "sky-600": "#0284c7", "sky-700": "#0369a1", "sky-800": "#075985", "sky-900": "#0c4a6e", "sky-950": "#082f49",
    "blue-50": "#eff6ff", "blue-100": "#dbeafe", "blue-200": "#bfdbfe", "blue-300": "#93c5fd", "blue-400": "#60a5fa", "blue-500": "#3b82f6", "blue-600": "#2563eb", "blue-700": "#1d4ed8", "blue-800": "#1e40af", "blue-900": "#1e3a8a", "blue-950": "#172554",
    "indigo-50": "#eef2ff", "indigo-100": "#e0f7ff", "indigo-200": "#c7d2fe", "indigo-300": "#a5b4fc", "indigo-400": "#818cf8", "indigo-500": "#6366f1", "indigo-600": "#4f46e5", "indigo-700": "#4338ca", "indigo-800": "#3730a3", "indigo-900": "#312e81", "indigo-950": "#1e1b4b",
    "violet-50": "#f5f3ff", "violet-100": "#ede9fe", "violet-200": "#ddd6fe", "violet-300": "#c4b5fd", "violet-400": "#a78bfa", "violet-500": "#8b5cf6", "violet-600": "#7c3aed", "violet-700": "#6d28d9", "violet-800": "#5b21b6", "violet-900": "#4c1d95", "violet-950": "#2e1065",
    "purple-50": "#faf5ff", "purple-100": "#f3e8ff", "purple-200": "#e9d5ff", "purple-300": "#d8b4fe", "purple-400": "#c084fc", "purple-500": "#a855f7", "purple-600": "#9333ea", "purple-700": "#7e22ce", "purple-800": "#6b21a8", "purple-900": "#581c87", "purple-950": "#3b0764",
    "fuchsia-50": "#fdf4ff", "fuchsia-100": "#fae8ff", "fuchsia-200": "#f5d0fe", "fuchsia-300": "#f0abfc", "fuchsia-400": "#e879f9", "fuchsia-500": "#d946ef", "fuchsia-600": "#c026d3", "fuchsia-700": "#a21caf", "fuchsia-800": "#86198f", "fuchsia-900": "#701a75", "fuchsia-950": "#4a044e",
    "pink-50": "#fdf2f8", "pink-100": "#fce7f3", "pink-200": "#fbcfe8", "pink-300": "#f9a8d4", "pink-400": "#f472b6", "pink-500": "#ec4899", "pink-600": "#db2777", "pink-700": "#be185d", "pink-800": "#9d174d", "pink-900": "#831843", "pink-950": "#500724",
    "rose-50": "#fff1f2", "rose-100": "#ffe4e6", "rose-200": "#fecdd3", "rose-300": "#fda4af", "rose-400": "#fb7185", "rose-500": "#f43f5e", "rose-600": "#e11d48", "rose-700": "#be123c", "rose-800": "#9f1239", "rose-900": "#881337", "rose-950": "#4c051e",
};

export const TAILWIND_SHADOW_MAP: Record<string, string> = {
    "xs": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    "sm": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
    "md": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    "lg": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    "xl": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
    "2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
    "inner": "inset 0 2px 4px 0 rgb(0 0 0 / 0.05)",
    "": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
    "none": "0 0 #0000",
};


export const TAILWIND_DROP_SHADOW_MAP: Record<string, string> = {
    "sm": "drop-shadow(0 1px 1px rgb(0 0 0 / 0.05))",
    "": "drop-shadow(0 1px 2px rgb(0 0 0 / 0.1)) drop-shadow(0 1px 1px rgb(0 0 0 / 0.06))",
    "md": "drop-shadow(0 4px 3px rgb(0 0 0 / 0.07)) drop-shadow(0 2px 2px rgb(0 0 0 / 0.06))",
    "lg": "drop-shadow(0 10px 8px rgb(0 0 0 / 0.04)) drop-shadow(0 4px 3px rgb(0 0 0 / 0.1))",
    "xl": "drop-shadow(0 20px 13px rgb(0 0 0 / 0.03)) drop-shadow(0 8px 5px rgb(0 0 0 / 0.08))",
    "2xl": "drop-shadow(0 25px 25px rgb(0 0 0 / 0.15))",
    "none": "drop-shadow(0 0 #0000)",
};

