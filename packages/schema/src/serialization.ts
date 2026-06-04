import type { CaliperNode, CaliperComputedStyles } from "./audit.js";
import {
  collectComputedStyleStrings,
  deserializeComputedStyles,
  serializeComputedStyles,
  type DeserializeContext,
  type SerializeContext,
} from "./style-serializers.js";

export class BitBridge {
  private static readonly MAGIC = 0x43414c49;

  static serialize(root: CaliperNode): Uint8Array {
    const strings = new Map<string, number>();
    const stringList: string[] = [];

    const getStringId = (strVal: string | null | undefined): number => {
      if (strVal === undefined || strVal === null) return 0;
      let stringId = strings.get(strVal);
      if (stringId === undefined) {
        stringId = stringList.length + 1;
        strings.set(strVal, stringId);
        stringList.push(strVal);
      }
      return stringId;
    };

    const stack: CaliperNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      getStringId(node.tag);
      getStringId(node.selector);
      getStringId(node.agentId);
      getStringId(node.htmlId);
      getStringId(node.textContent);
      getStringId(node.marker);
      node.classes?.forEach((className) => getStringId(className));
      collectComputedStyleStrings(node.styles, getStringId);

      if (node.children) {
        for (let childIndex = node.children.length - 1; childIndex >= 0; childIndex -= 1) {
          stack.push(node.children[childIndex]!);
        }
      }
    }

    const encoder = new TextEncoder();
    const encodedStrings = stringList.map((rawString) => encoder.encode(rawString));
    let dictSize = 8;
    encodedStrings.forEach((encodedBytes) => {
      dictSize += 2 + encodedBytes.length;
    });

    const buffer = new ArrayBuffer(dictSize + 1024 * 1024 * 5);
    const view = new DataView(buffer);
    let offset = 0;

    view.setUint32(offset, BitBridge.MAGIC);
    offset += 4;
    view.setUint32(offset, stringList.length);
    offset += 4;

    encodedStrings.forEach((encodedBytes) => {
      view.setUint16(offset, encodedBytes.length);
      offset += 2;
      new Uint8Array(buffer, offset, encodedBytes.length).set(encodedBytes);
      offset += encodedBytes.length;
    });

