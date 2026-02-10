import { ContextMetrics } from "./core.js";

export const MAX_DESCENDANT_COUNT = 1000;
export const RECOMMENDED_PAGINATION_THRESHOLD = 40;

export const DEFAULT_CONTEXT_METRICS: ContextMetrics = {
    rootFontSize: 16,
    devicePixelRatio: 1,
    viewportWidth: 1920,
    viewportHeight: 1080,
    visualViewportWidth: 1920,
    visualViewportHeight: 1080,
    scrollX: 0,
    scrollY: 0,
    documentWidth: 1920,
    documentHeight: 1080,
    orientation: "landscape",
    preferences: {
        colorScheme: "light",
        reducedMotion: false,
    },
};