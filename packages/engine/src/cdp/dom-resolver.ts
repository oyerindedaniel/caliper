import { caliperTargetToDomQuerySelector } from "@oyerinde/caliper-schema";
import type { CdpClient } from "./cdp-client.js";
import type {
  DomDescribeNodeResponse,
  DomGetBoxModelResponse,
  DomGetDocumentResponse,
  DomQuerySelectorResponse,
} from "./cdp-protocol.js";

/** Viewport-relative center of a DOM content quad (8 numbers). */
export function boxContentQuadCenter(contentQuad: number[]): { x: number; y: number } | null {
  if (contentQuad.length < 8) {
    return null;
  }

  const xValues = [
    contentQuad[0] ?? 0,
    contentQuad[2] ?? 0,
    contentQuad[4] ?? 0,
    contentQuad[6] ?? 0,
  ];
  const yValues = [
    contentQuad[1] ?? 0,
    contentQuad[3] ?? 0,
    contentQuad[5] ?? 0,
    contentQuad[7] ?? 0,
  ];
  const left = Math.min(...xValues);
  const top = Math.min(...yValues);
  const right = Math.max(...xValues);
  const bottom = Math.max(...yValues);

  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
  };
}

export async function resolveSelectorClickPoint(
  client: CdpClient,
  selector: string
): Promise<{ x: number; y: number } | null> {
  const nodeId = await resolveSelectorToNodeId(client, selector);
  if (!nodeId) {
    return null;
  }

  const boxModel = await client.send<DomGetBoxModelResponse>("DOM.getBoxModel", { nodeId });
  return boxContentQuadCenter(boxModel.model.content);
}

export async function resolveSelectorToNodeId(
  client: CdpClient,
  selector: string
): Promise<number | null> {
  const cssSelector = caliperTargetToDomQuerySelector(selector);
  if (cssSelector === null) {
    return null;
  }

  await client.send("DOM.enable");

  const document = await client.send<DomGetDocumentResponse>("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });

  const queryResult = await client.send<DomQuerySelectorResponse>("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector: cssSelector,
  });

  return queryResult.nodeId || null;
}

export async function describeNodeSelector(client: CdpClient, nodeId: number): Promise<string> {
  const description = await client.send<DomDescribeNodeResponse>("DOM.describeNode", { nodeId });

  const attributes = description.node.attributes ?? [];
  for (let index = 0; index < attributes.length; index += 2) {
    const name = attributes[index];
    const value = attributes[index + 1];
    if (name === "id" && value) {
      return `#${value}`;
    }
    if (name === "data-caliper-agent-id" && value) {
      return `[data-caliper-agent-id="${value}"]`;
    }
  }

  return description.node.nodeName.toLowerCase();
}
