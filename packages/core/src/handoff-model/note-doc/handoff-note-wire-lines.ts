export type HandoffNoteVerticalArrowDirection = "up" | "down";

export type WireLineColumn = {
  lineIndex: number;
  column: number;
  lineStart: number;
  lineEnd: number;
};

export function resolveWireLineColumn(wire: string, offset: number): WireLineColumn {
  const clamped = Math.max(0, Math.min(offset, wire.length));
  const lineStarts = [0];
  for (let index = 0; index < wire.length; index++) {
    if (wire[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  for (let lineIndex = lineStarts.length - 1; lineIndex >= 0; lineIndex--) {
    const lineStart = lineStarts[lineIndex]!;
    const lineEnd =
      lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1]! - 1 : wire.length;
    if (clamped >= lineStart && clamped <= lineEnd) {
      return { lineIndex, column: clamped - lineStart, lineStart, lineEnd };
    }
  }
  return { lineIndex: 0, column: clamped, lineStart: 0, lineEnd: wire.length };
}
