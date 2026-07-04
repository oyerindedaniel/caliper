import { describe, expect, it } from "vitest";
import { listEmbeddedBlankBandProbeWires } from "./handoff-note-embedded-newlines.js";
import { wireToDoc } from "./handoff-note-doc.js";
import { resolveWireLineColumn } from "./handoff-note-wire-lines.js";
import {
  resolveEmbeddedBlankBandVerticalMove,
  resolveHorizontalBleedWireMove,
  resolveVerticalArrowCrossLineMove,
  resolveVerticalArrowRowStartLanding,
  resolveVerticalArrowMinWireLineStart,
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

  it("steps over a pill atomically from its start", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `row @${agent} tail`;
    const doc = wireToDoc(wire);
    const mentionStart = wire.indexOf("@");
    const mentionEnd = mentionStart + `@${agent}`.length;

    expect(resolveHorizontalBleedWireMove(doc, mentionEnd, "left")).toEqual({
      offset: mentionStart,
      branch: "boundary-bleed-left",
    });
    expect(resolveHorizontalBleedWireMove(doc, mentionStart, "right")).toEqual({
      offset: mentionEnd,
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

  it("down from blank at column 0 lands at column 0 of the line below", () => {
    const wire = "header\n\n\n tail";
    const doc = wireToDoc(wire);
    const firstBlankLine = "header\n".length;
    const secondBlankLine = "header\n\n".length;
    const current = resolveWireLineColumn(wire, firstBlankLine);
    const target = resolveWireLineColumn(wire, secondBlankLine);

    const down = resolveVerticalArrowCrossLineMove(
      doc,
      wire,
      firstBlankLine,
      "down",
      0,
      { start: current.lineStart, end: current.lineEnd },
      { start: target.lineStart, end: target.lineEnd }
    );
    expect(down).toEqual({ offset: secondBlankLine, branch: "empty-target-column" });
  });

  it("preserves column and clamps when target line is shorter", () => {
    const wire = "abcdef\nghi";
    const doc = wireToDoc(wire);
    const from = wire.indexOf("ef");
    const current = resolveWireLineColumn(wire, from);
    const target = resolveWireLineColumn(wire, wire.indexOf("hi"));

    const down = resolveVerticalArrowCrossLineMove(
      doc,
      wire,
      from,
      "down",
      current.column,
      { start: current.lineStart, end: current.lineEnd },
      { start: target.lineStart, end: target.lineEnd }
    );
    expect(down?.offset).toBe(wire.length);
    expect(down?.branch).toBe("cross-line-column");
  });

  it("preserves column from inter-pill gap to plain row below", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const row1 = `row @${agentA} mid @${agentB} end`;
    const gapMid = row1.indexOf(" mid ") + 3;
    const column = resolveWireLineColumn(row1, gapMid).column;
    const wire = `${row1}\n${" ".repeat(column)}mark`;
    const doc = wireToDoc(wire);
    const current = resolveWireLineColumn(wire, gapMid);
    const target = resolveWireLineColumn(wire, row1.length + 1 + column);

    const down = resolveVerticalArrowCrossLineMove(
      doc,
      wire,
      gapMid,
      "down",
      column,
      { start: current.lineStart, end: current.lineEnd },
      { start: target.lineStart, end: target.lineEnd }
    );
    expect(down?.offset).toBe(row1.length + 1 + column);
    expect(down?.branch).toBe("cross-line-column");
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

  it("lands at goal column when exiting blank band to content row", () => {
    const agent = "caliper-aaaaaaa";
    const wire = `header\n\nrow @${agent} tail\n\n\n@${agent} `;
    const doc = wireToDoc(wire);
    const rowStart = wire.indexOf("row");
    const mentionStart = wire.indexOf("@");
    const samples = [
      { wire: 0, left: 0 },
      { wire: mentionStart, left: 0 },
      { wire: rowStart + 4, left: 80 },
      { wire: rowStart, left: 120 },
    ];

    const landing = resolveVerticalArrowRowStartLanding(doc, "up", samples, 120);
    expect(landing?.offset).toBe(rowStart);
    expect(landing?.branch).toBe("visual-row-start-column");
  });
});

describe("resolveVerticalArrowMinWireLineStart", () => {
  const agent = "caliper-aaaaaaa";

  it("picks leftmost wire regardless of goal column", () => {
    const wire = `header\n\nrow @${agent} tail\n\n\n@${agent} `;
    const doc = wireToDoc(wire);
    const rowStart = wire.indexOf("row");
    const mentionStart = wire.indexOf("@");
    const samples = [
      { wire: mentionStart, left: 0 },
      { wire: rowStart + 4, left: 80 },
      { wire: rowStart, left: 120 },
    ];

    const landing = resolveVerticalArrowMinWireLineStart(doc, "up", samples);
    expect(landing?.offset).toBe(rowStart);
    expect(landing?.branch).toBe("visual-line-start-minWire");
  });

  it("blank-band exit lands substantive wire-line start not mention sample", () => {
    const wire = `header @${agent} \n\n\ntail @${agent} `;
    const doc = wireToDoc(wire);
    const tailRowStart = wire.indexOf("tail");
    const mentionStart = wire.indexOf("@", tailRowStart);
    const samples = [
      { wire: mentionStart, left: 0 },
      { wire: wire.length - 1, left: 0 },
    ];

    const landing = resolveVerticalArrowMinWireLineStart(doc, "down", samples);
    expect(landing?.offset).toBe(tailRowStart);
    expect(landing?.branch).toBe("visual-line-start-minWire");
  });
});

describe("resolveEmbeddedBlankBandVerticalMove", () => {
  it("treats caret on storage newline before substantive row as lower visual row", () => {
    const wire = "header\n\ntail";
    const doc = wireToDoc(wire);
    const probe = listEmbeddedBlankBandProbeWires(doc)[0]!;
    const bridgingNewline = probe + 1;
    expect(wire[bridgingNewline]).toBe("\n");

    const up = resolveEmbeddedBlankBandVerticalMove(doc, bridgingNewline, "up", 0);
    expect(up).toEqual({ offset: probe, branch: "blank-band-probe-row" });
  });
});

describe("resolveVerticalArrowWireMove", () => {
  it("up chain from tail blank band never lands on prefix mention", () => {
    const agentA = "caliper-aaaaaaa";
    const agentB = "caliper-bbbbbbb";
    const wire = `row @${agentA} mid @${agentB} \n\ntail @${agentA} `;
    const doc = wireToDoc(wire);
    const prefixMentionAt = wire.indexOf("@");
    const blankLineStart = wire.indexOf("\n\n") + 1;
    const lowerMentionEnd = wire.length - 1;

    const firstUp = resolveVerticalArrowWireMove(
      doc,
      lowerMentionEnd,
      "up",
      resolveWireLineColumn(wire, lowerMentionEnd).column,
      {
        start: resolveWireLineColumn(wire, lowerMentionEnd).lineStart,
        end: resolveWireLineColumn(wire, lowerMentionEnd).lineEnd,
      },
      {
        start: resolveWireLineColumn(wire, blankLineStart).lineStart,
        end: resolveWireLineColumn(wire, blankLineStart).lineEnd,
      }
    );
    expect(firstUp?.offset).toBe(blankLineStart);
    expect(firstUp?.offset).not.toBe(prefixMentionAt);

    const secondUp = resolveVerticalArrowWireMove(
      doc,
      firstUp!.offset,
      "up",
      0,
      {
        start: resolveWireLineColumn(wire, firstUp!.offset).lineStart,
        end: resolveWireLineColumn(wire, firstUp!.offset).lineEnd,
      },
      {
        start: resolveWireLineColumn(wire, 0).lineStart,
        end: resolveWireLineColumn(wire, 0).lineEnd,
      }
    );
    expect(secondUp?.offset).toBe(0);
    expect(secondUp?.offset).not.toBe(prefixMentionAt);
  });

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
