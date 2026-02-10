import {
  type SelectionMetadata,
  type MeasurementResult,
  type ScrollState as CoreScrollState,
  type MeasurementLine as CoreMeasurementLine,
  filterRuntimeClasses,
  getElementDirectText,
  getLiveGeometry,
  type ScrollState,
} from "@caliper/core";
import {
  type SelectionMetadata as BridgeSelectionMetadata,
  type MeasurementResult as BridgeMeasurementResult,
  type ScrollState as BridgeScrollState,
  type CaliperComputedStyles,
  type Rect,
  type MeasurementLine as BridgeMeasurementLine,
  type ContextMetrics,
  type CaliperSelectorInput,
  type SourceHints,
  MAX_DESCENDANT_COUNT,
} from "@oyerinde/caliper-schema";

/**
 * Sanitizes a core SelectionMetadata object for transmission to an agent. 
 * Strips circular references and DOM nodes.
 * 
 * @param metadata - The core selection metadata.
 * @returns A serializable BridgeSelectionMetadata object.
 */
export function sanitizeSelection(
  metadata: SelectionMetadata | null | undefined
): BridgeSelectionMetadata | null {
  if (!metadata) return null;

  return {
    rect: sanitizeDOMRect(metadata.rect),
    scrollHierarchy: metadata.scrollHierarchy.map(sanitizeScrollState),
    position: metadata.position,
    initialWindowX: metadata.initialWindowX,
    initialWindowY: metadata.initialWindowY,
    depth: metadata.depth,
    stickyConfig: metadata.stickyConfig
      ? {
        top: metadata.stickyConfig.top,
        bottom: metadata.stickyConfig.bottom,
        left: metadata.stickyConfig.left,
        right: metadata.stickyConfig.right,
        naturalTop: metadata.stickyConfig.naturalTop,
        naturalLeft: metadata.stickyConfig.naturalLeft,
        containerWidth: metadata.stickyConfig.containerWidth,
        containerHeight: metadata.stickyConfig.containerHeight,
        elementWidth: metadata.stickyConfig.elementWidth,
        elementHeight: metadata.stickyConfig.elementHeight,
        anchorAbsoluteDepth: metadata.stickyConfig.anchorAbsoluteDepth,
      }
      : undefined,
    hasContainingBlock: metadata.hasContainingBlock,
  };
}

function sanitizeDOMRect(
  rect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    x: number;
    y: number;
  } | null
): Rect | null {
  if (!rect) return null;
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    x: rect.x,
    y: rect.y,
  };
}

function sanitizeScrollState(state: CoreScrollState): BridgeScrollState {
  return {
    initialScrollTop: state.initialScrollTop,
    initialScrollLeft: state.initialScrollLeft,
    containerRect: sanitizeDOMRect(state.containerRect),
    absoluteDepth: state.absoluteDepth,
    hasStickyAncestor: state.hasStickyAncestor,
  };
}

/**
 * Sanitizes a core MeasurementResult object for transmission to an agent. 
 * Strips circular references and DOM nodes.
 * 
 * @param result - The core measurement result.
 * @returns A serializable BridgeMeasurementResult object.
 */
export function sanitizeMeasurement(
  result: MeasurementResult | null | undefined
): BridgeMeasurementResult | null {
  if (!result) return null;

  return {
    context: result.context,
    lines: result.lines.map(sanitizeLine),
    primary: sanitizeDOMRect(result.primary)!,
    secondary: sanitizeDOMRect(result.secondary),
    timestamp: result.timestamp,
    primaryHierarchy: result.primaryHierarchy.map(sanitizeScrollState),
    secondaryHierarchy: result.secondaryHierarchy.map(sanitizeScrollState),
    primaryPosition: result.primaryPosition,
    secondaryPosition: result.secondaryPosition,
    primaryWinX: result.primaryWinX,
    primaryWinY: result.primaryWinY,
    secondaryWinX: result.secondaryWinX,
    secondaryWinY: result.secondaryWinY,
    primarySticky: result.primarySticky
      ? {
        top: result.primarySticky.top,
        bottom: result.primarySticky.bottom,
        left: result.primarySticky.left,
        right: result.primarySticky.right,
        naturalTop: result.primarySticky.naturalTop,
        naturalLeft: result.primarySticky.naturalLeft,
        containerWidth: result.primarySticky.containerWidth,
        containerHeight: result.primarySticky.containerHeight,
        elementWidth: result.primarySticky.elementWidth,
        elementHeight: result.primarySticky.elementHeight,
        anchorAbsoluteDepth: result.primarySticky.anchorAbsoluteDepth,
      }
      : undefined,
    secondarySticky: result.secondarySticky
      ? {
        top: result.secondarySticky.top,
        bottom: result.secondarySticky.bottom,
        left: result.secondarySticky.left,
        right: result.secondarySticky.right,
        naturalTop: result.secondarySticky.naturalTop,
        naturalLeft: result.secondarySticky.naturalLeft,
        containerWidth: result.secondarySticky.containerWidth,
        containerHeight: result.secondarySticky.containerHeight,
        elementWidth: result.secondarySticky.elementWidth,
        elementHeight: result.secondarySticky.elementHeight,
        anchorAbsoluteDepth: result.secondarySticky.anchorAbsoluteDepth,
      }
      : undefined,
    primaryHasContainingBlock: result.primaryHasContainingBlock,
    secondaryHasContainingBlock: result.secondaryHasContainingBlock,
  };
}

