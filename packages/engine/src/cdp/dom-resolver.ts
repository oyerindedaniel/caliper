import type { CdpClient } from "./cdp-client.js";
import type {
  DomDescribeNodeResponse,
  DomGetDocumentResponse,
  DomQuerySelectorResponse,
} from "./cdp-protocol.js";

export function normalizeSelectorForDom(selector: string): string {
  if (selector.startsWith("caliper-")) {
    return `[data-caliper-agent-id="${selector}"]`;
  }

  return selector;
}

export async function resolveSelectorToNodeId(
  client: CdpClient,
  selector: string
): Promise<number | null> {
  await client.send("DOM.enable");

  const document = await client.send<DomGetDocumentResponse>("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });

  const queryResult = await client.send<DomQuerySelectorResponse>("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector: normalizeSelectorForDom(selector),
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
