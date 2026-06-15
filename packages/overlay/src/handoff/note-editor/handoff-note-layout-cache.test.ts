import { describe, expect, it, beforeEach } from "vitest";
import { docPosToWireOffset, docToWire, wireOffsetToDocPos, wireToDoc } from "@caliper/core";
import { renderHandoffNoteDoc } from "./handoff-note-dom.js";
import {
  buildHandoffNoteLayoutMap,
  getCachedMeasuredSamples,
  invalidateHandoffNoteLayoutCache,
  readHandoffNoteLayoutCacheKey,
  setMeasuredSamplesCache,
} from "./handoff-note-layout-map.js";
import { resolveDomVerticalArrowMove } from "./handoff-note-selection.js";
import { setSelectionAtWire } from "./handoff-note-test-helpers.js";

describe("handoff-note-layout-cache", () => {
  beforeEach(() => {
    invalidateHandoffNoteLayoutCache();
  });

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
    expect(getCachedMeasuredSamples("hello", 320)).toBe(samples);
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
  });

  it("measured continuation tops seed a second visual row when pills share one band", () => {
    const agent = "caliper-aaaaaaaaaaa";
    const wire = `header @${agent} @${agent} ${"tail ".repeat(24)}`;
    const doc = wireToDoc(wire);
    const tailWire = wire.length - 1;
    const prefixStart = docPosToWireOffset(doc, { nodeIndex: 0, nodeOffset: 0 });
    const firstMentionEnd = docPosToWireOffset(doc, { nodeIndex: 1, nodeOffset: agent.length });
    const postMentionStart = firstMentionEnd + 1;
    const secondMentionEnd = docPosToWireOffset(doc, { nodeIndex: 3, nodeOffset: agent.length });
    const secondPostStart = secondMentionEnd + 1;
    const surface = document.createElement("div");
    surface.style.width = "480px";
    document.body.appendChild(surface);
    Object.defineProperty(surface, "clientWidth", { configurable: true, value: 480 });
    renderHandoffNoteDoc(surface, doc, { colorByAgentId: new Map([[agent, "#06f"]]) });

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
});