function sanitizeLine(line: CoreMeasurementLine): BridgeMeasurementLine {
  return {
    type: line.type,
    value: line.value,
    start: { x: line.start.x, y: line.start.y },
    end: { x: line.end.x, y: line.end.y },
    startSync: line.startSync,
    endSync: line.endSync,
  };
}

/**
 * Parses a CSSStyleDeclaration into a flattened, typed CaliperComputedStyles object.
 * 
 * @param styles - The computed style declaration.
 * @returns A typed object containing key layout and visual properties.
 */
export function parseComputedStyles(styles: CSSStyleDeclaration): CaliperComputedStyles {
  const parseNumber = (value: string): number => parseFloat(value) || 0;

  return {
    display: styles.display || styles.getPropertyValue("display"),
    visibility: styles.visibility || styles.getPropertyValue("visibility"),
    position: styles.position || styles.getPropertyValue("position"),
    boxSizing: styles.boxSizing || styles.getPropertyValue("box-sizing"),

    padding: {
      top: parseNumber(styles.paddingTop),
      right: parseNumber(styles.paddingRight),
      bottom: parseNumber(styles.paddingBottom),
      left: parseNumber(styles.paddingLeft),
    },
    margin: {
      top: parseNumber(styles.marginTop),
      right: parseNumber(styles.marginRight),
      bottom: parseNumber(styles.marginBottom),
      left: parseNumber(styles.marginLeft),
    },
    border: {
      top: parseNumber(styles.borderTopWidth),
      right: parseNumber(styles.borderRightWidth),
      bottom: parseNumber(styles.borderBottomWidth),
      left: parseNumber(styles.borderLeftWidth),
    },

    gap: styles.gap ? parseNumber(styles.gap) : null,
    flexDirection: styles.flexDirection || undefined,
    justifyContent: styles.justifyContent || undefined,
    alignItems: styles.alignItems || undefined,

    fontSize: parseNumber(styles.fontSize),
    fontWeight: styles.fontWeight,
    fontFamily: styles.fontFamily,
    lineHeight: styles.lineHeight === "normal" ? "normal" : parseNumber(styles.lineHeight),
    letterSpacing: styles.letterSpacing === "normal" ? "normal" : parseNumber(styles.letterSpacing),
    color: styles.color,

    backgroundColor: styles.backgroundColor,
    borderColor: styles.borderColor,
    borderRadius: styles.borderRadius,
    boxShadow: styles.boxShadow || undefined,
    opacity: parseNumber(styles.opacity),
    outline: styles.outline || undefined,
    outlineColor: styles.outlineColor,
    zIndex: styles.zIndex === "auto" ? null : parseInt(styles.zIndex, 10),

    overflow: styles.overflow,
    overflowX: styles.overflowX,
    overflowY: styles.overflowY,
    contentVisibility:
      styles.contentVisibility || styles.getPropertyValue("content-visibility") || "visible",
  };
}

/**
 * Captures global viewport and window metrics.
 * 
 * @returns Current context metrics including scroll, orientation, and preferences.
 */
export function getContextMetrics(): ContextMetrics {
  const isPortrait = window.matchMedia("(orientation: portrait)").matches;
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "no-preference";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    rootFontSize: parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16,
    devicePixelRatio: window.devicePixelRatio || 1,
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    visualViewportWidth: window.visualViewport?.width || window.innerWidth,
    visualViewportHeight: window.visualViewport?.height || window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    orientation: isPortrait ? "portrait" : "landscape",
    preferences: {
      colorScheme,
      reducedMotion,
    },
  };
}

