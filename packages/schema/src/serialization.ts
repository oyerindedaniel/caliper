import type { CaliperNode, BoxEdges, CaliperComputedStyles } from "./audit.js";

type StyleSerializerEntry<T> = {
    collectStrings: (value: T, collect: (strVal: string | null | undefined) => void) => void;
    serialize: (value: T, context: SerializeContext) => void;
    deserialize: (context: DeserializeContext) => T;
};

type StyleSerializerMap = {
    [K in keyof CaliperComputedStyles]: StyleSerializerEntry<CaliperComputedStyles[K]>;
};

interface SerializeContext {
    view: DataView;
    offset: number;
    getStringId: (strVal: string | null | undefined) => number;
}

interface DeserializeContext {
    view: DataView;
    offset: number;
    stringList: string[];
}

const stringSerializer = (defaultValue: string = ""): StyleSerializerEntry<string> => ({
    collectStrings: (value, collect) => collect(value),
    serialize: (value, context) => {
        context.view.setUint16(context.offset, context.getStringId(value));
        context.offset += 2;
    },
    deserialize: (context) => {
        const result = context.stringList[context.view.getUint16(context.offset)] || defaultValue;
        context.offset += 2;
        return result;
    },
});

const optionalStringSerializer = (): StyleSerializerEntry<string | undefined> => ({
    collectStrings: (value, collect) => collect(value),
    serialize: (value, context) => {
        context.view.setUint16(context.offset, context.getStringId(value));
        context.offset += 2;
    },
    deserialize: (context) => {
        const result = context.stringList[context.view.getUint16(context.offset)] || undefined;
        context.offset += 2;
        return result;
    },
});

const floatSerializer = (): StyleSerializerEntry<number> => ({
    collectStrings: () => { },
    serialize: (value, context) => {
        context.view.setFloat32(context.offset, value);
        context.offset += 4;
    },
    deserialize: (context) => {
        const result = context.view.getFloat32(context.offset);
        context.offset += 4;
        return result;
    },
});

const boxEdgesSerializer = (): StyleSerializerEntry<BoxEdges> => ({
    collectStrings: () => { },
    serialize: (edges, context) => {
        context.view.setFloat32(context.offset, edges.top); context.offset += 4;
        context.view.setFloat32(context.offset, edges.right); context.offset += 4;
        context.view.setFloat32(context.offset, edges.bottom); context.offset += 4;
        context.view.setFloat32(context.offset, edges.left); context.offset += 4;
    },
    deserialize: (context) => {
        const edges = {
            top: context.view.getFloat32(context.offset),
            right: context.view.getFloat32(context.offset + 4),
            bottom: context.view.getFloat32(context.offset + 8),
            left: context.view.getFloat32(context.offset + 12),
        };
        context.offset += 16;
        return edges;
    },
});

const nullableNumberSerializer = (): StyleSerializerEntry<number | null> => ({
    collectStrings: (value, collect) => collect(value === null ? null : String(value)),
    serialize: (value, context) => {
        context.view.setUint16(context.offset, context.getStringId(value === null ? null : String(value)));
        context.offset += 2;
    },
    deserialize: (context) => {
        const strValue = context.stringList[context.view.getUint16(context.offset)] || null;
        context.offset += 2;
        return strValue === null ? null : parseFloat(strValue);
    },
});

const numberOrStringSerializer = (defaultValue: string | number = ""): StyleSerializerEntry<number | string> => ({
    collectStrings: (value, collect) => collect(String(value)),
    serialize: (value, context) => {
        context.view.setUint16(context.offset, context.getStringId(String(value)));
        context.offset += 2;
    },
    deserialize: (context) => {
        const strValue = context.stringList[context.view.getUint16(context.offset)] || String(defaultValue);
        context.offset += 2;
        const numValue = parseFloat(strValue);
        return isNaN(numValue) ? strValue : numValue;
    },
});

const nullableNumberOrStringSerializer = (): StyleSerializerEntry<number | string | null> => ({
    collectStrings: (value, collect) => collect(value === null ? null : String(value)),
    serialize: (value, context) => {
        context.view.setUint16(context.offset, context.getStringId(value === null ? null : String(value)));
        context.offset += 2;
    },
    deserialize: (context) => {
        const strValue = context.stringList[context.view.getUint16(context.offset)] || null;
        context.offset += 2;
        if (strValue === null) return null;
        const numValue = parseFloat(strValue);
        return isNaN(numValue) ? strValue : numValue;
    },
});

const STYLE_SERIALIZERS = {
    display: stringSerializer(),
    position: stringSerializer(),
    boxSizing: stringSerializer(),
    padding: boxEdgesSerializer(),
    margin: boxEdgesSerializer(),
    border: boxEdgesSerializer(),
    gap: nullableNumberSerializer(),
    flexDirection: optionalStringSerializer(),
    justifyContent: optionalStringSerializer(),
    alignItems: optionalStringSerializer(),
    fontSize: floatSerializer(),
    fontWeight: stringSerializer(),
    fontFamily: stringSerializer(),
    lineHeight: nullableNumberOrStringSerializer(),
    letterSpacing: numberOrStringSerializer(0),
    color: stringSerializer(),
    backgroundColor: stringSerializer(),
    borderColor: optionalStringSerializer(),
    borderRadius: stringSerializer("0"),
    boxShadow: optionalStringSerializer(),
    opacity: numberOrStringSerializer(1),
    outline: optionalStringSerializer(),
    outlineColor: optionalStringSerializer(),
    zIndex: nullableNumberOrStringSerializer(),
    overflow: stringSerializer("visible"),
    overflowX: stringSerializer("visible"),
    overflowY: stringSerializer("visible"),
} satisfies StyleSerializerMap;

