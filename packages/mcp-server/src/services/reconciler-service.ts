import {
    FigmaFrameContext,
    CaliperNode,
    ReconciliationReport,
    AuditStrategy,
    PropertyDelta,
    NodePair,
    PairingReport,
    NodeReconciliationResult,
    FigmaNode,
    Anchor,
    StrategyAnalysis,
} from "@oyerinde/caliper-schema";

export class ReconcilerService {
    public reconcile(
        caliperTree: CaliperNode,
        figmaPrimary: FigmaFrameContext,
        figmaSecondary?: FigmaFrameContext,
        strategy: AuditStrategy = "A"
    ): ReconciliationReport {
        const pairingPrimary = this.pairNodes(caliperTree, figmaPrimary.rootNode);

        const pairingSecondary = figmaSecondary
            ? this.pairNodes(caliperTree, figmaSecondary.rootNode)
            : null;

        const results: NodeReconciliationResult[] = pairingPrimary.pairs.map((primaryPair) => {
            const secondaryMatch = pairingSecondary?.pairs.find(
                pair => pair.caliperNode.agentId === primaryPair.caliperNode.agentId
            )?.figmaNode || null;

            return this.reconcilePair(
                primaryPair,
                secondaryMatch,
                figmaPrimary,
                figmaSecondary,
                strategy
            );
        });

        const summary = {
            totalNodes: results.length,
            matchedNodes: results.filter((result) => result.status === "MATCH").length,
            driftedNodes: results.filter((result) => result.status !== "MATCH" && result.status !== "UNMATCHED").length,
            unmatchedNodes: pairingPrimary.unmatchedCaliper.length + pairingPrimary.unmatchedFigma.length,
        };

        const baseCSS = this.generateBaseCSS(results);
        const responsiveCSS = figmaSecondary
            ? {
                breakpoint: figmaSecondary.frameWidth,
                query: `@media (max-width: ${figmaSecondary.frameWidth}px)`,
                css: this.generateSecondaryCSS(results),
            }
            : undefined;

        const anchors = this.extractAnchors(results);

        return {
            summary,
            results,
            baseCSS,
            responsiveCSS,
            anchors,
        };
    }

    private pairNodes(caliperTree: CaliperNode, figmaRoot: FigmaNode): PairingReport {
        const pairs: NodePair[] = [];
        const unmatchedCaliper: CaliperNode[] = [];
        const unmatchedFigma: FigmaNode[] = [];

        const caliperNodes = this.flattenCaliperTree(caliperTree);
        const figmaNodes = this.flattenFigmaTree(figmaRoot);

        const usedFigma = new Set<string>();
        const usedCaliper = new Set<string>();

        for (const caliperNode of caliperNodes) {
            for (const figmaNode of figmaNodes) {
                if (usedFigma.has(figmaNode.id) || usedCaliper.has(caliperNode.agentId)) continue;
                const score = this.calculateMatchScore(caliperNode, figmaNode);
                if (score >= 80) {
                    pairs.push({
                        caliperNode: caliperNode,
                        figmaNode: figmaNode,
                        matchConfidence: score,
                        matchReason: this.getMatchReason(score),
                    });
                    usedFigma.add(figmaNode.id);
                    usedCaliper.add(caliperNode.agentId);
                }
            }
        }

        for (const caliperNode of caliperNodes) {
            if (usedCaliper.has(caliperNode.agentId)) continue;
            let bestMatch: FigmaNode | null = null;
            let bestScore = 0;
            for (const figmaNode of figmaNodes) {
                if (usedFigma.has(figmaNode.id)) continue;
                const score = this.calculateMatchScore(caliperNode, figmaNode);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = figmaNode;
                }
            }
            if (bestMatch && bestScore >= 40) {
                pairs.push({
                    caliperNode: caliperNode,
                    figmaNode: bestMatch,
                    matchConfidence: bestScore,
                    matchReason: this.getMatchReason(bestScore),
                });
                usedFigma.add(bestMatch.id);
                usedCaliper.add(caliperNode.agentId);
            } else {
                unmatchedCaliper.push(caliperNode);
            }
        }

        for (const figmaNode of figmaNodes) {
            if (!usedFigma.has(figmaNode.id)) unmatchedFigma.push(figmaNode);
        }

