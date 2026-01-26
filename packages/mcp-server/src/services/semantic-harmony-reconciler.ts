import type {
    CaliperNode,
    SemanticNode,
    DesignTokenDictionary,
    Framework,
    ReconciliationReport,
    PropertyDelta,
    TokenUsageReport,
    MissedToken,
} from "@oyerinde/caliper-schema";

import { semanticParserService } from "./semantic-parser-service.js";
import { applyInferredStylesToTree } from "./style-mapper.js";
import { tokenResolverService, TokenResolverService } from "./token-resolver-service.js";
import { pairHierarchically, HierarchicalPairingResult } from "./semantic-matcher.js";

interface ReconciliationInput {
    caliperTree: CaliperNode;
    expectedHtml: string;
    designTokens: DesignTokenDictionary;
    framework: Framework;
    figmaLayerUrl: string;
    secondaryHtml?: string;
    secondaryTokens?: DesignTokenDictionary;
}

export class SemanticHarmonyReconciler {
    private tokenResolver: TokenResolverService;

    constructor() {
        this.tokenResolver = tokenResolverService;
    }

    reconcile(input: ReconciliationInput): ReconciliationReport {
        const startTime = performance.now();

        const expectedRoot = semanticParserService.parse(input.expectedHtml);
        applyInferredStylesToTree(expectedRoot, input.framework);

        this.tokenResolver.buildIndex(input.designTokens);

        const actualIdLookup = new Map<string, CaliperNode>();
        const expectedIndexLookup = new Map<number, SemanticNode>();

        const pairingResult = pairHierarchically(
            input.caliperTree,
            expectedRoot,
            actualIdLookup,
            expectedIndexLookup
        );

        const deltas = this.reconcileProperties(
            pairingResult,
            actualIdLookup,
            expectedIndexLookup,
            input.designTokens
        );

        const tokenUsageReport = this.buildTokenUsageReport(deltas, input.designTokens);

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
        tokens: DesignTokenDictionary
    ): PropertyDelta[] {
        const deltas: PropertyDelta[] = [];

        for (const pair of pairing.pairs) {
            const actual = actualLookup.get(pair.actualNodeId);
            const expected = expectedLookup.get(pair.expectedNodeIndex);
            if (!actual || !expected) continue;

            const nodeDeltas = this.diffNode(actual, expected, tokens);
            deltas.push(...nodeDeltas);
        }

        return deltas;
    }

    private diffNode(
        actual: CaliperNode,
        expected: SemanticNode,
        tokens: DesignTokenDictionary
    ): PropertyDelta[] {
        const deltas: PropertyDelta[] = [];
        const selector = actual.selector;
        const inferred = expected.inferredStyles;

        if (inferred.gap && actual.styles.gap !== null) {
            const delta = this.compareProperty("gap", inferred.gap, `${actual.styles.gap}px`, tokens, selector);
            if (delta) deltas.push(delta);
        }

        if (inferred.padding) {
            const paddingProps: Array<["paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft", keyof typeof inferred.padding]> = [
                ["paddingTop", "top"],
                ["paddingRight", "right"],
                ["paddingBottom", "bottom"],
                ["paddingLeft", "left"],
            ];
            for (const [cssProp, edge] of paddingProps) {
                const expectedVal = inferred.padding[edge];
                const actualVal = `${actual.styles.padding[edge]}px`;
                const delta = this.compareProperty(cssProp, expectedVal, actualVal, tokens, selector);
                if (delta) deltas.push(delta);
            }
        }

        if (inferred.margin) {
            const marginProps: Array<["marginTop" | "marginRight" | "marginBottom" | "marginLeft", keyof typeof inferred.margin]> = [
                ["marginTop", "top"],
                ["marginRight", "right"],
                ["marginBottom", "bottom"],
                ["marginLeft", "left"],
            ];
            for (const [cssProp, edge] of marginProps) {
                const expectedVal = inferred.margin[edge];
                const actualVal = `${actual.styles.margin[edge]}px`;
                const delta = this.compareProperty(cssProp, expectedVal, actualVal, tokens, selector);
                if (delta) deltas.push(delta);
            }
        }

        if (inferred.fontSize) {
            const delta = this.compareProperty("fontSize", inferred.fontSize, `${actual.styles.fontSize}px`, tokens, selector);
            if (delta) deltas.push(delta);
        }

        if (inferred.fontWeight) {
            const delta = this.compareProperty("fontWeight", inferred.fontWeight, actual.styles.fontWeight, tokens, selector);
            if (delta) deltas.push(delta);
        }

        if (inferred.borderRadius) {
            const delta = this.compareProperty("borderRadius", inferred.borderRadius, actual.styles.borderRadius, tokens, selector);
            if (delta) deltas.push(delta);
        }

        if (inferred.backgroundColor) {
            const delta = this.compareProperty("backgroundColor", inferred.backgroundColor, actual.styles.backgroundColor, tokens, selector);
            if (delta) deltas.push(delta);
        }

        if (inferred.color) {
            const delta = this.compareProperty("color", inferred.color, actual.styles.color, tokens, selector);
            if (delta) deltas.push(delta);
        }

        if (inferred.width) {
            const delta = this.compareProperty("width", inferred.width, `${actual.rect.width}px`, tokens, selector);
            if (delta) deltas.push(delta);
        }

        if (inferred.height) {
            const delta = this.compareProperty("height", inferred.height, `${actual.rect.height}px`, tokens, selector);
            if (delta) deltas.push(delta);
        }

        return deltas;
    }

    private compareProperty(
        property: string,
        expectedValue: string,
        actualValue: string,
        tokens: DesignTokenDictionary,
        selector: string
    ): PropertyDelta | null {
        const result = this.tokenResolver.compareWithTokens(
            property,
            expectedValue,
            actualValue,
            tokens,
            selector
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
        tokens: DesignTokenDictionary
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
        const colorProps = ["color", "backgroundColor", "borderColor"];
        if (colorProps.includes(property)) return "colors";
        if (property === "borderRadius") return "borderRadius";
        if (property === "fontSize" || property === "fontWeight") return "typography";
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
            const rules = selectorDeltas.map(d => `  ${d.cssRecommendation}`).join("\n");
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
        applyInferredStylesToTree(secondaryRoot, framework);

        const actualIdLookup = new Map<string, CaliperNode>();
        const expectedIndexLookup = new Map<number, SemanticNode>();

        const pairing = pairHierarchically(caliperTree, secondaryRoot, actualIdLookup, expectedIndexLookup);
        const deltas = this.reconcileProperties(pairing, actualIdLookup, expectedIndexLookup, tokens);

        const css = this.generateCssRecommendations(deltas, true);

        if (!css) return "";

        return `@media (max-width: 768px) {\n${css.split("\n").map(line => `  ${line}`).join("\n")}\n}`;
    }

    private buildSummary(
        pairing: HierarchicalPairingResult,
        deltas: PropertyDelta[]
    ): ReconciliationReport["summary"] {
        const highConfidence = pairing.pairs.filter(p => p.confidence >= 80).length;
        const lowConfidence = pairing.pairs.filter(p => p.confidence < 60).length;
        const majorDeltas = deltas.filter(d => d.severity === "major").length;
        const minorDeltas = deltas.filter(d => d.severity === "minor").length;

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