    const nodeStack: CaliperNode[] = [root];
    while (nodeStack.length > 0) {
      const node = nodeStack.pop()!;

      view.setUint16(offset, getStringId(node.tag));
      offset += 2;
      view.setUint16(offset, getStringId(node.selector));
      offset += 2;
      view.setUint16(offset, getStringId(node.agentId));
      offset += 2;
      view.setUint16(offset, getStringId(node.htmlId));
      offset += 2;
      view.setUint16(offset, getStringId(node.textContent));
      offset += 2;
      view.setUint16(offset, getStringId(node.marker));
      offset += 2;
      view.setUint8(offset, node.ariaHidden ? 1 : 0);
      offset += 1;

      const classes = node.classes || [];
      view.setUint16(offset, classes.length);
      offset += 2;
      classes.forEach((className) => {
        view.setUint16(offset, getStringId(className));
        offset += 2;
      });

      view.setFloat32(offset, node.rect.top);
      offset += 4;
      view.setFloat32(offset, node.rect.left);
      offset += 4;
      view.setFloat32(offset, node.rect.width);
      offset += 4;
      view.setFloat32(offset, node.rect.height);
      offset += 4;
      view.setFloat32(offset, node.rect.bottom);
      offset += 4;
      view.setFloat32(offset, node.rect.right);
      offset += 4;
      view.setFloat32(offset, node.viewportRect.top);
      offset += 4;
      view.setFloat32(offset, node.viewportRect.left);
      offset += 4;

      const serializeContext: SerializeContext = { view, offset, getStringId };
      serializeComputedStyles(node.styles, serializeContext);
      offset = serializeContext.offset;

      view.setUint16(offset, node.depth);
      offset += 2;
      const children = node.children || [];
      view.setUint16(offset, children.length);
      offset += 2;

      for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
        nodeStack.push(children[childIndex]!);
      }
    }

    return new Uint8Array(buffer, 0, offset);
  }

  static deserialize(data: Uint8Array): CaliperNode {
    const buffer = data.buffer;
    const view = new DataView(buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    const magic = view.getUint32(offset);
    offset += 4;
    if (magic !== BitBridge.MAGIC) throw new Error("Invalid BitBridge format");

    const stringCount = view.getUint32(offset);
    offset += 4;
    const stringList: string[] = [""];
    const decoder = new TextDecoder();
    for (let stringIndex = 0; stringIndex < stringCount; stringIndex += 1) {
      const byteLength = view.getUint16(offset);
      offset += 2;
      const decodedString = decoder.decode(
        new Uint8Array(buffer, data.byteOffset + offset, byteLength)
      );
      stringList.push(decodedString);
      offset += byteLength;
    }

    const root = this.deserializeNode(view, offset, stringList);
    offset = root.newOffset;

    const nodeStack: { node: CaliperNode; childrenToRead: number }[] = [
      {
        node: root.node,
        childrenToRead: root.childCount,
      },
    ];

    while (nodeStack.length > 0) {
      const current = nodeStack[nodeStack.length - 1]!;

      if (current.childrenToRead > 0) {
        const childResult = this.deserializeNode(view, offset, stringList);
        offset = childResult.newOffset;

        childResult.node.parentAgentId = current.node.agentId;
        current.node.children.push(childResult.node);
        current.childrenToRead -= 1;

        if (childResult.childCount > 0) {
          nodeStack.push({
            node: childResult.node,
            childrenToRead: childResult.childCount,
          });
        }
      } else {
        nodeStack.pop();
      }
    }

    return root.node;
  }

  private static deserializeNode(
    view: DataView,
    offset: number,
    stringList: string[]
  ): { node: CaliperNode; childCount: number; newOffset: number } {
    const tag = stringList[view.getUint16(offset)] || "";
    offset += 2;
    const selector = stringList[view.getUint16(offset)] || "";
    offset += 2;
    const agentId = stringList[view.getUint16(offset)] || "";
    offset += 2;
    const htmlId = stringList[view.getUint16(offset)] || undefined;
    offset += 2;
    const textContent = stringList[view.getUint16(offset)] || undefined;
    offset += 2;
    const marker = stringList[view.getUint16(offset)] || undefined;
    offset += 2;
    const ariaHidden = view.getUint8(offset) === 1;
    offset += 1;

    const classCount = view.getUint16(offset);
    offset += 2;
    const classes: string[] = [];
    for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
      classes.push(stringList[view.getUint16(offset)] || "");
      offset += 2;
    }

    const rect = {
      top: view.getFloat32(offset),
      left: view.getFloat32(offset + 4),
      width: view.getFloat32(offset + 8),
      height: view.getFloat32(offset + 12),
      bottom: view.getFloat32(offset + 16),
      right: view.getFloat32(offset + 20),
      x: 0,
      y: 0,
    };
    rect.x = rect.left;
    rect.y = rect.top;
    offset += 24;

    const viewportTop = view.getFloat32(offset);
    offset += 4;
    const viewportLeft = view.getFloat32(offset);
    offset += 4;

    const deserializeContext: DeserializeContext = { view, offset, stringList };
    const styles: CaliperComputedStyles = deserializeComputedStyles(deserializeContext);
    offset = deserializeContext.offset;

    const depth = view.getUint16(offset);
    offset += 2;
    const childCount = view.getUint16(offset);
    offset += 2;

    const node: CaliperNode = {
      agentId,
      selector,
      tag,
      htmlId,
      classes,
      textContent,
      rect,
      viewportRect: { top: viewportTop, left: viewportLeft },
      depth,
      childCount,
      children: [],
      styles,
      marker,
      ariaHidden,
      measurements: {
        toParent: { top: 0, left: 0, bottom: 0, right: 0 },
        toPreviousSibling: null,
        toNextSibling: null,
        indexInParent: 0,
        siblingCount: childCount,
      },
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
    const jsonLength = view.getUint32(0);
    const jsonString = new TextDecoder().decode(data.subarray(4, 4 + jsonLength));
    const payload = data.subarray(4 + jsonLength);
    return { json: jsonString, payload };
  }
}
