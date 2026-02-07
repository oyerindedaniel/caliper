import { describe, it, expect, vi, beforeEach } from "vitest";
import { deduceGeometry, getLiveGeometry } from "./scroll-aware.js";

interface SimulationConfig {
  offsetTop: number;
  offsetLeft?: number;
  offsetParent: Element | null;
  rect: { top: number; left: number; width: number; height: number };
  styles?: Partial<CSSStyleDeclaration>;
}

const elementStyleMap = new Map<Element, Partial<CSSStyleDeclaration>>();

function setupSpatialSimulation(element: HTMLElement, config: SimulationConfig) {
  vi.spyOn(element, "offsetTop", "get").mockReturnValue(config.offsetTop);
  vi.spyOn(element, "offsetLeft", "get").mockReturnValue(config.offsetLeft ?? 0);
  vi.spyOn(element, "offsetParent", "get").mockReturnValue(config.offsetParent as HTMLElement);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    ...config.rect,
    bottom: config.rect.top + config.rect.height,
    right: config.rect.left + config.rect.width,
    x: config.rect.left,
    y: config.rect.top,
    toJSON: () => "",
  } as DOMRect);

  vi.spyOn(element, "clientWidth", "get").mockReturnValue(config.rect.width);
  vi.spyOn(element, "clientHeight", "get").mockReturnValue(config.rect.height);
  vi.spyOn(element, "offsetWidth", "get").mockReturnValue(config.rect.width);
  vi.spyOn(element, "offsetHeight", "get").mockReturnValue(config.rect.height);
  vi.spyOn(element, "clientLeft", "get").mockReturnValue(0);
  vi.spyOn(element, "clientTop", "get").mockReturnValue(0);

  const defaultStyles: Partial<CSSStyleDeclaration> = {
    position: "static",
    top: "auto",
    left: "auto",
    right: "auto",
    bottom: "auto",
    display: "block",
    overflow: "visible",
    transform: "none",
    filter: "none",
    perspective: "none",
    contain: "none",
    willChange: "auto",
    ...config.styles,
  };

  elementStyleMap.set(element, defaultStyles);

  vi.spyOn(window, "getComputedStyle").mockImplementation((targetElement): CSSStyleDeclaration => {
    const storedStyle = elementStyleMap.get(targetElement);
    if (storedStyle) return storedStyle as unknown as CSSStyleDeclaration;
    const defaultStyle: Partial<CSSStyleDeclaration> = {
      position: "static",
      overflow: "visible",
      transform: "none",
      filter: "none",
      perspective: "none",
      contain: "none",
      willChange: "auto",
    };
    return defaultStyle as unknown as CSSStyleDeclaration;
  });
}