export function findElementByFingerprint(
  fingerprintData: CaliperSelectorInput
): HTMLElement | null {
  // 1. Try stable marker
  if (fingerprintData.marker) {
    const markedElement = document.querySelector(
      `[data-caliper-marker="${fingerprintData.marker}"]`
    );
    if (markedElement) return markedElement as HTMLElement;
  }

  // 2. Try the original agent-id (might work if no HMR happened)
  const agentIdElement = document.querySelector(
    `[data-caliper-agent-id="${fingerprintData.selector}"]`
  );
  if (agentIdElement) return agentIdElement as HTMLElement;

  // 3. Try HTML ID
  if (fingerprintData.id) {
    const idElement = document.getElementById(fingerprintData.id);
    if (idElement && idElement.tagName.toLowerCase() === fingerprintData.tag) return idElement;
  }

  // 4. Try semantic rediscovery using coordinates and tag
  if (fingerprintData.x !== undefined && fingerprintData.y !== undefined) {
    let searchX = fingerprintData.x - (fingerprintData.initialWindowX || window.scrollX);
    let searchY = fingerprintData.y - (fingerprintData.initialWindowY || window.scrollY);

    if (fingerprintData.rect && fingerprintData.scrollHierarchy) {
      const liveGeometry = getLiveGeometry(
        fingerprintData.rect as DOMRect,
        fingerprintData.scrollHierarchy as ScrollState[],
        fingerprintData.position || "static",
        fingerprintData.stickyConfig,
        fingerprintData.initialWindowX || 0,
        fingerprintData.initialWindowY || 0,
        fingerprintData.hasContainingBlock || false
      );

      if (liveGeometry) {
        searchX = liveGeometry.left - (typeof window !== "undefined" ? window.scrollX : 0);
        searchY = liveGeometry.top - (typeof window !== "undefined" ? window.scrollY : 0);
      }
    } else {
      searchX = fingerprintData.x - window.scrollX;
      searchY = fingerprintData.y - window.scrollY;
    }

    const elementsAtPoint = document.elementsFromPoint(searchX, searchY);

    for (const targetElement of elementsAtPoint) {
      if (targetElement.tagName.toLowerCase() === fingerprintData.tag) {
        const targetClasses = filterRuntimeClasses(targetElement.classList);
        const classMatch = fingerprintData.classes?.every((className: string) =>
          targetClasses.includes(className)
        );

        if (classMatch) return targetElement as HTMLElement;
      }
    }
  }

  return null;
}

/**
 * Attempts to find a DOM element by its unique Caliper fingerprint or a standard selector.
 * 
 * @param targetSelector - The selector or fingerprint string.
 * @returns The resolved HTMLElement if found, otherwise null.
 */
export function resolveElement(targetSelector: string): HTMLElement | null {
  const trimmedSelector = targetSelector.trim();

  if (trimmedSelector.startsWith("{")) {
    try {
      const fingerprintData = JSON.parse(trimmedSelector) as CaliperSelectorInput;
      return findElementByFingerprint(fingerprintData);
    } catch (parseError) { }
  }

  if (trimmedSelector.startsWith("caliper-")) {
    return document.querySelector(`[data-caliper-agent-id="${trimmedSelector}"]`) as HTMLElement;
  }

  try {
    return document.querySelector(trimmedSelector) as HTMLElement;
  } catch (selectorError) {
    return null;
  }
}

/**
 * Attempts to find multiple DOM elements by a standard selector.
 * 
 * @param targetSelector - The selector (CSS or agent ID).
 * @returns An array of resolved Elements.
 */
export function resolveElements(targetSelector: string): Element[] {
  const trimmedSelector = targetSelector.trim();

  if (trimmedSelector.startsWith("{")) {
    const resolvedElement = resolveElement(trimmedSelector);
    return resolvedElement ? [resolvedElement] : [];
  }

  if (trimmedSelector.startsWith("caliper-")) {
    const resolvedElement = resolveElement(trimmedSelector);
    return resolvedElement ? [resolvedElement] : [];
  }

  try {
    return Array.from(document.querySelectorAll(trimmedSelector));
  } catch (selectorError) {
    return [];
  }
}

/**
 * Recursively counts the number of descendant elements of a node, with a safety limit.
 * 
 * @param element - The root element.
 * @param maxCount - The maximum number of descendants to count.
 * @returns An object with the count and whether it was truncated.
 */
