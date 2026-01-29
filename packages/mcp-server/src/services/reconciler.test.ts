import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticHarmonyReconciler } from './semantic-harmony-reconciler.js';
import type { CaliperNode, DesignTokenDictionary } from '@oyerinde/caliper-schema';
import { DEFAULT_CONTEXT_METRICS } from '@oyerinde/caliper-schema';

describe('SemanticHarmonyReconciler Integration', () => {
    let reconciler: SemanticHarmonyReconciler;

    beforeEach(() => {
        reconciler = new SemanticHarmonyReconciler();
    });

    const mockTokens: DesignTokenDictionary = {
        colors: {
            'brand-red': '#ff0000',
            'brand-blue': '#0000ff',
            'white': '#ffffff'
        },
        spacing: {
            'space-4': '16px',
            'space-8': '32px'
        },
        typography: {
            'body-lg': { fontSize: 18, fontWeight: 400, fontFamily: 'Inter' }
        },
        borderRadius: {
            'rounded-lg': '8px'
        }
    };

    const mockMetrics = DEFAULT_CONTEXT_METRICS;

    it('should correctly reconcile a matching button component', () => {
        const caliperTree: CaliperNode = {
            agentId: 'node-1',
            tag: 'button',
            selector: 'button.btn-primary',
            classes: ['btn-primary', 'p-4'],
            rect: { top: 100, left: 100, width: 200, height: 50, bottom: 150, right: 300, x: 100, y: 100 },
            viewportRect: { top: 100, left: 100 },
            depth: 0,
            childCount: 0,
            children: [],
            styles: {
                display: 'block',
                position: 'static',
                boxSizing: 'border-box',
                backgroundColor: 'rgb(255, 0, 0)', // brand-red
                fontSize: 16, // Wrong! Expected 18px (body-lg)
                fontWeight: '400',
                fontFamily: 'Inter',
                padding: { top: 16, right: 16, bottom: 16, left: 16 }, // space-4
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                border: { top: 0, right: 0, bottom: 0, left: 0 },
                borderRadius: '8px', // rounded-lg
                opacity: 1,
                color: 'white',
                overflow: 'visible',
                overflowX: 'visible',
                overflowY: 'visible',
                gap: null,
                lineHeight: 'normal',
                letterSpacing: 'normal',
                zIndex: null,
            },
            measurements: {
                toParent: { top: 0, left: 0, bottom: 0, right: 0 },
                toPreviousSibling: null,
                toNextSibling: null,
                indexInParent: 0,
                siblingCount: 1
            }
        };

        const expectedHtml = `
            <button class="brand-red p-space-4 rounded-lg text-body-lg">
                Click Me
            </button>
        `;

        const report = reconciler.reconcile({
            caliperTree,
            expectedHtml,
            designTokens: mockTokens,
            framework: 'react-tailwind',
            figmaLayerUrl: 'https://figma.com/test',
            metrics: mockMetrics
        });

        expect(report.summary.totalPairs).toBe(1);
        expect(report.summary.highConfidencePairs).toBe(1);

        // fontSize should be a delta (16px vs 18px)
        const fontSizeDelta = report.deltas.find(d => d.property === 'fontSize');
        expect(fontSizeDelta).toBeDefined();
        expect(fontSizeDelta?.severity).toBe('minor');
        expect(fontSizeDelta?.tokenName).toBe('body-lg');

        // backgroundColor should be matched (brand-red)
        const bgDelta = report.deltas.find(d => d.property === 'backgroundColor');
        expect(bgDelta).toBeUndefined(); // Matching should result in 0 deltas
    });

    it('should identify structural mismatches (missing elements)', () => {
        const caliperTree: CaliperNode = {
            agentId: 'node-1', tag: 'div', selector: 'div', classes: [],
            rect: { top: 0, left: 0, width: 100, height: 100, bottom: 100, right: 100, x: 0, y: 0 },
            viewportRect: { top: 0, left: 0 }, depth: 0, childCount: 0, children: [],
            styles: {
                display: 'block', position: 'static', boxSizing: 'border-box',
                fontSize: 16, fontWeight: '400', fontFamily: 'serif',
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                border: { top: 0, right: 0, bottom: 0, left: 0 },
                borderRadius: '0px', opacity: 1, color: 'black', backgroundColor: 'white',
                overflow: 'visible', overflowX: 'visible', overflowY: 'visible',
                gap: null, lineHeight: 'normal', letterSpacing: 'normal', zIndex: null,
            },
            measurements: {
                toParent: { top: 0, left: 0, bottom: 0, right: 0 },
                toPreviousSibling: null, toNextSibling: null,
                indexInParent: 0, siblingCount: 1
            }
        };

        // Figma expects a div WITH a span inside
        const expectedHtml = `
            <div>
                <span>Missing!</span>
            </div>
        `;

        const report = reconciler.reconcile({
            caliperTree,
            expectedHtml,
            designTokens: mockTokens,
            framework: 'react-tailwind',
            figmaLayerUrl: 'https://figma.com/test',
            metrics: mockMetrics
        });

        expect(report.summary.totalPairs).toBe(1); // Div matched
        expect(report.summary.unmatchedExpected).toBe(1); // Span unmatched
    });

    it('should reconcile properties even when tokens are missing', () => {
        const caliperTree: CaliperNode = {
            agentId: 'node-1', tag: 'div', selector: 'div', classes: [],
            rect: { top: 0, left: 0, width: 100, height: 100, bottom: 100, right: 100, x: 0, y: 0 },
            viewportRect: { top: 0, left: 0 }, depth: 0, childCount: 0, children: [],
            styles: {
                display: 'block', position: 'static', boxSizing: 'border-box',
                fontSize: 24, // Not in tokens
                fontWeight: '400', fontFamily: 'serif',
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                border: { top: 0, right: 0, bottom: 0, left: 0 },
                borderRadius: '0px', opacity: 1, color: 'black', backgroundColor: 'white',
                overflow: 'visible', overflowX: 'visible', overflowY: 'visible',
                gap: null, lineHeight: 'normal', letterSpacing: 'normal', zIndex: null,
            },
            measurements: {
                toParent: { top: 0, left: 0, bottom: 0, right: 0 },
                toPreviousSibling: null, toNextSibling: null,
                indexInParent: 0, siblingCount: 1
            }
        };

        const expectedHtml = `<div style="font-size: 30px">Test</div>`;

        const report = reconciler.reconcile({
            caliperTree,
            expectedHtml,
            designTokens: { colors: {}, spacing: {}, typography: {}, borderRadius: {} }, // NO TOKENS
            framework: 'html-css',
            figmaLayerUrl: 'https://figma.com/test',
            metrics: mockMetrics
        });

        expect(report.deltas.length).toBeGreaterThan(0);
        const fontSizeDelta = report.deltas.find(d => d.property === 'fontSize');
        expect(fontSizeDelta).toBeDefined();
        expect(fontSizeDelta?.figmaValue).toBe('30px');
        expect(fontSizeDelta?.caliperValue).toBe('24px');
        expect(fontSizeDelta?.tokenName).toBeUndefined(); // Should be undefined as tokens are empty
    });
});
