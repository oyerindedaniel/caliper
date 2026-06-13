import { describe, expect, it, beforeEach } from "vitest";
import { docToWire, wireOffsetToDocPos, wireToDoc } from "@caliper/core";
import { renderHandoffNoteDoc } from "./handoff-note-dom.js";
import {
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
});
