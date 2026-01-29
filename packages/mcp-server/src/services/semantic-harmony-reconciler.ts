import type {
    CaliperNode,
    SemanticNode,
    DesignTokenDictionary,
    Framework,
    ReconciliationReport,
    PropertyDelta,
    TokenUsageReport,
    MissedToken,
    ContextMetrics,
} from "@oyerinde/caliper-schema";

import { semanticParserService } from "./semantic-parser-service.js";
import { applyInferredStylesToTree } from "./style-mapper.js";
import { tokenResolverService, TokenResolverService } from "./token-resolver-service.js";
import { pairHierarchically, HierarchicalPairingResult } from "./semantic-matcher.js";
import type { PropertyDefinition, ReconciliationInput } from "../types/index.js";
import { PROPERTY_REGISTRY, SPACING_SCALE } from "../shared/properties.js";

export class SemanticHarmonyReconciler {
    private tokenResolver: TokenResolverService;

    constructor() {
        this.tokenResolver = tokenResolverService;
    }

    private prepareTargetTree(html: string, input: ReconciliationInput): SemanticNode {
        const root = semanticParserService.parse(html);
        applyInferredStylesToTree(
            root,
            input.framework,
            input.designTokens,
            input.metrics
        );
        return root;
    }

    reconcile(input: ReconciliationInput): ReconciliationReport {
        const startTime = performance.now();

        const expectedRoot = this.prepareTargetTree(input.expectedHtml, input);
        this.tokenResolver.buildIndex(input.designTokens, input.metrics);

        const actualIdLookup = new Map<string, CaliperNode>();
        const expectedIndexLookup = new Map<number, SemanticNode>();

        const pairingResult = pairHierarchically(
            input.caliperTree,
            expectedRoot,
            actualIdLookup,
            expectedIndexLookup,
            {
                framework: input.framework,
                tokens: input.designTokens,
                metrics: input.metrics
            }
        );

        const deltas = this.reconcileProperties(
            pairingResult,
            actualIdLookup,
            expectedIndexLookup,
            input.designTokens,
            input.metrics
        );

        const tokenUsageReport = this.buildTokenUsageReport(deltas);

        const cssRecommendations = this.generateCssRecommendations(deltas, false);

        let responsiveCssRecommendations: string | undefined;
        if (input.secondaryHtml) {
            responsiveCssRecommendations = this.generateResponsiveCss(
                input.caliperTree,
                input.secondaryHtml,
                input.secondaryTokens || input.designTokens,
                input.framework,
                input.metrics
            );
        }

        const summary = this.buildSummary(pairingResult, deltas);

        return {
            summary,
            pairs: pairingResult.pairs,
            deltas,
            cssRecommendations,
            responsiveCssRecommendations,
            tokenUsageReport,
            framework: input.framework,
            figmaLayerUrl: input.figmaLayerUrl,
            reconciliationDurationMs: performance.now() - startTime,
        };
    }

    private reconcileProperties(
        pairing: HierarchicalPairingResult,
        actualLookup: Map<string, CaliperNode>,
        expectedLookup: Map<number, SemanticNode>,
        tokens: DesignTokenDictionary,
        metrics?: ContextMetrics
    ): PropertyDelta[] {
        const deltas: PropertyDelta[] = [];

        for (const pair of pairing.pairs) {
            const actual = actualLookup.get(pair.actualNodeId);
            const expected = expectedLookup.get(pair.expectedNodeIndex);
            if (!actual || !expected) continue;

            const nodeDeltas = this.diffNode(actual, expected, tokens, actualLookup, metrics);
            deltas.push(...nodeDeltas);
        }

        return deltas;
    }

    private diffNode(
        actual: CaliperNode,
        expected: SemanticNode,
        tokens: DesignTokenDictionary,
        actualLookup: Map<string, CaliperNode>,
        metrics?: ContextMetrics
    ): PropertyDelta[] {
        const deltas: PropertyDelta[] = [];
        const selector = actual.selector;
        const inferred = expected.inferredStyles;

        const parent = actual.parentAgentId ? actualLookup.get(actual.parentAgentId) : null;
        const parentWidth = parent ? parent.rect.width : (metrics?.viewportWidth ?? 1920);
        const parentHeight = parent ? parent.rect.height : (metrics?.viewportHeight ?? 1080);

        for (const property of PROPERTY_REGISTRY) {
            const expectedVal = this.getExpectedValue(inferred, property);
            if (expectedVal === undefined || expectedVal === null) continue;

            const actualVal = property.actualValue(actual, parentWidth, parentHeight);
            if (actualVal === null) continue;

            const basis = property.percentageBasis ? property.percentageBasis(parentWidth, parentHeight, actual) : undefined;

            const delta = this.compareProperty(
                property.id,
                String(expectedVal),
                actualVal,
                tokens,
                selector,
                basis,
                metrics
            );

            if (delta) deltas.push(delta);
        }

        return deltas;
    }

