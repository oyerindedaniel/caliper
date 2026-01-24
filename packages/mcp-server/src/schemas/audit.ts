import { z } from "zod";

/**
 * Audit Strategies for Figma-to-Browser reconciliation.
 *
 * A: Container-First - Design frame is the max boundary
 * B: Padding-Locked - Fixed edge spacing, content fills available space
 * C: Ratio-Based - Element maintains proportional width to viewport
 */
export const AuditStrategySchema = z.enum(["A", "B", "C"]);
export type AuditStrategy = z.infer<typeof AuditStrategySchema>;

/**
 * Design properties extracted from Figma MCP output.
 * 
 * The AI agent is responsible for parsing Figma MCP responses:
 * - `get_metadata` returns XML with position/sizes → extract into this schema
 * - `get_variable_defs` returns variables → extract padding values
 * 
 * These represent the "Intent" from the design file.
 */
export const FigmaDesignPropsSchema = z.object({
    /** 
     * The width of the containing frame/artboard.
     * Maps to: parentFrame.absoluteBoundingBox.width
     */
    frameWidth: z.number().positive(),
    /** 
     * The height of the containing frame/artboard.
     * Maps to: parentFrame.absoluteBoundingBox.height
     */
    frameHeight: z.number().positive().optional(),
    /** 
     * The node's absolute X position.
     * Maps to: node.absoluteBoundingBox.x
     */
    nodeX: z.number(),
    /** 
     * The node's absolute Y position.
     * Maps to: node.absoluteBoundingBox.y
     */
    nodeY: z.number(),
    /** 
     * The node's absolute width.
     * Maps to: node.absoluteBoundingBox.width
     */
    nodeWidth: z.number().positive(),
    /** 
     * The node's absolute height.
     * Maps to: node.absoluteBoundingBox.height
     */
    nodeHeight: z.number().positive().optional(),
    /** Left padding (from Figma Auto Layout props) */
    paddingLeft: z.number().nonnegative().optional(),
    /** Right padding */
    paddingRight: z.number().nonnegative().optional(),
    /** Top padding */
    paddingTop: z.number().nonnegative().optional(),
    /** Bottom padding */
    paddingBottom: z.number().nonnegative().optional(),
    /** 
     * Auto Layout mode.
     * Maps to: node.layoutMode (null/absent becomes "NONE")
     */
    layoutMode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]).optional().default("NONE"),
});

export type FigmaDesignProps = z.infer<typeof FigmaDesignPropsSchema>;

/**
 * Live browser properties from Caliper inspection.
 * These represent the "Reality" in the implementation.
 */
export const BrowserElementPropsSchema = z.object({
    /** Current browser viewport width */
    viewportWidth: z.number().positive(),
    /** Current browser viewport height */
    viewportHeight: z.number().positive(),
    /** Element's left position (relative to viewport) */
    left: z.number(),
    /** Element's top position (relative to viewport) */
    top: z.number(),
    /** Element's computed width */
    width: z.number().nonnegative(),
    /** Element's computed height */
    height: z.number().nonnegative(),
    /** Computed padding-left in pixels */
    paddingLeft: z.number().nonnegative().optional(),
    /** Computed padding-right in pixels */
    paddingRight: z.number().nonnegative().optional(),
    /** Computed padding-top in pixels */
    paddingTop: z.number().nonnegative().optional(),
    /** Computed padding-bottom in pixels */
    paddingBottom: z.number().nonnegative().optional(),
    /** Computed margin-left in pixels */
    marginLeft: z.number().optional(),
    /** Computed margin-right in pixels */
    marginRight: z.number().optional(),
});

export type BrowserElementProps = z.infer<typeof BrowserElementPropsSchema>;

/**
 * A single dimension delta (e.g., width, left, padding).
 */
export const DeltaSchema = z.object({
    property: z.string(),
    designValue: z.number(),
    actualValue: z.number(),
    delta: z.number(),
    /** Whether the delta is within acceptable tolerance (default: 1px) */
    isAcceptable: z.boolean(),
});

export type Delta = z.infer<typeof DeltaSchema>;

/**
 * CSS recommendation to fix a detected issue.
 */
export const CSSRecommendationSchema = z.object({
    property: z.string(),
    currentValue: z.string(),
    recommendedValue: z.string(),
    reason: z.string(),
});

export type CSSRecommendation = z.infer<typeof CSSRecommendationSchema>;

/**
 * The full audit result returned to the AI agent.
 */
export const AuditResultSchema = z.object({
    /** Whether the implementation matches the design within tolerance */
    isPixelPerfect: z.boolean(),
    /** The strategy used for this audit */
    strategy: AuditStrategySchema,
    /** Summary of the audit in plain English */
    summary: z.string(),
    /** Individual property deltas */
    deltas: z.array(DeltaSchema),
    /** CSS recommendations to fix issues */
    recommendations: z.array(CSSRecommendationSchema),
    /** Viewport context at time of audit */
    viewportContext: z.object({
        viewportWidth: z.number(),
        figmaFrameWidth: z.number(),
        scaleFactor: z.number(),
    }),
    /** Timestamp of the audit */
    timestamp: z.number(),
});

export type AuditResult = z.infer<typeof AuditResultSchema>;

/**
 * Input schema for the caliper_audit_node tool.
 */
export const AuditNodeInputSchema = z.object({
    /** Caliper ID or CSS selector of the element to audit */
    selector: z.string().describe("Caliper ID (caliper-xxxx) or CSS selector of the element"),
    /** Design properties from Figma MCP */
    designProps: FigmaDesignPropsSchema.describe("Design properties from Figma MCP"),
    /** Audit strategy to apply */
    strategy: AuditStrategySchema.describe("A = Container-First, B = Padding-Locked, C = Ratio-Based"),
    /** Pixel tolerance for considering a match acceptable (default: 1) */
    tolerance: z.number().nonnegative().optional().describe("Pixel tolerance for acceptable match (default: 1px)"),
});

export type AuditNodeInput = z.infer<typeof AuditNodeInputSchema>;
