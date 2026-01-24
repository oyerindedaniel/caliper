import type { CursorContext as SchemaContext } from "@oyerinde/caliper-schema";

export type CursorContext = SchemaContext | null;
export type SyncSource = "primary" | "secondary";

export type ProjectionDirection = "top" | "right" | "bottom" | "left";

export interface ProjectionState {
  direction: ProjectionDirection | null;
  value: string;
  element: HTMLElement | null;
}

export interface RulerLine {
  id: string;
  type: "horizontal" | "vertical";
  position: number; // Viewport-relative coordinate (x for vertical, y for horizontal)
}

export interface RulerState {
  lines: RulerLine[];
}