    private getExpectedValue(inferred: SemanticNode["inferredStyles"], prop: PropertyDefinition): string | number | undefined {
        if (!inferred) return undefined;
        const val = inferred[prop.inferredKey];
        if (val === undefined || val === null) return undefined;

        if (typeof val === "object" && !Array.isArray(val)) {
            const edge = prop.id.replace(/^(padding|margin)/, "").toLowerCase() as "top" | "right" | "bottom" | "left";
            return (val)[edge];
        }

        return val as string | number;
    }

    private compareProperty(
        property: string,
        expectedValue: string,
        actualValue: string,
        tokens: DesignTokenDictionary,
        selector: string,
        percentageReference?: number,
        metrics?: ContextMetrics
    ): PropertyDelta | null {
        const result = this.tokenResolver.compareWithTokens(
            property,
            expectedValue,
            actualValue,
            tokens,
            selector,
            metrics,
            percentageReference
        );

        if (result.isMatch) return null;

        const expectedNum = parseFloat(expectedValue);
        const actualNum = parseFloat(actualValue);
        const delta = isNaN(expectedNum) || isNaN(actualNum) ? 0 : actualNum - expectedNum;

        let severity: "exact" | "minor" | "major" = "minor";
        if (Math.abs(delta) > 8) severity = "major";
        if (Math.abs(delta) === 0 && expectedValue !== actualValue) severity = "minor";

        const cssRecommendation = this.tokenResolver.generateCssRecommendation(
            property,
            expectedValue,
            result.tokenName
        );

        return {
            property,
            figmaValue: expectedValue,
            caliperValue: actualValue,
            delta,
            severity,
            tokenName: result.tokenName,
            cssRecommendation,
            selector,
        };
    }

    private buildTokenUsageReport(
        deltas: PropertyDelta[],
    ): TokenUsageReport {
        const tokensUsedCorrectly: string[] = [];
        const tokensMissed: MissedToken[] = [];

        for (const delta of deltas) {
            if (delta.tokenName) {
                tokensMissed.push({
                    tokenName: delta.tokenName,
                    tokenCategory: this.getTokenCategory(delta.property),
                    expectedValue: delta.figmaValue,
                    actualValue: delta.caliperValue,
                    property: delta.property,
                    selector: delta.selector,
                });
            }
        }

        return { tokensUsedCorrectly, tokensMissed };
    }

    private getTokenCategory(property: string): "colors" | "spacing" | "typography" | "borderRadius" {
        const propDef = PROPERTY_REGISTRY.find(p => p.id === property);
        if (!propDef) return "spacing";

        // Map 'layout' or 'visual' or other categories to the 4 main token categories
        if (propDef.category === "colors") return "colors";
        if (propDef.category === "typography") return "typography";
        if (propDef.category === "borderRadius") return "borderRadius";

        return "spacing";
    }

    private generateCssRecommendations(deltas: PropertyDelta[], isResponsive: boolean): string {
        const grouped = new Map<string, PropertyDelta[]>();

        for (const delta of deltas) {
            const existing = grouped.get(delta.selector) || [];
            existing.push(delta);
            grouped.set(delta.selector, existing);
        }

        const blocks: string[] = [];
        for (const [selector, selectorDeltas] of grouped) {
            const rules = selectorDeltas.map(delta => `  ${delta.cssRecommendation}`).join("\n");
            blocks.push(`${selector} {\n${rules}\n}`);
        }

        return blocks.join("\n\n");
    }

    private generateResponsiveCss(
        caliperTree: CaliperNode,
        secondaryHtml: string,
        tokens: DesignTokenDictionary,
        framework: Framework,
        metrics?: ContextMetrics,
    ): string {
        const secondaryInput: ReconciliationInput = {
            caliperTree,
            expectedHtml: secondaryHtml,
            designTokens: tokens,
            framework,
            figmaLayerUrl: "",
            metrics,
        };

        const secondaryRoot = this.prepareTargetTree(secondaryHtml, secondaryInput);

        const actualIdLookup = new Map<string, CaliperNode>();
        const expectedIndexLookup = new Map<number, SemanticNode>();

        const pairing = pairHierarchically(caliperTree, secondaryRoot, actualIdLookup, expectedIndexLookup, {
            framework,
            tokens,
            metrics
        });
        const deltas = this.reconcileProperties(pairing, actualIdLookup, expectedIndexLookup, tokens, metrics);

        if (deltas.length === 0) return "";

        if (framework.endsWith("-tailwind")) {
            return this.generateTailwindResponsiveClasses(deltas, metrics?.viewportWidth);
        }

        const css = this.generateCssRecommendations(deltas, true);
        if (!css) return "";

        const breakpoint = metrics?.viewportWidth || 768;
        const viewportLabel = metrics?.viewportWidth ? `${metrics.viewportWidth}px` : "secondary";

        return `/* Responsive overrides for ${viewportLabel} view */
@media (max-width: ${breakpoint}px) {
${css.split("\n").map(line => `  ${line}`).join("\n")}
}`;
    }

