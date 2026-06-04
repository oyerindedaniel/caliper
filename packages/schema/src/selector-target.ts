export const CALIPER_TARGET_RESOLUTION_MODES = {
  DOM_QUERY: "dom_query",
  FINGERPRINT_JSON: "fingerprint_json",
} as const;

export type CaliperTargetResolutionMode =
  (typeof CALIPER_TARGET_RESOLUTION_MODES)[keyof typeof CALIPER_TARGET_RESOLUTION_MODES];

export type NormalizeCaliperTargetSelectorResult =
  | { mode: typeof CALIPER_TARGET_RESOLUTION_MODES.DOM_QUERY; cssSelector: string }
  | { mode: typeof CALIPER_TARGET_RESOLUTION_MODES.FINGERPRINT_JSON };

export function escapeCssAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function isCaliperFingerprintTarget(target: string): boolean {
  return target.trim().startsWith("{");
}

export function isCaliperAgentIdTarget(target: string): boolean {
  return target.trim().startsWith("caliper-");
}

export function normalizeCaliperTargetSelector(
  target: string
): NormalizeCaliperTargetSelectorResult {
  const trimmed = target.trim();

  if (isCaliperFingerprintTarget(trimmed)) {
    return { mode: CALIPER_TARGET_RESOLUTION_MODES.FINGERPRINT_JSON };
  }

  if (isCaliperAgentIdTarget(trimmed)) {
    return {
      mode: CALIPER_TARGET_RESOLUTION_MODES.DOM_QUERY,
      cssSelector: `[data-caliper-agent-id="${escapeCssAttributeSelectorValue(trimmed)}"]`,
    };
  }

  return {
    mode: CALIPER_TARGET_RESOLUTION_MODES.DOM_QUERY,
    cssSelector: trimmed,
  };
}

/** CSS selector for CDP `DOM.querySelector` / `document.querySelector`, or null for JSON fingerprints. */
export function caliperTargetToDomQuerySelector(target: string): string | null {
  const normalized = normalizeCaliperTargetSelector(target);
  if (normalized.mode === CALIPER_TARGET_RESOLUTION_MODES.FINGERPRINT_JSON) {
    return null;
  }

  return normalized.cssSelector;
}