const STYLE_KEYS = Object.keys(STYLE_SERIALIZERS) as (keyof CaliperComputedStyles)[];

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

        // First pass: collect all strings for the dictionary
        const stack: CaliperNode[] = [root];
        while (stack.length > 0) {
            const node = stack.pop()!;
            getStringId(node.tag);
            getStringId(node.selector);
            getStringId(node.agentId);
            getStringId(node.htmlId);
            getStringId(node.textContent);
            node.classes?.forEach(className => getStringId(className));

            // Collect strings from styles using the serializer registry
            for (const key of STYLE_KEYS) {
                const serializer = STYLE_SERIALIZERS[key];
                (serializer.collectStrings as (v: CaliperComputedStyles[typeof key], c: (s: string | null | undefined) => void) => void)(
                    node.styles[key],
                    getStringId
                );
            }

            if (node.children) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push(node.children[i]!);
                }
            }
        }

        // Build buffer
        const encoder = new TextEncoder();
        const encodedStrings = stringList.map(rawString => encoder.encode(rawString));
        let dictSize = 8; // MAGIC (4) + COUNT (4)
        encodedStrings.forEach(bytes => dictSize += 2 + bytes.length);

        const buffer = new ArrayBuffer(dictSize + 1024 * 1024 * 5); // Base + 5MB
        const view = new DataView(buffer);
        let offset = 0;

        view.setUint32(offset, BitBridge.MAGIC); offset += 4;
        view.setUint32(offset, stringList.length); offset += 4;

        encodedStrings.forEach(bytes => {
            view.setUint16(offset, bytes.length); offset += 2;
            new Uint8Array(buffer, offset, bytes.length).set(bytes);
            offset += bytes.length;
        });

        // Second pass: serialize nodes
        const nodeStack: CaliperNode[] = [root];
        while (nodeStack.length > 0) {
            const node = nodeStack.pop()!;

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

            // Serialize styles using the registry
            const ctx: SerializeContext = { view, offset, getStringId };
            for (const key of STYLE_KEYS) {
                const serializer = STYLE_SERIALIZERS[key];
                (serializer.serialize as (v: CaliperComputedStyles[typeof key], c: SerializeContext) => void)(
                    node.styles[key],
                    ctx
                );
            }
            offset = ctx.offset;

            view.setUint16(offset, node.depth); offset += 2;
            const children = node.children || [];
            view.setUint16(offset, children.length); offset += 2;

            for (let i = children.length - 1; i >= 0; i--) {
                nodeStack.push(children[i]!);
            }
        }

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

        const root = this.deserializeNode(view, offset, stringList);
        offset = root.newOffset;

        const nodeStack: { node: CaliperNode; childrenToRead: number }[] = [{
            node: root.node,
            childrenToRead: root.childCount
        }];

        while (nodeStack.length > 0) {
            const current = nodeStack[nodeStack.length - 1]!;

            if (current.childrenToRead > 0) {
                const childResult = this.deserializeNode(view, offset, stringList);
                offset = childResult.newOffset;

                childResult.node.parentAgentId = current.node.agentId;
                current.node.children.push(childResult.node);
                current.childrenToRead--;

                if (childResult.childCount > 0) {
                    nodeStack.push({
                        node: childResult.node,
                        childrenToRead: childResult.childCount
                    });
                }
            } else {
                nodeStack.pop();
            }
        }

        return root.node;
    }

    private static deserializeNode(view: DataView, offset: number, stringList: string[]): { node: CaliperNode; childCount: number; newOffset: number } {
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

        // Deserialize styles using the registry
        const ctx: DeserializeContext = { view, offset, stringList };
        const styles = {} as CaliperComputedStyles;
        for (const key of STYLE_KEYS) {
            const serializer = STYLE_SERIALIZERS[key];
            (styles as Record<string, unknown>)[key] = serializer.deserialize(ctx);
        }
        offset = ctx.offset;

        const depth = view.getUint16(offset); offset += 2;
        const childCount = view.getUint16(offset); offset += 2;

        const node: CaliperNode = {
            agentId, selector, tag, htmlId, classes, textContent,
            rect, viewportRect: { top: vTop, left: vLeft },
            depth, childCount, children: [],
            styles,
            measurements: {
                toParent: { top: 0, left: 0, bottom: 0, right: 0 },
                toPreviousSibling: null, toNextSibling: null,
                indexInParent: 0, siblingCount: childCount
            }
        };

        return { node, childCount, newOffset: offset };
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

    static unpackEnvelope(data: Uint8Array): { json: string; payload: Uint8Array } {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const jsonLen = view.getUint32(0);
        const jsonStr = new TextDecoder().decode(data.subarray(4, 4 + jsonLen));
        const payload = data.subarray(4 + jsonLen);
        return { json: jsonStr, payload };
    }
}

