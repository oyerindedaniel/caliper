import { describe, expect, it, beforeEach } from "vitest";
import {
  docPosToWireOffset,
  docToWire,
  listEmbeddedBlankBandProbeWires,
  wireOffsetToDocPos,
  wireToDoc,
} from "@caliper/core";
import { renderHandoffNoteDoc } from "./handoff-note-dom.js";
import {
  buildHandoffNoteLayoutMap,
  buildLayoutMapFromSamples,
  getCachedMeasuredSamples,
  invalidateHandoffNoteLayoutCache,
  readHandoffNoteLayoutCacheKey,
  setMeasuredSamplesCache,
  type HandoffNoteLayoutMap,
} from "./handoff-note-layout-map.js";
import { resolveDomVerticalArrowMove } from "./handoff-note-selection.js";
import {
  setSelectionAtWire,
  stubHandoffNoteMentionLayoutCoords,
  stubHandoffNoteAnchorRectAtWire,
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

    it("reuses cache across repeated vertical measure via selection integration", () => {
      const doc = wireToDoc(`top\n${"hello world ".repeat(10)}tail`);
      const surface = document.createElement("div");
      surface.style.width = "160px";
      document.body.appendChild(surface);
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map() });
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
      const wire = `dh @${AGENT} d @${AGENT} \n\ndh @${AGENT} `;
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
      const wire = `dh @${AGENT} d @${AGENT} tail`;
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

    it("coords for soft-wrap tail interior use wrap-row column not row-0 tail column", () => {
      const wire = `dh @${AGENT} d @${AGENT} tail`;
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
      const wire = `dh @${agent} d @${agent} \ndhd`;
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
      const wire = `dh @${AGENT} d @${AGENT} tail`;
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
      const edgeTolerance = Math.max(2, layout.lineHeight * 0.25);
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
      const edgeTolerance = Math.max(2, layout.lineHeight * 0.25);
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
      const edgeTolerance = Math.max(2, layout.lineHeight * 0.25);
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

    it("segment offset landing maps sparse lower row interior to prefix offset above", () => {
      const agent = AGENT;
      const wire = `dhd @${agent} d @${agent} dhd`;
      const doc = wireToDoc(wire);
      const tailStart = wire.indexOf("dhd", 1);
      const tailInterior = tailStart + 1;
      const row0Top = 141.1;
      const row1Top = 158.86;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[agent, "#06f"]]) });
      setMeasuredSamplesCache(wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 4, top: row0Top, left: 367.23 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 484.39,
        },
        { wire: tailStart - 1, top: row0Top, left: 617.32 },
        { wire: wire.length, top: row1Top, left: 362.67 },
        { wire: tailStart, top: 140.67, left: 617.32 },
      ]);
      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, tailInterior));
      const landing = layout.resolveSegmentOffsetLanding(tailInterior, 1, 0);
      expect(landing).not.toBeNull();
      expect(landing!.sourceStartWire).toBe(tailStart);
      expect(landing!.targetStartWire).toBe(0);
      expect(tailInterior - landing!.sourceStartWire).toBe(1);
      expect(landing!.targetStartWire + (tailInterior - landing!.sourceStartWire)).toBe(1);
      surface.remove();
    });

    it("segment offset landing maps prefix offset down to sparse lower line", () => {
      const agent = AGENT;
      const wire = `dhd @${agent} d @${agent} \ndhd`;
      const doc = wireToDoc(wire);
      const lowerLineStart = wire.indexOf("\n") + 1;
      const lowerInterior = lowerLineStart + 1;
      const row0Top = 141.1;
      const row1Top = 158.86;
      const surface = document.createElement("div");
      surface.style.width = "310px";
      document.body.appendChild(surface);
      Object.defineProperty(surface, "clientWidth", { configurable: true, value: 310 });
      renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[agent, "#06f"]]) });
      setMeasuredSamplesCache(wire, surface.clientWidth, [
        { wire: 0, top: row0Top, left: 340 },
        { wire: 4, top: row0Top, left: 367.23 },
        {
          wire: docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: 0 }),
          top: row0Top,
          left: 484.39,
        },
        { wire: lowerLineStart - 1, top: row0Top, left: 617.32 },
        { wire: wire.length, top: row1Top, left: 362.67 },
      ]);
      const layout = buildHandoffNoteLayoutMap(surface, doc, wireOffsetToDocPos(doc, 1));
      const landing = layout.resolveSegmentOffsetLanding(1, 0, 1);
      expect(landing).not.toBeNull();
      expect(landing!.sourceStartWire).toBe(0);
      expect(landing!.targetStartWire).toBe(lowerLineStart);
      expect(landing!.targetStartWire + (1 - landing!.sourceStartWire)).toBe(lowerInterior);
      surface.remove();
    });
  });
});
