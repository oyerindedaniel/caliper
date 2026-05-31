import type { CaliperComputedStyles, CaliperVisibility } from "@oyerinde/caliper-schema";
import { CALIPER_VISIBILITY_REASON, CALIPER_VISIBILITY_STATUS } from "@oyerinde/caliper-schema";

type VisibilityInput = {
  element: Element;
  computedStyles: CaliperComputedStyles;
};

export function analyzeElementVisibility(input: VisibilityInput): CaliperVisibility {
  const { element, computedStyles } = input;
  const rect = element.getBoundingClientRect();
  const display = computedStyles.display ?? "inline";
  const visibility = computedStyles.visibility ?? "visible";
  const opacityValue = parseOpacity(computedStyles.opacity);
  const intersectingViewport = isIntersectingViewport(rect);
  const hasLayout = rect.width > 0 || rect.height > 0;

  if (display === "none") {
    return {
      status: CALIPER_VISIBILITY_STATUS.HIDDEN,
      reason: CALIPER_VISIBILITY_REASON.DISPLAY_NONE,
      intersectingViewport: false,
    };
  }

  if (visibility === "hidden" || visibility === "collapse" || opacityValue <= 0) {
    return {
      status: CALIPER_VISIBILITY_STATUS.HIDDEN,
      reason: CALIPER_VISIBILITY_REASON.NOT_VISIBLE,
      intersectingViewport: false,
    };
  }

  const hiddenAncestor = findHiddenAncestor(element.parentElement);
  if (hiddenAncestor) {
    return {
      status: CALIPER_VISIBILITY_STATUS.HIDDEN,
      reason: CALIPER_VISIBILITY_REASON.PARENT_HIDDEN,
      intersectingViewport: false,
      hiddenBy: {
        type: "ancestor",
        ancestorSelector: describeElement(hiddenAncestor),
      },
    };
  }

  if (hasLayout && !intersectingViewport) {
    return {
      status: CALIPER_VISIBILITY_STATUS.HIDDEN,
      reason: CALIPER_VISIBILITY_REASON.OUTSIDE_VIEWPORT,
      intersectingViewport: false,
    };
  }

  return {
    status: CALIPER_VISIBILITY_STATUS.VISIBLE,
    intersectingViewport,
  };
}

function parseOpacity(value: CaliperComputedStyles["opacity"]): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 1;
  }
  return 1;
}

function isIntersectingViewport(rect: DOMRect): boolean {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  return (
    rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth
  );
}

function findHiddenAncestor(element: Element | null): Element | null {
  let current = element;
  while (current) {
    const styles = window.getComputedStyle(current);
    if (
      styles.display === "none" ||
      styles.visibility === "hidden" ||
      styles.visibility === "collapse"
    ) {
      return current;
    }

    const opacity = Number.parseFloat(styles.opacity);
    if (Number.isFinite(opacity) && opacity <= 0) {
      return current;
    }

    const contentVisibility =
      styles.contentVisibility || styles.getPropertyValue("content-visibility");
    if (contentVisibility === "hidden") {
      return current;
    }

    current = current.parentElement;
  }
  return null;
}

function describeElement(element: Element): string {
  if (element.id) {
    return `#${element.id}`;
  }

  const agentId = element.getAttribute("data-caliper-agent-id");
  if (agentId) {
    return `[data-caliper-agent-id="${agentId}"]`;
  }

  return element.tagName.toLowerCase();
}
