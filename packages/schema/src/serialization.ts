import type { CaliperNode, BoxEdges } from "./audit.js";

export class BitBridge {
    private static readonly MAGIC = 0x43414C49; // "CALI"

    static serialize(root: CaliperNode): Uint8Array {
        const strings = new Map<string, number>();
        const stringList: string[] = [];

        const getStringId = (str: string | null | undefined): number => {
            if (str === undefined || str === null) return 0;
            let id = strings.get(str);
            if (id === undefined) {
                id = stringList.length + 1;
                strings.set(str, id);
                stringList.push(str);
            }
            return id;
        };

        const collect = (node: CaliperNode) => {
            getStringId(node.tag);
            getStringId(node.selector);
            getStringId(node.agentId);
            getStringId(node.htmlId);
            getStringId(node.textContent);
            if (node.classes) {
                node.classes.forEach(className => getStringId(className));
            }

            const styles = node.styles;
            getStringId(styles.display);
            getStringId(styles.position);
            getStringId(styles.boxSizing);
            getStringId(styles.color);
            getStringId(styles.backgroundColor);
            getStringId(styles.borderRadius);
            getStringId(styles.borderColor);
            getStringId(styles.boxShadow);
            getStringId(styles.outline);
            getStringId(styles.outlineColor);
            getStringId(styles.overflow);
            getStringId(styles.overflowX);
            getStringId(styles.overflowY);
            getStringId(styles.fontFamily);
            getStringId(styles.fontWeight);
            getStringId(styles.lineHeight === null ? null : String(styles.lineHeight));
            getStringId(String(styles.letterSpacing));
            getStringId(String(styles.opacity));
            getStringId(styles.zIndex === null ? null : String(styles.zIndex));
            getStringId(styles.gap === null ? null : String(styles.gap));

            if (node.children) {
                node.children.forEach(collect);
            }
        };
        collect(root);

        const encoder = new TextEncoder();
        const encodedStrings = stringList.map(rawString => encoder.encode(rawString));
        let dictSize = 4;
        encodedStrings.forEach(bytes => dictSize += 2 + bytes.length);

        const buffer = new ArrayBuffer(dictSize + 1024 * 1024 * 5);
        const view = new DataView(buffer);
        let offset = 0;

        view.setUint32(offset, BitBridge.MAGIC); offset += 4;

        view.setUint32(offset, stringList.length); offset += 4;
        encodedStrings.forEach(bytes => {
            view.setUint16(offset, bytes.length); offset += 2;
            new Uint8Array(buffer, offset, bytes.length).set(bytes);
            offset += bytes.length;
        });

        const encodeNode = (node: CaliperNode) => {
            view.setUint16(offset, getStringId(node.tag)); offset += 2;
            view.setUint16(offset, getStringId(node.selector)); offset += 2;
            view.setUint16(offset, getStringId(node.agentId)); offset += 2;
            view.setUint16(offset, getStringId(node.htmlId)); offset += 2;
            view.setUint16(offset, getStringId(node.textContent)); offset += 2;

            const classes = node.classes || [];
            view.setUint16(offset, classes.length); offset += 2;
            classes.forEach(className => {
                view.setUint16(offset, getStringId(className)); offset += 2;
            });

            view.setFloat32(offset, node.rect.top); offset += 4;
            view.setFloat32(offset, node.rect.left); offset += 4;
            view.setFloat32(offset, node.rect.width); offset += 4;
            view.setFloat32(offset, node.rect.height); offset += 4;
            view.setFloat32(offset, node.rect.bottom); offset += 4;
            view.setFloat32(offset, node.rect.right); offset += 4;
            view.setFloat32(offset, node.viewportRect.top); offset += 4;
            view.setFloat32(offset, node.viewportRect.left); offset += 4;

            const styles = node.styles;
            view.setUint16(offset, getStringId(styles.display)); offset += 2;
            view.setUint16(offset, getStringId(styles.position)); offset += 2;
            view.setUint16(offset, getStringId(styles.boxSizing)); offset += 2;
            view.setFloat32(offset, styles.fontSize); offset += 4;
            view.setUint16(offset, getStringId(styles.fontWeight)); offset += 2;
            view.setUint16(offset, getStringId(styles.fontFamily)); offset += 2;
            view.setUint16(offset, getStringId(String(styles.opacity))); offset += 2;
            view.setUint16(offset, getStringId(styles.color)); offset += 2;
            view.setUint16(offset, getStringId(styles.backgroundColor)); offset += 2;
            view.setUint16(offset, getStringId(styles.borderRadius)); offset += 2;
            view.setUint16(offset, getStringId(styles.borderColor)); offset += 2;
            view.setUint16(offset, getStringId(styles.boxShadow)); offset += 2;
            view.setUint16(offset, getStringId(styles.outline)); offset += 2;
            view.setUint16(offset, getStringId(styles.outlineColor)); offset += 2;
            view.setUint16(offset, getStringId(styles.overflow)); offset += 2;
            view.setUint16(offset, getStringId(styles.overflowX)); offset += 2;
            view.setUint16(offset, getStringId(styles.overflowY)); offset += 2;
            view.setUint16(offset, getStringId(styles.lineHeight === null ? null : String(styles.lineHeight))); offset += 2;
            view.setUint16(offset, getStringId(String(styles.letterSpacing))); offset += 2;
            view.setUint16(offset, getStringId(styles.zIndex === null ? null : String(styles.zIndex))); offset += 2;
            view.setUint16(offset, getStringId(styles.gap === null ? null : String(styles.gap))); offset += 2;

            const writeEdges = (edges: BoxEdges) => {
                view.setFloat32(offset, edges.top); offset += 4;
                view.setFloat32(offset, edges.right); offset += 4;
                view.setFloat32(offset, edges.bottom); offset += 4;
                view.setFloat32(offset, edges.left); offset += 4;
            };
            writeEdges(styles.padding);
            writeEdges(styles.margin);
            writeEdges(styles.border);

            view.setUint16(offset, node.depth); offset += 2;
            const children = node.children || [];
            view.setUint16(offset, children.length); offset += 2;
            children.forEach(encodeNode);
        };

        encodeNode(root);
        return new Uint8Array(buffer, 0, offset);
    }

