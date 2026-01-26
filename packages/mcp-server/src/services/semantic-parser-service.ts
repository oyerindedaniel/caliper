import type { SemanticNode } from "@oyerinde/caliper-schema";

const SELF_CLOSING_TAGS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr"
]);

interface ParsedTag {
    tag: string;
    classes: string[];
    id?: string;
    rawStyles?: string;
    isSelfClosing: boolean;
    rawAttributes: string;
}

function parseOpeningTag(tagString: string): ParsedTag | null {
    const match = tagString.match(/^<(\w+)([^>]*)\/?>$/);
    if (!match) return null;

    const tag = match[1]!.toLowerCase();
    const attrString = match[2] || "";
    const isSelfClosing = tagString.endsWith("/>") || SELF_CLOSING_TAGS.has(tag);

    let classes: string[] = [];
    let id: string | undefined;
    let rawStyles: string | undefined;

    const classMatch = attrString.match(/class(?:Name)?=["']([^"']+)["']/);
    if (classMatch) {
        classes = classMatch[1]!.split(/\s+/).filter(Boolean);
    }

    const idMatch = attrString.match(/id=["']([^"']+)["']/);
    if (idMatch) {
        id = idMatch[1];
    }

    const styleMatch = attrString.match(/style=["']([^"']+)["']/);
    if (styleMatch) {
        rawStyles = styleMatch[1];
    }

    return { tag, classes, id, rawStyles, isSelfClosing, rawAttributes: attrString };
}

function extractTextContent(html: string): string {
    const textOnly = html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return textOnly.slice(0, 100);
}

export class SemanticParserService {
    parse(html: string): SemanticNode {
        const trimmed = html.trim();
        if (!trimmed) {
            return this.createEmptyNode();
        }

        const rootNode = this.parseNode(trimmed, 0);
        return rootNode || this.createEmptyNode();
    }

    private parseNode(html: string, depth: number): SemanticNode | null {
        const trimmed = html.trim();
        if (!trimmed || !trimmed.startsWith("<")) return null;

        const openTagEnd = trimmed.indexOf(">");
        if (openTagEnd === -1) return null;

        const openTagStr = trimmed.slice(0, openTagEnd + 1);
        const parsed = parseOpeningTag(openTagStr);
        if (!parsed) return null;

        const node: SemanticNode = {
            tag: parsed.tag,
            classes: parsed.classes,
            id: parsed.id,
            rawStyles: parsed.rawStyles,
            inferredStyles: {},
            children: [],
        };

        if (parsed.isSelfClosing) {
            return node;
        }

        const closingIdx = this.findMatchingClosingTag(trimmed, parsed.tag, openTagEnd + 1);
        if (closingIdx === -1) {
            return node;
        }

        const innerHtml = trimmed.slice(openTagEnd + 1, closingIdx).trim();

        if (innerHtml) {
            const childNodes = this.parseChildren(innerHtml, depth + 1);
            node.children = childNodes;

            if (childNodes.length === 0) {
                const text = extractTextContent(innerHtml);
                if (text) {
                    node.textContent = text;
                }
            }
        }

        return node;
    }

    private findMatchingClosingTag(html: string, tag: string, startIdx: number): number {
        const openPattern = new RegExp(`<${tag}[\\s>]`, "gi");
        const closePattern = new RegExp(`</${tag}>`, "gi");

        let depth = 1;
        let pos = startIdx;

        while (pos < html.length && depth > 0) {
            openPattern.lastIndex = pos;
            closePattern.lastIndex = pos;

            const openMatch = openPattern.exec(html);
            const closeMatch = closePattern.exec(html);

            if (!closeMatch) return -1;

            if (openMatch && openMatch.index < closeMatch.index) {
                const checkSelfClose = html.slice(openMatch.index, html.indexOf(">", openMatch.index) + 1);
                if (!checkSelfClose.endsWith("/>")) {
                    depth++;
                }
                pos = openMatch.index + 1;
            } else {
                depth--;
                if (depth === 0) {
                    return closeMatch.index;
                }
                pos = closeMatch.index + 1;
            }
        }

        return -1;
    }

    private parseChildren(innerHtml: string, depth: number): SemanticNode[] {
        const children: SemanticNode[] = [];
        let remaining = innerHtml.trim();

        while (remaining.length > 0) {
            if (!remaining.startsWith("<")) {
                const nextTagIdx = remaining.indexOf("<");
                if (nextTagIdx === -1) break;
                remaining = remaining.slice(nextTagIdx);
                continue;
            }

            const openTagEnd = remaining.indexOf(">");
            if (openTagEnd === -1) break;

            const openTagStr = remaining.slice(0, openTagEnd + 1);
            const parsed = parseOpeningTag(openTagStr);
            if (!parsed) {
                remaining = remaining.slice(1);
                continue;
            }

            if (parsed.isSelfClosing) {
                const node: SemanticNode = {
                    tag: parsed.tag,
                    classes: parsed.classes,
                    id: parsed.id,
                    rawStyles: parsed.rawStyles,
                    inferredStyles: {},
                    children: [],
                };
                children.push(node);
                remaining = remaining.slice(openTagEnd + 1).trim();
                continue;
            }

            const closingIdx = this.findMatchingClosingTag(remaining, parsed.tag, openTagEnd + 1);
            if (closingIdx === -1) {
                remaining = remaining.slice(openTagEnd + 1);
                continue;
            }

            const fullElement = remaining.slice(0, closingIdx + `</${parsed.tag}>`.length);
            const childNode = this.parseNode(fullElement, depth);
            if (childNode) {
                children.push(childNode);
            }

            remaining = remaining.slice(closingIdx + `</${parsed.tag}>`.length).trim();
        }

        return children;
    }

    private createEmptyNode(): SemanticNode {
        return {
            tag: "div",
            classes: [],
            inferredStyles: {},
            children: [],
        };
    }
}

export const semanticParserService = new SemanticParserService();