        return {
            pairs,
            unmatchedCaliper,
            unmatchedFigma,
            structuralMatch: unmatchedCaliper.length === 0 && unmatchedFigma.length === 0,
        };
    }

    private calculateMatchScore(caliperNode: CaliperNode, figmaNode: FigmaNode): number {
        let score = 0;
        if (caliperNode.htmlId && figmaNode.name.toLowerCase().includes(caliperNode.htmlId.toLowerCase())) score += 50;
        if (caliperNode.htmlId === figmaNode.id) score += 90;
        if (caliperNode.textContent && figmaNode.type === "TEXT") {
            const caliperText = caliperNode.textContent.toLowerCase();
            const figmaText = figmaNode.name.toLowerCase();
            if (caliperText === figmaText || caliperText.includes(figmaText) || caliperText.includes(caliperText)) score += 40;
        }
        if (caliperNode.tag === "button" && figmaNode.name.toLowerCase().includes("button")) score += 10;
        if (caliperNode.tag === "img" && figmaNode.type === "RECTANGLE") score += 5;
        if (caliperNode.measurements.indexInParent === 0 && figmaNode.name.toLowerCase().includes("header")) score += 5;
        return Math.min(100, score);
    }

    private getMatchReason(score: number): string {
        if (score >= 90) return "Exact identifier match";
        if (score >= 80) return "Unique content match";
        if (score >= 60) return "Strong structural similarity";
        return "Fuzzy heuristic match";
    }

    private flattenCaliperTree(node: CaliperNode): CaliperNode[] {
        let result = [node];
        for (const child of node.children) {
            result = result.concat(this.flattenCaliperTree(child));
        }
        return result;
    }

    private flattenFigmaTree(node: FigmaNode): FigmaNode[] {
        let result = [node];
        if (node.children) {
            for (const child of node.children) {
                result = result.concat(this.flattenFigmaTree(child));
            }
        }
        return result;
    }

    private reconcilePair(
        primaryPair: NodePair,
        secondaryFigmaNode: FigmaNode | null,
        primaryContext: FigmaFrameContext,
        secondaryContext: FigmaFrameContext | undefined,
        strategy: AuditStrategy
    ): NodeReconciliationResult {
        const deltas: PropertyDelta[] = [];
        const baseRecommendations: string[] = [];
        const secondaryRecommendations: string[] = [];

        const caliperNode = primaryPair.caliperNode;
        const figmaNodePrimary = primaryPair.figmaNode;

        if (!figmaNodePrimary) {
            return {
                pair: primaryPair,
                status: "UNMATCHED",
                deltas: [],
                strategyAnalysis: { strategy, isCompliant: false },
                cssRecommendations: [],
            };
        }

        this.auditNodeState(caliperNode, figmaNodePrimary, deltas, baseRecommendations);

        const primaryAnalysis = this.performStrategyAnalysis(caliperNode, figmaNodePrimary, primaryContext, strategy);
        if (!primaryAnalysis.isCompliant) {
            this.addStrategyDeltas(primaryAnalysis, deltas, baseRecommendations);
        }

        if (secondaryFigmaNode && secondaryContext) {
            const secondaryDeltas: PropertyDelta[] = [];
            this.auditNodeState(caliperNode, secondaryFigmaNode, secondaryDeltas, secondaryRecommendations);

            const filteredSecondary = secondaryRecommendations.filter(recommendation => !baseRecommendations.includes(recommendation));
            secondaryRecommendations.length = 0;
            secondaryRecommendations.push(...filteredSecondary);
        }

        let status: "MATCH" | "MINOR_DRIFT" | "MAJOR_DRIFT" = "MATCH";
        if (deltas.some((delta) => delta.severity === "major")) status = "MAJOR_DRIFT";
        else if (deltas.some((delta) => delta.severity === "minor")) status = "MINOR_DRIFT";

        return {
            pair: primaryPair,
            status,
            deltas,
            strategyAnalysis: primaryAnalysis,
            cssRecommendations: baseRecommendations,
            secondaryRecommendations: secondaryRecommendations.length > 0 ? secondaryRecommendations : undefined,
        };
    }

    private auditNodeState(
        caliperNode: CaliperNode,
        figmaNode: FigmaNode,
        deltas: PropertyDelta[],
        recommendations: string[]
    ) {
        const designWidth = figmaNode.absoluteBoundingBox.width;
        if (Math.abs(caliperNode.rect.width - designWidth) > 1) {
            const delta = caliperNode.rect.width - designWidth;
            deltas.push({
                property: "width",
                figmaValue: `${designWidth}px`,
                caliperValue: `${caliperNode.rect.width}px`,
                delta: delta,
                severity: Math.abs(delta) > 8 ? "major" : "minor",
                cssRecommendation: `width: ${designWidth}px;`,
            });
            recommendations.push(`width: ${designWidth}px;`);
        }

        if (figmaNode.layout) {
            const figmaLayout = figmaNode.layout;
            const caliperPadding = caliperNode.styles.padding;

            const checkEdge = (property: string, figmaValue: number | undefined, caliperValue: number) => {
                if (figmaValue !== undefined && Math.abs(caliperValue - figmaValue) > 0.5) {
                    const delta = caliperValue - figmaValue;
                    deltas.push({
                        property: property,
                        figmaValue: `${figmaValue}px`,
                        caliperValue: `${caliperValue}px`,
                        delta: delta,
                        severity: Math.abs(delta) > 4 ? "major" : "minor",
                        cssRecommendation: `${property}: ${figmaValue}px;`,
                    });
                    recommendations.push(`${property}: ${figmaValue}px;`);
                }
            };

            checkEdge("padding-top", figmaLayout.paddingTop, caliperPadding.top);
            checkEdge("padding-right", figmaLayout.paddingRight, caliperPadding.right);
            checkEdge("padding-bottom", figmaLayout.paddingBottom, caliperPadding.bottom);
            checkEdge("padding-left", figmaLayout.paddingLeft, caliperPadding.left);
        }
    }

    private performStrategyAnalysis(
        caliperNode: CaliperNode,
        figmaNode: FigmaNode,
        context: FigmaFrameContext,
        strategy: AuditStrategy
    ): StrategyAnalysis {
        const analysis: StrategyAnalysis = { strategy, isCompliant: true };
        if (strategy === "A") {
            const expectedCenterX = context.frameWidth / 2;
            const actualCenterX = caliperNode.rect.left + caliperNode.rect.width / 2;
            analysis.expectedCenterX = expectedCenterX;
            analysis.actualCenterX = actualCenterX;
            analysis.centerDelta = actualCenterX - expectedCenterX;
            analysis.isCompliant = Math.abs(analysis.centerDelta || 0) < 5;
        } else if (strategy === "B") {
            if (figmaNode.layout) {
                analysis.expectedPaddingLeft = figmaNode.layout.paddingLeft;
                analysis.actualPaddingLeft = caliperNode.styles.padding.left;
                analysis.isCompliant = Math.abs((analysis.expectedPaddingLeft || 0) - (analysis.actualPaddingLeft || 0)) < 1;
            }
        }
        return analysis;
    }

    private addStrategyDeltas(analysis: StrategyAnalysis, deltas: PropertyDelta[], recommendations: string[]) {
        if (analysis.strategy === "A" && !analysis.isCompliant) {
            deltas.push({
                property: "alignment",
                figmaValue: "centered",
                caliperValue: `${analysis.actualCenterX ? analysis.actualCenterX.toFixed(1) : 0}x`,
                delta: analysis.centerDelta || 0,
                severity: "major",
                cssRecommendation: "margin-left: auto; margin-right: auto;",
            });
            if (!recommendations.includes("margin-left: auto; margin-right: auto;")) {
                recommendations.push("margin-left: auto; margin-right: auto;");
            }
        }
    }

    private generateBaseCSS(results: NodeReconciliationResult[]): string {
        return results
            .filter((result) => result.status !== "MATCH" && result.status !== "UNMATCHED" && result.cssRecommendations.length > 0)
            .map((result) => `${result.pair.caliperNode.selector} {\n  ${result.cssRecommendations.join("\n  ")}\n}`)
            .join("\n\n");
    }

    private generateSecondaryCSS(results: NodeReconciliationResult[]): string {
        return results
            .filter((result) => result.secondaryRecommendations && result.secondaryRecommendations.length > 0)
            .map((result) => `${result.pair.caliperNode.selector} {\n  ${result.secondaryRecommendations!.join("\n  ")}\n}`)
            .join("\n\n");
    }

    private extractAnchors(results: NodeReconciliationResult[]): Anchor[] {
        const anchors: Anchor[] = [];
        const seen = new Set<string>();
        for (const result of results) {
            const node = result.pair.caliperNode;
            if (node.htmlId && !seen.has(node.htmlId)) {
                anchors.push({
                    type: "id",
                    value: node.htmlId,
                    confidence: 100,
                    grepQuery: `id="${node.htmlId}"`,
                });
                seen.add(node.htmlId);
            } else if (node.textContent && node.textContent.length > 10 && !seen.has(node.textContent)) {
                anchors.push({
                    type: "text",
                    value: node.textContent,
                    confidence: 80,
                    grepQuery: node.textContent,
                });
                seen.add(node.textContent);
            }
        }
        return anchors;
    }
}

export const reconcilerService = new ReconcilerService();