    /**
     * Generates Tailwind utility classes with responsive prefixes for mobile breakpoints.
     */
    private generateTailwindResponsiveClasses(deltas: PropertyDelta[], viewportWidth?: number): string {
        const grouped = new Map<string, PropertyDelta[]>();

        for (const delta of deltas) {
            const existing = grouped.get(delta.selector) || [];
            existing.push(delta);
            grouped.set(delta.selector, existing);
        }

        // Map viewport width to Tailwind prefix
        // Tailwind breakpoints are min-width, so we pick the prefix that STARTS 
        // at or below our target viewport width.
        const getTailwindPrefix = (width: number): string => {
            if (width >= 1536) return "2xl";
            if (width >= 1280) return "xl";
            if (width >= 1024) return "lg";
            if (width >= 768) return "md";
            if (width >= 640) return "sm";
            return "max-sm"; // Use a max-width variant if available, or fallback to sm
        };

        const prefix = viewportWidth ? getTailwindPrefix(viewportWidth) : "sm";

        const recommendations: string[] = [];
        for (const [selector, selectorDeltas] of grouped) {
            const classes = selectorDeltas.map(delta => {
                const tailwindClass = this.cssToTailwindClass(delta.property, delta.figmaValue);
                return tailwindClass ? `${prefix}:${tailwindClass}` : null;
            }).filter(Boolean);

            if (classes.length > 0) {
                recommendations.push(`/* ${selector} (target: ${viewportWidth || "mobile"}px) */\n/* Add classes: ${classes.join(" ")} */`);
            }
        }

        return recommendations.join("\n\n");
    }

    /**
     * Converts a CSS property-value pair to a Tailwind utility class.
     */
    private cssToTailwindClass(property: string, value: string): string | null {
        const pxMatch = value.match(/^(\d+(?:\.\d+)?)px$/);
        const pxValue = pxMatch ? parseFloat(pxMatch[1] ?? "0") : null;

        const findSpacingToken = (px: number): string => {
            for (const [token, pxString] of Object.entries(SPACING_SCALE)) {
                const tokenPx = parseFloat(pxString);
                if (tokenPx === px) return token;
            }
            const entries = Object.entries(SPACING_SCALE)
                .map(([token, pxStr]) => ({ token, px: parseFloat(pxStr) }))
                .sort((a, b) => a.px - b.px);
            for (const entry of entries) {
                if (entry.px >= px) return entry.token;
            }
            return `[${px}px]`;
        };

        switch (property) {
            case "paddingTop": return pxValue !== null ? `pt-${findSpacingToken(pxValue)}` : null;
            case "paddingRight": return pxValue !== null ? `pr-${findSpacingToken(pxValue)}` : null;
            case "paddingBottom": return pxValue !== null ? `pb-${findSpacingToken(pxValue)}` : null;
            case "paddingLeft": return pxValue !== null ? `pl-${findSpacingToken(pxValue)}` : null;
            case "marginTop": return pxValue !== null ? `mt-${findSpacingToken(pxValue)}` : null;
            case "marginRight": return pxValue !== null ? `mr-${findSpacingToken(pxValue)}` : null;
            case "marginBottom": return pxValue !== null ? `mb-${findSpacingToken(pxValue)}` : null;
            case "marginLeft": return pxValue !== null ? `ml-${findSpacingToken(pxValue)}` : null;
            case "gap": return pxValue !== null ? `gap-${findSpacingToken(pxValue)}` : null;
            case "fontSize": return pxValue !== null ? `text-[${pxValue}px]` : null;
            case "width": return pxValue !== null ? `w-[${pxValue}px]` : null;
            case "height": return pxValue !== null ? `h-[${pxValue}px]` : null;
            case "display":
                if (value === "flex") return "flex";
                if (value === "grid") return "grid";
                if (value === "block") return "block";
                if (value === "none") return "hidden";
                return null;
            case "flexDirection":
                if (value === "column") return "flex-col";
                if (value === "row") return "flex-row";
                return null;
            default:
                return null;
        }
    }

    private buildSummary(
        pairing: HierarchicalPairingResult,
        deltas: PropertyDelta[]
    ): ReconciliationReport["summary"] {
        const highConfidence = pairing.pairs.filter(pair => pair.confidence >= 80).length;
        const lowConfidence = pairing.pairs.filter(pair => pair.confidence < 60).length;
        const majorDeltas = deltas.filter(delta => delta.severity === "major").length;
        const minorDeltas = deltas.filter(delta => delta.severity === "minor").length;

        return {
            totalPairs: pairing.pairs.length,
            highConfidencePairs: highConfidence,
            lowConfidencePairs: lowConfidence,
            unmatchedActual: pairing.unmatchedActualIds.length,
            unmatchedExpected: pairing.unmatchedExpectedIndices.length,
            totalDeltas: deltas.length,
            majorDeltas,
            minorDeltas,
        };
    }
}

export const semanticHarmonyReconciler = new SemanticHarmonyReconciler();
