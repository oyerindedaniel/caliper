import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  applyDocInsertText,
  collapsedSelection,
  docPosToWireOffset,
  docToWire,
  isEmbeddedBlankBandCollapseProbeWire,
  listEmbeddedBlankBandProbeWires,
  listBlankVisualLineStartWires,
  wireOffsetToDocPos,
  wireToDoc,
  type HandoffNoteDoc,
} from "@caliper/core";
import {
  renderHandoffNoteDoc,
  HANDOFF_WIRE_BREAK_ATTR,
  HANDOFF_LINE_PAD_ATTR,
  isHandoffBlankAnchorElement,
  isHandoffWireBreakElement,
} from "./handoff-note-dom.js";
import {
  buildHandoffNoteLayoutMap,
  buildLayoutMapFromSamples,
  getCachedMeasuredSamples,
  invalidateHandoffNoteLayoutCache,
  isSameWireSoftWrapBandCrossing,
  layoutRowTopTolerance,
  layoutContentRowEndSample,
  layoutContentRowContentExtentRight,
  layoutContentRowEndWire,
  layoutContentRowStickyColumn,
  layoutRowForFocus,
  layoutRowAtWireFocus,
  layoutVisualRowSeats,
  readHandoffNoteLayoutCacheKey,
  setMeasuredSamplesCache,
  type HandoffNoteLayoutMap,
  type HandoffNoteLayoutRow,
} from "./handoff-note-layout-map.js";
import {
  measureBlankStopSeatCoord,
  measureWireBreakCoord,
  resolveDomPointAtDocPos,
  resolvePaintContext,
  resolvePaintContextAtWire,
} from "./handoff-note-dom-points.js";
import { resolveDomVerticalArrowMove } from "./handoff-note-selection.js";
import {
  setSelectionAtWire,
  refreshHandoffNoteEditorLayoutGeometry,
  stubHandoffNoteMentionLayoutCoords,
  stubEmbeddedNewlineSegmentAcquire,
  stubHandoffNoteAnchorRectAtWire,
  stubTextNodeLineRects,
  mountThreeRowMentionSoftWrapFixture,
  applyThreeRowSpacerBrowserParityLayoutStubs,
  monotonicMeasuredLayoutSamples,
} from "./handoff-note-test-helpers.js";
import { applyDocDeleteWithWireLineSeats as applyDocDelete } from "@caliper/core/handoff-note-test";

const AGENT = "caliper-aaaaaaa";

function roundedRowTops(layout: HandoffNoteLayoutMap): number[] {
  return layout.rows.map((row) => Math.round(row.top * 100) / 100);
}

function expectStrictlyIncreasing(tops: number[]): void {
  for (let index = 1; index < tops.length; index++) {
    expect(tops[index]!).toBeGreaterThan(tops[index - 1]!);
  }
}

const EMBEDDED_SOFT_WRAP_ROWS = {
  band0: 100,
  band1: 118,
  band2: 154,
  band3: 172,
} as const;

const EMBEDDED_SOFT_WRAP_SEGMENT_LEFT = 40;
const EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH = 160;

function mountEmbeddedSoftWrapSurface(width = 200): HTMLDivElement {
  const surface = document.createElement("div");
  surface.style.width = `${width}px`;
  document.body.appendChild(surface);
  Object.defineProperty(surface, "clientWidth", { configurable: true, value: width });
  return surface;
}

function paintedOffsetTop(
  nodeOffset: number,
  bands: { wrapAt: number; newlineAt: number; postWrapAt?: number }
): number {
  const { wrapAt, newlineAt, postWrapAt = Number.POSITIVE_INFINITY } = bands;
  if (nodeOffset < wrapAt) {
    return EMBEDDED_SOFT_WRAP_ROWS.band0;
  }
  if (nodeOffset <= newlineAt) {
    return EMBEDDED_SOFT_WRAP_ROWS.band1;
  }
  if (nodeOffset < postWrapAt) {
    return EMBEDDED_SOFT_WRAP_ROWS.band2;
  }
  return EMBEDDED_SOFT_WRAP_ROWS.band3;
}

function stubEmbeddedNewlineNodePaint(
  surface: HTMLElement,
  doc: HandoffNoteDoc,
  bands: { wrapAt: number; newlineAt: number; postWrapAt?: number },
  lineFragmentTops: number[]
): () => void {
  const tailLeft = EMBEDDED_SOFT_WRAP_SEGMENT_LEFT + EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH;
  return stubTextNodeLineRects(
    surface,
    doc,
    0,
    lineFragmentTops.map((top) => ({
      top: top - 9,
      left: EMBEDDED_SOFT_WRAP_SEGMENT_LEFT,
      width: EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH,
      height: 18,
    })),
    {
      resolveOffsetRect: (nodeOffset) => ({
        top: paintedOffsetTop(nodeOffset, bands),
        left: tailLeft,
      }),
    }
  );
}

function stubPostNewlineSoftWrapAcquire(
  surface: HTMLElement,
  doc: HandoffNoteDoc,
  postLineStart: number,
  wireLength: number,
  postWrapStart: number,
  postInterior: number
): () => void {
  return stubEmbeddedNewlineSegmentAcquire(surface, doc, {
    startWire: postLineStart,
    endWireExclusive: wireLength,
    rects: [
      {
        top: EMBEDDED_SOFT_WRAP_ROWS.band2 - 9,
        left: EMBEDDED_SOFT_WRAP_SEGMENT_LEFT,
        width: EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH,
        height: 18,
      },
      {
        top: EMBEDDED_SOFT_WRAP_ROWS.band3 - 9,
        left: EMBEDDED_SOFT_WRAP_SEGMENT_LEFT,
        width: EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH,
        height: 18,
      },
    ],
    probeHits: [
      {
        column: EMBEDDED_SOFT_WRAP_SEGMENT_LEFT + 2,
        rowTop: EMBEDDED_SOFT_WRAP_ROWS.band2,
        pos: wireOffsetToDocPos(doc, postLineStart),
      },
      {
        column: EMBEDDED_SOFT_WRAP_SEGMENT_LEFT + EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH / 2,
        rowTop: EMBEDDED_SOFT_WRAP_ROWS.band2,
        pos: wireOffsetToDocPos(doc, postLineStart + 2),
      },
      {
        column: EMBEDDED_SOFT_WRAP_SEGMENT_LEFT + 2,
        rowTop: EMBEDDED_SOFT_WRAP_ROWS.band3,
        pos: wireOffsetToDocPos(doc, postWrapStart),
      },
      {
        column: EMBEDDED_SOFT_WRAP_SEGMENT_LEFT + EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH / 2,
        rowTop: EMBEDDED_SOFT_WRAP_ROWS.band3,
        pos: wireOffsetToDocPos(doc, postInterior),
      },
    ],
  });
}

