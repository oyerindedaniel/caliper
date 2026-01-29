import { z } from "zod";

// ============================================================================
// SEMANTIC NODE (Parsed from Figma's get_design_context output)
// ============================================================================

export const BoxEdgesStringSchema = z.object({
    top: z.string(),
    right: z.string(),
    bottom: z.string(),
    left: z.string(),
});

export const InferredStylesSchema = z.object({
    // Layout
    display: z.enum(["flex", "grid", "block", "inline", "inline-flex", "inline-block", "none", "contents", "table", "table-row", "table-cell"]).optional(),
    position: z.enum(["static", "relative", "absolute", "fixed", "sticky"]).optional(),
    boxSizing: z.enum(["content-box", "border-box"]).optional(),
    flexDirection: z.enum(["row", "column", "row-reverse", "column-reverse"]).optional(),
    justifyContent: z.string().optional(),
    alignItems: z.string().optional(),
    gridTemplateColumns: z.string().optional(),
    gridTemplateRows: z.string().optional(),

    // Spacing
    gap: z.string().optional(),
    padding: BoxEdgesStringSchema.optional(),
    margin: BoxEdgesStringSchema.optional(),

    // Dimensions
    width: z.string().optional(),
    height: z.string().optional(),

    // Colors
    backgroundColor: z.string().optional(),
    borderColor: z.string().optional(),
    color: z.string().optional(),

    // Typography
    fontSize: z.string().optional(),
    fontWeight: z.string().optional(),
    fontFamily: z.string().optional(),
    lineHeight: z.union([z.string(), z.number()]).optional(),
    letterSpacing: z.string().optional(),

    // Visual
    borderRadius: z.string().optional(),
    boxShadow: z.string().optional(),
    opacity: z.number().optional(),
    outline: z.string().optional(),
    outlineColor: z.string().optional(),
    zIndex: z.number().optional(),

    // Overflow
    overflow: z.string().optional(),
    overflowX: z.string().optional(),
    overflowY: z.string().optional(),

    // Visual Filter
    filter: z.string().optional(),
    backdropFilter: z.string().optional(),
    transform: z.string().optional(),
    content: z.string().optional(),
    backgroundImage: z.string().optional(),
    maskSize: z.string().optional(),
});

export const SemanticNodeSchema: z.ZodType<SemanticNode> = z.lazy(() =>
    z.object({
        tag: z.string(),
        classes: z.array(z.string()),
        id: z.string().optional(),
        textContent: z.string().optional(),
        inferredStyles: InferredStylesSchema,
        children: z.array(SemanticNodeSchema),
        rawStyles: z.string().optional(),
        figmaNodeId: z.string().optional(),
        figmaNodeName: z.string().optional(),
    })
);

export interface SemanticNode {
    tag: string;
    classes: string[];
    id?: string;
    textContent?: string;
    inferredStyles: z.infer<typeof InferredStylesSchema>;
    children: SemanticNode[];
    rawStyles?: string;
    figmaNodeId?: string;
    figmaNodeName?: string;
}

// ============================================================================
// DESIGN TOKEN DICTIONARY (From Figma's get_variable_defs output)
// ============================================================================

export const FontDefinitionSchema = z.object({
    fontSize: z.number(),
    fontWeight: z.number(),
    lineHeight: z.number().optional(),
    letterSpacing: z.number().optional(),
    fontFamily: z.string().optional(),
});

export const DesignTokenDictionarySchema = z.object({
    colors: z.record(z.string(), z.string()),
    spacing: z.record(z.string(), z.string()),
    typography: z.record(z.string(), FontDefinitionSchema),
    borderRadius: z.record(z.string(), z.string()),
});

export type DesignTokenDictionary = z.infer<typeof DesignTokenDictionarySchema>

// ============================================================================
// RECONCILIATION CONTEXT
// ============================================================================

export const FrameworkSchema = z.enum([
    "react-tailwind",
    "vue-tailwind",
    "svelte-tailwind",
    "html-tailwind",
    "react-css",
    "vue-css",
    "svelte-css",
    "html-css",
]);

export type Framework = z.infer<typeof FrameworkSchema>;

