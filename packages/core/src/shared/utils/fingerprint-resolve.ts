import type { CaliperSelectorInput } from "@oyerinde/caliper-schema";
import { getLiveGeometry } from "@/geometry/utils/scroll-aware.js";
import type { ScrollState } from "@/shared/types/index.js";
import { filterRuntimeClasses } from "./class-filter.js";

export function resolveElementFromFingerprint(
  fingerprint: CaliperSelectorInput
): HTMLElement | null {
  const byAgentId = document.querySelector(`[data-caliper-agent-id="${fingerprint.selector}"]`);
  if (byAgentId) {
    return byAgentId as HTMLElement;
  }

  if (fingerprint.marker) {
    const marked = document.querySelector(`[data-caliper-marker="${fingerprint.marker}"]`);
    if (marked) {
      return marked as HTMLElement;
    }
  }

  if (fingerprint.id) {
    const byId = document.getElementById(fingerprint.id);
    if (byId && byId.tagName.toLowerCase() === fingerprint.tag) {
      return byId;
    }
  }

  if (fingerprint.x !== undefined && fingerprint.y !== undefined) {
    let searchX = fingerprint.x - (fingerprint.initialWindowX ?? window.scrollX);
    let searchY = fingerprint.y - (fingerprint.initialWindowY ?? window.scrollY);

    if (fingerprint.rect && fingerprint.scrollHierarchy) {
      const liveGeometry = getLiveGeometry(
        fingerprint.rect as DOMRect,
        fingerprint.scrollHierarchy as ScrollState[],
        fingerprint.position ?? "static",
        fingerprint.stickyConfig,
        fingerprint.initialWindowX ?? 0,
        fingerprint.initialWindowY ?? 0,
        fingerprint.hasContainingBlock ?? false
      );

      if (liveGeometry) {
        searchX = liveGeometry.left - window.scrollX;
        searchY = liveGeometry.top - window.scrollY;
      }
    }

    for (const target of document.elementsFromPoint(searchX, searchY)) {
      if (target.tagName.toLowerCase() !== fingerprint.tag) {
        continue;
      }

      if (fingerprint.classes?.length) {
        const targetClasses = filterRuntimeClasses(target.classList);
        const classMatch = fingerprint.classes.every((className) =>
          targetClasses.includes(className)
        );
        if (!classMatch) {
          continue;
        }
      }

      return target as HTMLElement;
    }
  }

  return null;
}
