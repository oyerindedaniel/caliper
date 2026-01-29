import type {
    CaliperNode,
    SemanticNode,
    NodePair,
    MatchSignal,
    DesignTokenDictionary,
    Framework,
    ContextMetrics,
} from "@oyerinde/caliper-schema";
import { inferStylesFromClasses, parseInlineStyles } from "./style-mapper.js";

interface MatchCandidate {
    actualIdx: number;
    expectedIdx: number;
    score: number;
    signals: MatchSignal[];
}

function calculateTagScore(actualTag: string, expectedTag: string): { score: number; signal: MatchSignal } {
    if (actualTag === expectedTag) {
        return { score: 100, signal: "tag_match" };
    }

    const semanticEquiv: Record<string, string[]> = {
        "div": ["section", "article", "main", "aside", "header", "footer", "nav"],
        "span": ["strong", "em", "b", "i", "small", "mark"],
        "a": ["button"],
        "button": ["a"],
    };

    const equiv = semanticEquiv[actualTag];
    if (equiv && equiv.includes(expectedTag)) {
        return { score: 50, signal: "tag_match" };
    }

    return { score: -50, signal: "tag_mismatch" };
}

function calculateIdScore(actualId: string | undefined, expectedId: string | undefined): { score: number; signal?: MatchSignal } {
    if (!actualId || !expectedId) return { score: 0 };
    if (actualId === expectedId) {
        return { score: 100, signal: "id_match" };
    }
    return { score: 0 };
}

function calculateTextScore(actualText: string | undefined, expectedText: string | undefined): { score: number; signal?: MatchSignal } {
    if (!actualText || !expectedText) return { score: 0 };

    const normalizedActual = actualText.toLowerCase().trim();
    const normalizedExpected = expectedText.toLowerCase().trim();

    if (normalizedActual === normalizedExpected) {
        return { score: 80, signal: "text_exact" };
    }

    if (normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual)) {
        return { score: 40, signal: "text_fuzzy" };
    }

    return { score: 0 };
}

function calculateClassScore(actualClasses: string[], expectedClasses: string[]): { score: number; signal?: MatchSignal } {
    if (actualClasses.length === 0 || expectedClasses.length === 0) return { score: 0 };

    const actualSet = new Set(actualClasses.map(className => className.toLowerCase()));
    const expectedSet = new Set(expectedClasses.map(className => className.toLowerCase()));

    let matches = 0;
    for (const cls of expectedSet) {
        if (actualSet.has(cls)) matches++;
    }

    if (matches > 0) {
        const overlap = matches / Math.max(actualSet.size, expectedSet.size);
        return { score: Math.round(overlap * 60), signal: "class_semantic" };
    }

    return { score: 0 };
}

function calculateChildCountScore(actualCount: number, expectedCount: number): { score: number; signal?: MatchSignal } {
    if (actualCount === expectedCount) {
        return { score: 20, signal: "child_count_match" };
    }

    const diff = Math.abs(actualCount - expectedCount);
    if (diff > 2) {
        return { score: -30, signal: "child_count_mismatch" };
    }

    return { score: 0 };
}

function calculateLayoutScore(
    actualStyles: CaliperNode["styles"],
    expectedStyles: SemanticNode["inferredStyles"]
): { score: number; signal?: MatchSignal } {
    if (!expectedStyles.display) return { score: 0 };

    const actualDisplay = actualStyles.display;
    const expectedDisplay = expectedStyles.display;

    if (actualDisplay === expectedDisplay) {
        if (expectedStyles.flexDirection && actualStyles.flexDirection === expectedStyles.flexDirection) {
            return { score: 30, signal: "layout_match" };
        }
        return { score: 20, signal: "layout_match" };
    }

    return { score: 0 };
}

export function calculateSemanticSimilarity(
    actual: CaliperNode,
    expected: SemanticNode,
    context?: { framework: Framework, tokens: DesignTokenDictionary, metrics?: ContextMetrics }
): { score: number; signals: MatchSignal[] } {
    if (context && Object.keys(expected.inferredStyles).length === 0) {
        const classStyles = inferStylesFromClasses(expected.classes, context.framework, context.tokens, context.metrics);
        const inlineStyles = expected.rawStyles ? parseInlineStyles(expected.rawStyles) : {};
        expected.inferredStyles = { ...classStyles, ...inlineStyles };
    }

    const signals: MatchSignal[] = [];
    let totalScore = 0;

    const tagResult = calculateTagScore(actual.tag, expected.tag);
    totalScore += tagResult.score;
    signals.push(tagResult.signal);

    const idResult = calculateIdScore(actual.htmlId, expected.id);
    totalScore += idResult.score;
    if (idResult.signal) signals.push(idResult.signal);

    const textResult = calculateTextScore(actual.textContent, expected.textContent);
    totalScore += textResult.score;
    if (textResult.signal) signals.push(textResult.signal);

    const classResult = calculateClassScore(actual.classes, expected.classes);
    totalScore += classResult.score;
    if (classResult.signal) signals.push(classResult.signal);

    const childResult = calculateChildCountScore(actual.children.length, expected.children.length);
    totalScore += childResult.score;
    if (childResult.signal) signals.push(childResult.signal);

    const layoutResult = calculateLayoutScore(actual.styles, expected.inferredStyles);
    totalScore += layoutResult.score;
    if (layoutResult.signal) signals.push(layoutResult.signal);

    const normalizedScore = Math.max(0, Math.min(100, totalScore));

    return { score: normalizedScore, signals };
}