describe("handoff-note-layout-map", () => {
  beforeEach(() => {
    invalidateHandoffNoteLayoutCache();
  });

  describe("measured sample cache", () => {
    const cacheRoot = document.createElement("div");
    Object.defineProperty(cacheRoot, "clientWidth", { configurable: true, value: 320 });

    it("returns null before anything is cached", () => {
      expect(readHandoffNoteLayoutCacheKey(cacheRoot)).toBeNull();
      expect(getCachedMeasuredSamples(cacheRoot, "hello", 320)).toBeNull();
    });

    it("stores and reads samples keyed by root, wire, and width", () => {
      const samples = [
        { wire: 0, top: 0, left: 0 },
        { wire: 5, top: 0, left: 40 },
      ];
      setMeasuredSamplesCache(cacheRoot, "hello", 320, samples);

      expect(readHandoffNoteLayoutCacheKey(cacheRoot)).toEqual({
        wire: "hello",
        rootWidth: 320,
        sampleCount: 2,
      });
      expect(getCachedMeasuredSamples(cacheRoot, "hello", 320)).toEqual(samples);
      samples[0]!.top = 999;
      expect(getCachedMeasuredSamples(cacheRoot, "hello", 320)).toEqual([
        { wire: 0, top: 0, left: 0 },
        { wire: 5, top: 0, left: 40 },
      ]);
    });

    it("does not cross-hit another editor root with the same wire and width", () => {
      const otherRoot = document.createElement("div");
      Object.defineProperty(otherRoot, "clientWidth", { configurable: true, value: 320 });
      setMeasuredSamplesCache(cacheRoot, "hello", 320, [{ wire: 0, top: 100, left: 0 }]);
      setMeasuredSamplesCache(otherRoot, "hello", 320, [{ wire: 0, top: 200, left: 0 }]);

      expect(getCachedMeasuredSamples(cacheRoot, "hello", 320)).toEqual([
        { wire: 0, top: 100, left: 0 },
      ]);
      expect(getCachedMeasuredSamples(otherRoot, "hello", 320)).toEqual([
        { wire: 0, top: 200, left: 0 },
      ]);
    });

    it("misses when wire or width changes", () => {
      setMeasuredSamplesCache(cacheRoot, "hello", 320, [{ wire: 0, top: 0, left: 0 }]);

      expect(getCachedMeasuredSamples(cacheRoot, "hello!", 320)).toBeNull();
      expect(getCachedMeasuredSamples(cacheRoot, "hello", 280)).toBeNull();
    });

    it("clears on invalidation", () => {
      setMeasuredSamplesCache(cacheRoot, "hello", 320, [{ wire: 0, top: 0, left: 0 }]);
      invalidateHandoffNoteLayoutCache();
      expect(readHandoffNoteLayoutCacheKey(cacheRoot)).toBeNull();
      expect(getCachedMeasuredSamples(cacheRoot, "hello", 320)).toBeNull();
    });

    it("invalidates one root without clearing another root entry", () => {
      const otherRoot = document.createElement("div");
      Object.defineProperty(otherRoot, "clientWidth", { configurable: true, value: 320 });
      setMeasuredSamplesCache(cacheRoot, "hello", 320, [{ wire: 0, top: 10, left: 0 }]);
      setMeasuredSamplesCache(otherRoot, "hello", 320, [{ wire: 0, top: 20, left: 0 }]);

      invalidateHandoffNoteLayoutCache(cacheRoot);

      expect(getCachedMeasuredSamples(cacheRoot, "hello", 320)).toBeNull();
      expect(getCachedMeasuredSamples(otherRoot, "hello", 320)).toEqual([
        { wire: 0, top: 20, left: 0 },
      ]);
    });

    it("invalidates injected cache after generation bump without wire or width change", () => {
      setMeasuredSamplesCache(cacheRoot, "hello", 320, [{ wire: 0, top: 0, left: 0 }]);
      expect(getCachedMeasuredSamples(cacheRoot, "hello", 320)).not.toBeNull();
      invalidateHandoffNoteLayoutCache();
      setMeasuredSamplesCache(cacheRoot, "hello", 320, [{ wire: 0, top: 12, left: 0 }]);
      expect(getCachedMeasuredSamples(cacheRoot, "hello", 320)).toEqual([
        { wire: 0, top: 12, left: 0 },
      ]);
    });

    it("layoutContentRowEndSample returns measured coords for row-end wire", () => {
      const layout = buildLayoutMapFromSamples(
        [
          { wire: 0, top: 140, left: 350 },
          { wire: 43, top: 140, left: 625 },
          { wire: 48, top: 159, left: 380 },
        ],
        18
      );
      const doc = wireToDoc("x".repeat(50));
      expect(layoutContentRowEndWire(layout, doc, 0)).toBe(43);
      expect(layoutContentRowEndSample(layout, doc, 0)).toEqual({
        wire: 43,
        top: 140,
        left: 625,
      });
      expect(layoutContentRowStickyColumn(layout, doc, 0)).toBe(625);
      expect(layoutContentRowContentExtentRight(layout, doc, 0)).toBe(625);
      expect(layoutContentRowEndSample(layout, doc, 1)).toEqual({
        wire: 48,
        top: 159,
        left: 380,
      });
    });

    it("reuses cache across repeated vertical measure via selection integration", () => {
      const doc = wireToDoc(`top\n${"hello world ".repeat(10)}tail`);
      const surface = document.createElement("div");
      surface.style.width = "160px";
      document.body.appendChild(surface);
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
      refreshHandoffNoteEditorLayoutGeometry(surface, doc, docToWire(doc), {
        mentionCoords: new Map(),
        baseTop: 100,
        stride: 18,
      });
      setSelectionAtWire(surface, doc, 0);

      const focus = wireOffsetToDocPos(doc, 0);
      resolveDomVerticalArrowMove(surface, doc, focus, "up");

      expect(readHandoffNoteLayoutCacheKey(surface)).toEqual({
        wire: docToWire(doc),
        rootWidth: surface.clientWidth,
        sampleCount: expect.any(Number),
      });
      const cached = readHandoffNoteLayoutCacheKey(surface);
      expect(cached?.sampleCount).toBeGreaterThan(0);

      resolveDomVerticalArrowMove(surface, doc, focus, "up");
      expect(readHandoffNoteLayoutCacheKey(surface)).toEqual(cached);
      surface.remove();
    });
  });

  describe("blank band layout outcomes", () => {
    it("sandwiched blank band places one row per probe between content brackets", () => {
      const wire = "header\n\n\ntail";
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerTop = 100;
      const tailTop = 220;
      const tailStart = wire.indexOf("tail");
      const lineHeight = 16;

      const layout = buildLayoutMapFromSamples(
        [
          { wire: 0, top: headerTop, left: 0 },
          { wire: tailStart, top: tailTop, left: 0 },
        ],
        lineHeight,
        doc
      );

      const blankRows = layout.rows.filter((row) => row.kind === "blank");
      expect(blankRows).toHaveLength(probes.length);
      for (const row of blankRows) {
        expect(row.top).toBeGreaterThan(headerTop);
        expect(row.top).toBeLessThan(tailTop);
      }
      expectStrictlyIncreasing(roundedRowTops(layout));

      const rebuilt = buildLayoutMapFromSamples(
        [
          { wire: 0, top: headerTop, left: 0 },
          { wire: tailStart, top: tailTop, left: 0 },
        ],
        lineHeight,
        doc
      );
      expect(roundedRowTops(rebuilt)).toEqual(roundedRowTops(layout));
    });

    it("EOF trailing blank band ascends monotonically above content floor", () => {
      const wire = "header\n\n\n";
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);
      const headerTop = 80;
      const lineHeight = 16;

      const layout = buildLayoutMapFromSamples(
        [{ wire: 0, top: headerTop, left: 0 }],
        lineHeight,
        doc
      );

      const blankRows = layout.rows.filter((row) => row.kind === "blank");
      // Blank rows follow navigable stops (every empty line slot).
      expect(blankRows).toHaveLength(stops.length);
      for (const row of blankRows) {
        expect(row.top).toBeGreaterThan(headerTop);
      }
      expectStrictlyIncreasing(blankRows.map((row) => row.top));
    });

    /**
     * Leading-`\n` blank band: empty line slots include document-end.
     * Epoch samples every empty line-start stop (acquire / stub authority).
     * Empty open + 7 newlines → 8 stops `[0..7]`.
     */
    it("pure trailing blank band includes document-end blank slot (not content invent)", () => {
      const wire = "\n\n\n\n\n\n\n";
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);
      const lineHeight = 18.2;
      const blankLeft = 333.5;
      const samples = stops.map((stopWire, index) => ({
        wire: stopWire,
        top: 74.6666669845581 + index * lineHeight,
        left: blankLeft,
      }));

      const layout = buildLayoutMapFromSamples(samples, lineHeight, doc);
      const contentRows = layout.rows.filter((row) => row.kind === "content");
      const blankRows = layout.rows.filter((row) => row.kind === "blank");
      const eofSample = layout.samples.find((sample) => sample.wire === wire.length);

      expect(stops).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(layout.visualRowCount).toBe(stops.length);
      expect(blankRows).toHaveLength(stops.length);
      expect(contentRows).toHaveLength(0);
      expect(eofSample?.wire).toBe(wire.length);
    });

    /** Family: epoch must include every empty line-start stop, including document end. */
    it("pure trailing blank band includes document-end blank slot when all stops are sampled", () => {
      const wire = "\n\n\n";
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);
      const lineHeight = 18;
      const samples = stops.map((stopWire, index) => ({
        wire: stopWire,
        top: 80 + index * lineHeight,
        left: 333.5,
      }));
      const layout = buildLayoutMapFromSamples(samples, lineHeight, doc);
      expect(layout.visualRowCount).toBe(stops.length);
      expect(layout.rows.every((row) => row.kind === "blank")).toBe(true);
      expect(layout.samples.some((sample) => sample.wire === wire.length)).toBe(true);
      const blankTops = layout.rows.map((row) => row.top);
      for (let i = 1; i < blankTops.length; i++) {
        expect((blankTops[i]! - blankTops[i - 1]!) / lineHeight).toBeLessThan(1.4);
      }
    });

    /**
     * Consecutive empty line-starts stay on distinct rows (including pad-preceding + pad).
     */
    it("shared break-probe dock does not collapse two blank stops onto one row", () => {
      const wire = "header \n\n\n";
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);
      expect(stops).toEqual([8, 9, 10]);
      const lineHeight = 18;
      const layout = buildLayoutMapFromSamples(
        [
          { wire: 0, top: 80, left: 0 },
          ...stops.map((stopWire, index) => ({
            wire: stopWire,
            top: 100 + index * lineHeight,
            left: 0,
          })),
        ],
        lineHeight,
        doc
      );
      const rowForStop = (stopWire: number) =>
        layout.rows.findIndex(
          (row) => row.kind === "blank" && row.samples.some((sample) => sample.wire === stopWire)
        );
      const row8 = rowForStop(8);
      const row9 = rowForStop(9);
      const row10 = rowForStop(10);
      expect(row8).toBeGreaterThanOrEqual(0);
      expect(row9).toBeGreaterThanOrEqual(0);
      expect(row10).toBeGreaterThanOrEqual(0);
      expect(new Set([row8, row9, row10]).size).toBe(3);
      expect(layoutRowAtWireFocus(doc, layout, 8)).toBe(row8);
      expect(layoutRowAtWireFocus(doc, layout, 9)).toBe(row9);
      expect(layoutRowAtWireFocus(doc, layout, 10)).toBe(row10);
    });

    /** Family: trailing blanks under a content floor still must not add left:0 EOF content. */
    it("header + trailing blanks does not invent EOF content row at left 0", () => {
      const wire = "header\n\n\n";
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);
      const lineHeight = 16;
      const layout = buildLayoutMapFromSamples([{ wire: 0, top: 80, left: 0 }], lineHeight, doc);
      const eofContent = layout.rows.filter(
        (row) =>
          row.kind === "content" &&
          row.samples.some((sample) => sample.wire === wire.length && sample.left === 0)
      );
      expect(eofContent).toHaveLength(0);
      expect(layout.rows.filter((row) => row.kind === "blank")).toHaveLength(stops.length);
    });

    /**
     * Pad-preceding probe measure uses its wire-break BR (not a BA band).
     * Blank-stop acquire uses paint seats. Do not stub lastProbe via stop→opener
     * paint resolve — that poisons the prior stop’s opener BR.
     */
    it("delete-probe trailing blank measures wire-break Y not blank-anchor band", () => {
      const lineHeight = 18;
      const baseTop = 100;
      const blankLeft = 333.5;
      const cases = ["\n\n\n\n\n\n", "\n\n\n", "header\n\n\n", "\n".repeat(32)] as const;

      for (const wire of cases) {
        const doc = wireToDoc(wire);
        const probes = listEmbeddedBlankBandProbeWires(doc);
        const lastProbe = probes[probes.length - 1]!;
        const surface = document.createElement("div");
        surface.style.width = "480px";
        document.body.appendChild(surface);
        Object.defineProperty(surface, "clientWidth", { configurable: true, value: 480 });
        renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });

        const wireBreaks = [...surface.querySelectorAll(`br[${HANDOFF_WIRE_BREAK_ATTR}]`)];
        const restores: Array<() => void> = [];
        try {
          for (const [i, br] of wireBreaks.entries()) {
            const midY = baseTop + i * lineHeight;
            const rect = {
              top: midY - lineHeight / 2,
              left: blankLeft,
              right: blankLeft + 4,
              bottom: midY + lineHeight / 2,
              width: 4,
              height: lineHeight,
              x: blankLeft,
              y: midY - lineHeight / 2,
              toJSON: () => ({}),
            } as DOMRect;
            const prior = br.getBoundingClientRect.bind(br);
            br.getBoundingClientRect = () => rect;
            restores.push(() => {
              br.getBoundingClientRect = prior;
            });
          }
          const lastBrY = baseTop + (wireBreaks.length - 1) * lineHeight;
          // Stub pad from paint authority: if pad-preceding stop already seats on last BR,
          // pad is the next row (+1lh). If that stop seats on an earlier opener BR, pad
          // shares the final wire-break band (browser trailing empty).
          const padPrecedingStop = wire.endsWith("\n") ? wire.length - 1 : -1;
          const precedingSeatY =
            padPrecedingStop >= 0
              ? measureBlankStopSeatCoord(surface, doc, padPrecedingStop)?.top
              : null;
          const padY =
            precedingSeatY != null && Math.abs(precedingSeatY - lastBrY) < 1
              ? lastBrY + lineHeight
              : lastBrY;
          const linePad = surface.querySelector(
            `br[${HANDOFF_LINE_PAD_ATTR}]`
          ) as HTMLBRElement | null;
          if (linePad) {
            const padRect = {
              top: padY - lineHeight / 2,
              left: blankLeft,
              right: blankLeft + 4,
              bottom: padY + lineHeight / 2,
              width: 4,
              height: lineHeight,
              x: blankLeft,
              y: padY - lineHeight / 2,
              toJSON: () => ({}),
            } as DOMRect;
            const priorPad = linePad.getBoundingClientRect.bind(linePad);
            linePad.getBoundingClientRect = () => padRect;
            restores.push(() => {
              linePad.getBoundingClientRect = priorPad;
            });
          }
          // Poison only a BA sibling after the pad-preceding BR (if any), not via stop remap.
          const lastBr = wireBreaks[wireBreaks.length - 1]!;
          const baSibling = lastBr.nextSibling;
          if (baSibling && isHandoffBlankAnchorElement(baSibling)) {
            const poisonY = padY + lineHeight;
            const priorBa = (baSibling as HTMLElement).getBoundingClientRect.bind(baSibling);
            (baSibling as HTMLElement).getBoundingClientRect = () =>
              ({
                top: poisonY - lineHeight / 2,
                left: blankLeft,
                right: blankLeft + 4,
                bottom: poisonY + lineHeight / 2,
                width: 4,
                height: lineHeight,
                x: blankLeft,
                y: poisonY - lineHeight / 2,
                toJSON: () => ({}),
              }) as DOMRect;
            restores.push(() => {
              (baSibling as HTMLElement).getBoundingClientRect = priorBa;
            });
          }

          expect(
            isEmbeddedBlankBandCollapseProbeWire(doc, lastProbe, wireOffsetToDocPos(doc, lastProbe))
          ).toBe(true);
          expect(measureWireBreakCoord(surface, doc, lastProbe)?.top).toBe(lastBrY);

          invalidateHandoffNoteLayoutCache(surface);
          const layout = buildHandoffNoteLayoutMap(surface, doc);
          expect(layout.rows.filter((row) => row.kind === "blank")).toHaveLength(
            listBlankVisualLineStartWires(doc).length
          );
        } finally {
          while (restores.length) restores.pop()?.();
          surface.remove();
        }
      }
    });

    it("blank-stop acquire uses opener paint-seat Y not the stop wire BR", () => {
      const wire = "shhs\n\n\nsgs";
      const doc = wireToDoc(wire);
      const [upperStop, lowerStop] = listBlankVisualLineStartWires(doc);
      expect(upperStop).toBe(5);
      expect(lowerStop).toBe(6);

      const surface = document.createElement("div");
      surface.style.width = "480px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 480 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });

      const seatY = 140;
      const wrongOwnBreakY = 999;
      const restores: Array<() => void> = [];
      try {
        restores.push(
          stubHandoffNoteAnchorRectAtWire(surface, doc, 0, { top: 100, left: 0, height: 18 })
        );
        restores.push(
          stubHandoffNoteAnchorRectAtWire(surface, doc, wire.indexOf("sgs"), {
            top: 280,
            left: 0,
            height: 18,
          })
        );

        const seatPoint = resolveDomPointAtDocPos(
          surface,
          doc,
          wireOffsetToDocPos(doc, upperStop!)
        );
        expect(isHandoffBlankAnchorElement(seatPoint?.node.parentNode)).toBe(true);
        restores.push(
          stubHandoffNoteAnchorRectAtWire(surface, doc, upperStop!, {
            top: seatY,
            left: 0,
            height: 18,
          })
        );
        restores.push(
          stubHandoffNoteAnchorRectAtWire(surface, doc, lowerStop!, {
            top: seatY + 36,
            left: 0,
            height: 18,
          })
        );

        // After lower-stop stub (which stamps this BR as lower seat), poison the stop's
        // own BR so acquire must ignore it in favor of the opener BA seat.
        const ownBreakPoint = resolveDomPointAtDocPos(
          surface,
          doc,
          wireOffsetToDocPos(doc, upperStop!),
          { blankStopOpenerDocked: true, preferWireBreakOverBlankAnchor: true }
        );
        expect(
          ownBreakPoint?.node instanceof HTMLBRElement &&
            isHandoffWireBreakElement(ownBreakPoint.node)
        ).toBe(true);
        const ownBr = ownBreakPoint!.node as HTMLBRElement;
        const priorOwn = ownBr.getBoundingClientRect.bind(ownBr);
        ownBr.getBoundingClientRect = () =>
          ({
            top: wrongOwnBreakY - 9,
            left: 0,
            right: 4,
            bottom: wrongOwnBreakY + 9,
            width: 4,
            height: 18,
            x: 0,
            y: wrongOwnBreakY - 9,
            toJSON: () => ({}),
          }) as DOMRect;
        restores.push(() => {
          ownBr.getBoundingClientRect = priorOwn;
        });

        invalidateHandoffNoteLayoutCache(surface);
        const layout = buildHandoffNoteLayoutMap(surface, doc);
        const upperRow = layout.rows.find(
          (row) => row.kind === "blank" && row.samples.some((s) => s.wire === upperStop)
        );
        expect(upperRow?.top).toBe(seatY);
        expect(upperRow?.top).not.toBe(wrongOwnBreakY);
      } finally {
        while (restores.length) restores.pop()?.();
        surface.remove();
      }
    });

    it("composite blank band places distinct rows below middle content", () => {
      const wire = `prefix @${AGENT} \n\n@${AGENT} tail\n\n\nbottom @${AGENT}\n`;
      const doc = wireToDoc(wire);
      const middleRowLineStart = wire.indexOf(`@${AGENT} tail`);
      const middleTop = 177;
      const middleRowTailEnd = middleRowLineStart + `@${AGENT} tail`.length;
      const bottomLineStart = wire.indexOf("bottom");
      const blankRun = listBlankVisualLineStartWires(doc).filter(
        (stop) => stop >= middleRowTailEnd && stop < bottomLineStart
      );
      const surface = document.createElement("div");
      surface.style.width = "480px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 480 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      let blankTop = 214;
      const samples: { wire: number; top: number; left: number }[] = [
        { wire: 0, top: 141, left: 0 },
        { wire: middleRowLineStart, top: middleTop, left: 0 },
        { wire: middleRowLineStart + 16, top: middleTop, left: 200 },
      ];
      for (const blankWire of blankRun) {
        samples.push({ wire: blankWire, top: blankTop, left: 0 });
        blankTop += 37;
      }
      const endOfLastMention = bottomLineStart + `bottom @${AGENT}`.length - 1;
      samples.push({ wire: endOfLastMention, top: blankTop, left: 200 });
      setMeasuredSamplesCache(surface, wire, surface.clientWidth, samples);

      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const bandBlankRows = layout.rows.filter(
        (row) => row.kind === "blank" && blankRun.includes(row.samples[0]?.wire ?? -1)
      );
      expect(bandBlankRows).toHaveLength(blankRun.length);
      for (const row of bandBlankRows) {
        expect(row.top).toBeGreaterThan(middleTop);
      }
      expectStrictlyIncreasing(bandBlankRows.map((row) => row.top));
      surface.remove();
    });

    it("produces identical row tops on consecutive layout builds with a warm cache", () => {
      const wire = `he @${AGENT} x @${AGENT} \n\nhe @${AGENT} `;
      const doc = wireToDoc(wire);
      const surface = document.createElement("div");
      surface.style.width = "480px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 480 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      const prefixStart = docPosToWireOffset(doc, { nodeIndex: 0, nodeOffset: 0 });
      const tailWire = wire.length - 1;
      const row1Top = 141.1;
      const row2Top = 195.69;
      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: prefixStart, top: row1Top, left: 0 },
        { wire: 20, top: row1Top, left: 200 },
        { wire: 21, top: row1Top, left: 220 },
        { wire: 43, top: row1Top, left: 400 },
        { wire: 46, top: row2Top, left: 0 },
        { wire: tailWire, top: row2Top, left: 120 },
      ]);

      const first = buildHandoffNoteLayoutMap(surface, doc);
      const second = buildHandoffNoteLayoutMap(surface, doc);

      expect(roundedRowTops(second)).toEqual(roundedRowTops(first));
      expect(first.rows.filter((row) => row.kind === "blank").length).toBe(1);
      surface.remove();
    });
  });

  describe("dom acquire path â€” suffix blank band", () => {
    const suffixBlankBandWire = `header @${AGENT} \n\n\ntail @${AGENT} `;

    function mountSurface(): HTMLElement {
      const surface = document.createElement("div");
      surface.style.width = "480px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 480 });
      return surface;
    }

    function stubMentionRows(surface: HTMLElement): void {
      stubHandoffNoteMentionLayoutCoords(
        surface,
        new Map([
          [1, { top: 150, left: 80 }],
          [3, { top: 280, left: 0 }],
        ])
      );
    }

    it("unsampled atom on content line keeps content row not trailing blank-probe bracket", () => {
      const wire = `prefix @${AGENT} \n\n@${AGENT} tail\n\n\n\nbottom @${AGENT}\n`;
      const doc = wireToDoc(wire);
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      const bottomLine = `bottom @${AGENT}`;
      const bottomLineStart = wire.indexOf(bottomLine);
      const endOfLastMention = bottomLineStart + bottomLine.length - 1;
      setMeasuredSamplesCache(
        surface,
        wire,
        surface.clientWidth,
        monotonicMeasuredLayoutSamples(wire)
      );
      const focus = wireOffsetToDocPos(doc, endOfLastMention);
      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const contentRow = layoutRowAtWireFocus(doc, layout, bottomLineStart);
      const blankProbeAfter = listEmbeddedBlankBandProbeWires(doc).find(
        (probe) => probe > endOfLastMention
      );
      const trailingBlankStop = listBlankVisualLineStartWires(doc).find(
        (stop) => stop > endOfLastMention
      );
      expect(contentRow).toBeGreaterThanOrEqual(0);
      expect(layoutRowAtWireFocus(doc, layout, endOfLastMention)).toBe(contentRow);
      expect(layoutRowForFocus(surface, doc, layout, focus)).toBe(contentRow);
      // Trailing empty line-start is its own blank row below content. Same wire may
      // alias mention-end ↔ break probe — do not use wire-only focus for blank ownership.
      expect(trailingBlankStop).toBe(wire.length);
      const trailingBlankRow = layout.rows.findIndex(
        (row) =>
          row.kind === "blank" && row.samples.some((sample) => sample.wire === trailingBlankStop)
      );
      expect(trailingBlankRow).toBeGreaterThan(contentRow);
      if (blankProbeAfter !== undefined) {
        expect(layout.rows[trailingBlankRow]!.breakProbeWire).toBe(blankProbeAfter);
      }
      expect(
        layoutRowForFocus(surface, doc, layout, wireOffsetToDocPos(doc, trailingBlankStop!))
      ).toBe(trailingBlankRow);
      surface.remove();
    });

    it("paint index stamps atom interiors onto pill row from boundary samples", () => {
      const wire = `pre @${AGENT} post`;
      const doc = wireToDoc(wire);
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubHandoffNoteMentionLayoutCoords(surface, new Map([[1, { top: 120, left: 40 }]]));
      const mentionNodeIndex = doc.nodes.findIndex((node) => node.type === "mention");
      expect(mentionNodeIndex).toBeGreaterThanOrEqual(0);
      const startPos = { nodeIndex: mentionNodeIndex, nodeOffset: 0 };
      const interiorPos = { nodeIndex: mentionNodeIndex, nodeOffset: 3 };
      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const startRow = layout.paintContextForDocPos(startPos)?.rowIndex;
      expect(startRow).toBeGreaterThanOrEqual(0);
      expect(layout.paintContextForDocPos(interiorPos)?.rowIndex).toBe(startRow);
      expect(layoutRowForFocus(surface, doc, layout, interiorPos)).toBe(startRow);
      surface.remove();
    });

    it("builds layout from DOM acquire without hand-seeded sample cache", () => {
      const doc = wireToDoc(suffixBlankBandWire);
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubMentionRows(surface);

      const layout = buildHandoffNoteLayoutMap(surface, doc);
      expect(layout.samples.length).toBeGreaterThan(0);
      expect(listEmbeddedBlankBandProbeWires(doc)).toHaveLength(2);
      expect(layout.rows.filter((row) => row.kind === "blank")).toHaveLength(2);
      surface.remove();
    });

    it("dom acquire cache includes blank line-start stops and break-probe docks", () => {
      const doc = wireToDoc(suffixBlankBandWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const stops = listBlankVisualLineStartWires(doc);
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubMentionRows(surface);
      const lineHeight = 18;
      const wireBreaks = [
        ...surface.querySelectorAll(`br[${HANDOFF_WIRE_BREAK_ATTR}]`),
      ] as HTMLBRElement[];
      const restores: Array<() => void> = [];
      try {
        for (const [index, br] of wireBreaks.entries()) {
          const midY = 160 + index * lineHeight;
          const rect = {
            top: midY - lineHeight / 2,
            left: 40,
            right: 44,
            bottom: midY + lineHeight / 2,
            width: 4,
            height: lineHeight,
            x: 40,
            y: midY - lineHeight / 2,
            toJSON: () => ({}),
          } as DOMRect;
          const prior = br.getBoundingClientRect.bind(br);
          br.getBoundingClientRect = () => rect;
          restores.push(() => {
            br.getBoundingClientRect = prior;
          });
        }
        for (const [index, stopWire] of stops.entries()) {
          restores.push(
            stubHandoffNoteAnchorRectAtWire(surface, doc, stopWire, {
              top: 160 + (index + 1) * lineHeight,
              left: 40,
            })
          );
        }
        invalidateHandoffNoteLayoutCache(surface);

        buildHandoffNoteLayoutMap(surface, doc);

        const cached = getCachedMeasuredSamples(surface, suffixBlankBandWire, surface.clientWidth);
        expect(cached).not.toBeNull();
        for (const probeWire of probes) {
          expect(cached!.some((sample) => sample.wire === probeWire)).toBe(true);
        }
        for (const stopWire of stops) {
          expect(cached!.some((sample) => sample.wire === stopWire)).toBe(true);
        }
      } finally {
        while (restores.length) restores.pop()?.();
        surface.remove();
      }
    });

    it("blank row top matches acquire-epoch empty line-start measure", () => {
      const doc = wireToDoc(suffixBlankBandWire);
      const stops = listBlankVisualLineStartWires(doc);
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubMentionRows(surface);
      const stopTops = [168.5, 186.25];
      // Epoch samples keyed by empty line-starts (navigable stops), not probe docks.
      setMeasuredSamplesCache(surface, suffixBlankBandWire, surface.clientWidth, [
        { wire: 0, top: 150, left: 0 },
        { wire: stops[0]!, top: stopTops[0]!, left: 40 },
        { wire: stops[1]!, top: stopTops[1]!, left: 40 },
        { wire: suffixBlankBandWire.indexOf("tail"), top: 220, left: 0 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const blankRows = layout.rows.filter((row) => row.kind === "blank");
      expect(blankRows).toHaveLength(stops.length);
      for (const [index, row] of blankRows.entries()) {
        expect(Math.round(row.top * 100) / 100).toBe(stopTops[index]!);
      }
      surface.remove();
    });

    it("infer does not remasure blank Y against a cached content epoch", () => {
      const wire = "header\n\n\ntail";
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      expect(probes).toHaveLength(2);
      const headerTop = 100;
      const tailTop = 154;
      const driftedProbeTops = [200, 220];
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
      for (const [index, probeWire] of probes.entries()) {
        stubHandoffNoteAnchorRectAtWire(surface, doc, probeWire, {
          top: driftedProbeTops[index]!,
          left: 0,
          height: 18,
        });
      }
      // Content-only epoch. Drifted probe DOM must not be remasured on infer.
      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: headerTop, left: 0 },
        { wire: wire.indexOf("tail"), top: tailTop, left: 0 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const blankTops = layout.rows
        .filter((row) => row.kind === "blank")
        .map((row) => Math.round(row.top * 100) / 100);
      expect(blankTops).toHaveLength(2);
      expect(blankTops.every((top) => top > headerTop && top < tailTop)).toBe(true);
      expect(blankTops).not.toEqual(driftedProbeTops);
      surface.remove();
    });

    it("epoch blank samples drive blank row tops without live remasure", () => {
      const agent = "caliper-aaaaaaa";
      const wire = `header\n\n\ntail`;
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);
      const layout = buildLayoutMapFromSamples(
        [
          { wire: 0, top: 100, left: 0 },
          { wire: stops[0]!, top: 118, left: 0 },
          { wire: stops[1]!, top: 136, left: 0 },
          { wire: wire.indexOf("tail"), top: 154, left: 0 },
        ],
        18,
        doc
      );
      const blankRows = layout.rows.filter((row) => row.kind === "blank");
      expect(blankRows.map((row) => Math.round(row.top))).toEqual([118, 136]);
    });

    it("assigns text-led lower row after blank band to the content band below blanks", () => {
      const wire = `header @${AGENT} \n\n\nlower @${AGENT} `;
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);
      const lowerRowStart = wire.indexOf("lower");
      const exitNewlineWire = lowerRowStart - 1;
      const lowerMentionStart = wire.indexOf("@", lowerRowStart);
      expect(stops).toContain(exitNewlineWire);
      const headerTop = 141.1;
      const blank1Top = 177.49;
      const blank2Top = 213.89;
      const contentTop = 250.29;
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubHandoffNoteMentionLayoutCoords(
        surface,
        new Map([
          [1, { top: headerTop, left: 80 }],
          [3, { top: contentTop, left: 0 }],
        ])
      );
      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: headerTop, left: 0 },
        { wire: stops[0]!, top: blank1Top, left: 0 },
        { wire: stops[1]!, top: blank2Top, left: 0 },
        { wire: lowerMentionStart, top: contentTop, left: 0 },
        { wire: wire.length - 1, top: contentTop, left: 120 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const contentRowIndex = layoutRowAtWireFocus(doc, layout, lowerMentionStart);
      const exitRowIndex = layoutRowAtWireFocus(doc, layout, exitNewlineWire);
      expect(layout.rows[exitRowIndex]?.kind).toBe("blank");
      expect(exitRowIndex).not.toBe(contentRowIndex);
      expect(layoutRowAtWireFocus(doc, layout, lowerRowStart)).toBe(contentRowIndex);
      surface.remove();
    });

    it("brackets embedded content-to-content break wire on the lower line row", () => {
      const wire = `he @${AGENT} x @${AGENT} \nseg`;
      const doc = wireToDoc(wire);
      const breakWire = wire.indexOf("\n");
      const lowerLineStart = breakWire + 1;
      const row0Top = 141.1;
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubHandoffNoteMentionLayoutCoords(
        surface,
        new Map([
          [1, { top: row0Top, left: 359.58 }],
          [3, { top: row0Top, left: 492.52 }],
        ])
      );
      invalidateHandoffNoteLayoutCache();

      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const lowerRow = layoutRowAtWireFocus(doc, layout, lowerLineStart);
      expect(layoutRowAtWireFocus(doc, layout, breakWire)).toBe(lowerRow);
      surface.remove();
    });

    it("adds layout sample at content-to-content embedded newline inside text node", () => {
      const wire = `header @${AGENT} \n\n\nmiddle line\nlower`;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      let middleLineStart = probes.at(-1)! + 1;
      while (middleLineStart < wire.length && wire[middleLineStart] === "\n") {
        middleLineStart++;
      }
      const lowerLineStart = wire.indexOf("\n", middleLineStart) + 1;
      const headerTop = 141.1;
      const middleTop = 250.0;
      const lowerTop = 286.0;
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubHandoffNoteMentionLayoutCoords(surface, new Map([[1, { top: headerTop, left: 80 }]]));
      stubHandoffNoteAnchorRectAtWire(surface, doc, middleLineStart, { top: middleTop, left: 0 });
      stubHandoffNoteAnchorRectAtWire(surface, doc, lowerLineStart, { top: lowerTop, left: 0 });
      invalidateHandoffNoteLayoutCache();

      const layout = buildHandoffNoteLayoutMap(surface, doc);

      expect(layout.visualRowCount).toBeGreaterThanOrEqual(4);
      const cached = getCachedMeasuredSamples(surface, wire, surface.clientWidth);
      expect(cached?.some((sample) => sample.wire === lowerLineStart)).toBe(true);
      expect(cached?.some((sample) => sample.wire === probes[0]!)).toBe(false);
      const lowerSample = cached?.find((sample) => sample.wire === lowerLineStart);
      expect(lowerSample?.top).toBe(lowerTop);
      surface.remove();
    });

    /**
     * `header\n\n` → two blank stops (empty after header + trailing pad).
     */
    it("keeps stacked blank rows as separate visual rows in dom acquire", () => {
      const wire = "header\n\n";
      const doc = wireToDoc(wire);
      const stops = listBlankVisualLineStartWires(doc);
      expect(stops).toEqual([7, 8]);
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
      invalidateHandoffNoteLayoutCache();

      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const blankRows = layout.rows.filter((row) => row.kind === "blank");
      expect(blankRows).toHaveLength(stops.length);
      expectStrictlyIncreasing(blankRows.map((row) => row.top));
      surface.remove();
    });
  });

  describe("soft-wrap visual rows", () => {
    it("measured continuation tops seed a second visual row when pills share one band", () => {
      const wire = `header @${AGENT} @${AGENT} ${"tail ".repeat(24)}`;
      const doc = wireToDoc(wire);
      const tailWire = wire.length - 1;
      const prefixStart = docPosToWireOffset(doc, { nodeIndex: 0, nodeOffset: 0 });
      const firstMentionEnd = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: AGENT.length });
      const postMentionStart = firstMentionEnd + 1;
      const secondMentionEnd = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: AGENT.length });
      const secondPostStart = secondMentionEnd + 1;
      const surface = document.createElement("div");
      surface.style.width = "480px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 480 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      const row1Top = 141.09897422790527;
      const row2Top = 159.29689598083496;
      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: prefixStart, top: row1Top, left: 0 },
        { wire: postMentionStart, top: row1Top, left: 200 },
        { wire: firstMentionEnd, top: row1Top, left: 220 },
        { wire: secondPostStart, top: row1Top, left: 400 },
        { wire: secondMentionEnd, top: row1Top, left: 420 },
        { wire: tailWire, top: row2Top, left: 520 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc);

      expect(layout.visualRowCount).toBeGreaterThanOrEqual(2);
      expect(layoutRowAtWireFocus(doc, layout, tailWire)).toBeGreaterThan(0);
      expect(layoutRowAtWireFocus(doc, layout, prefixStart)).toBe(0);
      surface.remove();
    });

    it("assigns fully soft-wrapped post-mention tail interior to continuation row", () => {
      const wire = `he @${AGENT} x @${AGENT} tail`;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("tail");
      const tailInterior = tailStart + 2;
      const tailPastEnd = wire.length;
      const row0Top = 141.1;
      const row1Top = 158.86;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 3, top: row0Top, left: 359.58 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 492.52,
        },
        { wire: tailStart - 1, top: row0Top, left: 609.68 },
        { wire: tailPastEnd, top: row1Top, left: 370.02 },
        { wire: tailStart, top: 140.67, left: 609.68 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc);

      expect(layoutRowAtWireFocus(doc, layout, tailStart - 1)).toBe(0);
      expect(layoutRowAtWireFocus(doc, layout, tailInterior)).toBe(1);
      expect(layoutRowAtWireFocus(doc, layout, tailPastEnd)).toBe(1);
      surface.remove();
    });

    it("keeps three post-mention measured soft-wrap bands as three visual rows", () => {
      const wire = `meh @${AGENT} wrap mid band`;
      const doc = wireToDoc(wire);
      const postStart = wire.indexOf(" wrap");
      const wrapW = postStart + 1;
      const midStart = wire.indexOf("mid");
      const bandStart = wire.indexOf("band");
      const row0 = 140.67;
      const row1 = 158.86;
      const row2 = 177.06;
      const layout = buildLayoutMapFromSamples(
        [
          { wire: 0, top: row0, left: 335.5 },
          { wire: 4, top: row0, left: 356.46 },
          { wire: postStart, top: row0, left: 606.55 },
          { wire: wrapW, top: row1, left: 343.0 },
          { wire: midStart, top: row1, left: 380.0 },
          { wire: bandStart, top: row2, left: 335.5 },
          { wire: wire.length, top: row2, left: 380.0 },
        ],
        18,
        doc
      );

      expect(layout.visualRowCount).toBeGreaterThanOrEqual(3);
      expect(layoutRowAtWireFocus(doc, layout, wrapW)).toBe(1);
      expect(layoutRowAtWireFocus(doc, layout, bandStart)).toBe(2);
      expect(layout.coordsForWire(wrapW)?.left).toBeCloseTo(343.0, 0);
      expect(layout.coordsForWire(bandStart)?.top).toBeCloseTo(row2, 0);
    });

    it("keeps two-band post-mention soft wrap as two visual rows", () => {
      const wire = `meh @${AGENT} wrap`;
      const doc = wireToDoc(wire);
      const wrapW = wire.indexOf("wrap");
      const layout = buildLayoutMapFromSamples(
        [
          { wire: 0, top: 140.67, left: 335.5 },
          { wire: wrapW - 1, top: 141.1, left: 606.55 },
          { wire: wrapW, top: 158.86, left: 343.0 },
          { wire: wire.length, top: 158.86, left: 380.0 },
        ],
        18,
        doc
      );
      expect(layout.visualRowCount).toBe(2);
      expect(layoutRowAtWireFocus(doc, layout, wrapW)).toBe(1);
    });

    it("keeps typed postfix interior on paint row when mention-end alias sample is on lower row", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      const agent = fx.agent;
      const postfixNode = fx.postfixSpacerNode;
      const spacer = fx.doc.nodes[postfixNode];
      expect(spacer?.type).toBe("text");
      if (spacer?.type !== "text") {
        fx.root.remove();
        return;
      }

      const inserted = applyDocInsertText(
        fx.doc,
        collapsedSelection({ nodeIndex: postfixNode, nodeOffset: spacer.text.length }),
        "vapm mist"
      );
      fx.doc = inserted.doc;
      renderHandoffNoteDoc(fx.root, fx.doc, {
        colorByAgentId: new Map([[agent, "#06f"]]),
      });
      const wire = docToWire(fx.doc);
      const interiorPos = { nodeIndex: postfixNode, nodeOffset: 8 };
      const interiorWire = docPosToWireOffset(fx.doc, interiorPos);
      const mistStart = docPosToWireOffset(fx.doc, { nodeIndex: postfixNode, nodeOffset: 1 });
      const thirdMentionEnd = docPosToWireOffset(fx.doc, {
        nodeIndex: fx.mentionNodes[2]!,
        nodeOffset: 1 + agent.length,
      });

      stubTextNodeLineRects(fx.root, fx.doc, postfixNode, [
        { top: fx.row1Top, left: 520, width: 120 },
      ]);
      invalidateHandoffNoteLayoutCache();
      setMeasuredSamplesCache(fx.root, wire, fx.rootWidth, [
        { wire: 0, top: fx.row0Top, left: 349.5 },
        { wire: 4, top: fx.row0Top, left: 378.57 },
        { wire: thirdMentionEnd, top: fx.row1Top, left: 524.02 },
        { wire: mistStart, top: fx.row1Top, left: 528.77 },
        { wire: mistStart + 1, top: fx.row1Top, left: 542.47 },
        { wire: interiorWire, top: fx.row1Top, left: 542.47 },
        { wire: interiorWire + 1, top: fx.row1Top, left: 556.17 },
        { wire: fx.fourthMentionStart, top: fx.row2Top, left: 348.5 },
        { wire: wire.length, top: fx.row2Top, left: 469.21 },
        { wire: fx.wrapRowStartWire, top: fx.row1Top, left: 355.15 },
        { wire: fx.interiorWire, top: fx.row1Top, left: 379.09 },
        { wire: mistStart - 1, top: fx.row2Top, left: 526.77 },
      ]);

      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc);

      expect(layoutRowAtWireFocus(fx.doc, layout, interiorWire)).toBe(1);
      expect(layoutRowAtWireFocus(fx.doc, layout, interiorWire)).not.toBe(2);
      fx.root.remove();
    });

    it("paintContextForDocPos maps cross-row spacer alias wire to row-1 text tail", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      const spacer = fx.doc.nodes[fx.postfixSpacerNode];
      expect(spacer?.type).toBe("text");
      if (spacer?.type !== "text") {
        fx.root.remove();
        return;
      }
      const tailPos = { nodeIndex: fx.postfixSpacerNode, nodeOffset: spacer.text.length };
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc);
      const paintCtx = layout.paintContextForDocPos(
        resolvePaintContextAtWire(fx.doc, fx.fourthMentionStart).paintPos
      );
      expect(paintCtx?.paintDocPos).toEqual(tailPos);
      expect(paintCtx?.rowIndex).toBe(1);
      expect(layout.paintContextForDocPos(tailPos)?.rowIndex).toBe(1);
      expect(layoutRowForFocus(fx.root, fx.doc, layout, tailPos)).toBe(1);
      expect(layoutRowAtWireFocus(fx.doc, layout, fx.fourthMentionStart)).toBe(1);
      fx.root.remove();
    });

    it("dom acquire keeps postfix node-start on painted row when next mention is lower", () => {
      const fx = mountThreeRowMentionSoftWrapFixture();
      const spacer = fx.doc.nodes[fx.postfixSpacerNode];
      expect(spacer?.type).toBe("text");
      if (spacer?.type !== "text") {
        fx.root.remove();
        return;
      }

      const inserted = applyDocInsertText(
        fx.doc,
        collapsedSelection({ nodeIndex: fx.postfixSpacerNode, nodeOffset: spacer.text.length }),
        "vapm mist"
      );
      fx.doc = inserted.doc;
      renderHandoffNoteDoc(fx.root, fx.doc, {
        colorByAgentId: new Map([[fx.agent, "#06f"]]),
      });
      stubHandoffNoteMentionLayoutCoords(
        fx.root,
        new Map(
          fx.mentionNodes.map((nodeIndex, i) => [
            nodeIndex,
            {
              top: i < 2 ? fx.row0Top : i === 2 ? fx.row1Top : fx.row2Top,
              left: 500 + i * 8,
            },
          ])
        )
      );
      applyThreeRowSpacerBrowserParityLayoutStubs(fx);
      invalidateHandoffNoteLayoutCache();

      const interiorPos = { nodeIndex: fx.postfixSpacerNode, nodeOffset: 8 };
      const interiorWire = docPosToWireOffset(fx.doc, interiorPos);
      const nodeStartWire = docPosToWireOffset(fx.doc, {
        nodeIndex: fx.postfixSpacerNode,
        nodeOffset: 0,
      });
      const fourthMentionStart = docPosToWireOffset(fx.doc, {
        nodeIndex: fx.mentionNodes[3]!,
        nodeOffset: 0,
      });
      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc);
      const cached = getCachedMeasuredSamples(fx.root, docToWire(fx.doc), fx.rootWidth);
      const nodeStartSample = cached?.find((sample) => sample.wire === nodeStartWire);
      const fourthMentionSample = cached?.find((sample) => sample.wire === fourthMentionStart);

      expect(nodeStartSample).toBeDefined();
      expect(nodeStartSample!.top).toBeCloseTo(fx.row1Top, 0);
      expect(nodeStartSample!.top).not.toBeCloseTo(fx.row2Top, 0);
      expect(fourthMentionSample).toBeDefined();
      expect(fourthMentionSample!.top).toBeCloseTo(fx.row2Top, 0);
      expect(layoutRowAtWireFocus(fx.doc, layout, interiorWire)).toBe(1);
      expect(layoutRowAtWireFocus(fx.doc, layout, interiorWire)).not.toBe(2);
      expect(layoutRowAtWireFocus(fx.doc, layout, fourthMentionStart)).toBe(2);
      fx.root.remove();
    });

    it("infers prefix end from lower-row continuation when trailing spacer sample is absent", () => {
      const wire = `he @${AGENT} x @${AGENT} tail`;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("tail");
      const tailInterior = tailStart + 2;
      const spacerWire = tailStart - 1;
      const tailPastEnd = wire.length;
      const row0Top = 141.1;
      const row1Top = 158.86;
      const continuationLeft = 370.02;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 3, top: row0Top, left: 359.58 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 492.52,
        },
        { wire: tailStart, top: row1Top, left: continuationLeft },
        { wire: tailPastEnd, top: row1Top, left: continuationLeft },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc);

      expect(layoutRowAtWireFocus(doc, layout, spacerWire)).toBe(0);
      expect(layoutRowAtWireFocus(doc, layout, tailStart)).toBe(1);
      expect(layoutRowAtWireFocus(doc, layout, tailInterior)).toBe(1);
      surface.remove();
    });

    it("dom acquire pins wrap row bounds from painted fragment boundaries", () => {
      const wire = `he @${AGENT} x @${AGENT} tail`;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("tail");
      const spacerWire = tailStart - 1;
      const tailTextNodeIndex = 4;
      const row0Top = 141.1;
      const row1Top = 158.86;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubHandoffNoteMentionLayoutCoords(
        surface,
        new Map([
          [1, { top: row0Top, left: 382.09 }],
          [3, { top: row0Top, left: 507.67 }],
        ])
      );
      const restoreRects = stubTextNodeLineRects(
        surface,
        doc,
        tailTextNodeIndex,
        [
          { top: row0Top - 9, left: 580, width: 44, height: 18 },
          { top: row1Top - 9, left: 347.5, width: 120, height: 18 },
        ],
        {
          resolveOffsetRect: (nodeOffset) =>
            nodeOffset <= 0
              ? { top: row0Top, left: 624.82 }
              : { top: row1Top, left: 370.02 + nodeOffset * 4 },
        }
      );
      invalidateHandoffNoteLayoutCache();

      try {
        const layout = buildHandoffNoteLayoutMap(surface, doc);
        expect(layoutRowAtWireFocus(doc, layout, spacerWire)).toBe(0);
        expect(layoutRowAtWireFocus(doc, layout, tailStart)).toBe(1);
        const cached = getCachedMeasuredSamples(surface, wire, surface.clientWidth);
        expect(cached?.some((sample) => sample.wire === spacerWire && sample.top === row0Top)).toBe(
          true
        );
        expect(cached?.some((sample) => sample.wire === tailStart)).toBe(true);
        expect(cached?.find((sample) => sample.wire === tailStart)?.top).toBeGreaterThan(row0Top);
      } finally {
        restoreRects();
        surface.remove();
      }
    });

    it("dom acquire pins each pairwise boundary for three-line soft wrap in one text node", () => {
      const wire = "0123456789abcdefghijklmnop";
      const doc = wireToDoc(wire);
      const line2Start = 8;
      const line3Start = 17;
      const row0Top = 100;
      const row1Top = 118;
      const row2Top = 136;
      const surface = document.createElement("div");
      surface.style.width = "200px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 200 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });

      const restoreRects = stubTextNodeLineRects(
        surface,
        doc,
        0,
        [
          { top: row0Top - 9, left: 40, width: 160, height: 18 },
          { top: row1Top - 9, left: 40, width: 160, height: 18 },
          { top: row2Top - 9, left: 40, width: 160, height: 18 },
        ],
        {
          resolveOffsetRect: (nodeOffset) => {
            if (nodeOffset < line2Start) {
              return { top: row0Top, left: 160 };
            }
            if (nodeOffset < line3Start) {
              return { top: row1Top, left: 160 };
            }
            return { top: row2Top, left: 160 };
          },
        }
      );
      invalidateHandoffNoteLayoutCache();

      try {
        const layout = buildHandoffNoteLayoutMap(surface, doc);
        expect(layout.visualRowCount).toBeGreaterThanOrEqual(3);
        expect(layoutRowAtWireFocus(doc, layout, line2Start - 1)).toBe(0);
        expect(layoutRowAtWireFocus(doc, layout, line2Start)).toBe(1);
        expect(layoutRowAtWireFocus(doc, layout, line3Start - 1)).toBe(1);
        expect(layoutRowAtWireFocus(doc, layout, line3Start)).toBe(2);
        expect(layoutRowAtWireFocus(doc, layout, line2Start + 2)).toBe(1);
        expect(layoutRowAtWireFocus(doc, layout, line3Start + 2)).toBe(2);
        expect(layout.rows[2]?.top).toBeCloseTo(row2Top, 0);
        const cached = getCachedMeasuredSamples(surface, wire, surface.clientWidth);
        expect(
          cached?.some((sample) => sample.wire === line2Start - 1 && sample.top === row0Top)
        ).toBe(true);
        expect(cached?.some((sample) => sample.wire === line2Start && sample.top === row1Top)).toBe(
          true
        );
        expect(
          cached?.some((sample) => sample.wire === line3Start - 1 && sample.top === row1Top)
        ).toBe(true);
        expect(cached?.some((sample) => sample.wire === line3Start && sample.top === row2Top)).toBe(
          true
        );
      } finally {
        restoreRects();
        surface.remove();
      }
    });

    it("dom acquire samples embedded-newline line interiors on the painted band", () => {
      const wire = `pre @${AGENT} @${AGENT} \nline \n\n\n line @${AGENT}`;
      const doc = wireToDoc(wire);
      const lineStartWire = wire.indexOf("line");
      const lineEndWire = wire.indexOf("\n", lineStartWire);
      const interiorWire = lineStartWire + 2;
      const row0Top = 141.1;
      const row1Top = 159.3;
      const row4Top = 214.0;
      const segmentLeft = 347.5;
      const segmentWidth = 48;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      stubHandoffNoteMentionLayoutCoords(
        surface,
        new Map([
          [1, { top: row0Top, left: 382.09 }],
          [3, { top: row4Top, left: 382.09 }],
        ])
      );
      const restoreAcquire = stubEmbeddedNewlineSegmentAcquire(surface, doc, {
        startWire: lineStartWire,
        endWireExclusive: lineEndWire,
        rects: [{ top: row1Top - 9, left: segmentLeft, width: segmentWidth, height: 18 }],
        probeHits: [
          {
            column: segmentLeft + 2,
            rowTop: row1Top,
            pos: wireOffsetToDocPos(doc, lineStartWire),
          },
          {
            column: segmentLeft + segmentWidth / 2,
            rowTop: row1Top,
            pos: wireOffsetToDocPos(doc, interiorWire),
          },
        ],
      });
      invalidateHandoffNoteLayoutCache();

      try {
        const layout = buildHandoffNoteLayoutMap(surface, doc);
        const cached = getCachedMeasuredSamples(surface, wire, surface.clientWidth);
        expect(cached?.find((sample) => sample.wire === lineStartWire)?.top).toBe(row1Top);
        expect(cached?.find((sample) => sample.wire === interiorWire)?.top).toBe(row1Top);

        const embeddedRow = layoutRowAtWireFocus(doc, layout, lineStartWire);
        expect(layoutRowAtWireFocus(doc, layout, interiorWire)).toBe(embeddedRow);
        expect(layout.rows[embeddedRow]?.top).toBeCloseTo(row1Top, 0);
        expect(layoutRowAtWireFocus(doc, layout, 0)).toBeLessThan(embeddedRow);
      } finally {
        restoreAcquire();
        surface.remove();
      }
    });

    it("promotes substantive wire-newline row start when acquire cache omits line-start text", () => {
      const wire = `pre @${AGENT} x @${AGENT} \nline @${AGENT} @${AGENT} \n\ntail`;
      const doc = wireToDoc(wire);
      const lineStartWire = wire.indexOf("line", wire.indexOf("\n"));
      const firstMentionOnLine = wire.indexOf("@", lineStartWire);
      const row0Top = 141.1;
      const row1Top = 159.3;
      const visualStart = 347.5;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      const restoreLineStart = stubHandoffNoteAnchorRectAtWire(surface, doc, lineStartWire, {
        top: row1Top,
        left: visualStart,
      });

      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: visualStart },
        { wire: 4, top: row0Top, left: 374.73 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 2, nodeOffset: 1 }),
          top: row0Top,
          left: 491.89,
        },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 507.67,
        },
        { wire: lineStartWire - 1, top: row0Top, left: 628.38 },
        { wire: firstMentionOnLine, top: row1Top, left: 382.09 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 5, nodeOffset: 0 }),
          top: row1Top,
          left: 499.25,
        },
        { wire: wire.length - 1, top: 195.26, left: 377.52 },
      ]);

      try {
        const layout = buildHandoffNoteLayoutMap(surface, doc);
        expect(layoutRowAtWireFocus(doc, layout, lineStartWire)).toBe(1);
        expect(layoutRowAtWireFocus(doc, layout, firstMentionOnLine)).toBe(1);
        expect(layout.coordsForWire(lineStartWire)?.left).toBe(visualStart);
      } finally {
        restoreLineStart();
        surface.remove();
      }
    });

    it("keeps leading post-mention spacer on pill row when the substantive tail wraps", () => {
      const wire = `pre @${AGENT} x @${AGENT} line @${AGENT} @${AGENT} `;
      const doc = wireToDoc(wire);
      const secondPostStart = docPosToWireOffset(doc, { nodeIndex: 4, nodeOffset: 0 });
      const secondTextStart = secondPostStart + 1;
      const secondMentionStart = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 });
      const row0Top = 141.1;
      const row1Top = 159.3;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: 347.5 },
        { wire: 4, top: row0Top, left: 374.73 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: AGENT.length }),
          top: row0Top,
          left: 491.89,
        },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 507.67,
        },
        { wire: secondPostStart, top: row1Top, left: 624.82 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 5, nodeOffset: 0 }),
          top: row1Top,
          left: 382.09,
        },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 5, nodeOffset: AGENT.length }),
          top: row1Top,
          left: 499.25,
        },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 6, nodeOffset: 0 }),
          top: row1Top,
          left: 503.81,
        },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 7, nodeOffset: AGENT.length }),
          top: row1Top,
          left: 620.97,
        },
        { wire: wire.length, top: row1Top, left: 624.52 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 2, nodeOffset: 0 }),
          top: row0Top - 0.43,
          left: 491.89,
        },
        { wire: secondTextStart, top: row0Top - 0.43, left: 624.82 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc);

      expect(layoutRowAtWireFocus(doc, layout, secondMentionStart)).toBe(0);
      expect(layoutRowAtWireFocus(doc, layout, secondPostStart)).toBe(0);
      expect(layoutRowAtWireFocus(doc, layout, secondTextStart)).toBe(1);
      expect(layout.coordsForWire(secondTextStart)?.left).toBeCloseTo(382.09, 1);
      surface.remove();
    });

    it("coords for soft-wrap tail interior use wrap-row column not row-0 tail column", () => {
      const wire = `he @${AGENT} x @${AGENT} tail`;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("tail");
      const tailInterior = tailStart + 2;
      const tailPastEnd = wire.length;
      const row0Top = 141.1;
      const row1Top = 158.86;
      const wrapStartLeft = 370.02;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });

      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 3, top: row0Top, left: 359.58 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 492.52,
        },
        { wire: tailStart - 1, top: row0Top, left: 609.68 },
        { wire: tailPastEnd, top: row1Top, left: wrapStartLeft },
        { wire: tailStart, top: 140.67, left: 609.68 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const coord = layout.coordsForWire(tailInterior);

      expect(coord).not.toBeNull();
      expect(coord!.left).toBeGreaterThan(wrapStartLeft - 5);
      expect(coord!.left).toBeLessThan(wrapStartLeft + 5);
      expect(coord!.left).toBeLessThan(400);
      surface.remove();
    });

    it("coords for embedded substantive lower wire line bracket within lower segment only", () => {
      const agent = "caliper-aaaaaaa";
      const wire = `he @${agent} x @${agent} \nseg`;
      const doc = wireToDoc(wire);
      const lowerLineStart = wire.indexOf("\n") + 1;
      const lowerInterior = lowerLineStart + 1;
      const lowerPastEnd = wire.length;
      const row0Top = 141.1;
      const row1Top = 158.86;
      const lowerStartLeft = 370.02;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[agent, "#06f"]]) });

      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 3, top: row0Top, left: 359.58 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 492.52,
        },
        { wire: lowerLineStart - 1, top: row0Top, left: 609.68 },
        { wire: lowerPastEnd, top: row1Top, left: lowerStartLeft },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const coord = layout.coordsForWire(lowerInterior);

      expect(coord).not.toBeNull();
      expect(coord!.left).toBeGreaterThan(lowerStartLeft - 5);
      expect(coord!.left).toBeLessThan(lowerStartLeft + 5);
      expect(coord!.left).toBeLessThan(450);
      surface.remove();
    });

    it("shorter-row sticky preserves goal when landing on wrap continuation row", () => {
      const wire = `he @${AGENT} x @${AGENT} tail`;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("tail");
      const tailPastEnd = wire.length;
      const row0Top = 141.1;
      const row1Top = 158.86;
      const wideGoal = 609.68;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 3, top: row0Top, left: 359.58 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 492.52,
        },
        { wire: tailStart - 1, top: row0Top, left: wideGoal },
        { wire: tailPastEnd, top: row1Top, left: 370.02 },
        { wire: tailStart, top: 140.67, left: wideGoal },
      ]);
      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const wrapRow = layout.rows[1]!;
      const wrapRowMax = Math.max(...wrapRow.samples.map((sample) => sample.left));
      const edgeTolerance = layoutRowTopTolerance(layout.lineHeight);
      expect(
        layout.shouldPreserveGoalColumnOnShorterRowLanding({
          fromRowIndex: 0,
          targetRowIndex: 1,
          targetRow: wrapRow,
          effectiveGoalColumn: wideGoal,
          landedColumn: wrapRowMax,
          edgeTolerance,
          useRowStartLandingOnTarget: false,
        })
      ).toBe(true);
      surface.remove();
    });

    it("shorter-row sticky preserves pre-clamp goal on Down into wrap continuation row", () => {
      const wire = `pre @${AGENT} x @${AGENT} post @${AGENT} @${AGENT} `;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("post");
      const row0Top = 141.1;
      const row1Top = 159.3;
      const prefixGoal = 361.11;
      const wrapRowStartColumn = 377.8125;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: 347.5 },
        { wire: 4, top: row0Top, left: 374.73 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 507.67,
        },
        { wire: tailStart - 1, top: row0Top, left: 624.82 },
        { wire: wire.length, top: row1Top, left: wrapRowStartColumn },
        { wire: tailStart, top: row1Top, left: wrapRowStartColumn },
      ]);
      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const wrapRow = layout.rows[1]!;
      const edgeTolerance = layoutRowTopTolerance(layout.lineHeight);
      expect(
        layout.shouldPreserveGoalColumnOnShorterRowLanding({
          fromRowIndex: 0,
          targetRowIndex: 1,
          targetRow: wrapRow,
          effectiveGoalColumn: prefixGoal,
          landedColumn: wrapRowStartColumn,
          edgeTolerance,
          useRowStartLandingOnTarget: false,
        })
      ).toBe(true);
      surface.remove();
    });

    it("shorter-row sticky re-anchors on Up into same-wire soft-wrap prefix row", () => {
      const agent = "caliper-aaaaaaaaaaa";
      const wire = `header @${agent} tail @${agent} `;
      const doc = wireToDoc(wire);
      const secondMentionEnd = wire.length - 1;
      const firstMentionStart = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: 0 });
      const row1Top = 141.09897422790527;
      const row2Top = 159.29689598083496;
      const wideGoal = 482.7083435058594;
      const surface = document.createElement("div");
      surface.style.width = "480px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 480 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[agent, "#06f"]]) });
      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: row1Top, left: 347 },
        { wire: firstMentionStart, top: row1Top, left: 360 },
        { wire: docPosToWireOffset(doc, { nodeIndex: 2, nodeOffset: 0 }), top: row1Top, left: 480 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: agent.length }),
          top: row2Top,
          left: 505.39,
        },
        { wire: secondMentionEnd, top: row2Top, left: wideGoal },
      ]);
      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const prefixRow = layout.rows[0]!;
      const prefixMax = Math.max(...prefixRow.samples.map((sample) => sample.left));
      const edgeTolerance = layoutRowTopTolerance(layout.lineHeight);
      expect(
        layout.shouldPreserveGoalColumnOnShorterRowLanding({
          fromRowIndex: 1,
          targetRowIndex: 0,
          targetRow: prefixRow,
          effectiveGoalColumn: wideGoal,
          landedColumn: prefixMax,
          edgeTolerance,
          useRowStartLandingOnTarget: false,
        })
      ).toBe(false);
      surface.remove();
    });

    it("shorter-row sticky preserves goal on Up through wire line break", () => {
      const wire = "hi\nmuch longer lower line";
      const doc = wireToDoc(wire);
      const upperEnd = wire.indexOf("\n") - 1;
      const lowerPastEnd = wire.length;
      const row0Top = 100;
      const row1Top = 118;
      const upperMaxLeft = 95;
      const lowerWideLeft = 440;
      const layout = buildLayoutMapFromSamples(
        [
          { wire: 0, top: row0Top, left: 40 },
          { wire: upperEnd, top: row0Top, left: upperMaxLeft },
          { wire: lowerPastEnd, top: row1Top, left: lowerWideLeft },
        ],
        18,
        doc
      );
      const upperRow = layout.rows[0]!;
      const edgeTolerance = layoutRowTopTolerance(layout.lineHeight);
      expect(
        layout.shouldPreserveGoalColumnOnShorterRowLanding({
          fromRowIndex: 1,
          targetRowIndex: 0,
          targetRow: upperRow,
          effectiveGoalColumn: lowerWideLeft,
          landedColumn: upperMaxLeft,
          edgeTolerance,
          useRowStartLandingOnTarget: false,
        })
      ).toBe(true);
    });

    it("row-start landing blocks sticky preserve on Down into wrap continuation", () => {
      const wire = `pre @${AGENT} x @${AGENT} post @${AGENT} @${AGENT} `;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("post");
      const row0Top = 141.1;
      const row1Top = 159.3;
      const prefixGoal = 361.11;
      const wrapRowStartColumn = 377.8125;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: 347.5 },
        { wire: 4, top: row0Top, left: 374.73 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 507.67,
        },
        { wire: tailStart - 1, top: row0Top, left: 624.82 },
        { wire: wire.length, top: row1Top, left: wrapRowStartColumn },
        { wire: tailStart, top: row1Top, left: wrapRowStartColumn },
      ]);
      const layout = buildHandoffNoteLayoutMap(surface, doc);
      const wrapRow = layout.rows[1]!;
      const edgeTolerance = layoutRowTopTolerance(layout.lineHeight);
      const stickyInput = {
        fromRowIndex: 0,
        targetRowIndex: 1,
        targetRow: wrapRow,
        effectiveGoalColumn: prefixGoal,
        landedColumn: wrapRowStartColumn,
        edgeTolerance,
      };
      expect(
        layout.shouldPreserveGoalColumnOnShorterRowLanding({
          ...stickyInput,
          useRowStartLandingOnTarget: false,
        })
      ).toBe(true);
      expect(
        layout.shouldPreserveGoalColumnOnShorterRowLanding({
          ...stickyInput,
          useRowStartLandingOnTarget: true,
        })
      ).toBe(false);
      surface.remove();
    });

    it("row-start landing still preserves sticky goal on Up into shorter row", () => {
      const wire = "hi\nmuch longer lower line";
      const doc = wireToDoc(wire);
      const upperEnd = wire.indexOf("\n") - 1;
      const lowerPastEnd = wire.length;
      const row0Top = 100;
      const row1Top = 118;
      const upperMaxLeft = 95;
      const lowerWideLeft = 440;
      const layout = buildLayoutMapFromSamples(
        [
          { wire: 0, top: row0Top, left: 40 },
          { wire: upperEnd, top: row0Top, left: upperMaxLeft },
          { wire: lowerPastEnd, top: row1Top, left: lowerWideLeft },
        ],
        18,
        doc
      );
      const upperRow = layout.rows[0]!;
      const edgeTolerance = layoutRowTopTolerance(layout.lineHeight);
      expect(
        layout.shouldPreserveGoalColumnOnShorterRowLanding({
          fromRowIndex: 1,
          targetRowIndex: 0,
          targetRow: upperRow,
          effectiveGoalColumn: lowerWideLeft,
          landedColumn: upperMaxLeft,
          edgeTolerance,
          useRowStartLandingOnTarget: true,
        })
      ).toBe(true);
    });
  });

  describe("layoutVisualRowSeats — progressive delete land lattice", () => {
    // Progressive trash — handoff-note-arrow-contract.md
    it("emits one seat per visual row, with a soft-wrap continuation row as its own content seat", () => {
      const wire = `he @${AGENT} x @${AGENT} tail\n`;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("tail");
      const trailingBlank = wire.length;
      const row0Top = 141.1;
      const row1Top = 158.86;

      const layout = buildLayoutMapFromSamples(
        [
          { wire: 0, top: row0Top, left: 340 },
          { wire: 3, top: row0Top, left: 359.58 },
          {
            wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
            top: row0Top,
            left: 492.52,
          },
          { wire: tailStart - 1, top: row0Top, left: 609.68 },
          { wire: tailStart, top: row1Top, left: 340 },
          { wire: tailStart + 4, top: row1Top, left: 380 },
        ],
        18,
        doc
      );

      expect(layout.visualRowCount).toBe(3);
      const seats = layoutVisualRowSeats(layout, doc);
      expect(seats).toEqual([
        { wire: 0, kind: "content" },
        { wire: tailStart, kind: "content" },
        { wire: trailingBlank, kind: "blank" },
      ]);
    });
  });

  describe("embedded-newline text node Ã— soft-wrap acquire contract", () => {
    const preWrapStart = 8;
    const postWrapBandWidth = 8;

    it("dom acquire pins pre-newline two-band wrap boundaries in cache", () => {
      const wire = "0123456789abcdefghij\nx";
      const doc = wireToDoc(wire);
      const newlineWire = wire.indexOf("\n");
      const surface = mountEmbeddedSoftWrapSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
      const restorePaint = stubEmbeddedNewlineNodePaint(
        surface,
        doc,
        { wrapAt: preWrapStart, newlineAt: newlineWire },
        [EMBEDDED_SOFT_WRAP_ROWS.band0, EMBEDDED_SOFT_WRAP_ROWS.band1]
      );
      invalidateHandoffNoteLayoutCache();

      try {
        buildHandoffNoteLayoutMap(surface, doc);
        const cached = getCachedMeasuredSamples(surface, wire, surface.clientWidth);
        expect(cached?.find((sample) => sample.wire === preWrapStart - 1)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band0
        );
        expect(cached?.find((sample) => sample.wire === preWrapStart)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band1
        );
      } finally {
        restorePaint();
        surface.remove();
      }
    });

    it("dom acquire pins pre-newline three-band wrap boundaries in cache", () => {
      const wire = "0123456789abcdefghijklmnop\nx";
      const doc = wireToDoc(wire);
      const newlineWire = wire.indexOf("\n");
      const preLine3Start = 17;
      const preBand2Top = 136;
      const surface = mountEmbeddedSoftWrapSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
      const tailLeft = EMBEDDED_SOFT_WRAP_SEGMENT_LEFT + EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH;
      const restorePaint = stubTextNodeLineRects(
        surface,
        doc,
        0,
        [EMBEDDED_SOFT_WRAP_ROWS.band0, EMBEDDED_SOFT_WRAP_ROWS.band1, preBand2Top].map((top) => ({
          top: top - 9,
          left: EMBEDDED_SOFT_WRAP_SEGMENT_LEFT,
          width: EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH,
          height: 18,
        })),
        {
          resolveOffsetRect: (nodeOffset) => {
            if (nodeOffset < preWrapStart) {
              return { top: EMBEDDED_SOFT_WRAP_ROWS.band0, left: tailLeft };
            }
            if (nodeOffset < preLine3Start) {
              return { top: EMBEDDED_SOFT_WRAP_ROWS.band1, left: tailLeft };
            }
            return { top: preBand2Top, left: tailLeft };
          },
        }
      );
      invalidateHandoffNoteLayoutCache();

      try {
        buildHandoffNoteLayoutMap(surface, doc);
        const cached = getCachedMeasuredSamples(surface, wire, surface.clientWidth);
        expect(cached?.find((sample) => sample.wire === preWrapStart - 1)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band0
        );
        expect(cached?.find((sample) => sample.wire === preWrapStart)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band1
        );
        expect(cached?.find((sample) => sample.wire === preLine3Start - 1)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band1
        );
        expect(cached?.find((sample) => sample.wire === preLine3Start)?.top).toBe(preBand2Top);
      } finally {
        restorePaint();
        surface.remove();
      }
    });

    it("dom acquire assigns pre-newline wrap interior to its painted band", () => {
      const wire = "0123456789abcdefghij\nx";
      const doc = wireToDoc(wire);
      const newlineWire = wire.indexOf("\n");
      const preInterior = preWrapStart + 3;
      const preLineEnd = newlineWire - 1;
      const surface = mountEmbeddedSoftWrapSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
      const restorePaint = stubEmbeddedNewlineNodePaint(
        surface,
        doc,
        { wrapAt: preWrapStart, newlineAt: newlineWire },
        [EMBEDDED_SOFT_WRAP_ROWS.band0, EMBEDDED_SOFT_WRAP_ROWS.band1]
      );
      invalidateHandoffNoteLayoutCache();

      try {
        const layout = buildHandoffNoteLayoutMap(surface, doc);
        expect(layoutRowAtWireFocus(doc, layout, preWrapStart - 1)).toBe(0);
        expect(layoutRowAtWireFocus(doc, layout, preWrapStart)).toBe(1);
        expect(layoutRowAtWireFocus(doc, layout, preInterior)).toBe(1);
        expect(layoutRowAtWireFocus(doc, layout, preLineEnd)).toBe(1);
        expect(layout.rows[1]?.top).toBeCloseTo(EMBEDDED_SOFT_WRAP_ROWS.band1, 0);
      } finally {
        restorePaint();
        surface.remove();
      }
    });

    it("dom acquire pins post-newline two-band wrap boundaries on substantive line", () => {
      const wire = "x\nklmnopqrstuvwxyz0123";
      const doc = wireToDoc(wire);
      const postLineStart = wire.indexOf("\n") + 1;
      const postWrapStart = postLineStart + postWrapBandWidth;
      const postInterior = postWrapStart + 3;
      const surface = mountEmbeddedSoftWrapSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
      const restorePaint = stubTextNodeLineRects(
        surface,
        doc,
        0,
        [
          {
            top: EMBEDDED_SOFT_WRAP_ROWS.band2 - 9,
            left: EMBEDDED_SOFT_WRAP_SEGMENT_LEFT,
            width: EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH,
            height: 18,
          },
          {
            top: EMBEDDED_SOFT_WRAP_ROWS.band3 - 9,
            left: EMBEDDED_SOFT_WRAP_SEGMENT_LEFT,
            width: EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH,
            height: 18,
          },
        ],
        {
          resolveOffsetRect: (nodeOffset) => {
            const tailLeft = EMBEDDED_SOFT_WRAP_SEGMENT_LEFT + EMBEDDED_SOFT_WRAP_SEGMENT_WIDTH;
            if (nodeOffset < postWrapStart) {
              return { top: EMBEDDED_SOFT_WRAP_ROWS.band2, left: tailLeft };
            }
            return { top: EMBEDDED_SOFT_WRAP_ROWS.band3, left: tailLeft };
          },
        }
      );
      invalidateHandoffNoteLayoutCache();

      try {
        const layout = buildHandoffNoteLayoutMap(surface, doc);
        const cached = getCachedMeasuredSamples(surface, wire, surface.clientWidth);
        expect(cached?.find((sample) => sample.wire === postLineStart)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band2
        );
        expect(cached?.find((sample) => sample.wire === postWrapStart)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band3
        );
        expect(layoutRowAtWireFocus(doc, layout, postLineStart)).toBe(0);
        expect(layoutRowAtWireFocus(doc, layout, postWrapStart)).toBe(1);
        expect(layoutRowAtWireFocus(doc, layout, postInterior)).toBe(1);
      } finally {
        restorePaint();
        surface.remove();
      }
    });

    it("dom acquire assigns four visual rows when pre- and post-newline segments each soft-wrap", () => {
      const wire = "0123456789abcdefghij\nklmnopqrstuvwxyz0123";
      const doc = wireToDoc(wire);
      const newlineWire = wire.indexOf("\n");
      const preInterior = preWrapStart + 3;
      const postLineStart = newlineWire + 1;
      const postWrapStart = postLineStart + postWrapBandWidth;
      const postInterior = postWrapStart + 3;
      const surface = mountEmbeddedSoftWrapSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
      const restorePaint = stubEmbeddedNewlineNodePaint(
        surface,
        doc,
        { wrapAt: preWrapStart, newlineAt: newlineWire, postWrapAt: postWrapStart },
        [
          EMBEDDED_SOFT_WRAP_ROWS.band0,
          EMBEDDED_SOFT_WRAP_ROWS.band1,
          EMBEDDED_SOFT_WRAP_ROWS.band2,
          EMBEDDED_SOFT_WRAP_ROWS.band3,
        ]
      );
      invalidateHandoffNoteLayoutCache();

      try {
        const layout = buildHandoffNoteLayoutMap(surface, doc);
        const cached = getCachedMeasuredSamples(surface, wire, surface.clientWidth);

        expect(layout.visualRowCount).toBeGreaterThanOrEqual(4);
        expect(layoutRowAtWireFocus(doc, layout, preInterior)).toBe(1);
        expect(layoutRowAtWireFocus(doc, layout, postInterior)).toBe(3);
        expect(layout.rows[0]?.top).toBeCloseTo(EMBEDDED_SOFT_WRAP_ROWS.band0, 0);
        expect(layout.rows[1]?.top).toBeCloseTo(EMBEDDED_SOFT_WRAP_ROWS.band1, 0);
        expect(layout.rows[2]?.top).toBeCloseTo(EMBEDDED_SOFT_WRAP_ROWS.band2, 0);
        expect(layout.rows[3]?.top).toBeCloseTo(EMBEDDED_SOFT_WRAP_ROWS.band3, 0);
        expect(cached?.find((sample) => sample.wire === preWrapStart)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band1
        );
        expect(cached?.find((sample) => sample.wire === postWrapStart)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band3
        );
        const preWrapRow = layoutRowAtWireFocus(doc, layout, preInterior);
        const postWrapRow = layoutRowAtWireFocus(doc, layout, postInterior);
        expect(isSameWireSoftWrapBandCrossing(doc, preWrapRow, postWrapRow, layout.rows)).toBe(
          false
        );
      } finally {
        restorePaint();
        surface.remove();
      }
    });

    it("infer assigns pre-newline wrap rows from cache on embedded-newline text node", () => {
      const wire = "0123456789abcdefghij\nklmnopqrstuvwxyz0123";
      const doc = wireToDoc(wire);
      const newlineWire = wire.indexOf("\n");
      const preInterior = preWrapStart + 3;
      const postLineStart = newlineWire + 1;
      const postWrapStart = postLineStart + postWrapBandWidth;
      const postInterior = postWrapStart + 3;
      const surface = mountEmbeddedSoftWrapSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });

      setMeasuredSamplesCache(surface, wire, surface.clientWidth, [
        { wire: 0, top: EMBEDDED_SOFT_WRAP_ROWS.band0, left: 200 },
        { wire: preWrapStart - 1, top: EMBEDDED_SOFT_WRAP_ROWS.band0, left: 200 },
        { wire: preWrapStart, top: EMBEDDED_SOFT_WRAP_ROWS.band1, left: 200 },
        { wire: newlineWire - 1, top: EMBEDDED_SOFT_WRAP_ROWS.band1, left: 200 },
        { wire: postLineStart, top: EMBEDDED_SOFT_WRAP_ROWS.band2, left: 40 },
        { wire: postWrapStart - 1, top: EMBEDDED_SOFT_WRAP_ROWS.band2, left: 40 },
        { wire: postWrapStart, top: EMBEDDED_SOFT_WRAP_ROWS.band3, left: 40 },
        { wire: wire.length, top: EMBEDDED_SOFT_WRAP_ROWS.band3, left: 40 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc);

      expect(layoutRowAtWireFocus(doc, layout, preInterior)).toBe(1);
      expect(layoutRowAtWireFocus(doc, layout, postInterior)).toBe(3);
      expect(layout.rows[1]?.top).toBeCloseTo(EMBEDDED_SOFT_WRAP_ROWS.band1, 0);
      expect(layout.rows[3]?.top).toBeCloseTo(EMBEDDED_SOFT_WRAP_ROWS.band3, 0);
      surface.remove();
    });
  });

  /**
   * Root lock: after soft-wrap acquire, `alignEmbeddedNewlinePrefixAfterAtomicRows`
   * must not flatten wrap-band tops onto the pill for the whole prefix-until-`\n`.
   * Minimal post-atomic + embedded-`\n` shape — not the full session blank lattice.
   * Contract: post-atomic prefix snap; soft wrap inside a wire line.
   */
  describe("post-atomic embedded-NL prefix snap vs soft-wrap acquire", () => {
    afterEach(() => {
      invalidateHandoffNoteLayoutCache();
    });

    const pillMidY = 177.49;
    const wrapMidY = 186.59;
    /** `@mention` + `" wrap \\n"` — first wire-line soft-wraps; later `\n` in same text node. */
    const wire = `@${AGENT} wrap \n`;
    const doc = wireToDoc(wire);
    const textNodeIndex = 1;
    const textNode = doc.nodes[textNodeIndex];
    if (textNode?.type !== "text") {
      throw new Error("expected post-mention text node");
    }
    const wrapLocal = textNode.text.indexOf("wrap");
    const nlLocal = textNode.text.indexOf("\n");
    const prefixWire = docPosToWireOffset(doc, { nodeIndex: textNodeIndex, nodeOffset: 0 });
    const wrapWire = docPosToWireOffset(doc, {
      nodeIndex: textNodeIndex,
      nodeOffset: wrapLocal,
    });
    const wrapTailWire = docPosToWireOffset(doc, {
      nodeIndex: textNodeIndex,
      nodeOffset: nlLocal - 1,
    });
    const mentionStartWire = docPosToWireOffset(doc, { nodeIndex: 0, nodeOffset: 0 });

    function stubPillAndTwoBandWrap(surface: HTMLElement): () => void {
      stubHandoffNoteMentionLayoutCoords(surface, new Map([[0, { top: pillMidY, left: 400 }]]));
      return stubTextNodeLineRects(
        surface,
        doc,
        textNodeIndex,
        [
          { top: pillMidY - 9, left: 520, width: 16, height: 18 },
          { top: wrapMidY - 9, left: 335.5, width: 48, height: 18 },
        ],
        {
          // resolveOffsetRect.top is midY; fragment rect tops are box tops.
          resolveOffsetRect: (nodeOffset) => {
            if (nodeOffset < wrapLocal) {
              return { top: pillMidY, left: 520 + nodeOffset * 4, width: 8, height: 18 };
            }
            if (nodeOffset < nlLocal) {
              return {
                top: wrapMidY,
                left: 335.5 + (nodeOffset - wrapLocal) * 7,
                width: 8,
                height: 18,
              };
            }
            return { top: wrapMidY + 18, left: 335.5, width: 8, height: 18 };
          },
        }
      );
    }

    it("shape: wrap text sits in post-mention run that later contains \\n", () => {
      const node = doc.nodes[textNodeIndex];
      expect(node?.type).toBe("text");
      if (node?.type !== "text") {
        return;
      }
      expect(doc.nodes[0]?.type).toBe("mention");
      expect(wrapLocal).toBeGreaterThan(0);
      expect(nlLocal).toBeGreaterThan(wrapLocal);
      expect(node.text.slice(0, nlLocal)).toContain("wrap");
      expect(prefixWire).toBeLessThan(wrapWire);
    });

    it("acquire cache keeps wrap-band tops below pill (prefix snap does not flatten)", () => {
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      const restore = stubPillAndTwoBandWrap(surface);
      invalidateHandoffNoteLayoutCache(surface);

      try {
        buildHandoffNoteLayoutMap(surface, doc);
        const cached = getCachedMeasuredSamples(surface, wire, 310) ?? [];
        const prefix = cached.find((sample) => sample.wire === prefixWire);
        const wrap = cached.find(
          (sample) => sample.wire === wrapWire || sample.wire === wrapTailWire
        );
        const msg = `cached=${JSON.stringify(
          cached.map((sample) => ({ wire: sample.wire, top: sample.top }))
        )}`;

        expect(prefix, msg).toBeTruthy();
        expect(wrap, msg).toBeTruthy();
        // Same-band prefix may snap to exact pill midY.
        expect(prefix!.top, msg).toBeCloseTo(pillMidY, 1);
        // Soft-wrap continuation must survive post-atomic prefix align.
        expect(wrap!.top, msg).toBeGreaterThan(pillMidY + 4);
        expect(wrap!.top, msg).toBeCloseTo(wrapMidY, 1);
      } finally {
        restore();
        surface.remove();
      }
    });

    it("infer: wrap wire is a distinct visual row below the mention band", () => {
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      const restore = stubPillAndTwoBandWrap(surface);
      invalidateHandoffNoteLayoutCache(surface);
      const wrapMidCharWire = docPosToWireOffset(doc, {
        nodeIndex: textNodeIndex,
        nodeOffset: wrapLocal + 2,
      });

      try {
        const layout = buildHandoffNoteLayoutMap(surface, doc);
        const mentionRow = layoutRowAtWireFocus(doc, layout, mentionStartWire, surface);
        const wrapRow = layoutRowAtWireFocus(doc, layout, wrapWire, surface);
        const wrapMidRow = layoutRowAtWireFocus(doc, layout, wrapMidCharWire, surface);
        const wrapTailRow = layoutRowAtWireFocus(doc, layout, wrapTailWire, surface);
        const cached = getCachedMeasuredSamples(surface, wire, 310) ?? [];
        const msg = JSON.stringify({
          tops: layout.rows.map((row) => `${row.kind}@${row.top.toFixed(2)}`),
          rows: { mentionRow, wrapRow, wrapMidRow, wrapTailRow },
          wires: { wrapWire, wrapMidCharWire, wrapTailWire },
          samples: cached.map((sample) => ({
            wire: sample.wire,
            top: Number(sample.top.toFixed(2)),
          })),
          continuationProbe: layout.continuationAfterRowEndWire(prefixWire),
        });
        // Soft-wrap partition: unsampled wrap glyphs still share the continuation row.
        expect(wrapRow, msg).toBeGreaterThan(mentionRow);
        expect(wrapMidRow, msg).toBe(wrapRow);
        expect(wrapTailRow, msg).toBe(wrapRow);
        expect(layout.continuationAfterRowEndWire(prefixWire), msg).toBe(wrapWire);
        expect(
          layout.rows.some((row) => row.kind === "content" && Math.abs(row.top - wrapMidY) < 2),
          msg
        ).toBe(true);
      } finally {
        restore();
        surface.remove();
      }
    });
  });

  describe("isSameWireSoftWrapBandCrossing", () => {
    const AGENT = "caliper-aaaaaaa";
    const ROW1 = 100;
    const ROW2 = 118;

    function contentRow(
      top: number,
      samples: { wire: number; left: number }[]
    ): HandoffNoteLayoutRow {
      const mapped = samples.map((sample) => ({ ...sample, top }));
      const lefts = mapped.map((sample) => sample.left);
      return {
        kind: "content",
        top,
        samples: mapped,
        minLeft: Math.min(...lefts),
        maxLeft: Math.max(...lefts),
      };
    }

    it("returns false when upper row max sample sits on wire newline", () => {
      const wire = `hi @${AGENT}\nwide content here`;
      const doc = wireToDoc(wire);
      const mentionEnd = docPosToWireOffset(doc, {
        nodeIndex: 1,
        nodeOffset: 1 + AGENT.length,
      });
      const lowerStart = wire.indexOf("\n") + 1;
      const rows = [
        contentRow(ROW1, [
          { wire: 0, left: 0 },
          { wire: mentionEnd, left: 150 },
        ]),
        contentRow(ROW2, [{ wire: lowerStart, left: 0 }]),
      ];
      expect(isSameWireSoftWrapBandCrossing(doc, 1, 0, rows)).toBe(false);
      expect(isSameWireSoftWrapBandCrossing(doc, 0, 1, rows)).toBe(false);
    });

    it("returns true for adjacent visual rows on one wire line without embedded newline", () => {
      const wire = `header @${AGENT} tail`;
      const doc = wireToDoc(wire);
      const mentionStart = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: 0 });
      const postMention = mentionStart + 1 + AGENT.length + 1;
      const rows = [
        contentRow(ROW1, [
          { wire: 0, left: 0 },
          { wire: mentionStart, left: 30 },
        ]),
        contentRow(ROW2, [
          { wire: postMention, left: 80 },
          { wire: wire.length, left: 200 },
        ]),
      ];
      expect(isSameWireSoftWrapBandCrossing(doc, 1, 0, rows)).toBe(true);
    });
  });

  describe("layout row authority — no public wire→row APIs", () => {
    function mount(wire: string) {
      const doc = wireToDoc(wire);
      const root = document.createElement("div");
      root.contentEditable = "true";
      document.body.appendChild(root);
      renderHandoffNoteDoc(root, doc, {
        colorByAgentId: new Map([[AGENT, "#f00"]]),
      });
      return { root, doc };
    }

    function chippedMentionAbuttingBlank() {
      const doc0 = wireToDoc(`header @${AGENT} \n\n\n`);
      const spacerWire = listEmbeddedBlankBandProbeWires(doc0)[0]! - 1;
      const chipped = applyDocDelete(
        doc0,
        collapsedSelection(wireOffsetToDocPos(doc0, spacerWire), "after"),
        "backspace"
      )!;
      const mentionEnd = chipped.selection.focus;
      const probeWire = listEmbeddedBlankBandProbeWires(chipped.doc)[0]!;
      expect(chipped.doc.nodes[mentionEnd.nodeIndex]?.type).toBe("mention");
      expect(docPosToWireOffset(chipped.doc, mentionEnd)).toBe(probeWire);
      return { wire: docToWire(chipped.doc), mentionEnd, probeWire };
    }

    it("layout map has no public wire paint/row APIs", () => {
      const { root, doc } = mount("hello");
      try {
        const layout = buildHandoffNoteLayoutMap(root, doc);
        expect(layout).not.toHaveProperty("rowIndexForWire");
        expect(layout).not.toHaveProperty("paintContextForWire");
        expect(typeof layout.paintContextForDocPos).toBe("function");
      } finally {
        root.remove();
      }
    });

    it("mention-end ≡ probe — layoutRowAtWireFocus matches layoutRowForFocus(mentionEnd)", () => {
      const { wire, mentionEnd, probeWire } = chippedMentionAbuttingBlank();
      const { root, doc } = mount(wire);
      try {
        const layout = buildHandoffNoteLayoutMap(root, doc);
        expect(layoutRowAtWireFocus(doc, layout, probeWire, root)).toBe(
          layoutRowForFocus(root, doc, layout, mentionEnd)
        );
        const focusPaint = resolvePaintContext(doc, mentionEnd, { root });
        const byDoc = layout.paintContextForDocPos(focusPaint.paintPos);
        const atWirePaint = resolvePaintContextAtWire(doc, probeWire, { root });
        expect(atWirePaint.focusPos).toEqual(mentionEnd);
        expect(layout.paintContextForDocPos(atWirePaint.paintPos)?.rowIndex).toBe(byDoc?.rowIndex);
      } finally {
        root.remove();
      }
    });

    it("ordinary interior text — wire-focus helper matches focus row", () => {
      const { root, doc } = mount("hello world");
      try {
        const focus = wireOffsetToDocPos(doc, 3);
        const layout = buildHandoffNoteLayoutMap(root, doc);
        expect(layoutRowAtWireFocus(doc, layout, 3, root)).toBe(
          layoutRowForFocus(root, doc, layout, focus)
        );
      } finally {
        root.remove();
      }
    });
  });
});