    static deserialize(data: Uint8Array): CaliperNode {
        const buffer = data.buffer;
        const view = new DataView(buffer, data.byteOffset, data.byteLength);
        let offset = 0;

        const magic = view.getUint32(offset); offset += 4;
        if (magic !== BitBridge.MAGIC) throw new Error("Invalid BitBridge format");

        const stringCount = view.getUint32(offset); offset += 4;
        const stringList: string[] = [""];
        const decoder = new TextDecoder();
        for (let i = 0; i < stringCount; i++) {
            const len = view.getUint16(offset); offset += 2;
            const str = decoder.decode(new Uint8Array(buffer, data.byteOffset + offset, len));
            stringList.push(str);
            offset += len;
        }

        const decodeNode = (): CaliperNode => {
            const tag = stringList[view.getUint16(offset)] || ""; offset += 2;
            const selector = stringList[view.getUint16(offset)] || ""; offset += 2;
            const agentId = stringList[view.getUint16(offset)] || ""; offset += 2;
            const htmlId = stringList[view.getUint16(offset)] || undefined; offset += 2;
            const textContent = stringList[view.getUint16(offset)] || undefined; offset += 2;

            const classCount = view.getUint16(offset); offset += 2;
            const classes: string[] = [];
            for (let i = 0; i < classCount; i++) {
                classes.push(stringList[view.getUint16(offset)] || "");
                offset += 2;
            }

            const rect = {
                top: view.getFloat32(offset), left: view.getFloat32(offset + 4),
                width: view.getFloat32(offset + 8), height: view.getFloat32(offset + 12),
                bottom: view.getFloat32(offset + 16), right: view.getFloat32(offset + 20),
                x: 0, y: 0
            };
            rect.x = rect.left;
            rect.y = rect.top;
            offset += 24;

            const vTop = view.getFloat32(offset); offset += 4;
            const vLeft = view.getFloat32(offset); offset += 4;

            const display = stringList[view.getUint16(offset)] || ""; offset += 2;
            const position = stringList[view.getUint16(offset)] || ""; offset += 2;
            const boxSizing = stringList[view.getUint16(offset)] || ""; offset += 2;
            const fontSize = view.getFloat32(offset); offset += 4;
            const fontWeight = stringList[view.getUint16(offset)] || ""; offset += 2;
            const fontFamily = stringList[view.getUint16(offset)] || ""; offset += 2;
            const opacityStr = stringList[view.getUint16(offset)] || "1"; offset += 2;
            const color = stringList[view.getUint16(offset)] || ""; offset += 2;
            const backgroundColor = stringList[view.getUint16(offset)] || ""; offset += 2;
            const borderRadius = stringList[view.getUint16(offset)] || "0"; offset += 2;
            const borderColor = stringList[view.getUint16(offset)] || undefined; offset += 2;
            const boxShadow = stringList[view.getUint16(offset)] || undefined; offset += 2;
            const outline = stringList[view.getUint16(offset)] || undefined; offset += 2;
            const outlineColor = stringList[view.getUint16(offset)] || undefined; offset += 2;
            const overflow = stringList[view.getUint16(offset)] || "visible"; offset += 2;
            const overflowX = stringList[view.getUint16(offset)] || "visible"; offset += 2;
            const overflowY = stringList[view.getUint16(offset)] || "visible"; offset += 2;
            const lhStr = stringList[view.getUint16(offset)] || null; offset += 2;
            const lsStr = stringList[view.getUint16(offset)] || "0"; offset += 2;
            const ziStr = stringList[view.getUint16(offset)] || null; offset += 2;
            const gapStr = stringList[view.getUint16(offset)] || null; offset += 2;

            const opacity = isNaN(parseFloat(opacityStr)) ? opacityStr : parseFloat(opacityStr);
            const lineHeight = lhStr === null ? null : (isNaN(parseFloat(lhStr)) ? lhStr : parseFloat(lhStr));
            const letterSpacing = isNaN(parseFloat(lsStr)) ? lsStr : parseFloat(lsStr);
            const zIndex = ziStr === null ? null : (isNaN(parseFloat(ziStr)) ? ziStr : parseInt(ziStr, 10));
            const gap = gapStr === null ? null : parseFloat(gapStr);

            const readEdges = (): BoxEdges => {
                const edges = { top: view.getFloat32(offset), right: view.getFloat32(offset + 4), bottom: view.getFloat32(offset + 8), left: view.getFloat32(offset + 12) };
                offset += 16;
                return edges;
            };
            const padding = readEdges();
            const margin = readEdges();
            const border = readEdges();

            const depth = view.getUint16(offset); offset += 2;
            const childCount = view.getUint16(offset); offset += 2;

            const node: CaliperNode = {
                agentId, selector, tag, htmlId, classes, textContent,
                rect, viewportRect: { top: vTop, left: vLeft },
                depth, childCount, children: [],
                styles: {
                    display, position, boxSizing, padding, margin, border,
                    fontSize, fontWeight, fontFamily, opacity, color, backgroundColor,
                    lineHeight,
                    letterSpacing,
                    borderRadius, borderColor, boxShadow, outline, outlineColor,
                    overflow, overflowX, overflowY,
                    gap, zIndex
                },
                measurements: {
                    toParent: { top: 0, left: 0, bottom: 0, right: 0 },
                    toPreviousSibling: null, toNextSibling: null,
                    indexInParent: 0, siblingCount: childCount
                }
            };

            for (let i = 0; i < childCount; i++) {
                const child = decodeNode();
                child.parentAgentId = node.agentId;
                node.children.push(child);
            }

            return node;
        };

        return decodeNode();
    }

    static packEnvelope(json: string, payload: Uint8Array): Uint8Array {
        const jsonBytes = new TextEncoder().encode(json);
        const combined = new Uint8Array(4 + jsonBytes.byteLength + payload.byteLength);
        const view = new DataView(combined.buffer);

        view.setUint32(0, jsonBytes.byteLength);
        combined.set(jsonBytes, 4);
        combined.set(payload, 4 + jsonBytes.byteLength);

        return combined;
    }

    static unpackEnvelope(data: Uint8Array): { json: string, payload: Uint8Array } {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const jsonLen = view.getUint32(0);
        const jsonStr = new TextDecoder().decode(data.subarray(4, 4 + jsonLen));
        const payload = data.subarray(4 + jsonLen);
        return { json: jsonStr, payload };
    }
}
