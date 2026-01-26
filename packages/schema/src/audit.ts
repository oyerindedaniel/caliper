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
    tabId: z.string().optional(), // Tab ID for cross-tab identification
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

export type BoxEdges = z.infer<typeof BoxEdgesSchema>;
export type CaliperComputedStyles = z.infer<typeof CaliperComputedStylesSchema>;
export type ParentGap = z.infer<typeof ParentGapSchema>;
export type SiblingGap = z.infer<typeof SiblingGapSchema>;
export type CaliperMeasurements = z.infer<typeof CaliperMeasurementsSchema>;
