import { describe, expect, it } from "vitest";
import { wireToDoc } from "./handoff-note-doc.js";
import { resolveWireLineColumn } from "./handoff-note-wire-lines.js";
import {
  resolveHorizontalBleedWireMove,
  resolveVerticalArrowCrossLineMove,
  resolveVerticalArrowRowStartLanding,
  resolveVerticalArrowVisualLanding,
  resolveVerticalArrowWireMove,
} from "./handoff-note-vertical-nav.js";

describe("resolveHorizontalBleedWireMove", () => {
  it("steps left at the first line and right at the last line", () => {
    const wire = "abcdef\nghij";
    const doc = wireToDoc(wire);

    expect(resolveHorizontalBleedWireMove(doc, 4, "left")).toEqual({
      offset: 3,
      branch: "boundary-bleed-left",
    });
    expect(resolveHorizontalBleedWireMove(doc, wire.length - 1, "right")).toEqual({
      offset: wire.length,
      branch: "boundary-bleed-right",
    });
  });
});

describe("resolveVerticalArrowCrossLineMove", () => {
  const agentA = "caliper-aaaaaaa";

  it("preserves column into tail when landing on a mention-first row from a high column", () => {
    const wire = `@${agentA} tail text\nnotes here keeping it longer`;
    const doc = wireToDoc(wire);
    const fromHighColumn = wire.length - 1;
    const sourceColumn = resolveWireLineColumn(wire, fromHighColumn).column;
    const currentHigh = resolveWireLineColumn(wire, fromHighColumn);
    const targetUp = { start: 0, end: `@${agentA} tail text`.length };
    const fromHighLine = {
      start: currentHigh.lineStart,
      end: currentHigh.lineEnd,
    };

    const up = resolveVerticalArrowCrossLineMove(
      doc,
      wire,
      fromHighColumn,
      "up",
      sourceColumn,
      fromHighLine,
      targetUp
    );
    const pillEnd = wire.indexOf("@") + `@${agentA}`.length;
    expect(up?.offset).toBeGreaterThanOrEqual(pillEnd);
    expect(up?.branch).toBe("cross-line-column");
  });

  it("snaps to pill end when projected column falls inside a mention-first row on down", () => {
    const wire = `notes here\n@${agentA} tail text`;
    const doc = wireToDoc(wire);
    const fromColumn = 5;
    const current = resolveWireLineColumn(wire, fromColumn);
    const target = resolveWireLineColumn(wire, wire.indexOf("@"));
    const pillEnd = wire.indexOf("@") + `@${agentA}`.length;

    const down = resolveVerticalArrowCrossLineMove(
      doc,
      wire,
      fromColumn,
      "down",
      fromColumn,
      { start: current.lineStart, end: current.lineEnd },
      { start: target.lineStart, end: target.lineEnd }
    );
    expect(down?.offset).toBe(pillEnd);
  });

  it("up from blank at column 0 lands at column 0 of the line above", () => {
    const wire = "header\n\n\n tail";
    const doc = wireToDoc(wire);
    const firstBlankLine = "header\n".length;
    const current = resolveWireLineColumn(wire, firstBlankLine);
    const target = resolveWireLineColumn(wire, 0);

    const up = resolveVerticalArrowCrossLineMove(
      doc,
      wire,
      firstBlankLine,
      "up",
      0,
      { start: current.lineStart, end: current.lineEnd },
      { start: target.lineStart, end: target.lineEnd }
    );
    expect(up).toEqual({ offset: 0, branch: "empty-line-up" });
  });
});

describe("resolveVerticalArrowRowStartLanding", () => {
  const agent = "caliper-0ik99dso0";

  it("lands on column-aligned sample, not earliest wire when tail sample shares the wrapped band", () => {
    const doc = wireToDoc(`@${agent} @${agent} @${agent} `);
    const wrappedBandPillStart = 38;
    const samples = [
      { wire: 37, left: 600 },
      { wire: wrappedBandPillStart, left: 347 },
      { wire: 56, left: 479 },
    ];

    const landing = resolveVerticalArrowRowStartLanding(doc, "down", samples, 347);
    expect(landing?.offset).toBe(wrappedBandPillStart);
    expect(landing?.offset).not.toBe(37);
    expect(landing?.branch).toBe("visual-row-start-column");
  });
});

describe("resolveVerticalArrowVisualLanding", () => {
  const agentA = "caliper-aaaaaaa";
  const agentB = "caliper-bbbbbbb";

  it("dom landing matches horizontal X at goal column", () => {
    const wire = `summary @${agentA} @${agentB} wrap @${agentA} `;
    const doc = wireToDoc(wire);
    const line2Mention = wire.indexOf("@", 1);
    const wrapStart = wire.indexOf("wrap");
    const samples = [
      { wire: line2Mention, left: 0 },
      { wire: wrapStart, left: 120 },
    ];

    const down = resolveVerticalArrowVisualLanding(doc, "down", samples, 120, {
      fromMentionStart: false,
    });
    expect(down).toEqual({ offset: wrapStart, branch: "dom-column" });

    const up = resolveVerticalArrowVisualLanding(doc, "up", samples, 120, {
      fromMentionStart: false,
    });
    expect(up).toEqual({ offset: wrapStart, branch: "dom-column" });
  });

  it("dom landing snaps to pill start when X-match falls inside a mention on up", () => {
    const wire = `summary @${agentA} tail`;
    const doc = wireToDoc(wire);
    const mentionStart = wire.indexOf("@");
    const samples = [
      { wire: mentionStart, left: 0 },
      { wire: mentionStart + 4, left: 40 },
    ];

    const up = resolveVerticalArrowVisualLanding(doc, "up", samples, 40, {
      fromMentionStart: false,
    });
    expect(up).toEqual({ offset: mentionStart, branch: "dom-mentionInterior" });
  });
});

describe("resolveVerticalArrowWireMove", () => {
  it("crosses wire lines instead of stepping along the same row", () => {
    const agent = "caliper-ho14ofyh6";
    const wire = `prefix @${agent} mid @${agent} tail\n\n\n`;
    const doc = wireToDoc(wire);
    const firstPill = wire.indexOf(`@${agent}`);
    const secondPill = wire.indexOf(`@${agent}`, firstPill + 1);
    const { lineStart, lineEnd, column } = resolveWireLineColumn(wire, firstPill);
    const targetLine = resolveWireLineColumn(wire, wire.indexOf("\n") + 1);

    const move = resolveVerticalArrowWireMove(
      doc,
      firstPill,
      "down",
      column,
      { start: lineStart, end: lineEnd },
      { start: targetLine.lineStart, end: targetLine.lineEnd }
    );
    expect(move?.offset).toBe(targetLine.lineStart);
    expect(move?.offset).not.toBe(secondPill);
  });

  it("bleeds horizontally when there is no adjacent wire line", () => {
    const wire = "abcdef\nghij";
    const doc = wireToDoc(wire);
    const { lineStart, lineEnd } = resolveWireLineColumn(wire, 4);

    const up = resolveVerticalArrowWireMove(
      doc,
      4,
      "up",
      4,
      { start: lineStart, end: lineEnd },
      null
    );
    expect(up).toEqual({ offset: 3, branch: "boundary-bleed-left" });

    const lastLine = resolveWireLineColumn(wire, wire.length - 1);
    const down = resolveVerticalArrowWireMove(
      doc,
      wire.length - 1,
      "down",
      lastLine.column,
      { start: lastLine.lineStart, end: lastLine.lineEnd },
      null
    );
    expect(down).toEqual({ offset: wire.length, branch: "boundary-bleed-right" });
  });
});
