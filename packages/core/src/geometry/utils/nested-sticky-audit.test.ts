import { describe, it, expect, beforeEach, vi } from "vitest";
import { getLiveGeometry, deduceGeometry, getTotalScrollDelta } from "./scroll-aware.js";
import { getLivePoint } from "../../measurement-model/utils/measurement-result.js";
import type { MeasurementLine } from "@oyerinde/caliper-schema";

const elementStyleMap = new Map<Element, Partial<CSSStyleDeclaration>>();

function setupSpatialSimulation(
  el: HTMLElement,
  config: {
    rect?: Partial<DOMRect>;
    styles?: Partial<CSSStyleDeclaration>;
    offsetTop?: number;
    offsetLeft?: number;
    offsetParent?: Element | null;
    clientHeight?: number;
    clientWidth?: number;
    scrollTop?: number;
    scrollLeft?: number;
  }
) {
  const mockRect = {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    bottom: 0,
    right: 0,
    x: 0,
    y: 0,
    ...config.rect,
    toJSON: () => "",
  } as DOMRect;

  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(mockRect);
  Object.defineProperty(el, "clientHeight", {
    value: config.clientHeight ?? mockRect.height,
    configurable: true,
  });
  Object.defineProperty(el, "clientWidth", {
    value: config.clientWidth ?? mockRect.width,
    configurable: true,
  });
  if (!Object.getOwnPropertyDescriptor(el, "offsetTop")) {
    Object.defineProperty(el, "offsetTop", { value: config.offsetTop ?? 0, configurable: true });
  }
  if (!Object.getOwnPropertyDescriptor(el, "offsetLeft")) {
    Object.defineProperty(el, "offsetLeft", { value: config.offsetLeft ?? 0, configurable: true });
  }
  Object.defineProperty(el, "offsetParent", {
    value: config.offsetParent ?? null,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    value: config.scrollTop ?? 0,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(el, "scrollLeft", {
    value: config.scrollLeft ?? 0,
    writable: true,
    configurable: true,
  });

  if (config.styles) {
    elementStyleMap.set(el, config.styles);
  }
}

describe("Nested Sticky Audit", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    elementStyleMap.clear();
    vi.restoreAllMocks();

    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element): CSSStyleDeclaration => {
      const mock = elementStyleMap.get(el) || {};
      const merged: Partial<CSSStyleDeclaration> = {
        overflow: "visible",
        overflowX: "visible",
        overflowY: "visible",
        position: "static",
        top: "auto",
        bottom: "auto",
        left: "auto",
        right: "auto",
        ...mock,
      };

      if (el instanceof HTMLElement && el.style) {
        merged.position = el.style.position || mock.position || "static";
      }

      return merged as unknown as CSSStyleDeclaration;
    });

    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
    Object.defineProperty(window, "scrollX", { value: 0, writable: true, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, writable: true });
  });

  it("Replicate Stress Test Section 3: Sticky inside Scroller with intermediate Relative parent", () => {
    const scroller = document.createElement("div");
    const cappingParent = document.createElement("div");
    const sticky = document.createElement("div");

    cappingParent.appendChild(sticky);
    scroller.appendChild(cappingParent);
    document.body.appendChild(scroller);

    // Scroller at top 200, height 300
    setupSpatialSimulation(scroller, {
      styles: { overflow: "auto" },
      rect: { top: 200, left: 0, width: 500, height: 300 },
      offsetTop: 200,
      offsetParent: document.body,
    });

    // CappingParent inside scroller. Height 1000. Relative.
    setupSpatialSimulation(cappingParent, {
      styles: { position: "relative" },
      rect: { top: 200, left: 0, width: 500, height: 1000 },
      offsetTop: 200,
      offsetParent: document.body,
    });

    // Sticky element inside CappingParent. Top 20 threshold. Natural top 20 relative to parent.
    setupSpatialSimulation(sticky, {
      styles: { position: "sticky", top: "20px" },
      rect: { top: 220, left: 0, width: 100, height: 40 },
      offsetTop: 20,
      offsetParent: cappingParent,
    });

    // Test deducing at scroll 0
    const deduction = deduceGeometry(sticky);

    // Scroll scroller by 100
    Object.defineProperty(scroller, "scrollTop", { value: 100, writable: true });
    // The sticky element would be at viewport 20 relative to scroller.
    // Scroller top is 200. Window scroll is 0.
    // So Sticky Viewport Top = 200 + 20 = 220.
    // Doc Top = 220 + window.scrollY = 220.

    // We need to mock getBoundingClientRect for the live state
    vi.spyOn(sticky, "getBoundingClientRect").mockReturnValue({
      top: 220,
      left: 0,
      width: 100,
      height: 40,
      bottom: 260,
      right: 100,
      x: 0,
      y: 220,
      toJSON: () => "",
    } as DOMRect);

    const live = getLiveGeometry(
      deduction.rect,
      deduction.scrollHierarchy,
      deduction.position,
      deduction.stickyConfig,
      0,
      0
    );

    // If it works correctly, live top should be 220
    expect(live?.top).toBe(220);
  });

  it("Practical Scenario 2: Sticky Header & Footer in same Scroller", () => {
    const scroller = document.createElement("div");
    const header = document.createElement("div");
    const footer = document.createElement("div");

    scroller.appendChild(header);
    scroller.appendChild(footer);
    document.body.appendChild(scroller);

    // Scroller: viewport at 100, height 500
    setupSpatialSimulation(scroller, {
      styles: { overflow: "auto" },
      rect: { top: 100, left: 0, width: 500, height: 500 },
      offsetTop: 100,
      offsetParent: document.body,
    });

    // Header: sticky top 0, natural 0 relative to scroller
    setupSpatialSimulation(header, {
      styles: { position: "sticky", top: "0px" },
      rect: { top: 100, left: 0, width: 500, height: 50 },
      offsetTop: 0,
      offsetParent: scroller,
    });

    // Footer: sticky bottom 0, natural 950 relative to scroller
    setupSpatialSimulation(footer, {
      styles: { position: "sticky", bottom: "0px" },
      rect: { top: 550, left: 0, width: 500, height: 50 },
      offsetTop: 950,
      offsetParent: scroller,
    });

    const headerDec = deduceGeometry(header);
    const footerDec = deduceGeometry(footer);

    // Scroll scroller by 200
    Object.defineProperty(scroller, "scrollTop", { value: 200, writable: true });

    // Header should stick at scroller top (100 viewport)
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      top: 100,
      left: 0,
      width: 500,
      height: 50,
      bottom: 150,
      right: 500,
      x: 0,
      y: 100,
      toJSON: () => "",
    } as DOMRect);
    const headerLive = getLiveGeometry(
      headerDec.rect,
      headerDec.scrollHierarchy,
      headerDec.position,
      headerDec.stickyConfig,
      0,
      0
    );
    expect(headerLive?.top).toBe(100);

    // Footer is at natural 950. At scroll 200:
    // Viewport relative to scroller = 950 - 200 = 750.
    // Scroller height is 500. Bottom edge is at 500 viewport relative to scroller.
    // Footer sticky bottom 0 pins it to 500-50 = 450 viewport relative to scroller.
    // But 750 (static) > 450 (pinned), so it shouldn't be sticking YET if we are scrolling down?
    // Wait, bottom: 0 means it stays AT LEAST at viewport height - element height.
    // If static view is at 750, and limit is 450, it sticks.
    // Viewport Top = 100 (scroller top) + 450 = 550.

    vi.spyOn(footer, "getBoundingClientRect").mockReturnValue({
      top: 550,
      left: 0,
      width: 500,
      height: 50,
      bottom: 600,
      right: 500,
      x: 0,
      y: 550,
      toJSON: () => "",
    } as DOMRect);
    const footerLive = getLiveGeometry(
      footerDec.rect,
      footerDec.scrollHierarchy,
      footerDec.position,
      footerDec.stickyConfig,
      0,
      0
    );
    expect(footerLive?.top).toBe(550);
  });

  it("Practical Scenario 3: Sticky inside Nested Scrollers", () => {
    const outerScroller = document.createElement("div");
    const innerScroller = document.createElement("div");
    const sticky = document.createElement("div");

    innerScroller.appendChild(sticky);
    outerScroller.appendChild(innerScroller);
    document.body.appendChild(outerScroller);

    // Outer Scroller: height 500
    setupSpatialSimulation(outerScroller, {
      styles: { overflow: "auto" },
      rect: { top: 0, left: 0, width: 500, height: 500 },
      offsetTop: 0,
      offsetParent: document.body,
    });

    // Inner Scroller: natural 200 relative to outer, height 300
    setupSpatialSimulation(innerScroller, {
      styles: { overflow: "auto" },
      rect: { top: 200, left: 0, width: 400, height: 300 },
      offsetTop: 200,
      offsetParent: outerScroller,
    });

    // Sticky: natural 100 relative to inner, top 10
    setupSpatialSimulation(sticky, {
      styles: { position: "sticky", top: "10px" },
      rect: { top: 300, left: 0, width: 100, height: 50 },
      offsetTop: 100,
      offsetParent: innerScroller,
    });

    const dec = deduceGeometry(sticky);

    // Scroll outer by 50, inner by 150
    Object.defineProperty(outerScroller, "scrollTop", { value: 50, writable: true });
    Object.defineProperty(innerScroller, "scrollTop", { value: 150, writable: true });

    // Outer scroll 50: Inner Scroller viewport top = 200 - 50 = 150.
    // Inner scroll 150: Sticky natural view top relative to inner = 100 - 150 = -50.
    // Pinned to 10 relative to inner.
    // Sticky viewport top = 150 (inner top) + 10 = 160.

    vi.spyOn(sticky, "getBoundingClientRect").mockReturnValue({
      top: 160,
      left: 0,
      width: 100,
      height: 50,
      bottom: 210,
      right: 100,
      x: 0,
      y: 160,
      toJSON: () => "",
    } as DOMRect);

    const live = getLiveGeometry(
      dec.rect,
      dec.scrollHierarchy,
      dec.position,
      dec.stickyConfig,
      0,
      0
    );
    expect(live?.top).toBe(160);
  });

  it("Practical Scenario 4: Horizontal Sticky Columns (Table Pattern)", () => {
    const tableContainer = document.createElement("div");
    const stickyColumn = document.createElement("div");

    tableContainer.appendChild(stickyColumn);
    document.body.appendChild(tableContainer);

    // Table Container: horizontal scroll, width 400
    setupSpatialSimulation(tableContainer, {
      styles: { overflowX: "auto" },
      rect: { top: 0, left: 100, width: 400, height: 500 },
      offsetLeft: 100,
      offsetParent: document.body,
    });

    // Sticky Column: left 0, natural 0 relative to table
    setupSpatialSimulation(stickyColumn, {
      styles: { position: "sticky", left: "0px" },
      rect: { top: 0, left: 100, width: 100, height: 500 },
      offsetLeft: 0,
      offsetParent: tableContainer,
    });

    const dec = deduceGeometry(stickyColumn);

    // Scroll table horizontally by 150
    Object.defineProperty(tableContainer, "scrollLeft", { value: 150, writable: true });

    // Column should stick at table left (100 viewport)
    vi.spyOn(stickyColumn, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 100,
      width: 100,
      height: 500,
      bottom: 500,
      right: 200,
      x: 100,
      y: 0,
      toJSON: () => "",
    } as DOMRect);

    const live = getLiveGeometry(
      dec.rect,
      dec.scrollHierarchy,
      dec.position,
      dec.stickyConfig,
      0,
      0
    );
    expect(live?.left).toBe(100);
  });

  it("Practical Scenario 5: Sticky inside a Sticky container (Matryoshka)", () => {
    const scroller = document.createElement("div");
    const stickyParent = document.createElement("div");
    const stickyChild = document.createElement("div");

    stickyParent.appendChild(stickyChild);
    scroller.appendChild(stickyParent);
    document.body.appendChild(scroller);

    // Scroller: height 500
    setupSpatialSimulation(scroller, {
      styles: { overflow: "auto" },
      rect: { top: 0, left: 0, width: 500, height: 500 },
      offsetTop: 0,
      offsetParent: document.body,
    });

    // Sticky Parent: sticky top 0, height 1000
    setupSpatialSimulation(stickyParent, {
      styles: { position: "sticky", top: "0px" },
      rect: { top: 0, left: 0, width: 500, height: 1000 },
      offsetTop: 0,
      offsetParent: scroller,
    });

    // Sticky Child: sticky top 50, natural 200 relative to parent
    setupSpatialSimulation(stickyChild, {
      styles: { position: "sticky", top: "50px" },
      rect: { top: 200, left: 0, width: 100, height: 50 },
      offsetTop: 200,
      offsetParent: stickyParent,
    });

    const childDec = deduceGeometry(stickyChild);

    // Scroll scroller by 300
    Object.defineProperty(scroller, "scrollTop", { value: 300, writable: true });

    // Sticky Parent sticks at 0 viewport.
    // Sticky Child natural view relative to parent is 200.
    // Parent is at viewport 0. Child static viewport = 0 + 200 = 200.
    // Child threshold is 50. 200 > 50, so it shouldn't be sticking relative to parent yet?
    // Wait, if parent is sticky and child is sticky, they both try to pin to the SAME scroller.
    // But the child is a descendant of the parent.
    // Our logic in getTotalScrollDelta says:
    // const isDescendantOfStickyAnchor = sticky && scrollState.absoluteDepth > sticky.anchorAbsoluteDepth;
    // If we are measuring stickyChild, its anchor is itself.
    // When we process 'scroller', depth(scroller) < depth(stickyChild), so it applies.
    // However, if we have nested sticky, browser behavior is that they both pin.
    // At scroll 300:
    // Sticky Parent viewport = 0.
    // Sticky Child: natural top 200. scroll 300. static = 200 - 300 = -100.
    // Clamped to 50.
    // Sticky Child viewport = 50.

    vi.spyOn(stickyChild, "getBoundingClientRect").mockReturnValue({
      top: 50,
      left: 0,
      width: 100,
      height: 50,
      bottom: 100,
      right: 100,
      x: 0,
      y: 50,
      toJSON: () => "",
    } as DOMRect);

    const live = getLiveGeometry(
      childDec.rect,
      childDec.scrollHierarchy,
      childDec.position,
      childDec.stickyConfig,
      0,
      0
    );
    expect(live?.top).toBe(50);
  });

  it("Practical Scenario 6: Cross-container capping via Relative parent", () => {
    const scroller = document.createElement("div");
    const cappingParent = document.createElement("div");
    const sticky = document.createElement("div");

    cappingParent.appendChild(sticky);
    scroller.appendChild(cappingParent);
    document.body.appendChild(scroller);

    // Scroller: viewport at 0, height 500
    setupSpatialSimulation(scroller, {
      styles: { overflow: "auto" },
      rect: { top: 0, left: 0, width: 500, height: 500 },
      offsetTop: 0,
      offsetParent: document.body,
    });

    // Capping Parent: height 200, relative, natural 100 relative to scroller
    setupSpatialSimulation(cappingParent, {
      styles: { position: "relative" },
      rect: { top: 100, left: 0, width: 500, height: 200 },
      offsetTop: 100,
      offsetParent: scroller,
    });

    // Sticky element: top 0, natural 0 relative to capping parent
    setupSpatialSimulation(sticky, {
      styles: { position: "sticky", top: "0px" },
      rect: { top: 100, left: 0, width: 100, height: 50 },
      offsetTop: 0,
      offsetParent: cappingParent,
    });

    const dec = deduceGeometry(sticky);

    // Scroll scroller by 150
    Object.defineProperty(scroller, "scrollTop", { value: 150, writable: true });

    // Sticky natural viewport top = 100 (capping) + 0 (sticky) - 150 (scroll) = -50.
    // Threshold 0 pins it to viewport 0?
    // BUT capping parent bottom is at 100 (natural) + 200 (height) = 300.
    // At scroll 150, capping parent viewport bottom = 300 - 150 = 150.
    // Sticky element height 50.
    // If it sticks at 0, its bottom is at 50. 50 < 150, so it's fine.
    // It sticks at 0.

    vi.spyOn(sticky, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      width: 100,
      height: 50,
      bottom: 50,
      right: 100,
      x: 0,
      y: 0,
      toJSON: () => "",
    } as DOMRect);

    const live = getLiveGeometry(
      dec.rect,
      dec.scrollHierarchy,
      dec.position,
      dec.stickyConfig,
      0,
      0
    );
    expect(live?.top).toBe(0);

    // Scroll scroller by 280
    Object.defineProperty(scroller, "scrollTop", { value: 280, writable: true });
    // Capping parent viewport bottom = 300 - 280 = 20.
    // Sticky element height 50.
    // It's pushed up by the bottom edge of capping parent.
    // Top = 20 (bottom edge) - 50 (height) = -30 viewport.

    vi.spyOn(sticky, "getBoundingClientRect").mockReturnValue({
      top: -30,
      left: 0,
      width: 100,
      height: 50,
      bottom: 20,
      right: 100,
      x: 0,
      y: -30,
      toJSON: () => "",
    } as DOMRect);

    const liveCapped = getLiveGeometry(
      dec.rect,
      dec.scrollHierarchy,
      dec.position,
      dec.stickyConfig,
      0,
      0
    );
    expect(liveCapped?.top).toBe(-30);
  });
});

