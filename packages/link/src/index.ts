import { createOverlay } from "@caliper/overlay";

if (typeof window !== "undefined") {
  const instance = createOverlay();
  instance.mount();

  (window as any).__CALIPER__ = instance;
}