export function countDescendants(
  element: Element,
  maxCount = MAX_DESCENDANT_COUNT
): { count: number; isTruncated: boolean } {
  let count = 0;
  const stack: Element[] = [element];

  while (stack.length > 0 && count < maxCount) {
    const el = stack.pop()!;
    for (let i = el.children.length - 1; i >= 0; i--) {
      count++;
      if (count >= maxCount) return { count, isTruncated: true };
      stack.push(el.children[i]!);
    }
  }

  return { count, isTruncated: false };
}

/** Regex patterns for detecting hashed/generated class names */
const HASHED_CLASS_PATTERNS = [
  /__[a-z0-9]{5,}$/i, // CSS Modules: component__abc123
  /^css-[a-z0-9]+$/i, // Emotion: css-abc123
  /^sc-[a-z]+$/i, // styled-components: sc-abc
  /^_[a-z0-9]{6,}$/i, // Generic hash: _abc123xyz
  /^[a-z]+-module_[a-z]+__[a-z0-9]+$/i, // Next.js CSS Modules: page-module_name__hash
];

function isHashedClass(className: string): boolean {
  return HASHED_CLASS_PATTERNS.some((pattern) => pattern.test(className));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generates descriptive metadata (hints) for an element to help an agent 
 * find its source in a codebase.
 * 
 * @param element - The element to analyze.
 * @returns An object containing stable anchors, suggested grep patterns, and more.
 */
export function generateSourceHints(element: HTMLElement): SourceHints {
  const tagName = element.tagName.toLowerCase();
  const stableAnchors: string[] = [];
  const unstableClasses: string[] = [];

  // Priority 1: data-caliper-marker (developer-placed, most stable)
  const marker = element.getAttribute("data-caliper-marker");
  if (marker) {
    stableAnchors.push(`data-caliper-marker="${marker}"`);
  }

  // Priority 2: data-testid (common testing convention)
  const testId = element.getAttribute("data-testid");
  if (testId) {
    stableAnchors.push(`data-testid="${testId}"`);
  }

  // Priority 3: id (if not auto-generated)
  const id = element.id;
  if (id && !id.startsWith("radix-") && !id.startsWith(":r") && !/^[a-z0-9]{8,}$/i.test(id)) {
    stableAnchors.push(`id="${id}"`);
  }

  // Priority 4: aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    stableAnchors.push(`aria-label="${ariaLabel}"`);
  }

  // Priority 5: name (for form elements)
  const name = element.getAttribute("name");
  if (name) {
    stableAnchors.push(`name="${name}"`);
  }

  // Priority 6: role (if explicit)
  const role = element.getAttribute("role");
  if (role) {
    stableAnchors.push(`role="${role}"`);
  }

  // Priority 7: other data-* attributes (excluding caliper internals)
  for (const attr of Array.from(element.attributes)) {
    if (
      attr.name.startsWith("data-") &&
      !attr.name.startsWith("data-caliper-") &&
      !attr.name.startsWith("data-radix-") &&
      attr.name !== "data-testid"
    ) {
      stableAnchors.push(`${attr.name}="${attr.value}"`);
    }
  }

  // Classify classes as stable or hashed
  const classes = filterRuntimeClasses(element.classList);
  for (const cls of classes) {
    if (isHashedClass(cls)) {
      unstableClasses.push(cls);
    } else if (cls.length > 2 && !stableAnchors.some((a) => a.includes(cls))) {
      // Short classes like "p" or "m" are not useful for grep
      stableAnchors.push(`className="${cls}"`);
    }
  }

  // Get text content (truncated)
  let textContent = getElementDirectText(element, 50);
  if (textContent && textContent.length === 50) {
    textContent = textContent + "...";
  }

  // Get accessible name (aria-label or aria-labelledby resolved)
  let accessibleName: string | undefined = ariaLabel || undefined;
  if (!accessibleName) {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) {
        accessibleName = labelEl.textContent?.trim().slice(0, 50) || undefined;
      }
    }
  }

  // Determine best suggested grep pattern
  let suggestedGrep: string | undefined;
  if (stableAnchors.length > 0) {
    suggestedGrep = escapeRegex(stableAnchors[0]!);
  } else if (textContent) {
    // Use text content as fallback
    suggestedGrep = escapeRegex(textContent);
  }

  return {
    stableAnchors,
    suggestedGrep,
    textContent,
    accessibleName,
    unstableClasses,
    tagName,
  };
}