// ============================================================================
// CONTEXT METRICS (Browser environment details for relative unit resolution)
// ============================================================================

export const ContextMetricsSchema = z.object({
    rootFontSize: z.number(),
    devicePixelRatio: z.number(),
    viewportWidth: z.number(),
    viewportHeight: z.number(),
    visualViewportWidth: z.number().optional(),
    visualViewportHeight: z.number().optional(),
});

export type ContextMetrics = z.infer<typeof ContextMetricsSchema>;

export const DEFAULT_CONTEXT_METRICS: ContextMetrics = {
    rootFontSize: 16,
    devicePixelRatio: 1,
    viewportWidth: 1920,
    viewportHeight: 1080,
    visualViewportWidth: 1920,
    visualViewportHeight: 1080,
};

// ============================================================================
// NODE PAIR (Semantic Harmony pairing result)
// ============================================================================

export const MatchSignalSchema = z.enum([
    "tag_match",
    "tag_mismatch",
    "id_match",
    "text_exact",
    "text_fuzzy",
    "class_semantic",
    "child_count_match",
    "child_count_mismatch",
    "position_match",
    "layout_match",
    "code_connect_lock",
]);

export const NodePairSchema = z.object({
    actualNodeId: z.string(),
    expectedNodeIndex: z.number(),
    confidence: z.number().min(0).max(100),
    depth: z.number(),
    matchSignals: z.array(MatchSignalSchema),
});

export interface NodePair {
    actualNodeId: string;
    expectedNodeIndex: number;
    confidence: number;
    depth: number;
    matchSignals: z.infer<typeof MatchSignalSchema>[];
}

// ============================================================================
// TOKEN USAGE REPORT (Tracks correct and missed token usage)
// ============================================================================

export const MissedTokenSchema = z.object({
    tokenName: z.string(),
    tokenCategory: z.enum(["colors", "spacing", "typography", "borderRadius"]),
    expectedValue: z.string(),
    actualValue: z.string(),
    property: z.string(),
    selector: z.string(),
});

export const TokenUsageReportSchema = z.object({
    tokensUsedCorrectly: z.array(z.string()),
    tokensMissed: z.array(MissedTokenSchema),
});

// ============================================================================
// RECONCILIATION REPORT (Output of the Semantic Harmony Engine)
// ============================================================================

export const ReconciliationSummarySchema = z.object({
    totalPairs: z.number(),
    highConfidencePairs: z.number(),
    lowConfidencePairs: z.number(),
    unmatchedActual: z.number(),
    unmatchedExpected: z.number(),
    totalDeltas: z.number(),
    majorDeltas: z.number(),
    minorDeltas: z.number(),
});

export const PropertyDeltaSchema = z.object({
    property: z.string(),
    figmaValue: z.string(),
    caliperValue: z.string(),
    delta: z.number(),
    severity: z.enum(["exact", "minor", "major"]),
    tokenName: z.string().optional(),
    cssRecommendation: z.string(),
    selector: z.string(),
});

export const ReconciliationReportSchema = z.object({
    summary: ReconciliationSummarySchema,
    pairs: z.array(NodePairSchema),
    deltas: z.array(PropertyDeltaSchema),
    cssRecommendations: z.string(),
    responsiveCssRecommendations: z.string().optional(),
    tokenUsageReport: TokenUsageReportSchema,
    framework: FrameworkSchema,
    figmaLayerUrl: z.string(),
    reconciliationDurationMs: z.number(),
});

export type BoxEdgesString = z.infer<typeof BoxEdgesStringSchema>;
export type InferredStyles = z.infer<typeof InferredStylesSchema>;
export type FontDefinition = z.infer<typeof FontDefinitionSchema>;
export type MatchSignal = z.infer<typeof MatchSignalSchema>;
export type MissedToken = z.infer<typeof MissedTokenSchema>;
export type TokenUsageReport = z.infer<typeof TokenUsageReportSchema>;
export type ReconciliationSummary = z.infer<typeof ReconciliationSummarySchema>;
export type PropertyDelta = z.infer<typeof PropertyDeltaSchema>;
export type ReconciliationReport = z.infer<typeof ReconciliationReportSchema>;
