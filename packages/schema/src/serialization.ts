import type { CaliperNode, CaliperComputedStyles, CaliperMeasurements, BoxEdges } from "./audit.js";

export class BitBridge {
    private static readonly MAGIC = 0x43414C49; // "CALI"
    private static readonly VERSION = 1;

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
                node.classes.forEach(c => getStringId(c));
            }

            const s = node.styles;
            getStringId(s.display);
            getStringId(s.position);
            getStringId(s.boxSizing);
            getStringId(s.color);
            getStringId(s.backgroundColor);
            getStringId(s.borderRadius);
            getStringId(s.overflow);
            getStringId(s.fontFamily);
            getStringId(s.fontWeight);

            if (node.children) {
                node.children.forEach(collect);
            }
        };
        collect(root);

        const encoder = new TextEncoder();
        const encodedStrings = stringList.map(s => encoder.encode(s));
        let dictSize = 4;
        encodedStrings.forEach(b => dictSize += 2 + b.length);

        const buffer = new ArrayBuffer(dictSize + 1024 * 1024 * 5);
        const view = new DataView(buffer);
        let offset = 0;

        view.setUint32(offset, BitBridge.MAGIC); offset += 4;
        view.setUint16(offset, BitBridge.VERSION); offset += 2;

        view.setUint32(offset, stringList.length); offset += 4;
        encodedStrings.forEach(b => {
            view.setUint16(offset, b.length); offset += 2;
            new Uint8Array(buffer, offset, b.length).set(b);
            offset += b.length;
        });

        const encodeNode = (node: CaliperNode) => {
            view.setUint16(offset, getStringId(node.tag)); offset += 2;
            view.setUint16(offset, getStringId(node.selector)); offset += 2;
            view.setUint16(offset, getStringId(node.agentId)); offset += 2;
            view.setUint16(offset, getStringId(node.htmlId)); offset += 2;
            view.setUint16(offset, getStringId(node.textContent)); offset += 2;

            const classes = node.classes || [];
            view.setUint16(offset, classes.length); offset += 2;
            classes.forEach(c => {
                view.setUint16(offset, getStringId(c)); offset += 2;
            });

            view.setFloat32(offset, node.rect.top); offset += 4;
            view.setFloat32(offset, node.rect.left); offset += 4;
            view.setFloat32(offset, node.rect.width); offset += 4;
            view.setFloat32(offset, node.rect.height); offset += 4;
            view.setFloat32(offset, node.rect.bottom); offset += 4;
            view.setFloat32(offset, node.rect.right); offset += 4;
            view.setFloat32(offset, node.viewportRect.top); offset += 4;
            view.setFloat32(offset, node.viewportRect.left); offset += 4;

            const s = node.styles;
            view.setUint16(offset, getStringId(s.display)); offset += 2;
            view.setUint16(offset, getStringId(s.position)); offset += 2;
            view.setUint16(offset, getStringId(s.boxSizing)); offset += 2;
            view.setFloat32(offset, s.fontSize); offset += 4;
            view.setUint16(offset, getStringId(s.fontWeight)); offset += 2;
            view.setUint16(offset, getStringId(s.fontFamily)); offset += 2;
            view.setFloat32(offset, s.opacity); offset += 4;
            view.setUint16(offset, getStringId(s.color)); offset += 2;
            view.setUint16(offset, getStringId(s.backgroundColor)); offset += 2;

            const writeEdges = (e: BoxEdges) => {
                view.setFloat32(offset, e.top); offset += 4;
                view.setFloat32(offset, e.right); offset += 4;
                view.setFloat32(offset, e.bottom); offset += 4;
                view.setFloat32(offset, e.left); offset += 4;
            };
            writeEdges(s.padding);
            writeEdges(s.margin);
            writeEdges(s.border);

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

        const version = view.getUint16(offset); offset += 2;

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
            const opacity = view.getFloat32(offset); offset += 4;
            const color = stringList[view.getUint16(offset)] || ""; offset += 2;
            const backgroundColor = stringList[view.getUint16(offset)] || ""; offset += 2;

            const readEdges = (): BoxEdges => {
                const e = { top: view.getFloat32(offset), right: view.getFloat32(offset + 4), bottom: view.getFloat32(offset + 8), left: view.getFloat32(offset + 12) };
                offset += 16;
                return e;
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
                    lineHeight: null, letterSpacing: 0,
                    overflow: "visible", overflowX: "visible", overflowY: "visible",
                    borderRadius: "0", gap: null, zIndex: null
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
