/**
 * Type declarations for @caliper/overlay
 * Prevents React package from type-checking SolidJS JSX
 */

declare module "@caliper/overlay" {
  export interface OverlayOptions {}

  export interface OverlayInstance {
    mount: (container?: HTMLElement) => void;
    dispose: () => void;
  }

  export function createOverlay(options?: OverlayOptions): OverlayInstance;
}