describe("Sticky-Static Disconnect", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    elementStyleMap.clear();
    vi.restoreAllMocks();

    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      const mock = elementStyleMap.get(el) || {};
      const merged = {
        overflow: "visible",
        overflowX: "visible",
        overflowY: "visible",
        position: "static",
        top: "auto",
        bottom: "auto",
        left: "auto",
        right: "auto",
        ...mock,
      };
      return merged as unknown as CSSStyleDeclaration;
    });

    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
    Object.defineProperty(window, "scrollX", { value: 0, writable: true, configurable: true });
  });

  it("FAILING TEST: Sticky element captured while stuck should sync correctly when scrolled back", () => {
    const scroller = document.createElement("div");
    const sticky = document.createElement("div");

    scroller.appendChild(sticky);
    document.body.appendChild(scroller);

    /**
     * SCENARIO:
     * Scroller is at viewport top 100.
     * Scroller is scrolled by 300px.
     * Sticky element has natural offsetTop 100.
     * Sticky element has threshold top 20px.
     */

    // Scroller setup
    setupSpatialSimulation(scroller, {
      styles: { overflow: "auto" },
      rect: { top: 100, left: 0, width: 500, height: 300 },
      offsetTop: 100,
      offsetParent: document.body,
    });
    Object.defineProperty(scroller, "scrollTop", { value: 300 });

    /**
     * REAL BROWSER MATH at scroll 300:
     * Natural Viewport = ScrollerTop (100) + OffsetTop (100) - Scroll (300) = -100.
     * Pinned to 20px threshold relative to scroller?
     * No, position: sticky top: 20px means it stays at 20px relative to VIEWPORT
     * if the container is at the top.
     * Usually it pins to scroller edges. top: 20px relative to scroller would be viewport 100+20 = 120.
     */

    // At capture (scroll 300), the element is stuck at 120 viewport top.
    setupSpatialSimulation(sticky, {
      styles: { position: "sticky", top: "20px" },
      rect: { top: 120, left: 0, width: 100, height: 40 },
      offsetTop: 100, // Natural offset
      offsetParent: scroller,
    });

    const deduction = deduceGeometry(sticky);

    /**
     * CURRENT FAULTY LOGIC (Buggy version using getBoundingClientRect):
     * targetRect.top (120) - containerRect.top (100) + scrollTop (300) = 320.
     * So deduction.stickyConfig.naturalTop will be 320 instead of 100.
     */

    // -- ACTION: Scroll back to 0 --
    Object.defineProperty(scroller, "scrollTop", { value: 0 });

    /**
     * REAL BROWSER position at scroll 0:
     * Viewport = ScrollerTop (100) + OffsetTop (100) - Scroll (0) = 200.
     */
    vi.spyOn(sticky, "getBoundingClientRect").mockReturnValue({
      top: 200,
      left: 0,
      width: 100,
      height: 40,
      toJSON: () => "",
    } as DOMRect);

    const live = getLiveGeometry(
      deduction.rect,
      deduction.scrollHierarchy,
      deduction.position,
      deduction.stickyConfig,
      0,
      0
    );

    /**
     * EXPECTATION: Live geometry matches browser position (200).
     * REALITY (If bug exists):
     * calculateStickyDelta(0, 300, 320, 20, ...)
     *   startRef = max(320-300, 20) = 20
     *   endRef = max(320-0, 20) = 320
     *   delta = 20 - 320 = -300
     *   liveTop = 120 (capture) - (-300) = 420.
     * 420 != 200. => FAIL.
     */
    expect(live?.top).toBe(200);
  });
});