describe("Deep Sticky & Scroll-Back Regression", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    elementStyleMap.clear();
    vi.restoreAllMocks();
    // Explicitly reset window scroll which is often overwritten via Object.defineProperty
    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
    Object.defineProperty(window, "scrollX", { value: 0, writable: true, configurable: true });
  });

  it("Scenario 1: Scroll-back drift (Selecting already stuck element)", () => {
    const stickySection = document.createElement("div");
    document.body.appendChild(stickySection);

    // Natural top: 100. Sticky threshold: 20px.
    // If we scroll window to 100, the element is AT 20px relative to viewport.
    // Natural Position = 100. Viewport Position = 100 - 100 = 0 -> clamped to 20.

    setupSpatialSimulation(stickySection, {
      styles: { position: "sticky", top: "20px" },
      offsetTop: 100,
      offsetParent: document.body,
      rect: { top: 20, left: 0, width: 100, height: 50 }, // Captured AT scrollY: 100
    });

    Object.defineProperty(window, "scrollY", { value: 100, writable: true });
    Object.defineProperty(window, "scrollX", { value: 0, writable: true });

    const deduction = deduceGeometry(stickySection);

    // Test: Scroll back to 0.
    // API pattern: Pass capture values, set window.scrollY to target
    Object.defineProperty(window, "scrollY", { value: 0, writable: true });

    const live = getLiveGeometry(
      deduction.rect,
      deduction.scrollHierarchy,
      deduction.position,
      deduction.stickyConfig,
      deduction.initialWindowX,
      deduction.initialWindowY // Capture value = 100
    );

    // At scroll=0, element should be at its natural position: doc top = 100
    expect(live?.top).toBe(100);
  });

  it("Scenario 2: Deep nested measurement (Clipping & Pinning breakage)", () => {
    // Window -> StickyTOC (20px) -> InternalScroll (offset 0, scroll 50) -> Item
    const toc = document.createElement("div");
    const scroller = document.createElement("div");
    const item = document.createElement("div");

    scroller.appendChild(item);
    toc.appendChild(scroller);
    document.body.appendChild(toc);

    // Setup TOC: Sticky at 20px. Natural pos 100.
    // At scrollY 100, TOC is at 20px.
    setupSpatialSimulation(toc, {
      styles: { position: "sticky", top: "20px" },
      offsetTop: 100,
      offsetParent: document.body,
      rect: { top: 20, left: 0, width: 200, height: 400 },
    });

    // Setup Scroller: inside TOC. Scroll 50.
    setupSpatialSimulation(scroller, {
      styles: { overflow: "auto" },
      offsetTop: 0,
      offsetParent: toc,
      rect: { top: 20, left: 0, width: 200, height: 200 },
    });

    // Setup Item: inside Scroller. Offset 100.
    // In viewport: TOC(20) + Scroller(0) + Item(100) - Scroll(50) = 70px.
    setupSpatialSimulation(item, {
      offsetTop: 100,
      offsetParent: scroller,
      rect: { top: 70, left: 5, width: 190, height: 20 },
    });

    Object.defineProperty(window, "scrollY", { value: 100, writable: true });
    Object.defineProperty(scroller, "scrollTop", { value: 50, writable: true });

    const itemDeduction = deduceGeometry(item);

    // Test: Scroll window further to 200.
    // API pattern: Pass capture values, set window.scrollY to target
    Object.defineProperty(window, "scrollY", { value: 200, writable: true });

    const live = getLiveGeometry(
      itemDeduction.rect,
      itemDeduction.scrollHierarchy,
      itemDeduction.position,
      itemDeduction.stickyConfig,
      itemDeduction.initialWindowX,
      itemDeduction.initialWindowY // Capture value = 100
    );

    // TOC stays at viewport 20px (still stuck). Item at viewport 70px.
    // Document top = 70 + 200 = 270
    expect(live?.top).toBe(270);

    // CRITICAL: Clipping check.
    // TOC's live doc position = 20 (viewport) + 200 (scroll) = 220
    expect(live?.visibleMinY).toBe(220);
  });

  it("Scenario 3: Container Capping (Push-off)", () => {
    const container = document.createElement("div");
    const stickyElement = document.createElement("div");
    container.appendChild(stickyElement);
    document.body.appendChild(container);

    // Container: natural top 100, height 200 (bottom 300)
    setupSpatialSimulation(container, {
      offsetTop: 100,
      offsetParent: document.body,
      rect: { top: 100, left: 0, width: 200, height: 200 },
    });

    // Sticky element: Natural top 120 (100+20), sticky threshold 10px, height 50
    // Capping starts when container bottom (300) - element height (50) = 250 doc pos.
    // At threshold 10px, it wants to be at viewport 10.
    setupSpatialSimulation(stickyElement, {
      styles: { position: "sticky", top: "10px" },
      offsetTop: 20,
      offsetParent: container,
      rect: { top: 120, left: 10, width: 50, height: 50 },
    });

    const deduction = deduceGeometry(stickyElement);

    // Test at scroll = 110 (Just starts sticking)
    // Natural top 120 - 110 = 10 (at threshold)
    // Live top should be 120 doc top.
    Object.defineProperty(window, "scrollY", { value: 110, writable: true });
    const live110 = getLiveGeometry(
      deduction.rect,
      deduction.scrollHierarchy,
      deduction.position,
      deduction.stickyConfig,
      deduction.initialWindowX,
      deduction.initialWindowY
    );
    expect(live110?.top).toBe(120);

    // Test at scroll = 300 (Container is at viewport -200)
    // Element is capped by container bottom. Container bottom = 300.
    // Element top must be 300 - 50 = 250.
    Object.defineProperty(window, "scrollY", { value: 300, writable: true });
    const live300 = getLiveGeometry(
      deduction.rect,
      deduction.scrollHierarchy,
      deduction.position,
      deduction.stickyConfig,
      deduction.initialWindowX,
      deduction.initialWindowY
    );
    expect(live300?.top).toBe(250);
  });

  it.skip("Scenario 4: Nested Sticky Hierarchies", () => {
    // Non-practical for now
    const outerSticky = document.createElement("div");
    const innerSticky = document.createElement("div");
    outerSticky.appendChild(innerSticky);
    document.body.appendChild(outerSticky);

    // Outer: sticky at 10px, natural top 100, height 500
    setupSpatialSimulation(outerSticky, {
      styles: { position: "sticky", top: "10px" },
      offsetTop: 100,
      offsetParent: document.body,
      rect: { top: 10, left: 0, width: 200, height: 500 }, // Captured at scroll 100? No, let's capture at 0
    });

    // Inner: sticky at 40px relative to outer, natural top 50 within outer
    // Total natural top = 100 + 50 = 150
    setupSpatialSimulation(innerSticky, {
      styles: { position: "sticky", top: "40px" },
      offsetTop: 50,
      offsetParent: outerSticky,
      rect: { top: 150, left: 0, width: 100, height: 50 },
    });

    Object.defineProperty(window, "scrollY", { value: 0, writable: true });
    const deduction = deduceGeometry(innerSticky);

    // Scroll to 200.
    // Outer sticky (natural 100) is at viewport 10 (stuck). Shift = (doc 210 vs doc 100)?
    // Inner sticky (natural 150) wants to be at viewport 40 relative to outer...
    // Outer is at 10 viewport. Inner wants to be at 10+40 = 50 viewport.
    // If unscrolled: Inner is at 150-200 = -50?
    // Wait, at scroll 200:
    // Outer (natural 100) -> Viewport = max(100-200, 10) = 10. Doc = 10+200 = 210.
    // Inner (natural 150) -> Viewport = max(150-200, 10+40) = 50. Doc = 50+200 = 250.

    Object.defineProperty(window, "scrollY", { value: 200, writable: true });
    const live = getLiveGeometry(
      deduction.rect,
      deduction.scrollHierarchy,
      deduction.position,
      deduction.stickyConfig,
      0,
      0
    );

    expect(live?.top).toBe(250);
  });

  it("Scenario 5: Transformed Container (Containing Block Breakage)", () => {
    const transformed = document.createElement("div");
    const stickyElement = document.createElement("div");
    transformed.appendChild(stickyElement);
    document.body.appendChild(transformed);

    // Transform establishes a containing block for fixed but NOT specifically for sticky (sticky follows nearest scroller)
    // HOWEVER, it does establish a containing block for absolute/fixed which affects deduceGeometry's search.
    setupSpatialSimulation(transformed, {
      styles: { transform: "translateX(10px)", position: "relative" },
      offsetTop: 100,
      offsetParent: document.body,
      rect: { top: 100, left: 10, width: 200, height: 500 },
    });

    setupSpatialSimulation(stickyElement, {
      styles: { position: "sticky", top: "20px" },
      offsetTop: 50,
      offsetParent: transformed,
      rect: { top: 150, left: 10, width: 50, height: 50 },
    });

    const deduction = deduceGeometry(stickyElement);
    expect(deduction.hasContainingBlock).toBe(true);

    // If it's sticky, it should still function normally relative to window scroll if no closer scroller exists
    Object.defineProperty(window, "scrollY", { value: 200, writable: true });
    const live = getLiveGeometry(
      deduction.rect,
      deduction.scrollHierarchy,
      deduction.position,
      deduction.stickyConfig,
      0,
      0
    );

    // natural 150, scroll 200 -> wants -50, clamped to 20. Doc = 20 + 200 = 220.
    expect(live?.top).toBe(220);
  });

  it.skip("Scenario 6: Deep Nest with Intersection Clipping", () => {
    // Non-practical for now
    // Window -> StickyA (20px) -> ScrollerB (scroll 50) -> StickyC (10px relative to B) -> Item
    const containerA = document.createElement("div");
    const scrollerB = document.createElement("div");
    const containerC = document.createElement("div");
    const item = document.createElement("div");

    containerC.appendChild(item);
    scrollerB.appendChild(containerC);
    containerA.appendChild(scrollerB);
    document.body.appendChild(containerA);

    setupSpatialSimulation(containerA, {
      styles: { position: "sticky", top: "20px" },
      offsetTop: 100,
      offsetParent: document.body,
      rect: { top: 20, left: 0, width: 500, height: 500 }, // scroll 100
    });

    setupSpatialSimulation(scrollerB, {
      styles: { overflow: "auto" },
      offsetTop: 10,
      offsetParent: containerA,
      rect: { top: 30, left: 0, width: 400, height: 400 },
    });

    setupSpatialSimulation(containerC, {
      styles: { position: "sticky", top: "10px" },
      offsetTop: 10,
      offsetParent: scrollerB,
      rect: { top: 40, left: 0, width: 300, height: 300 },
    });

    setupSpatialSimulation(item, {
      offsetTop: 100,
      offsetParent: containerC,
      rect: { top: 140, left: 0, width: 50, height: 50 },
    });

    Object.defineProperty(window, "scrollY", { value: 100, writable: true });
    Object.defineProperty(scrollerB, "scrollTop", { value: 0, writable: true });

    const deduction = deduceGeometry(item);

    // Query at window scroll 200.
    // containerA at viewport 20. Doc = 220.
    // scrollerB is child of A. It moves to 220+10 = 230 doc.
    // containerC is child of B and sticky at 10px.
    // If scrollerB scroll is 0: Natural top of C relative to B is 10.
    // Viewport relative to B = 10 - 0 = 10. Stuck.
    // Item is child of C. Natural 100.

    Object.defineProperty(window, "scrollY", { value: 200, writable: true });
    const live = getLiveGeometry(
      deduction.rect,
      deduction.scrollHierarchy,
      deduction.position,
      deduction.stickyConfig,
      0,
      100
    );

    // Item total natural top = 100 (A) + 10 (B) + 10 (C) + 100 (item) = 220.
    // A is stuck at 20. B is at +10 from A = 30 viewport.
    // C is stuck at 10 relative to B = 10 + 30 = 40 viewport.
    // Item is at +100 from C = 140 viewport.
    // Live Doc Top = 140 (viewport) + 200 (scroll) = 340.

    expect(live?.top).toBe(340);

    // Clipping: visibleMinY should be intersection of A, B, C.
    // A clip: 20 viewport + 200 scroll = 220.
    // B clip: 30 viewport + 200 scroll = 230.
    // C doesn't clip (overflow: visible).
    // Result: 230.
    expect(live?.visibleMinY).toBe(230);
  });
});
