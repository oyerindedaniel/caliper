import { z } from "zod";
import { RectSchema } from "./core.js";

/**
 * The input data structure for a Caliper selection copy.
 */
export const CaliperSelectorInputSchema = z.object({
    selector: z.string(),      // The CSS selector or data-caliper-agent-id
    tag: z.string(),           // e.g., "section"
    timestamp: z.number(),     // When the copy was made
    id: z.string().optional(), // HTML id attribute
    text: z.string().optional(), // Visible text snippet
    classes: z.array(z.string()).optional(), // CSS classes (filtered)
});

export type CaliperSelectorInput = z.infer<typeof CaliperSelectorInputSchema>;

/**
 * Parsed padding/margin/border for a single box edge.
 */
export const BoxEdgesSchema = z.object({
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
});

/**
 * All relevant computed styles extracted from getComputedStyle().
 * Values are parsed to numbers where applicable.
 */
export const CaliperComputedStylesSchema = z.object({
    // Box Model
    display: z.string(),
    position: z.string(),
    boxSizing: z.string(),

    // Spacing
    padding: BoxEdgesSchema,
    margin: BoxEdgesSchema,
    border: BoxEdgesSchema,

    // Flexbox/Grid
    gap: z.number().nullable(),
    flexDirection: z.string().optional(),
    justifyContent: z.string().optional(),
    alignItems: z.string().optional(),

    // Typography
    fontSize: z.number(),
    fontWeight: z.string(),
    fontFamily: z.string(),
    lineHeight: z.number().nullable(),
    letterSpacing: z.number(),
    color: z.string(),

    // Visual
    backgroundColor: z.string(),
    borderRadius: z.string(),
    opacity: z.number(),
    zIndex: z.number().nullable(),

    // Overflow
    overflow: z.string(),
    overflowX: z.string(),
    overflowY: z.string(),
});

// ============================================================================
// MEASUREMENTS (Gaps between elements)
// ============================================================================

/**
 * Measurement from this node to its parent's content edge.
 */
export const ParentGapSchema = z.object({
    top: z.number(),    // Distance from parent's padding-top edge to node's margin-top
    left: z.number(),   // Distance from parent's padding-left edge to node's margin-left
    bottom: z.number(), // Distance from node's margin-bottom to parent's padding-bottom
    right: z.number(),  // Distance from node's margin-right to parent's padding-right
});

/**
 * Measurement to an adjacent sibling.
 */
export const SiblingGapSchema = z.object({
    distance: z.number(),
    direction: z.enum(["above", "below", "left", "right"]).nullable(),
}).nullable();

/**
 * All structural measurements for a node.
 */
export const CaliperMeasurementsSchema = z.object({
    toParent: ParentGapSchema,
    toPreviousSibling: SiblingGapSchema,
    toNextSibling: SiblingGapSchema,
    indexInParent: z.number(),
    siblingCount: z.number(),
});

// ============================================================================
// CALIPER NODE (The DOM representation)
// ============================================================================

/**
 * A single DOM element with all captured properties.
 * This is recursive via the `children` field.
 */
export const CaliperNodeSchema: z.ZodType<CaliperNode> = z.lazy(() =>
    z.object({
        // Identity
        agentId: z.string(),
        selector: z.string(),
        tag: z.string(),
        htmlId: z.string().optional(),
        classes: z.array(z.string()),
        textContent: z.string().optional(),

        // Geometry (document-relative)
        rect: RectSchema,

        // Viewport-relative position
        viewportRect: z.object({
            top: z.number(),
            left: z.number(),
        }),

        // Computed Styles
        styles: CaliperComputedStylesSchema,

        // Measurements
        measurements: CaliperMeasurementsSchema,

        // Tree structure
        depth: z.number(),
        parentAgentId: z.string().optional(),
        childCount: z.number(),
        children: z.array(CaliperNodeSchema),
    })
);

export interface CaliperNode {
    agentId: string;
    selector: string;
    tag: string;
    htmlId?: string;
    classes: string[];
    textContent?: string;
    rect: z.infer<typeof RectSchema>;
    viewportRect: { top: number; left: number };
    styles: z.infer<typeof CaliperComputedStylesSchema>;
    measurements: z.infer<typeof CaliperMeasurementsSchema>;
    depth: number;
    parentAgentId?: string;
    childCount: number;
    children: CaliperNode[];
}

// ============================================================================
// FIGMA NODE (The design representation)
// ============================================================================

/**
 * Bounding box in Figma coordinates.
 */
export const FigmaBoundingBoxSchema = z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
});

/**
 * Layout properties for auto-layout frames.
 */
export const FigmaLayoutSchema = z.object({
    layoutMode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]),
    primaryAxisAlignItems: z.enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"]).optional(),
    counterAxisAlignItems: z.enum(["MIN", "CENTER", "MAX"]).optional(),
    itemSpacing: z.number().optional(),
    paddingLeft: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingTop: z.number().optional(),
    paddingBottom: z.number().optional(),
});

/**
 * Typography properties for text nodes.
 */
export const FigmaTypographySchema = z.object({
    fontFamily: z.string().optional(),
    fontSize: z.number().optional(),
    fontWeight: z.number().optional(),
    lineHeightPx: z.number().optional(),
    letterSpacing: z.number().optional(),
});

/**
 * A single Figma layer with relevant properties.
 * Recursive via the `children` field.
 */
export const FigmaNodeSchema: z.ZodType<FigmaNode> = z.lazy(() =>
    z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        absoluteBoundingBox: FigmaBoundingBoxSchema,
        layout: FigmaLayoutSchema.optional(),
        style: FigmaTypographySchema.optional(),
        children: z.array(FigmaNodeSchema).optional(),
    })
);

