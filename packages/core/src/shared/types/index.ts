export type CursorContext = "parent" | "sibling" | "child" | null;
export type SyncSource = "primary" | "secondary";

export type ProjectionDirection = "top" | "right" | "bottom" | "left";

export interface ProjectionState {
    direction: ProjectionDirection | null;
    value: string;
    element: HTMLElement | null;
}