export function greedyChildAlignment(
    actualChildren: CaliperNode[],
    expectedChildren: SemanticNode[],
    context?: { framework: Framework, tokens: DesignTokenDictionary, metrics?: ContextMetrics }
): Array<{ actualIdx: number; expectedIdx: number; score: number; signals: MatchSignal[] }> {
    if (actualChildren.length === 0 || expectedChildren.length === 0) {
        return [];
    }

    const candidates: MatchCandidate[] = [];

    for (let i = 0; i < actualChildren.length; i++) {
        for (let j = 0; j < expectedChildren.length; j++) {
            const { score, signals } = calculateSemanticSimilarity(actualChildren[i]!, expectedChildren[j]!, context);
            if (score > 10 || signals.includes("id_match")) {
                candidates.push({ actualIdx: i, expectedIdx: j, score, signals });
            }
        }
    }

    candidates.sort((a, b) => b.score - a.score);

    const usedActual = new Set<number>();
    const usedExpected = new Set<number>();
    const result: MatchCandidate[] = [];

    for (const candidate of candidates) {
        if (usedActual.has(candidate.actualIdx) || usedExpected.has(candidate.expectedIdx)) {
            continue;
        }

        if (candidate.score >= 30) {
            result.push(candidate);
            usedActual.add(candidate.actualIdx);
            usedExpected.add(candidate.expectedIdx);
        }
    }

    return result;
}

export interface HierarchicalPairingResult {
    pairs: NodePair[];
    unmatchedActualIds: string[];
    unmatchedExpectedIndices: number[];
}

export function pairHierarchically(
    actualRoot: CaliperNode,
    expectedRoot: SemanticNode,
    actualIdLookup: Map<string, CaliperNode>,
    expectedIndexLookup: Map<number, SemanticNode>,
    context?: { framework: Framework, tokens: DesignTokenDictionary, metrics?: ContextMetrics }
): HierarchicalPairingResult {
    const pairs: NodePair[] = [];
    const matchedActualIds = new Set<string>();
    const matchedExpectedIndices = new Set<number>();
    let expectedIndexCounter = 0;

    function assignIndex(node: SemanticNode): number {
        const idx = expectedIndexCounter++;
        expectedIndexLookup.set(idx, node);
        return idx;
    }

    function buildExpectedIndexMap(node: SemanticNode, parentIdx: number): void {
        for (const child of node.children) {
            assignIndex(child);
            buildExpectedIndexMap(child, expectedIndexCounter - 1);
        }
    }

    const rootExpectedIdx = assignIndex(expectedRoot);
    buildExpectedIndexMap(expectedRoot, rootExpectedIdx);

    function recurse(actual: CaliperNode, expected: SemanticNode, expectedIdx: number, depth: number): void {
        const { score, signals } = calculateSemanticSimilarity(actual, expected, context);

        pairs.push({
            actualNodeId: actual.agentId,
            expectedNodeIndex: expectedIdx,
            confidence: score,
            depth,
            matchSignals: signals,
        });

        matchedActualIds.add(actual.agentId);
        matchedExpectedIndices.add(expectedIdx);

        // greedyChildAlignment is O(Ca * Ce), we keep it as is but avoid redundant index searches.
        const childAlignments = greedyChildAlignment(actual.children, expected.children, context);

        for (const alignment of childAlignments) {
            const actualChild = actual.children[alignment.actualIdx]!;
            const expectedChild = expected.children[alignment.expectedIdx]!;


            const childExpectedIdx = nodeToIndex.get(expectedChild) ?? -1;
            recurse(actualChild, expectedChild, childExpectedIdx, depth + 1);
        }
    }

    const nodeToIndex = new Map<SemanticNode, number>();
    for (const [idx, node] of expectedIndexLookup.entries()) {
        nodeToIndex.set(node, idx);
    }

    recurse(actualRoot, expectedRoot, rootExpectedIdx, 0);

    const allActualIds: string[] = [];
    function collectActualIds(node: CaliperNode): void {
        allActualIds.push(node.agentId);
        actualIdLookup.set(node.agentId, node);
        for (const child of node.children) {
            collectActualIds(child);
        }
    }

    collectActualIds(actualRoot);

    const unmatchedActualIds = allActualIds.filter(id => !matchedActualIds.has(id));
    const unmatchedExpectedIndices: number[] = [];
    for (let i = 0; i < expectedIndexCounter; i++) {
        if (!matchedExpectedIndices.has(i)) {
            unmatchedExpectedIndices.push(i);
        }
    }

    return { pairs, unmatchedActualIds, unmatchedExpectedIndices };
}