export interface FigmaNode {
    id: string;
    name: string;
    type: string;
    absoluteBoundingBox: z.infer<typeof FigmaBoundingBoxSchema>;
    layout?: z.infer<typeof FigmaLayoutSchema>;
    style?: z.infer<typeof FigmaTypographySchema>;
    children?: FigmaNode[];
}

/**
 * The container frame context (defines the breakpoint).
 */
export const FigmaFrameContextSchema = z.object({
    frameId: z.string(),
    frameName: z.string(),
    frameWidth: z.number(),
    frameHeight: z.number(),
    rootNode: FigmaNodeSchema,
});

// ============================================================================
// PAIRING (Links DOM nodes to Figma nodes)
// ============================================================================

/**
 * A single pairing between a Caliper node and a Figma node.
 */
export const NodePairSchema = z.object({
    caliperNode: CaliperNodeSchema,
    figmaNode: FigmaNodeSchema.nullable(),
    matchConfidence: z.number(),
    matchReason: z.string(),
});

/**
 * Result of the pairing algorithm.
 */
export const PairingReportSchema = z.object({
    pairs: z.array(NodePairSchema),
    unmatchedCaliper: z.array(CaliperNodeSchema),
    unmatchedFigma: z.array(FigmaNodeSchema),
    structuralMatch: z.boolean(),
});

// ============================================================================
// STRATEGY & RECONCILIATION
// ============================================================================

/**
 * The three audit strategies.
 */
export const AuditStrategySchema = z.enum(["A", "B", "C"]);

/**
 * A single property mismatch.
 */
export const PropertyDeltaSchema = z.object({
    property: z.string(),
    figmaValue: z.string(),
    caliperValue: z.string(),
    delta: z.number(),
    severity: z.enum(["exact", "minor", "major"]),
    cssRecommendation: z.string(),
});

/**
 * Strategy-specific analysis for a node.
 */
export const StrategyAnalysisSchema = z.object({
    strategy: AuditStrategySchema,
    isCompliant: z.boolean(),

    // Strategy A (Container-First)
    expectedCenterX: z.number().optional(),
    actualCenterX: z.number().optional(),
    centerDelta: z.number().optional(),

    // Strategy B (Padding-Locked)
    expectedPaddingLeft: z.number().optional(),
    expectedPaddingRight: z.number().optional(),
    actualPaddingLeft: z.number().optional(),
    actualPaddingRight: z.number().optional(),

    // Strategy C (Ratio-Based)
    expectedRatio: z.number().optional(),
    actualRatio: z.number().optional(),
    ratioDelta: z.number().optional(),
});

/**
 * Full reconciliation result for a single node pair.
 */
export const NodeReconciliationResultSchema = z.object({
    pair: NodePairSchema,
    status: z.enum(["MATCH", "MINOR_DRIFT", "MAJOR_DRIFT", "UNMATCHED"]),
    deltas: z.array(PropertyDeltaSchema),
    strategyAnalysis: StrategyAnalysisSchema,
    cssRecommendations: z.array(z.string()),
    secondaryRecommendations: z.array(z.string()).optional(),
});

/**
 * Anchor for source discovery (grep).
 */
export const AnchorSchema = z.object({
    type: z.enum(["id", "text", "class"]),
    value: z.string(),
    confidence: z.number(),
    grepQuery: z.string(),
});

/**
 * Responsive CSS block for a breakpoint.
 */
export const ResponsiveCSSBlockSchema = z.object({
    breakpoint: z.number(),
    query: z.string(),
    css: z.string(),
});

/**
 * The final reconciliation report.
 */
export const ReconciliationReportSchema = z.object({
    summary: z.object({
        totalNodes: z.number(),
        matchedNodes: z.number(),
        driftedNodes: z.number(),
        unmatchedNodes: z.number(),
    }),
    results: z.array(NodeReconciliationResultSchema),
    baseCSS: z.string(),
    responsiveCSS: ResponsiveCSSBlockSchema.optional(),
    anchors: z.array(AnchorSchema),
});

export type BoxEdges = z.infer<typeof BoxEdgesSchema>;
export type CaliperComputedStyles = z.infer<typeof CaliperComputedStylesSchema>;
export type ParentGap = z.infer<typeof ParentGapSchema>;
export type SiblingGap = z.infer<typeof SiblingGapSchema>;
export type CaliperMeasurements = z.infer<typeof CaliperMeasurementsSchema>;
export type FigmaBoundingBox = z.infer<typeof FigmaBoundingBoxSchema>;
export type FigmaLayout = z.infer<typeof FigmaLayoutSchema>;
export type FigmaTypography = z.infer<typeof FigmaTypographySchema>;
export type FigmaFrameContext = z.infer<typeof FigmaFrameContextSchema>;
export type NodePair = z.infer<typeof NodePairSchema>;
export type PairingReport = z.infer<typeof PairingReportSchema>;
export type AuditStrategy = z.infer<typeof AuditStrategySchema>;
export type PropertyDelta = z.infer<typeof PropertyDeltaSchema>;
export type StrategyAnalysis = z.infer<typeof StrategyAnalysisSchema>;
export type NodeReconciliationResult = z.infer<typeof NodeReconciliationResultSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type ResponsiveCSSBlock = z.infer<typeof ResponsiveCSSBlockSchema>;
export type ReconciliationReport = z.infer<typeof ReconciliationReportSchema>;
