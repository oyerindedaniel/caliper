import { describe, it, expect } from 'vitest';
import { calculateSemanticSimilarity, greedyChildAlignment } from './semantic-matcher.js';
import type { CaliperNode, SemanticNode } from '@oyerinde/caliper-schema';

describe('SemanticMatcher Hardening', () => {
    const createBaseCaliper = (tag: string, agentId: string): CaliperNode => ({
        agentId, tag, selector: tag, classes: [],
        rect: { top: 0, left: 0, width: 100, height: 100, bottom: 100, right: 100, x: 0, y: 0 },
        viewportRect: { top: 0, left: 0 }, depth: 0, childCount: 0, children: [],
        styles: {
            display: 'block', position: 'static', boxSizing: 'border-box',
            fontSize: 16, fontWeight: '400', fontFamily: 'serif',
            color: 'black', backgroundColor: 'white', padding: { top: 0, right: 0, bottom: 0, left: 0 },
            margin: { top: 0, right: 0, bottom: 0, left: 0 }, border: { top: 0, right: 0, bottom: 0, left: 0 },
            borderRadius: '0px', opacity: 1, overflow: 'visible', overflowX: 'visible', overflowY: 'visible',
            gap: null, lineHeight: 'normal', letterSpacing: 'normal', zIndex: null,
        },
        measurements: {
            toParent: { top: 0, left: 0, bottom: 0, right: 0 },
            toPreviousSibling: null, toNextSibling: null,
            indexInParent: 0, siblingCount: 1
        }
    });

    const createBaseSemantic = (tag: string): SemanticNode => ({
        tag, classes: [], inferredStyles: {}, children: []
    });

    it('should correctly score semantic equivalents (div vs section)', () => {
        const actual = createBaseCaliper('div', '1');
        const expected = createBaseSemantic('section');

        const { score, signals } = calculateSemanticSimilarity(actual, expected);
        expect(score).toBeGreaterThan(0);
        expect(signals).toContain('tag_match'); // 50 points
    });

    it('should reject non-equivalent tags', () => {
        const actual = createBaseCaliper('p', '1');
        const expected = createBaseSemantic('button');

        const { score, signals } = calculateSemanticSimilarity(actual, expected);
        expect(score).toBe(0); // -50 clamped to 0
        expect(signals).toContain('tag_mismatch');
    });

    it('should align children correctly with noisy/interleaved elements', () => {
        const actual: CaliperNode[] = [
            createBaseCaliper('span', 'actual-1'), // Noise
            createBaseCaliper('div', 'actual-2'),  // Target
            createBaseCaliper('p', 'actual-3'),    // Target
        ];

        const expected: SemanticNode[] = [
            { ...createBaseSemantic('div'), textContent: 'Match 1' },
            { ...createBaseSemantic('p'), textContent: 'Match 2' },
        ];

        actual[1]!.textContent = 'Match 1';
        actual[2]!.textContent = 'Match 2';

        const alignment = greedyChildAlignment(actual, expected);

        expect(alignment.length).toBe(2);
        expect(alignment[0]!.actualIdx).toBe(1); // div -> div
        expect(alignment[1]!.actualIdx).toBe(2); // p -> p
    });

    it('should prioritize ID match over tag similarity', () => {
        const actual = { ...createBaseCaliper('div', '1'), htmlId: 'target' };
        const expected = { ...createBaseSemantic('section'), id: 'target' };

        const { score } = calculateSemanticSimilarity(actual, expected);
        // Tag match (50) + ID match (100) = 150 clamped to 100
        expect(score).toBe(100);
    });
});
