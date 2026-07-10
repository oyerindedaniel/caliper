import { describe, expect, it, beforeEach } from "vitest";
import {
  applyDocInsertText,
  collapsedSelection,
  docPosToWireOffset,
  docToWire,
  listEmbeddedBlankBandProbeWires,
  wireOffsetToDocPos,
  wireToDoc,
  type HandoffNoteDoc,
} from "@caliper/core";
import { renderHandoffNoteDoc } from "./handoff-note-dom.js";
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
  readHandoffNoteLayoutCacheKey,
  setMeasuredSamplesCache,
  type HandoffNoteLayoutMap,
  type HandoffNoteLayoutRow,
} from "./handoff-note-layout-map.js";
import { resolveDomVerticalArrowMove } from "./handoff-note-selection.js";
import {
  setSelectionAtWire,
  refreshHandoffNoteEditorLayoutGeometry,
  stubHandoffNoteMentionLayoutCoords,
  stubEmbeddedNewlineSegmentAcquire,
  stubHandoffNoteAnchorRectAtWire,
  stubTextNodeLineRects,
  mountThreeRowMentionSoftWrapFixture,
} from "./handoff-note-test-helpers.js";

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
    it("returns null before anything is cached", () => {
      expect(readHandoffNoteLayoutCacheKey()).toBeNull();
      expect(getCachedMeasuredSamples("hello", 320)).toBeNull();
    });

    it("stores and reads samples keyed by wire and root width", () => {
      const samples = [
        { wire: 0, top: 0, left: 0 },
        { wire: 5, top: 0, left: 40 },
      ];
      setMeasuredSamplesCache("hello", 320, samples);

      expect(readHandoffNoteLayoutCacheKey()).toEqual({
        wire: "hello",
        rootWidth: 320,
        sampleCount: 2,
      });
      expect(getCachedMeasuredSamples("hello", 320)).toEqual(samples);
      samples[0]!.top = 999;
      expect(getCachedMeasuredSamples("hello", 320)).toEqual([
        { wire: 0, top: 0, left: 0 },
        { wire: 5, top: 0, left: 40 },
      ]);
    });

    it("misses when wire or width changes", () => {
      setMeasuredSamplesCache("hello", 320, [{ wire: 0, top: 0, left: 0 }]);

      expect(getCachedMeasuredSamples("hello!", 320)).toBeNull();
      expect(getCachedMeasuredSamples("hello", 280)).toBeNull();
    });

    it("clears on invalidation", () => {
      setMeasuredSamplesCache("hello", 320, [{ wire: 0, top: 0, left: 0 }]);
      invalidateHandoffNoteLayoutCache();
      expect(readHandoffNoteLayoutCacheKey()).toBeNull();
      expect(getCachedMeasuredSamples("hello", 320)).toBeNull();
    });

    it("invalidates injected cache after generation bump without wire or width change", () => {
      setMeasuredSamplesCache("hello", 320, [{ wire: 0, top: 0, left: 0 }]);
      expect(getCachedMeasuredSamples("hello", 320)).not.toBeNull();
      invalidateHandoffNoteLayoutCache();
      setMeasuredSamplesCache("hello", 320, [{ wire: 0, top: 12, left: 0 }]);
      expect(getCachedMeasuredSamples("hello", 320)).toEqual([{ wire: 0, top: 12, left: 0 }]);
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

      expect(readHandoffNoteLayoutCacheKey()).toEqual({
        wire: docToWire(doc),
        rootWidth: surface.clientWidth,
        sampleCount: expect.any(Number),
      });
      const cached = readHandoffNoteLayoutCacheKey();
      expect(cached?.sampleCount).toBeGreaterThan(0);

      resolveDomVerticalArrowMove(surface, doc, focus, "up");
      expect(readHandoffNoteLayoutCacheKey()).toEqual(cached);
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
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const headerTop = 80;
      const lineHeight = 16;

      const layout = buildLayoutMapFromSamples(
        [{ wire: 0, top: headerTop, left: 0 }],
        lineHeight,
        doc
      );

      const blankRows = layout.rows.filter((row) => row.kind === "blank");
      expect(blankRows).toHaveLength(probes.length);
      for (const row of blankRows) {
        expect(row.top).toBeGreaterThan(headerTop);
      }
      expectStrictlyIncreasing(blankRows.map((row) => row.top));
    });

    it("composite blank band places distinct rows below middle content", () => {
      const wire = `prefix @${AGENT} \n\n@${AGENT} tail\n\n\nbottom @${AGENT}\n`;
      const doc = wireToDoc(wire);
      const middleRowLineStart = wire.indexOf(`@${AGENT} tail`);
      const middleTop = 177;
      const middleRowTailEnd = middleRowLineStart + `@${AGENT} tail`.length;
      const bottomLineStart = wire.indexOf("bottom");
      const blankRun = listEmbeddedBlankBandProbeWires(doc).filter(
        (probe) => probe >= middleRowTailEnd && probe < bottomLineStart
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
      setMeasuredSamplesCache(wire, surface.clientWidth, samples);

      const layout = buildHandoffNoteLayoutMap(
        surface,
        doc,
        wireOffsetToDocPos(doc, endOfLastMention)
      );
      const bandBlankRows = layout.rows.filter(
        (row) =>
          row.kind === "blank" &&
          row.breakProbeWire !== undefined &&
          blankRun.includes(row.breakProbeWire)
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
      setMeasuredSamplesCache(wire, surface.clientWidth, [
        { wire: prefixStart, top: row1Top, left: 0 },
        { wire: 20, top: row1Top, left: 200 },
        { wire: 21, top: row1Top, left: 220 },
        { wire: 43, top: row1Top, left: 400 },
        { wire: 46, top: row2Top, left: 0 },
        { wire: tailWire, top: row2Top, left: 120 },
      ]);

      const first = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, tailWire));
      const second = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, tailWire));

      expect(roundedRowTops(second)).toEqual(roundedRowTops(first));
      expect(first.rows.filter((row) => row.kind === "blank").length).toBe(1);
      surface.remove();
    });
  });

  describe("dom acquire path — suffix blank band", () => {
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

    it("builds layout from DOM acquire without hand-seeded sample cache", () => {
      const doc = wireToDoc(suffixBlankBandWire);
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubMentionRows(surface);

      const layout = buildHandoffNoteLayoutMap(
        surface,
        doc,
        wireOffsetToDocPos(doc, suffixBlankBandWire.length)
      );
      expect(layout.samples.length).toBeGreaterThan(0);
      expect(listEmbeddedBlankBandProbeWires(doc)).toHaveLength(2);
      expect(layout.rows.filter((row) => row.kind === "blank")).toHaveLength(2);
      surface.remove();
    });

    it("dom acquire cache excludes blank-band probe wires", () => {
      const doc = wireToDoc(suffixBlankBandWire);
      const probes = new Set(listEmbeddedBlankBandProbeWires(doc));
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubMentionRows(surface);
      invalidateHandoffNoteLayoutCache();

      buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, 0));

      const cached = getCachedMeasuredSamples(docToWire(doc), surface.clientWidth);
      expect(cached).not.toBeNull();
      for (const sample of cached!) {
        expect(probes.has(sample.wire)).toBe(false);
      }
      surface.remove();
    });

    it("blank row top matches wire-break DOM measure when root is available", () => {
      const doc = wireToDoc(suffixBlankBandWire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[AGENT, "#06f"]]) });
      stubMentionRows(surface);
      const probeTops = [168.5, 186.25];
      for (const [index, probeWire] of probes.entries()) {
        stubHandoffNoteAnchorRectAtWire(surface, doc, probeWire, {
          top: probeTops[index]!,
          left: 40,
          height: 18,
        });
      }

      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, probes[0]!));
      const blankRows = layout.rows.filter((row) => row.kind === "blank");
      expect(blankRows).toHaveLength(2);
      for (const [index, row] of blankRows.entries()) {
        expect(Math.round(row.top * 100) / 100).toBe(probeTops[index]!);
      }
      surface.remove();
    });

    it("assigns text-led lower row after blank band to the content band below blanks", () => {
      const wire = `header @${AGENT} \n\n\nlower @${AGENT} `;
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      const lowerRowStart = wire.indexOf("lower");
      const exitNewlineWire = lowerRowStart - 1;
      const lowerMentionStart = wire.indexOf("@", lowerRowStart);
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
      setMeasuredSamplesCache(wire, surface.clientWidth, [
        { wire: 0, top: headerTop, left: 0 },
        { wire: probes[0]!, top: blank1Top, left: 0 },
        { wire: probes[1]!, top: blank2Top, left: 0 },
        { wire: lowerMentionStart, top: contentTop, left: 0 },
        { wire: wire.length - 1, top: contentTop, left: 120 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, probes[1]!));
      const contentRowIndex = layout.rowIndexForWire(lowerMentionStart);
      expect(layout.rowIndexForWire(exitNewlineWire)).toBe(contentRowIndex);
      expect(layout.rowIndexForWire(lowerRowStart)).toBe(contentRowIndex);
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

      const layout = buildHandoffNoteLayoutMap(
        surface,
        doc,
        wireOffsetToDocPos(doc, lowerLineStart)
      );
      const lowerRow = layout.rowIndexForWire(lowerLineStart);
      expect(layout.rowIndexForWire(breakWire)).toBe(lowerRow);
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

      const layout = buildHandoffNoteLayoutMap(
        surface,
        doc,
        wireOffsetToDocPos(doc, wire.length - 1)
      );

      expect(layout.visualRowCount).toBeGreaterThanOrEqual(4);
      const cached = getCachedMeasuredSamples(docToWire(doc), surface.clientWidth);
      expect(cached?.some((sample) => sample.wire === lowerLineStart)).toBe(true);
      expect(cached?.some((sample) => sample.wire === probes[0]!)).toBe(false);
      const lowerSample = cached?.find((sample) => sample.wire === lowerLineStart);
      expect(lowerSample?.top).toBe(lowerTop);
      surface.remove();
    });

    it("keeps stacked blank rows as separate visual rows in dom acquire", () => {
      const wire = "header\n\n";
      const doc = wireToDoc(wire);
      const probes = listEmbeddedBlankBandProbeWires(doc);
      expect(probes).toHaveLength(2);
      const surface = mountSurface();
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
      invalidateHandoffNoteLayoutCache();

      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, probes[1]!));
      const blankRows = layout.rows.filter((row) => row.kind === "blank");
      expect(blankRows).toHaveLength(2);
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
      setMeasuredSamplesCache(wire, surface.clientWidth, [
        { wire: prefixStart, top: row1Top, left: 0 },
        { wire: postMentionStart, top: row1Top, left: 200 },
        { wire: firstMentionEnd, top: row1Top, left: 220 },
        { wire: secondPostStart, top: row1Top, left: 400 },
        { wire: secondMentionEnd, top: row1Top, left: 420 },
        { wire: tailWire, top: row2Top, left: 520 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, tailWire));

      expect(layout.visualRowCount).toBeGreaterThanOrEqual(2);
      expect(layout.rowIndexForWire(tailWire)).toBeGreaterThan(0);
      expect(layout.rowIndexForWire(prefixStart)).toBe(0);
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

      setMeasuredSamplesCache(wire, surface.clientWidth, [
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

      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, tailInterior));

      expect(layout.rowIndexForWire(tailStart - 1)).toBe(0);
      expect(layout.rowIndexForWire(tailInterior)).toBe(1);
      expect(layout.rowIndexForWire(tailPastEnd)).toBe(1);
      surface.remove();
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
      setMeasuredSamplesCache(wire, fx.rootWidth, [
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

      const layout = buildHandoffNoteLayoutMap(fx.root, fx.doc, interiorPos);

      expect(layout.rowIndexForWire(interiorWire)).toBe(1);
      expect(layout.rowIndexForWire(interiorWire)).not.toBe(2);
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

      setMeasuredSamplesCache(wire, surface.clientWidth, [
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

      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, tailInterior));

      expect(layout.rowIndexForWire(spacerWire)).toBe(0);
      expect(layout.rowIndexForWire(tailStart)).toBe(1);
      expect(layout.rowIndexForWire(tailInterior)).toBe(1);
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
        const layout = buildHandoffNoteLayoutMap(
          surface,
          doc,
          wireOffsetToDocPos(doc, tailStart + 2)
        );
        expect(layout.rowIndexForWire(spacerWire)).toBe(0);
        expect(layout.rowIndexForWire(tailStart)).toBe(1);
        const cached = getCachedMeasuredSamples(wire, surface.clientWidth);
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
        const layout = buildHandoffNoteLayoutMap(
          surface,
          doc,
          wireOffsetToDocPos(doc, line3Start + 2)
        );
        expect(layout.visualRowCount).toBeGreaterThanOrEqual(3);
        expect(layout.rowIndexForWire(line2Start - 1)).toBe(0);
        expect(layout.rowIndexForWire(line2Start)).toBe(1);
        expect(layout.rowIndexForWire(line3Start - 1)).toBe(1);
        expect(layout.rowIndexForWire(line3Start)).toBe(2);
        expect(layout.rowIndexForWire(line2Start + 2)).toBe(1);
        expect(layout.rowIndexForWire(line3Start + 2)).toBe(2);
        expect(layout.rows[2]?.top).toBeCloseTo(row2Top, 0);
        const cached = getCachedMeasuredSamples(wire, surface.clientWidth);
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
        const layout = buildHandoffNoteLayoutMap(
          surface,
          doc,
          wireOffsetToDocPos(doc, interiorWire)
        );
        const cached = getCachedMeasuredSamples(docToWire(doc), surface.clientWidth);
        expect(cached?.find((sample) => sample.wire === lineStartWire)?.top).toBe(row1Top);
        expect(cached?.find((sample) => sample.wire === interiorWire)?.top).toBe(row1Top);

        const embeddedRow = layout.rowIndexForWire(lineStartWire);
        expect(layout.rowIndexForWire(interiorWire)).toBe(embeddedRow);
        expect(layout.rows[embeddedRow]?.top).toBeCloseTo(row1Top, 0);
        expect(layout.rowIndexForWire(0)).toBeLessThan(embeddedRow);
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

      setMeasuredSamplesCache(wire, surface.clientWidth, [
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
        const layout = buildHandoffNoteLayoutMap(
          surface,
          doc,
          wireOffsetToDocPos(doc, wire.length - 1)
        );
        expect(layout.rowIndexForWire(lineStartWire)).toBe(1);
        expect(layout.rowIndexForWire(firstMentionOnLine)).toBe(1);
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

      setMeasuredSamplesCache(wire, surface.clientWidth, [
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

      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, wire.length));

      expect(layout.rowIndexForWire(secondMentionStart)).toBe(0);
      expect(layout.rowIndexForWire(secondPostStart)).toBe(0);
      expect(layout.rowIndexForWire(secondTextStart)).toBe(1);
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

      setMeasuredSamplesCache(wire, surface.clientWidth, [
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

      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, tailInterior));
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

      setMeasuredSamplesCache(wire, surface.clientWidth, [
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

      const layout = buildHandoffNoteLayoutMap(
        surface,
        doc,
        wireOffsetToDocPos(doc, lowerInterior)
      );
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
      setMeasuredSamplesCache(wire, surface.clientWidth, [
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
      const layout = buildHandoffNoteLayoutMap(
        surface,
        doc,
        wireOffsetToDocPos(doc, tailStart - 1)
      );
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
      setMeasuredSamplesCache(wire, surface.clientWidth, [
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
      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, 2));
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
      setMeasuredSamplesCache(wire, surface.clientWidth, [
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
      const layout = buildHandoffNoteLayoutMap(
        surface,
        doc,
        wireOffsetToDocPos(doc, secondMentionEnd)
      );
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
      setMeasuredSamplesCache(wire, surface.clientWidth, [
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
      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, 2));
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

  describe("embedded-newline text node × soft-wrap acquire contract", () => {
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
        buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, preWrapStart + 2));
        const cached = getCachedMeasuredSamples(wire, surface.clientWidth);
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
        buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, preLine3Start + 2));
        const cached = getCachedMeasuredSamples(wire, surface.clientWidth);
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
        const layout = buildHandoffNoteLayoutMap(
          surface,
          doc,
          wireOffsetToDocPos(doc, preInterior)
        );
        expect(layout.rowIndexForWire(preWrapStart - 1)).toBe(0);
        expect(layout.rowIndexForWire(preWrapStart)).toBe(1);
        expect(layout.rowIndexForWire(preInterior)).toBe(1);
        expect(layout.rowIndexForWire(preLineEnd)).toBe(1);
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
        const layout = buildHandoffNoteLayoutMap(
          surface,
          doc,
          wireOffsetToDocPos(doc, postInterior)
        );
        const cached = getCachedMeasuredSamples(wire, surface.clientWidth);
        expect(cached?.find((sample) => sample.wire === postLineStart)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band2
        );
        expect(cached?.find((sample) => sample.wire === postWrapStart)?.top).toBe(
          EMBEDDED_SOFT_WRAP_ROWS.band3
        );
        expect(layout.rowIndexForWire(postLineStart)).toBe(0);
        expect(layout.rowIndexForWire(postWrapStart)).toBe(1);
        expect(layout.rowIndexForWire(postInterior)).toBe(1);
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
        const layout = buildHandoffNoteLayoutMap(
          surface,
          doc,
          wireOffsetToDocPos(doc, postInterior)
        );
        const cached = getCachedMeasuredSamples(wire, surface.clientWidth);

        expect(layout.visualRowCount).toBeGreaterThanOrEqual(4);
        expect(layout.rowIndexForWire(preInterior)).toBe(1);
        expect(layout.rowIndexForWire(postInterior)).toBe(3);
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
        const preWrapRow = layout.rowIndexForWire(preInterior);
        const postWrapRow = layout.rowIndexForWire(postInterior);
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

      setMeasuredSamplesCache(wire, surface.clientWidth, [
        { wire: 0, top: EMBEDDED_SOFT_WRAP_ROWS.band0, left: 200 },
        { wire: preWrapStart - 1, top: EMBEDDED_SOFT_WRAP_ROWS.band0, left: 200 },
        { wire: preWrapStart, top: EMBEDDED_SOFT_WRAP_ROWS.band1, left: 200 },
        { wire: newlineWire - 1, top: EMBEDDED_SOFT_WRAP_ROWS.band1, left: 200 },
        { wire: postLineStart, top: EMBEDDED_SOFT_WRAP_ROWS.band2, left: 40 },
        { wire: postWrapStart - 1, top: EMBEDDED_SOFT_WRAP_ROWS.band2, left: 40 },
        { wire: postWrapStart, top: EMBEDDED_SOFT_WRAP_ROWS.band3, left: 40 },
        { wire: wire.length, top: EMBEDDED_SOFT_WRAP_ROWS.band3, left: 40 },
      ]);

      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, postInterior));

      expect(layout.rowIndexForWire(preInterior)).toBe(1);
      expect(layout.rowIndexForWire(postInterior)).toBe(3);
      expect(layout.rows[1]?.top).toBeCloseTo(EMBEDDED_SOFT_WRAP_ROWS.band1, 0);
      expect(layout.rows[3]?.top).toBeCloseTo(EMBEDDED_SOFT_WRAP_ROWS.band3, 0);
      surface.remove();
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
      const mapped = samples.map((s) => ({ ...s, top }));
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
});
