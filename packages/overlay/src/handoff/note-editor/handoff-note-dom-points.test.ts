import { describe, expect, it } from "vitest";
import { listBlankVisualLineStartWires, wireOffsetToDocPos, wireToDoc } from "@caliper/core";
import {
  getDocAnchorRect,
  getDocAnchorRectAtDomPoint,
  measureBlankStopSeatCoord,
  resolveDomPointAtDocPos,
} from "./handoff-note-dom-points.js";
import {
  HANDOFF_LINE_PAD_ATTR,
  HANDOFF_WIRE_BREAK_ATTR,
  isHandoffLinePadElement,
  isHandoffWireBreakElement,
  renderHandoffNoteDoc,
} from "./handoff-note-dom.js";
import { stubHandoffNoteAnchorRectAtWire } from "./handoff-note-test-helpers.js";

describe("handoff-note-dom-points", () => {
  it("measures a blank stop at its anchor instead of its preceding break", () => {
    const doc = wireToDoc("wrap\n\n\nlower");
    const [firstStop, secondStop] = listBlankVisualLineStartWires(doc);
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

    const points = [
      { wire: firstStop!, top: 200 },
      { wire: secondStop!, top: 218 },
    ].map(({ wire, top }) => ({
      wire,
      top,
      point: resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, wire))!,
    }));
    const priorCreateRange = document.createRange.bind(document);
    const restores = [...root.querySelectorAll(`br[${HANDOFF_WIRE_BREAK_ATTR}]`)].map(
      (br, index) => {
        const prior = br.getBoundingClientRect.bind(br);
        br.getBoundingClientRect = () =>
          ({
            top: 91 + index * 18,
            bottom: 109 + index * 18,
            left: 0,
            right: 4,
            width: 4,
            height: 18,
            x: 0,
            y: 91 + index * 18,
            toJSON: () => ({}),
          }) as DOMRect;
        return () => {
          br.getBoundingClientRect = prior;
        };
      }
    );
    document.createRange = () => {
      const range = priorCreateRange();
      const priorSetStart = range.setStart.bind(range);
      range.setStart = (node: Node, offset: number) => {
        priorSetStart(node, offset);
        const entry = points.find(
          (candidate) => candidate.point.node === node && candidate.point.offset === offset
        );
        if (entry) {
          const rect = {
            top: entry.top - 9,
            bottom: entry.top + 9,
            left: 0,
            right: 4,
            width: 4,
            height: 18,
            x: 0,
            y: entry.top - 9,
            toJSON: () => ({}),
          } as DOMRect;
          range.getClientRects = () => [rect] as unknown as DOMRectList;
          range.getBoundingClientRect = () => rect;
        }
      };
      return range;
    };

    try {
      expect(points.map(({ wire }) => measureBlankStopSeatCoord(root, doc, wire)?.top)).toEqual(
        points.map(({ top }) => top)
      );
    } finally {
      document.createRange = priorCreateRange;
      while (restores.length) restores.pop()?.();
      root.remove();
    }
  });

  it("getDocAnchorRect prefers lowest soft-wrap client rect over previous-row end", () => {
    const agent = "caliper-aaaaaaaaa";
    const wire = `meh @${agent} w`;
    const doc = wireToDoc(wire);
    const wrapW = wire.length - 1;
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.appendChild(root);
    renderHandoffNoteDoc(root, doc, {
      colorByAgentId: new Map([[agent, "#06f"]]),
    });

    // midY coords — stub converts to box tops; bounding stays upper so picker must use getClientRects.
    const restore = stubHandoffNoteAnchorRectAtWire(root, doc, wrapW, [
      { top: 141, left: 610.1 },
      { top: 159, left: 343.0 },
    ]);

    try {
      const rect = getDocAnchorRect(root, doc, wireOffsetToDocPos(doc, wrapW));
      expect(rect).not.toBeNull();
      expect(rect!.left).toBeCloseTo(343.0, 0);
      // midY 159 → box top 150 at default height 18
      expect(rect!.top).toBeCloseTo(150, 0);
    } finally {
      restore();
      root.remove();
    }
  });

  it("getDocAnchorRectAtDomPoint uses plain BR child at root-offset (live blank paint)", () => {
    const wire = "\n\n\n\n";
    const doc = wireToDoc(wire);
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

    let breakIdx = -1;
    let breakEl: HTMLBRElement | null = null;
    for (let i = 0; i < root.childNodes.length; i++) {
      const child = root.childNodes[i];
      if (child instanceof HTMLBRElement && isHandoffWireBreakElement(child)) {
        breakIdx = i;
        breakEl = child;
        break;
      }
    }
    expect(breakEl).not.toBeNull();
    breakEl!.removeAttribute(HANDOFF_WIRE_BREAK_ATTR);
    expect(isHandoffWireBreakElement(breakEl!)).toBe(false);

    const zeroRect = {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const breakRect = {
      top: 250,
      bottom: 268,
      left: 12,
      right: 16,
      width: 4,
      height: 18,
      x: 12,
      y: 250,
      toJSON: () => ({}),
    } as DOMRect;

    const docApi = root.ownerDocument;
    const priorCreateRange = docApi.createRange.bind(docApi);
    docApi.createRange = () => {
      const range = priorCreateRange();
      const priorSetStart = range.setStart.bind(range);
      range.setStart = (node: Node, offset: number) => {
        priorSetStart(node, offset);
        if (node === root && offset === breakIdx) {
          range.getClientRects = () => [] as unknown as DOMRectList;
          range.getBoundingClientRect = () => zeroRect;
        }
        return undefined;
      };
      return range;
    };
    const priorBreakRect = breakEl!.getBoundingClientRect.bind(breakEl!);
    breakEl!.getBoundingClientRect = () => breakRect;

    try {
      const rect = getDocAnchorRectAtDomPoint(root, { node: root, offset: breakIdx });
      expect(rect).not.toBeNull();
      expect(rect!.top).toBe(250);
      expect(rect!.left).toBe(12);
    } finally {
      breakEl!.getBoundingClientRect = priorBreakRect;
      docApi.createRange = priorCreateRange;
      root.remove();
    }
  });

  it("text char-offset under root must not steal preceding wire-break rect (rectWrongBr)", () => {
    const wire = "header\n\ndhhd";
    const doc = wireToDoc(wire);
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });

    const tail = [...root.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent === "dhhd"
    ) as Text | undefined;
    expect(tail).toBeTruthy();
    const breakBeforeTail = tail!.previousSibling;
    expect(breakBeforeTail).toBeInstanceOf(HTMLBRElement);

    const breakRect = {
      top: 150,
      bottom: 167,
      left: 333.5,
      right: 333.5,
      width: 0,
      height: 17,
      x: 333.5,
      y: 150,
      toJSON: () => ({}),
    } as DOMRect;
    const textRect = {
      top: 168,
      bottom: 185,
      left: 363.5,
      right: 363.5,
      width: 0,
      height: 17,
      x: 363.5,
      y: 168,
      toJSON: () => ({}),
    } as DOMRect;

    const priorBreakRect = (breakBeforeTail as HTMLBRElement).getBoundingClientRect.bind(
      breakBeforeTail
    );
    (breakBeforeTail as HTMLBRElement).getBoundingClientRect = () => breakRect;

    const docApi = root.ownerDocument;
    const priorCreateRange = docApi.createRange.bind(docApi);
    docApi.createRange = () => {
      const range = priorCreateRange();
      const priorSetStart = range.setStart.bind(range);
      range.setStart = (node: Node, offset: number) => {
        priorSetStart(node, offset);
        if (node === tail) {
          range.getClientRects = () =>
            ({
              length: 1,
              item: (i: number) => (i === 0 ? textRect : null),
              0: textRect,
              [Symbol.iterator]: function* () {
                yield textRect;
              },
            }) as unknown as DOMRectList;
          range.getBoundingClientRect = () => textRect;
        }
        return undefined;
      };
      return range;
    };

    try {
      // Char offset 3 == last letter of dhhd; must NOT index root.childNodes[3] (the BR).
      const rect = getDocAnchorRectAtDomPoint(root, { node: tail!, offset: 3 });
      expect(rect).not.toBeNull();
      expect(rect!.top, "must use text range Y, not wire-break Y").toBe(168);
      expect(rect!.top).not.toBe(150);

      const endWire = wire.length;
      const endRect = getDocAnchorRect(root, doc, wireOffsetToDocPos(doc, endWire - 1));
      expect(endRect).not.toBeNull();
      expect(endRect!.top, "last dhhd char via doc pos").toBe(168);
    } finally {
      (breakBeforeTail as HTMLBRElement).getBoundingClientRect = priorBreakRect;
      docApi.createRange = priorCreateRange;
      root.remove();
    }
  });

  it("getDocAnchorRect after affinity resolves past the focused char", () => {
    const wire = "d";
    const doc = wireToDoc(wire);
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.appendChild(root);
    renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
    try {
      const pos = wireOffsetToDocPos(doc, 0);
      const omitPoint = resolveDomPointAtDocPos(root, doc, pos);
      const afterPoint = resolveDomPointAtDocPos(root, doc, pos, { focusAffinity: "after" });
      expect(omitPoint?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(afterPoint?.node.nodeType).toBe(Node.TEXT_NODE);
      expect(afterPoint!.offset).toBe(omitPoint!.offset + 1);
      // Plumbing: affinity option must reach resolve (same after point as above).
      expect(getDocAnchorRect(root, doc, pos, { focusAffinity: "after" })).not.toBeNull();
    } finally {
      root.remove();
    }
  });

  /**
   * Locks post-loop EOF line-pad path in resolveTextDomPointAtOffset.
   * In-loop trailing-pad early return was removed as redundant — these wires still
   * land on the line-pad via the after-loop branch (last empty split part → break → pad).
   */
  it("trailing empty line-start after final \\n paints EOF line-pad (post-loop path)", () => {
    const cases = ["a\n", "header \n", "x\n\n", "\n", "hello\n\n\n"] as const;
    for (const wire of cases) {
      const doc = wireToDoc(wire);
      const root = document.createElement("div");
      root.contentEditable = "true";
      document.body.appendChild(root);
      try {
        renderHandoffNoteDoc(root, doc, { colorByAgentId: new Map() });
        expect(
          root.querySelector(`br[${HANDOFF_LINE_PAD_ATTR}]`),
          `pad present for ${JSON.stringify(wire)}`
        ).not.toBeNull();
        const eofPoint = resolveDomPointAtDocPos(root, doc, wireOffsetToDocPos(doc, wire.length));
        expect(eofPoint, `eof point for ${JSON.stringify(wire)}`).not.toBeNull();
        expect(
          isHandoffLinePadElement(eofPoint!.node),
          `eof paints pad for ${JSON.stringify(wire)}`
        ).toBe(true);
      } finally {
        root.remove();
      }
    }
  });
});
