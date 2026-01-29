import { describe, it, expect } from 'vitest';
import { BitBridge } from './serialization.js';
import type { CaliperNode } from './audit.js';

describe('BitBridge Serialization', () => {
    it('should serialize and deserialize a simple node system', () => {
        const root: CaliperNode = {
            agentId: 'root',
            tag: 'div',
            selector: 'div',
            classes: ['container', 'p-4'],
            rect: { top: 0, left: 0, width: 100, height: 100, bottom: 100, right: 100, x: 0, y: 0 },
            viewportRect: { top: 0, left: 0 },
            depth: 0,
            childCount: 1,
            children: [
                {
                    agentId: 'child-1',
                    tag: 'span',
                    selector: 'span',
                    classes: ['text-sm'],
                    rect: { top: 10, left: 10, width: 80, height: 20, bottom: 30, right: 90, x: 10, y: 10 },
                    viewportRect: { top: 10, left: 10 },
                    depth: 1,
                    childCount: 0,
                    children: [],
                    styles: {
                        display: 'block',
                        position: 'relative',
                        boxSizing: 'border-box',
                        fontSize: 14,
                        fontWeight: '400',
                        fontFamily: 'Inter',
                        color: 'rgb(0, 0, 0)',
                        backgroundColor: 'transparent',
                        padding: { top: 0, right: 0, bottom: 0, left: 0 },
                        margin: { top: 0, right: 0, bottom: 0, left: 0 },
                        border: { top: 0, right: 0, bottom: 0, left: 0 },
                        borderRadius: '0px',
                        opacity: 1,
                        overflow: 'visible',
                        overflowX: 'visible',
                        overflowY: 'visible',
                        gap: null,
                        lineHeight: 'normal',
                        letterSpacing: 'normal',
                        zIndex: null,
                    },
                    measurements: {
                        toParent: { top: 10, left: 10, bottom: 70, right: 10 },
                        toPreviousSibling: null,
                        toNextSibling: null,
                        indexInParent: 0,
                        siblingCount: 1
                    }
                }
            ],
            styles: {
                display: 'flex',
                position: 'relative',
                boxSizing: 'border-box',
                fontSize: 16,
                fontWeight: '700',
                fontFamily: 'Inter',
                color: 'rgb(0, 0, 0)',
                backgroundColor: 'white',
                padding: { top: 10, right: 10, bottom: 10, left: 10 },
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                border: { top: 1, right: 1, bottom: 1, left: 1 },
                borderRadius: '8px',
                opacity: 1,
                overflow: 'hidden',
                overflowX: 'hidden',
                overflowY: 'hidden',
                gap: 8,
                lineHeight: 1.5,
                letterSpacing: 0,
                zIndex: 1,
            },
            measurements: {
                toParent: { top: 0, left: 0, bottom: 0, right: 0 },
                toPreviousSibling: null,
                toNextSibling: null,
                indexInParent: 0,
                siblingCount: 1
            }
        };

        const serialized = BitBridge.serialize(root);
        const reconstructed = BitBridge.deserialize(serialized);

        expect(reconstructed.agentId).toBe(root.agentId);
        expect(reconstructed.tag).toBe(root.tag);
        expect(reconstructed.classes).toEqual(root.classes);
        expect(reconstructed.children.length).toBe(1);
        expect(reconstructed.children[0]!.agentId).toBe('child-1');
        expect(reconstructed.children[0]!.styles.fontSize).toBe(14);
        expect(reconstructed.styles.borderRadius).toBe('8px');
        expect(reconstructed.styles.gap).toBe(8);
        expect(reconstructed.styles.lineHeight).toBe(1.5);
    });

    it('should handle strings efficiently with deduplication', () => {
        const root: CaliperNode = {
            agentId: 'id-1', tag: 'div', selector: 'div',
            classes: ['common', 'common', 'unique'],
            rect: { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0, x: 0, y: 0 },
            viewportRect: { top: 0, left: 0 }, depth: 0, childCount: 0, children: [],
            styles: {
                display: 'block', position: 'static', boxSizing: 'border-box',
                fontSize: 16, fontWeight: '400', fontFamily: 'serif',
                color: 'black', backgroundColor: 'black',
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                border: { top: 0, right: 0, bottom: 0, left: 0 },
                borderRadius: '0px', opacity: 1,
                overflow: 'visible', overflowX: 'visible', overflowY: 'visible',
                gap: null, lineHeight: 'normal', letterSpacing: 'normal', zIndex: null,
            },
            measurements: {
                toParent: { top: 0, left: 0, bottom: 0, right: 0 },
                toPreviousSibling: null, toNextSibling: null,
                indexInParent: 0, siblingCount: 1
            }
        };

        const serialized = BitBridge.serialize(root);
        const reconstructed = BitBridge.deserialize(serialized);
        expect(reconstructed.tag).toBe('div');
        expect(reconstructed.classes).toEqual(['common', 'common', 'unique']);
    });

    it('should serialize deeply nested trees without stack overflow', () => {
        const createDeepNode = (currentDepth: number, maxDepth: number): CaliperNode => {
            const node: CaliperNode = {
                agentId: `depth-${currentDepth}`,
                tag: 'div',
                selector: 'div',
                classes: [],
                rect: { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0, x: 0, y: 0 },
                viewportRect: { top: 0, left: 0 },
                depth: currentDepth,
                childCount: currentDepth < maxDepth ? 1 : 0,
                children: currentDepth < maxDepth ? [createDeepNode(currentDepth + 1, maxDepth)] : [],
                styles: {
                    display: 'block', position: 'static', boxSizing: 'border-box',
                    fontSize: 16, fontWeight: '400', fontFamily: 'serif',
                    color: 'black', backgroundColor: 'black',
                    padding: { top: 0, right: 0, bottom: 0, left: 0 },
                    margin: { top: 0, right: 0, bottom: 0, left: 0 },
                    border: { top: 0, right: 0, bottom: 0, left: 0 },
                    borderRadius: '0px', opacity: 1,
                    overflow: 'visible', overflowX: 'visible', overflowY: 'visible',
                    gap: null, lineHeight: 'normal', letterSpacing: 'normal', zIndex: null,
                },
                measurements: {
                    toParent: { top: 0, left: 0, bottom: 0, right: 0 },
                    toPreviousSibling: null, toNextSibling: null,
                    indexInParent: 0, siblingCount: 1
                }
            };
            return node;
        };

        const deepTree = createDeepNode(0, 50); // 50 levels deep
        const serialized = BitBridge.serialize(deepTree);
        const reconstructed = BitBridge.deserialize(serialized);

        expect(reconstructed.agentId).toBe('depth-0');
        let current = reconstructed;
        for (let i = 0; i < 50; i++) {
            expect(current.children.length).toBe(1);
            current = current.children[0]!;
        }
        expect(current.agentId).toBe('depth-50');
    });
});