describe("FINAL SYNC REPLICATION", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    elementStyleMap.clear();
    vi.restoreAllMocks();

    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      const mock = elementStyleMap.get(el) || {};
      const merged = {
        overflow: "visible",
        position: "static",
        top: "auto",
        ...mock,
      };
      return merged as unknown as CSSStyleDeclaration;
    });

    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  });

  it("should maintain sync when measuring to target deep in scroller", () => {
    const scroller = document.createElement("div");
    const container = document.createElement("div");
    const sticky = document.createElement("div");
    const target = document.createElement("div");

    scroller.appendChild(container);
    container.appendChild(sticky);
    container.appendChild(target);
    document.body.appendChild(scroller);

    // 1. Setup Scroller (Viewport 100)
    setupSpatialSimulation(scroller, {
      styles: { overflow: "auto" },
      rect: { top: 100, height: 300 },
      offsetTop: 100,
      offsetParent: document.body,
    });

    // 2. Setup Container (Natural relative 0, height 1000)
    setupSpatialSimulation(container, {
      styles: { position: "relative" },
      offsetTop: 20, // user had padding: 20px
      offsetParent: scroller,
    });

    // 3. Setup Sticky (Natural 20 relative to container -> 40 relative to scroller)
    setupSpatialSimulation(sticky, {
      styles: { position: "sticky", top: "20px" },
      rect: { top: 140, height: 40 }, // At scroll 0: 100 (scroller) + 40 (nat) = 140
      offsetTop: 20,
      offsetParent: container,
    });

    // 4. Setup Target (Natural 800 relative to container -> 820 relative to scroller)
    setupSpatialSimulation(target, {
      rect: { top: 920, height: 40 }, // At scroll 0: 100 + 820 = 920
      offsetTop: 800,
      offsetParent: container,
    });

    // STEP A: Select Sticky at Scroll 0
    const stickyDeduction = deduceGeometry(sticky);

    // STEP B: Scroll down to 800
    Object.defineProperty(scroller, "scrollTop", { value: 800 });
    // Sticky is stuck at viewport 120 (scroller 100 + threshold 20)
    vi.spyOn(sticky, "getBoundingClientRect").mockReturnValue({
      top: 120,
      height: 40,
      toJSON: () => "",
    } as DOMRect);
    // Target is at viewport 100 + 820 - 800 = 120
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 120,
      height: 40,
      toJSON: () => "",
    } as DOMRect);

    // STEP C: Select Target now
    const targetDeduction = deduceGeometry(target);

    // STEP D: Scroll back to 0
    Object.defineProperty(scroller, "scrollTop", { value: 0 });

    // CALCULATE LIVE POINTS for the line
    const primaryDelta = getTotalScrollDelta(
      stickyDeduction.scrollHierarchy,
      stickyDeduction.position,
      stickyDeduction.stickyConfig,
      0,
      0
    );

    const secondaryDelta = getTotalScrollDelta(
      targetDeduction.scrollHierarchy,
      targetDeduction.position,
      targetDeduction.stickyConfig,
      0,
      0
    );

    // Line was captured at scroll 800? Wait, primary was captured at scroll 0.
    // If we create a measurement result between them:
    const line: MeasurementLine = {
      type: "distance",
      value: 0, // Not used by getLivePoint but required by type
      start: { x: 0, y: 140 }, // Sticky at scroll 0
      end: { x: 0, y: 120 }, // Target at scroll 800
      startSync: "primary",
      endSync: "secondary",
    };

    const startLive = getLivePoint(line.start, "primary", line, primaryDelta, secondaryDelta, 0, 0);
    const endLive = getLivePoint(line.end, "secondary", line, primaryDelta, secondaryDelta, 0, 0);

    // AT SCROLL 0:
    // Sticky should be at 140.
    // Target should be at 920.
    expect(startLive.y).toBe(140);
    expect(endLive.y).toBe(920);
  });
});
