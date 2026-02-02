import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getScrollAwareRect,
  isScrollContainer,
  getScrollHierarchy,
  getLiveGeometry,
  deduceGeometry,
  getCommonVisibilityWindow,
  clampPointToGeometry,
} from "./scroll-aware.js";

interface CSSDictionary extends Record<string, string | undefined> {
  display?: string;
  visibility?: string;
  position?: string;
  transform?: string;
  filter?: string;
  perspective?: string;
  contain?: string;
  willChange?: string;
  overflow?: string;
  overflowX?: string;
  overflowY?: string;
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
}

describe("Scroll-Aware Geometry", () => {
  const styleStore = new Map<Element, CSSDictionary>();

  beforeEach(() => {
    document.body.innerHTML = "";
    styleStore.clear();
    vi.restoreAllMocks();

    Object.defineProperty(window, "scrollX", { value: 0, writable: true, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
    Object.defineProperty(window, "innerWidth", {
      value: 1000,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 1000,
      writable: true,
      configurable: true,
    });

    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element): CSSStyleDeclaration => {
      const mock = styleStore.get(el) || {};
      const merged: CSSDictionary = {
        position: "static",
        transform: "none",
        filter: "none",
        perspective: "none",
        contain: "none",
        willChange: "auto",
        overflow: "visible",
        overflowX: "visible",
        overflowY: "visible",
        top: "auto",
        bottom: "auto",
        left: "auto",
        right: "auto",
        display: "block",
        ...mock,
      };
      return {
        ...merged,
        getPropertyValue: (p: string) => merged[p] || "",
      } as unknown as CSSStyleDeclaration;
    });
  });

  function setupSpatialSimulation(
    el: HTMLElement,
    config: {
      clientWidth?: number;
      clientHeight?: number;
      scrollLeft?: number;
      scrollTop?: number;
      offsetTop?: number;
      offsetLeft?: number;
      offsetParent?: Element | null;
      rect?: Partial<DOMRect>;
      styles?: CSSDictionary;
    }
  ) {
    Object.defineProperty(el, "clientWidth", {
      value: config.clientWidth ?? 100,
      configurable: true,
    });
    Object.defineProperty(el, "clientHeight", {
      value: config.clientHeight ?? 100,
      configurable: true,
    });
    Object.defineProperty(el, "scrollLeft", {
      value: config.scrollLeft ?? 0,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(el, "scrollTop", {
      value: config.scrollTop ?? 0,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(el, "offsetTop", { value: config.offsetTop ?? 0, configurable: true });
    Object.defineProperty(el, "offsetLeft", { value: config.offsetLeft ?? 0, configurable: true });
    Object.defineProperty(el, "offsetParent", {
      value: config.offsetParent ?? null,
      configurable: true,
    });

    if (config.rect) {
      const r = config.rect;
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        top: r.top ?? 0,
        left: r.left ?? 0,
        width: r.width ?? 0,
        height: r.height ?? 0,
        bottom: (r.top ?? 0) + (r.height ?? 0),
        right: (r.left ?? 0) + (r.width ?? 0),
        x: r.left ?? 0,
        y: r.top ?? 0,
        toJSON: () => "",
      } as DOMRect);
    }

    if (config.styles) {
      styleStore.set(el, config.styles);
    }
  }

  describe("Core Utils & Guards", () => {
    it("should handle negative window scroll (Safari Overscroll)", () => {
      const viewportRect = new DOMRect(0, 0, 100, 100);
      Object.defineProperty(window, "scrollX", { value: -50 });
      Object.defineProperty(window, "scrollY", { value: -50 });
      const abs = getScrollAwareRect(viewportRect);
      // Expected: 0 (base) + (-50) [Window Scroll] = -50
      expect(abs.left).toBe(-50);
      expect(abs.top).toBe(-50);
    });

    it("should identify SVG elements as renderable but not scroll containers", () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      document.body.appendChild(svg);
      styleStore.set(svg, { overflow: "hidden" });
      expect(isScrollContainer(svg)).toBe(false);
    });

    it("should identify overflow: clip as a scroll container for clipping purposes", () => {
      const div = document.createElement("div");
      setupSpatialSimulation(div, { styles: { overflow: "clip" } });
      expect(isScrollContainer(div)).toBe(true);
    });
  });

  describe("Sticky Matrix", () => {
    it("should accurately deduce sticky configuration (Top Stick)", () => {
      const container = document.createElement("div");
      const sticky = document.createElement("div");
      container.appendChild(sticky);
      document.body.appendChild(container);

      setupSpatialSimulation(container, {
        clientHeight: 1000,
        rect: { top: 0, left: 0, height: 1000, width: 500 },
      });
      setupSpatialSimulation(sticky, {
        offsetTop: 5,
        offsetParent: container,
        rect: { top: 10, left: 0, height: 50, width: 500 },
        styles: { position: "sticky", top: "10px" },
      });

      const geo = deduceGeometry(sticky);
      expect(geo.position).toBe("sticky");
      expect(geo.stickyConfig?.top).toBe(10); // CSS Top
      expect(geo.stickyConfig?.naturalTop).toBe(5); // Offset Top
    });

    it("should handle bottom-sticky positioning mapping", () => {
      const sticky = document.createElement("div");
      document.body.appendChild(sticky);
      setupSpatialSimulation(sticky, {
        rect: { top: 80, height: 20 },
        styles: { position: "sticky", bottom: "20px" },
      });

      const geo = deduceGeometry(sticky);
      expect(geo.stickyConfig?.bottom).toBe(20); // CSS Bottom
    });
  });

  describe("Fixed Position & Containing Blocks (Exotic CSS)", () => {
    it("should detect when fixed element is in a transformed ancestor", () => {
      const wrapper = document.createElement("div");
      const transformed = document.createElement("div");
      const fixed = document.createElement("div");

      transformed.appendChild(fixed);
      wrapper.appendChild(transformed);
      document.body.appendChild(wrapper);

      setupSpatialSimulation(wrapper, { styles: { position: "static" } });
      setupSpatialSimulation(transformed, {
        styles: { transform: "scale(1)", position: "static" },
      });
      setupSpatialSimulation(fixed, { styles: { position: "fixed" } });

      const geo = deduceGeometry(fixed);
      expect(geo.position).toBe("fixed");
      expect(geo.hasContainingBlock).toBe(true);
    });

    it("should maintain viewport pinning for standard fixed elements (Unconstrained)", () => {
      Object.defineProperty(window, "scrollX", { value: 100 });
      Object.defineProperty(window, "scrollY", { value: 100 });

      const stableRect = new DOMRect(10, 10, 50, 50);
      const live = getLiveGeometry(stableRect, [], "fixed", undefined, 0, 0, false);

      // Expected: 10 (base) + 100 [Window Scroll] = 110
      expect(live?.top).toBe(110);
      expect(live?.left).toBe(110);
    });

    it("should handle nested internal scroll within fixed containers (Portaled)", () => {
      const popover = document.createElement("div");
      const scrollArea = document.createElement("div");
      const target = document.createElement("div");

      scrollArea.appendChild(target);
      popover.appendChild(scrollArea);
      document.body.appendChild(popover);

      setupSpatialSimulation(popover, { styles: { position: "fixed" } });
      setupSpatialSimulation(scrollArea, {
        styles: { overflow: "auto" },
        scrollLeft: 0,
        scrollTop: 0,
      });

      const stableRect = new DOMRect(10, 10, 50, 50);
      const hierarchy = getScrollHierarchy(target);

      Object.defineProperty(scrollArea, "scrollTop", { value: 50, configurable: true });
      Object.defineProperty(window, "scrollY", { value: 100, writable: true });

      const live = getLiveGeometry(stableRect, hierarchy, "fixed", undefined, 0, 0, false);

      // Expected: 10 (base) - (50 - 0) [Local Scroll Delta] - (100 - 0) [Window Scroll Delta]
      // = 10 - 50 + 100 = 60
      expect(live?.top).toBe(60);
    });

    it("should maintain glue for sticky items inside fixed containers (Navbar Pattern)", () => {
      const navbar = document.createElement("nav");
      const stickyItem = document.createElement("div");
      navbar.appendChild(stickyItem);
      document.body.appendChild(navbar);

      setupSpatialSimulation(navbar, { styles: { position: "fixed" } });
      setupSpatialSimulation(stickyItem, { styles: { position: "sticky", top: "0px" } });

      const stableRect = new DOMRect(0, 0, 100, 50);
      const hierarchy = getScrollHierarchy(stickyItem);

      Object.defineProperty(window, "scrollY", { value: 500 });

      const live = getLiveGeometry(stableRect, hierarchy, "fixed", undefined, 0, 0, false);

      // Expected: 0 (base) + 500 [Window Scroll] = 500
      expect(live?.top).toBe(500);
    });

    it("should handle portaled items (Portal Trigger Stability)", () => {
      // Structure before portal
      const mainContent = document.createElement("main");
      const scrollContainer = document.createElement("div");
      const portalRoot = document.createElement("div"); // Usually at body end

      scrollContainer.appendChild(mainContent);
      document.body.appendChild(scrollContainer);
      document.body.appendChild(portalRoot);

      setupSpatialSimulation(scrollContainer, {
        styles: { overflow: "auto" },
        scrollTop: 0,
      });

      const popover = document.createElement("div");
      portalRoot.appendChild(popover);
      setupSpatialSimulation(popover, { styles: { position: "fixed" } });

      const stableRect = new DOMRect(300, 300, 200, 200);
      const hierarchy = getScrollHierarchy(popover);

      Object.defineProperty(window, "scrollY", { value: 100, writable: true });
      Object.defineProperty(scrollContainer, "scrollTop", { value: 500, configurable: true });

      const live = getLiveGeometry(stableRect, hierarchy, "fixed", undefined, 0, 0, false);

      // Expected: 300 (base) + 100 [Window Scroll] = 400 (Fixed ignores container scroll 500)
      expect(live?.top).toBe(400);
    });

    it("should handle floating item (Absolute) in outside scroll container", () => {
      const container = document.createElement("div");
      const floatingItem = document.createElement("div");
      container.appendChild(floatingItem);
      document.body.appendChild(container);

      setupSpatialSimulation(container, {
        styles: { overflow: "auto", position: "relative" },
        scrollLeft: 0,
        scrollTop: 0,
      });
      setupSpatialSimulation(floatingItem, { styles: { position: "absolute" } });

      const stableRect = new DOMRect(200, 200, 100, 100);
      const hierarchy = getScrollHierarchy(floatingItem);

      Object.defineProperty(container, "scrollTop", { value: 100, configurable: true });

      const live = getLiveGeometry(stableRect, hierarchy, "static", undefined, 0, 0, false);

      // Expected: 200 (base) - 100 [Container Scroll] = 100 (Absolute moves with content)
      expect(live?.top).toBe(100);
    });
  });

  describe("Visibility Clipping & Pruning", () => {
    it("should detect when partially visible (Bounding Edge Case)", () => {
      const container = document.createElement("div");
      setupSpatialSimulation(container, { clientHeight: 100, clientWidth: 100 });
      const item = {
        element: container,
        initialScrollLeft: 0,
        initialScrollTop: 0,
        containerRect: new DOMRect(0, 0, 100, 100),
      };

      const stableRect = new DOMRect(0, 99, 100, 100);
      const live = getLiveGeometry(stableRect, [item]);

      expect(live?.isHidden).toBe(false);
      // Expected: Bottom 99px clipped (starts at 99, 1px visible in 100px container)
      expect(live?.clipPath).toBe("inset(0px 0px 99px 0px)");
    });

    it("should report isHidden: false but no clipping for elements outside document viewport bounds", () => {
      const stableRect = new DOMRect(0, 1100, 50, 50);
      const live = getLiveGeometry(stableRect, []);
      expect(live?.clipPath).toBe("none");
    });
  });

  describe("Hierarchy & Context Utilities", () => {
    it("should terminate hierarchy search gracefully at Shadow DOM boundary", () => {
      const host = document.createElement("div");
      const shadow = host.attachShadow({ mode: "open" });
      const inner = document.createElement("div");
      shadow.appendChild(inner);
      document.body.appendChild(host);

      const hierarchy = getScrollHierarchy(inner);
      expect(hierarchy.length).toBe(0);
    });

    it("should calculate common visibility window between elements in distinct hierarchies", () => {
      const mainShared = document.createElement("main");
      const section1 = document.createElement("section");
      const section2 = document.createElement("section");

      setupSpatialSimulation(mainShared, {
        clientWidth: 800,
        clientHeight: 800,
        rect: { top: 0, left: 0, width: 800, height: 800 },
      });

      const mainState = {
        element: mainShared,
        initialScrollLeft: 0,
        initialScrollTop: 0,
        containerRect: new DOMRect(0, 0, 800, 800),
      };

      const h1 = [
        {
          element: section1 as HTMLElement,
          initialScrollLeft: 0,
          initialScrollTop: 0,
          containerRect: new DOMRect(10, 10, 100, 100),
        },
        mainState,
      ];
      const h2 = [
        {
          element: section2 as HTMLElement,
          initialScrollLeft: 0,
          initialScrollTop: 0,
          containerRect: new DOMRect(200, 200, 100, 100),
        },
        mainState,
      ];

      const win = getCommonVisibilityWindow(h1, h2, section1, section2);
      // Expected: 800x800 (Common ancestor dimensions)
      expect(win.maxX).toBe(800);
      expect(win.maxY).toBe(800);
    });

    it("should handle elements inside nested shared scrollable containers (Intersection Math)", () => {
      const sharedContainer = document.createElement("div");
      setupSpatialSimulation(sharedContainer, {
        clientWidth: 500,
        clientHeight: 500,
        rect: { top: 0, left: 0, width: 500, height: 500 },
      });

      const h1 = [
        {
          element: sharedContainer,
          initialScrollLeft: 0,
          initialScrollTop: 0,
          containerRect: new DOMRect(0, 0, 500, 500),
        },
      ];
      const h2 = [...h1];

      const win = getCommonVisibilityWindow(h1, h2, document.body, document.body);

      // Expected: 500x500 (Shared container dimensions)
      expect(win.maxX).toBe(500);
      expect(win.maxY).toBe(500);
      expect(win.minX).toBe(0);
    });

    it("should clamp viewport points to live geometry bounds", () => {
      const geo = {
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        clipPath: "",
        isHidden: false,
        visibleMinX: 10,
        visibleMaxX: 90,
        visibleMinY: 10,
        visibleMaxY: 90,
      };

      const pt = { x: 5, y: 5 };
      const result = clampPointToGeometry(pt, geo, { scrollX: 0, scrollY: 0 });

      // Expected: Clamped to visibleMin/Max (10)
      expect(result.x).toBe(10);
      expect(result.y).toBe(10);
    });
  });
});
