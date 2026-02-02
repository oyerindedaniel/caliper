import { generateId } from "./id.js";
import { filterRuntimeClasses } from "./class-filter.js";
import { getElementDirectText } from "./text-content.js";
import { BRIDGE_TAB_ID_KEY } from "../constants/index.js";
import type { CaliperSelectorInput, SelectionMetadata } from "@oyerinde/caliper-schema";

export function buildSelectorInfo(
  element: Element,
  metadata?: Partial<SelectionMetadata>
): CaliperSelectorInput {
  const tagName = element.tagName.toLowerCase();

  let agentId = element.getAttribute("data-caliper-agent-id");
  if (!agentId) {
    agentId = generateId("caliper");
    element.setAttribute("data-caliper-agent-id", agentId);
  }

  const id = (element as HTMLElement).id;
  const text = getElementDirectText(element);
  const classes = filterRuntimeClasses(element.classList);

  const parent = element.parentElement;
  let nthChild = -1;
  if (parent) {
    nthChild = Array.from(parent.children).indexOf(element);
  }

  const marker = element.getAttribute("data-caliper-marker") || undefined;

  let depth = metadata?.depth;
  if (depth === undefined) {
    depth = 0;
    let curr = element.parentElement;
    while (curr) {
      depth++;
      curr = curr.parentElement;
    }
  }

  let x: number;
  let y: number;

  if (metadata?.rect) {
    x = Math.round(metadata.rect.left);
    y = Math.round(metadata.rect.top);
  } else {
    const rect = element.getBoundingClientRect();
    x = Math.round(rect.left + (typeof window !== "undefined" ? window.scrollX : 0));
    y = Math.round(rect.top + (typeof window !== "undefined" ? window.scrollY : 0));
  }

  const info: CaliperSelectorInput = {
    selector: agentId,
    tag: tagName,
    timestamp: Date.now(),
    nthChild: nthChild !== -1 ? nthChild : undefined,
    x,
    y,
    depth,
    marker,
  };

  if (id) info.id = id;
  if (text) info.text = text;
  if (classes.length > 0) info.classes = classes;

  const tabId =
    typeof sessionStorage !== "undefined" ? sessionStorage.getItem(BRIDGE_TAB_ID_KEY) : null;
  if (tabId) info.tabId = tabId;

  return info;
}

/**
 * A helper function for developers to add stable markers to their components.
 * Returns an object with the data-caliper-marker attribute.
 *
 * @example
 * <div {...caliperProps("main-logo")}>...</div>
 */
export function caliperProps(marker: string) {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
    return {};
  }
  return {
    "data-caliper-marker": marker,
  };
}
