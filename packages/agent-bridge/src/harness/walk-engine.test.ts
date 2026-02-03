import { describe, it, expect, beforeEach, vi } from "vitest";
import { walkAndMeasure } from "./walk-engine.js";
import { CaliperNode } from "@oyerinde/caliper-schema";

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
  contentVisibility?: string;
}

interface LayoutSimulation {
  rect: MockRect;
  styles: CSSDictionary;
}

describe("WalkEngine Verification", () => {
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
    const testDocument = globalThis.document;
    if (!testDocument) {
      throw new Error("JSDOM environment not initialized.");
    }
    testDocument.body.innerHTML = "";
    layoutStore.clear();
    vi.restoreAllMocks();

    const createDOMRect = (rect: MockRect): DOMRect =>
      ({
        ...rect,
        toJSON: () => JSON.stringify(rect),
      }) as DOMRect;

    const originalGetBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      const entry = layoutStore.get(this);
      return createDOMRect(entry ? entry.rect : BASE_RECT);
    };

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element: Element): CSSStyleDeclaration => {
        const entry = layoutStore.get(element);

        const tag = element.tagName.toUpperCase();
        const isNoRender = ["STYLE", "SCRIPT", "HEAD", "META", "LINK", "TEMPLATE"].includes(tag);

        const mergedStyles: CSSDictionary = {
          ...BASE_STYLE,
          ...(isNoRender ? { display: "none" } : {}),
          ...(entry?.styles || {}),
        };

        return {
          ...mergedStyles,
          getPropertyValue: (propertyName: string): string => {
            const camel = propertyName.replace(/-([a-z])/g, (match) => match[1]!.toUpperCase());
            const val = mergedStyles[camel] || mergedStyles[propertyName];
            return val || "0px";
          },
          item: (index: number) => "",
          length: 0,
          parentRule: null,
        } as unknown as CSSStyleDeclaration;
      }
    );

    return () => {
      Element.prototype.getBoundingClientRect = originalGetBCR;
    };
  });

  function setElementLayout(
    target: string | Element,
    rect: Partial<MockRect>,
    styles: CSSDictionary = {}
  ) {
    const element = typeof target === "string" ? document.querySelector(target) : target;
    if (!element) throw new Error(`Element not found: ${target}`);

    const fullRect = { ...BASE_RECT, ...rect };
    fullRect.bottom = fullRect.top + fullRect.height;
    fullRect.right = fullRect.left + fullRect.width;
    fullRect.x = fullRect.left;
    fullRect.y = fullRect.top;

    layoutStore.set(element, {
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
    const node2 = result.root.children[1]!;
    const node3 = result.root.children[2]!;

    expect(node2.measurements.toPreviousSibling?.direction).toBe("left");
    expect(node3.measurements.toPreviousSibling?.direction).toBe("above");
    expect(node3.measurements.toPreviousSibling?.distance).toBe(20);
  });

  it("should correctly prune visibility-inherited trees", async () => {
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

    // Root (1), Container (2), Target (3), Visible (4)
    expect(result.nodeCount).toBe(4);
    expect(result.root.children.map((childNode: CaliperNode) => childNode.selector)).toContain(
      "#visible"
    );
    expect(
      result.root.children.find((childNode: CaliperNode) => childNode.htmlId === "container")
        ?.styles.visibility
    ).toBe("hidden");
  });

  it("should strictly prune display:none branches", async () => {
    document.body.innerHTML = `
            <div id="root">
                <div id="none" style="display: none">
                   <div id="ghost">I should not exist</div>
                </div>
                <div id="block">I am here</div>
            </div>
        `;

    setElementLayout("#none", {}, { display: "none" });

    const result = await walkAndMeasure("#root");
    expect(result.nodeCount).toBe(2); // root + block
    const selectors: string[] = [];
    const collect = (node: CaliperNode) => {
      selectors.push(node.selector);
      for (const childNode of node.children) collect(childNode);
    };
    collect(result.root);
    expect(selectors).not.toContain("#none");
    expect(selectors).not.toContain("#ghost");
  });

  it("should handle extreme DOM depth without stack overflow", async () => {
    let html = '<div id="root">';
    let tail = "</div>";
    for (let index = 0; index < 50; index++) {
      html += `<div id="d${index}">`;
      tail += "</div>";
    }
    document.body.innerHTML = html + tail;

    const result = await walkAndMeasure("#root", { maxDepth: 100 });
    expect(result.maxDepthReached).toBe(50);
    expect(result.nodeCount).toBe(51);
  });

  describe("Pagination & Continuous Walking", () => {
    it("should truncate and provide a continuation token when maxNodes is reached", async () => {
      document.body.innerHTML = `
                <div id="root">
                    <div id="c1">
                        <div id="gc1">Sub</div>
                    </div>
                    <div id="c2">Beta</div>
                    <div id="c3">Gamma</div>
                </div>
            `;

      setElementLayout("#root", { width: 100, height: 100 });
      setElementLayout("#c1", { width: 10, height: 10 });
      setElementLayout("#c2", { width: 10, height: 10 });
      setElementLayout("#c3", { width: 10, height: 10 });
      setElementLayout("#gc1", { width: 5, height: 5 });

      // Process: root(1) -> Level 1: c1(2, hits limit), c2(3), c3(4) -> Stop before Level 2 (gc1)
      const result = await walkAndMeasure("#root", { maxNodes: 2 });

      expect(result.nodeCount).toBe(4);
      expect(result.hasMore).toBe(true);
      expect(result.continuationToken).toBeDefined();
      expect(result.batchInstructions).toContain("Tree truncated at 4 nodes");
    });

    it("should terminate pagination at direct parent boundaries to avoid mid-tree cuts", async () => {
      document.body.innerHTML = `
                <div id="root">
                    <div id="parentA">
                        <div id="childA1">A1</div>
                        <div id="childA2">A2</div>
                    </div>
                    <div id="parentB">
                        <div id="childB1">B1</div>
                    </div>
                </div>
            `;

      // 1:root -> (Level 1) 2:parentA(hits limit), 3:parentB -> (Level 2) Stop before childA1
      const result = await walkAndMeasure("#root", { maxNodes: 2 });

      const selectors: string[] = [result.root.selector];
      const collect = (node: CaliperNode) => {
        for (const childNode of node.children) {
          selectors.push(childNode.selector);
          collect(childNode);
        }
      };
      collect(result.root);

      expect(result.nodeCount).toBe(3);
      expect(selectors).toContain("#parentA");
      expect(selectors).toContain("#parentB");
      expect(selectors).not.toContain("#childA1"); // childA1 was unshifted back
      expect(result.continuationToken).toBeDefined();
    });
  });

  describe("Lazy Agent ID Mounting", () => {
    it("should mount a new agent ID if missing but return a more descriptive selector", async () => {
      document.body.innerHTML = `
                <div id="root">
                    <div class="target-class">Missing ID</div>
                </div>
            `;

      const targetEl = document.querySelector(".target-class")!;
      expect(targetEl.getAttribute("data-caliper-agent-id")).toBeNull();

      const result = await walkAndMeasure("#root");
      const targetNode = result.root.children[0]!;

      // Should have mounted an ID
      const mountedId = targetEl.getAttribute("data-caliper-agent-id");
      expect(mountedId).toMatch(/^caliper-[a-z0-9]+/);

      // But should NOT have used it as the selector (should use tag.class:nth-child instead)
      expect(targetNode.selector).toBe("div.target-class:nth-child(1)");

      // agentId defaults to the attribute value if present (which we just mounted)
      expect(targetNode.agentId).toBe(mountedId!);
      expect(targetNode.ariaHidden).toBe(false);
    });

    it("should capture aria-hidden state", async () => {
      document.body.innerHTML = `
                <div id="root">
                    <div id="hidden" aria-hidden="true">Hidden</div>
                </div>
            `;
      const result = await walkAndMeasure("#root");
      const node = result.root.children[0]!;
      expect(node.ariaHidden).toBe(true);
    });

    it("should use and return agent ID if it was already present", async () => {
      document.body.innerHTML = `
                <div id="root">
                    <div data-caliper-agent-id="existing-id">Has ID</div>
                </div>
            `;

      const result = await walkAndMeasure("#root");
      const targetNode = result.root.children[0]!;

      // It should return the full selector wrap
      expect(targetNode.selector).toBe('[data-caliper-agent-id="existing-id"]');
      // agentId should be the raw value
      expect(targetNode.agentId).toBe("existing-id");
    });
  });

  describe("Fault Tolerance", () => {
    it("should gracefully skip nodes that fail to snapshot (e.g., removed during walk)", async () => {
      document.body.innerHTML = `
                <div id="root">
                    <div id="c1">First</div>
                    <div id="c2">Second</div>
                    <div id="c3">Third</div>
                </div>
            `;

      const c2 = document.getElementById("c2")!;
      vi.spyOn(c2, "getBoundingClientRect").mockImplementation(() => {
        throw new Error("Element detached during walk");
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await walkAndMeasure("#root");

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();

      // Should have 3 nodes: root, c1, c3 (c2 skipped)
      expect(result.nodeCount).toBe(3);
      const selectors = [result.root.selector];
      const collect = (node: CaliperNode) => {
        for (const childNode of node.children) {
          selectors.push(childNode.selector);
          collect(childNode);
        }
      };
      collect(result.root);

      expect(selectors).toContain("#c1");
      expect(selectors).toContain("#c3");
      expect(selectors).not.toContain("#c2");
    });
  });

  describe("SVG Geometry Support", () => {
    it("should capture high-precision coordinates for SVG elements", async () => {
      document.body.innerHTML = `
                <div id="container">
                    <svg id="svg-root" width="500" height="500" style="margin-top: 100px;">
                        <rect id="svg-rect" x="50" y="50" width="100" height="100" />
                    </svg>
                </div>
            `;

      setElementLayout("#container", { top: 0, left: 0, width: 600, height: 600 });
      setElementLayout("#svg-root", { top: 100, left: 0, width: 500, height: 500 });
      setElementLayout("#svg-rect", { top: 150, left: 50, width: 100, height: 100 });

      const result = await walkAndMeasure("#container");
      const root = result.root;
      const svg = root.children[0]!;
      const rect = svg.children[0]!;

      expect(rect.tag).toBe("rect");
      expect(rect.rect.top).toBe(150);
      expect(rect.rect.left).toBe(50);
      expect(rect.measurements.toParent.top).toBe(50); // Relative to SVG root
    });
  });

  describe("Shadow DOM Support", () => {
    it("should walk into shadow roots (if possible)", async () => {
      document.body.innerHTML = `
                <div id="host"></div>
                <div id="plain">Plain</div>
            `;

      const host = document.getElementById("host")!;
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `<div id="shadow-child">Shadow</div>`;

      setElementLayout("#host", { top: 0, left: 0, width: 100, height: 100 });
      const shadowChild = shadow.getElementById("shadow-child")!;
      setElementLayout(shadowChild, { top: 10, left: 10, width: 50, height: 50 });

      const result = await walkAndMeasure("#host");

      const selectors: string[] = [];
      const collect = (node: CaliperNode) => {
        selectors.push(node.selector);
        for (const childNode of node.children) collect(childNode);
      };
      collect(result.root);

      expect(selectors).toContain("#shadow-child");
    });

    it("should walk into nested shadow roots", async () => {
      document.body.innerHTML = `<div id="host-outer"></div>`;
      const hostOuter = document.getElementById("host-outer")!;
      const shadowOuter = hostOuter.attachShadow({ mode: "open" });
      shadowOuter.innerHTML = `<div id="host-inner"></div>`;

      const hostInner = shadowOuter.getElementById("host-inner")!;
      const shadowInner = hostInner.attachShadow({ mode: "open" });
      shadowInner.innerHTML = `<div id="deep-child">Deep</div>`;

      setElementLayout(hostOuter, { top: 0, left: 0, width: 200, height: 200 });
      setElementLayout(hostInner, { top: 0, left: 0, width: 200, height: 200 });
      setElementLayout(shadowInner.getElementById("deep-child")!, {
        top: 10,
        left: 10,
        width: 180,
        height: 180,
      });

      const result = await walkAndMeasure("#host-outer");
      const selectors: string[] = [];
      const collect = (node: CaliperNode) => {
        selectors.push(node.selector);
        for (const childNode of node.children) collect(childNode);
      };
      collect(result.root);

      expect(selectors).toContain("#deep-child");
    });
  });

  describe("Modern Visibility Edge Cases", () => {
    it("should strictly prune content-visibility: hidden branches", async () => {
      document.body.innerHTML = `
                <div id="root">
                    <div id="cv-hidden" style="content-visibility: hidden">
                        <div id="child">Hidden Child</div>
                    </div>
                </div>
            `;

      setElementLayout("#root", { top: 0, left: 0 });
      setElementLayout("#cv-hidden", { top: 0, left: 0 }, { contentVisibility: "hidden" });
      setElementLayout("#child", { top: 0, left: 0 });

      const result = await walkAndMeasure("#root");

      expect(result.nodeCount).toBe(1); // Only root
      expect(result.root.children.length).toBe(0);
    });

    it("should NOT prune children of 0x0 containers if they have visible overflow (Layout Branch Killing)", async () => {
      document.body.innerHTML = `
                <div id="root">
                    <div id="zero-size" style="width: 0; height: 0; overflow: visible">
                        <div id="overflow-child" style="width: 100px; height: 100px">Visible child</div>
                    </div>
                </div>
            `;

      // Simulating a container that has 0 size but its children are visible due to overflow
      setElementLayout("#root", { top: 0, left: 0, width: 500, height: 500 });
      setElementLayout(
        "#zero-size",
        { top: 0, left: 0, width: 0, height: 0 },
        { overflow: "visible" }
      );
      setElementLayout("#overflow-child", { top: 0, left: 0, width: 100, height: 100 });

      const result = await walkAndMeasure("#root");

      // We expect the zero-size container to be in the tree because it occupies layout context,
      // and we definitely need its children.
      expect(result.nodeCount).toBe(3); // root, zero-size, overflow-child
      expect(result.root.children[0]!.children[0]!.htmlId).toBe("overflow-child");
    });
  });
});
