import { describe, it, expect, beforeEach, vi } from "vitest";
import { walkAndMeasure } from "./walk-engine.js";

interface MockRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
  x: number;
  y: number;
}

interface CSSDictionary extends Record<string, string | undefined> {
  display?: string;
  visibility?: string;
  position?: string;
  boxSizing?: string;
  fontSize?: string;
  opacity?: string;
  paddingTop?: string;
  paddingLeft?: string;
  paddingBottom?: string;
  paddingRight?: string;
  marginTop?: string;
  marginLeft?: string;
  marginBottom?: string;
  marginRight?: string;
  gap?: string;
  zIndex?: string;
}

interface LayoutSimulation {
  rect: MockRect;
  styles: CSSDictionary;
}

describe("WalkEngine Verification - Industrial Scenarios", () => {
  const layoutStore = new Map<Element, LayoutSimulation>();

  const BASE_RECT: MockRect = {
    top: 0,
    left: 0,
    width: 100,
    height: 100,
    bottom: 100,
    right: 100,
    x: 0,
    y: 0,
  };
  const BASE_STYLE: CSSDictionary = {
    display: "block",
    visibility: "visible",
    position: "static",
    boxSizing: "border-box",
    fontSize: "16px",
    opacity: "1",
    paddingTop: "0px",
    paddingLeft: "0px",
    paddingBottom: "0px",
    paddingRight: "0px",
    marginTop: "0px",
    marginLeft: "0px",
    marginBottom: "0px",
    marginRight: "0px",
    gap: "normal",
    zIndex: "auto",
  };

  beforeEach(() => {
    const doc = globalThis.document;
    if (!doc) {
      throw new Error("JSDOM environment not initialized.");
    }
    doc.body.innerHTML = "";
    layoutStore.clear();
    vi.restoreAllMocks();

    const createDOMRect = (r: MockRect): DOMRect =>
      ({
        ...r,
        toJSON: () => JSON.stringify(r),
      }) as DOMRect;

    const originalGetBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      const entry = layoutStore.get(this);
      return createDOMRect(entry ? entry.rect : BASE_RECT);
    };

    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element): CSSStyleDeclaration => {
      const entry = layoutStore.get(el);

      const tag = el.tagName.toUpperCase();
      const isNoRender = ["STYLE", "SCRIPT", "HEAD", "META", "LINK", "TEMPLATE"].includes(tag);

      const mergedStyles: CSSDictionary = {
        ...BASE_STYLE,
        ...(isNoRender ? { display: "none" } : {}),
        ...(entry?.styles || {}),
      };

      return {
        ...mergedStyles,
        getPropertyValue: (p: string): string => {
          const camel = p.replace(/-([a-z])/g, (g) => g[1]!.toUpperCase());
          const val = mergedStyles[camel] || mergedStyles[p];
          return val || "0px";
        },
        item: (index: number) => "",
        length: 0,
        parentRule: null,
      } as unknown as CSSStyleDeclaration;
    });

    return () => {
      Element.prototype.getBoundingClientRect = originalGetBCR;
    };
  });

  function setElementLayout(selector: string, rect: Partial<MockRect>, styles: CSSDictionary = {}) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);

    const fullRect = { ...BASE_RECT, ...rect };
    fullRect.bottom = fullRect.top + fullRect.height;
    fullRect.right = fullRect.left + fullRect.width;
    fullRect.x = fullRect.left;
    fullRect.y = fullRect.top;

    layoutStore.set(el, {
      rect: fullRect,
      styles: styles,
    });
  }

  it("should accurately calculate vertical spacing (Real World: Stack)", async () => {
    document.body.innerHTML = `
            <div id="stack">
                <div id="item1">Top</div>
                <div id="item2">Bottom</div>
            </div>
        `;

    setElementLayout("#stack", { top: 0, left: 0, width: 200, height: 200 });
    setElementLayout("#item1", { top: 10, left: 0, width: 200, height: 50 });
    setElementLayout("#item2", { top: 100, left: 0, width: 200, height: 50 });

    const result = await walkAndMeasure("#stack");
    const node2 = result.root.children[1]!;

    expect(node2.measurements.toPreviousSibling?.distance).toBe(40);
    expect(node2.measurements.toPreviousSibling?.direction).toBe("above");
  });

  it("should respect padding-aware inset offsets (Real World: Inset Content)", async () => {
    document.body.innerHTML = `
            <div id="parent">
                <div id="child">Target</div>
            </div>
        `;

    setElementLayout(
      "#parent",
      { top: 100, left: 100, width: 500, height: 500 },
      {
        paddingTop: "50px",
        paddingLeft: "50px",
      }
    );

    setElementLayout("#child", { top: 200, left: 200, width: 100, height: 100 });

    const result = await walkAndMeasure("#parent");
    const childNode = result.root.children[0]!;

    expect(childNode.measurements.toParent.top).toBe(50);
    expect(childNode.measurements.toParent.left).toBe(50);
  });

  it("should handle flex-row wrap with multi-line spacing", async () => {
    document.body.innerHTML = `
            <div id="grid">
                <div id="c1">C1</div>
                <div id="c2">C2</div>
                <div id="c3">C3</div>
            </div>
        `;

    setElementLayout("#grid", { top: 0, left: 0, width: 200, height: 200 });
    setElementLayout("#c1", { top: 0, left: 0, width: 90, height: 40 });
    setElementLayout("#c2", { top: 0, left: 100, width: 90, height: 40 });
    setElementLayout("#c3", { top: 60, left: 0, width: 90, height: 40 });

    const result = await walkAndMeasure("#grid");
    const n2 = result.root.children[1]!;
    const n3 = result.root.children[2]!;

    expect(n2.measurements.toPreviousSibling?.direction).toBe("left");
    expect(n3.measurements.toPreviousSibling?.direction).toBe("above");
    expect(n3.measurements.toPreviousSibling?.distance).toBe(20);
  });

  it("should correctly prune visibility-inherited trees (Industrial Edge Case)", async () => {
    document.body.innerHTML = `
            <div id="root">
                <div id="container">
                   <div id="target">I am hidden too</div>
                </div>
                <div id="visible">I am visible</div>
            </div>
        `;

    setElementLayout("#container", {}, { visibility: "hidden" });
    setElementLayout("#target", {}, { visibility: "hidden" });

    const result = await walkAndMeasure("#root");

    expect(result.nodeCount).toBe(2);
    expect(result.root.children.map((c) => c.agentId)).toContain("#visible");
    expect(result.root.children.map((c) => c.agentId)).not.toContain("#container");
  });

  it("should handle extreme DOM depth without stack overflow (Industrial Stress)", async () => {
    let html = '<div id="root">';
    let tail = "</div>";
    for (let i = 0; i < 50; i++) {
      html += `<div id="d${i}">`;
      tail += "</div>";
    }
    document.body.innerHTML = html + tail;

    const result = await walkAndMeasure("#root", { maxDepth: 100 });
    expect(result.maxDepthReached).toBe(50);
    expect(result.nodeCount).toBe(51);
  });
});
