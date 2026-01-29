import { describe, it, expect } from 'vitest';
import { semanticParserService } from './semantic-parser-service.js';

describe('SemanticParserService Hardening', () => {
    it('should handle malformed HTML with unclosed tags', () => {
        const malformed = '<div><span>No closing span</div>';
        const root = semanticParserService.parse(malformed);

        expect(root.tag).toBe('div');
        expect(root.children.length).toBe(1);
        expect(root.children[0]!.tag).toBe('span');
        expect(root.children[0]!.textContent).toContain('No closing span');
    });

    it('should ignore attributes with nested greater-than symbols', () => {
        const html = '<div data-custom="value > still value">Text</div>';
        const root = semanticParserService.parse(html);

        expect(root.tag).toBe('div');
        expect(root.textContent).toBe('Text');
    });

    it('should handle extreme whitespace in tags', () => {
        const html = '<div    class="p-4"   id="test"   >Content</   div   >';
        const root = semanticParserService.parse(html);

        expect(root.tag).toBe('div');
        expect(root.classes).toContain('p-4');
        expect(root.id).toBe('test');
        expect(root.textContent).toBe('Content');
    });

    it('should handle rare self-closing tags correctly', () => {
        const html = '<div><br /><hr><span>After</span></div>';
        const root = semanticParserService.parse(html);

        expect(root.tag).toBe('div');
        expect(root.children.length).toBe(3);
        expect(root.children[0]!.tag).toBe('br');
        expect(root.children[1]!.tag).toBe('hr');
        expect(root.children[2]!.tag).toBe('span');
    });

    it('should extract text content from deep trees correctly', () => {
        const html = '<div><p>Hello <span>World</span></p></div>';
        const root = semanticParserService.parse(html);

        expect(root.children.length).toBe(1);
        const p = root.children[0]!;
        expect(p.tag).toBe('p');
        expect(p.textContent).toBe('Hello World');
    });
});
