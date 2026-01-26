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
import { tokenResolverService, TokenResolverService } from "./token-resolver-service.js";
import { pairHierarchically, HierarchicalPairingResult } from "./semantic-matcher.js";

interface ReconciliationInput {
    caliperTree: CaliperNode;
    expectedHtml: string;
    designTokens: DesignTokenDictionary;
    framework: Framework;
    figmaLayerUrl: string;
    metrics?: ContextMetrics;
    secondaryHtml?: string;
    secondaryTokens?: DesignTokenDictionary;
}

interface PropertyDefinition {
    id: string;
    inferredKey: keyof NonNullable<SemanticNode["inferredStyles"]>;
    actualValue: (node: CaliperNode, parentWidth: number, parentHeight: number) => string | null;
    percentageBasis?: (parentWidth: number, parentHeight: number, node: CaliperNode) => number;
    category: "colors" | "spacing" | "typography" | "borderRadius";
}

const PROPERTY_REGISTRY: PropertyDefinition[] = [
    { id: "gap", inferredKey: "gap", actualValue: node => node.styles.gap !== null ? `${node.styles.gap}px` : null, percentageBasis: width => width, category: "spacing" },
    { id: "paddingTop", inferredKey: "padding", actualValue: node => `${node.styles.padding.top}px`, percentageBasis: width => width, category: "spacing" },
    { id: "paddingRight", inferredKey: "padding", actualValue: node => `${node.styles.padding.right}px`, percentageBasis: width => width, category: "spacing" },
    { id: "paddingBottom", inferredKey: "padding", actualValue: node => `${node.styles.padding.bottom}px`, percentageBasis: width => width, category: "spacing" },
    { id: "paddingLeft", inferredKey: "padding", actualValue: node => `${node.styles.padding.left}px`, percentageBasis: width => width, category: "spacing" },
    { id: "marginTop", inferredKey: "margin", actualValue: node => `${node.styles.margin.top}px`, percentageBasis: width => width, category: "spacing" },
    { id: "marginRight", inferredKey: "margin", actualValue: node => `${node.styles.margin.right}px`, percentageBasis: width => width, category: "spacing" },
    { id: "marginBottom", inferredKey: "margin", actualValue: node => `${node.styles.margin.bottom}px`, percentageBasis: width => width, category: "spacing" },
    { id: "marginLeft", inferredKey: "margin", actualValue: node => `${node.styles.margin.left}px`, percentageBasis: width => width, category: "spacing" },
    { id: "fontSize", inferredKey: "fontSize", actualValue: node => `${node.styles.fontSize}px`, percentageBasis: (_, __, node) => node.styles.fontSize, category: "typography" },
    { id: "fontWeight", inferredKey: "fontWeight", actualValue: node => node.styles.fontWeight, category: "typography" },
    { id: "lineHeight", inferredKey: "lineHeight", actualValue: node => node.styles.lineHeight === "normal" ? "normal" : `${node.styles.lineHeight}px`, percentageBasis: (_, __, node) => node.styles.fontSize, category: "typography" },
    { id: "letterSpacing", inferredKey: "letterSpacing", actualValue: node => node.styles.letterSpacing === "normal" ? "normal" : `${node.styles.letterSpacing}px`, percentageBasis: (_, __, node) => node.styles.fontSize, category: "typography" },
    { id: "borderRadius", inferredKey: "borderRadius", actualValue: node => node.styles.borderRadius, percentageBasis: width => width, category: "borderRadius" },
    { id: "backgroundColor", inferredKey: "backgroundColor", actualValue: node => node.styles.backgroundColor, category: "colors" },
    { id: "borderColor", inferredKey: "borderColor", actualValue: node => node.styles.borderColor || null, category: "colors" },
    { id: "color", inferredKey: "color", actualValue: node => node.styles.color, category: "colors" },
    { id: "boxShadow", inferredKey: "boxShadow", actualValue: node => node.styles.boxShadow || "none", category: "spacing" },
    { id: "opacity", inferredKey: "opacity", actualValue: node => String(node.styles.opacity), category: "spacing" },
    { id: "outline", inferredKey: "outline", actualValue: node => node.styles.outline || "none", category: "spacing" },
    { id: "outlineColor", inferredKey: "outlineColor", actualValue: node => node.styles.outlineColor || null, category: "colors" },
    { id: "zIndex", inferredKey: "zIndex", actualValue: node => node.styles.zIndex === null ? "auto" : String(node.styles.zIndex), category: "spacing" },
    { id: "width", inferredKey: "width", actualValue: node => `${node.rect.width}px`, percentageBasis: width => width, category: "spacing" },
    { id: "height", inferredKey: "height", actualValue: node => `${node.rect.height}px`, percentageBasis: (_, height) => height, category: "spacing" },
];

export class SemanticHarmonyReconciler {
    private tokenResolver: TokenResolverService;

    constructor() {
        this.tokenResolver = tokenResolverService;
    }

    reconcile(input: ReconciliationInput): ReconciliationReport {
        const startTime = performance.now();

        const expectedRoot = semanticParserService.parse(input.expectedHtml);
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
                input.framework
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

        for (const prop of PROPERTY_REGISTRY) {
            const expectedVal = this.getExpectedValue(inferred, prop);
            if (expectedVal === undefined || expectedVal === null) continue;

            const actualVal = prop.actualValue(actual, parentWidth, parentHeight);
            if (actualVal === null) continue;

            const basis = prop.percentageBasis ? prop.percentageBasis(parentWidth, parentHeight, actual) : undefined;

            const delta = this.compareProperty(
                prop.id,
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

    private getExpectedValue(inferred: SemanticNode["inferredStyles"], prop: PropertyDefinition): any {
        const val = inferred[prop.inferredKey];
        if (!val) return undefined;

        if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            const edge = prop.id.replace(/^(padding|margin)/, "").toLowerCase() as "top" | "right" | "bottom" | "left";
            return (val)[edge];
        }

        return val;
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
        const colorProps = ["color", "backgroundColor", "borderColor", "outlineColor"];
        if (colorProps.includes(property)) return "colors";
        if (property === "borderRadius") return "borderRadius";
        if (property === "fontSize" || property === "fontWeight" || property === "lineHeight" || property === "letterSpacing") return "typography";
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
        framework: Framework
    ): string {
        const secondaryRoot = semanticParserService.parse(secondaryHtml);

        const actualIdLookup = new Map<string, CaliperNode>();
        const expectedIndexLookup = new Map<number, SemanticNode>();

        const pairing = pairHierarchically(caliperTree, secondaryRoot, actualIdLookup, expectedIndexLookup, {
            framework,
            tokens
        });
        const deltas = this.reconcileProperties(pairing, actualIdLookup, expectedIndexLookup, tokens);

        const css = this.generateCssRecommendations(deltas, true);

        if (!css) return "";

        return `@media (max-width: 768px) {\n${css.split("\n").map(line => `  ${line}`).join("\n")}\n}`;
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
