import {
  DEFAULT_ENGINE_NAVIGATION_TIMEOUT_DOM_MS,
  DEFAULT_ENGINE_NAVIGATION_TIMEOUT_LOAD_MS,
  DEFAULT_ENGINE_VIEWPORT_DEVICE_SCALE_FACTOR,
  DEFAULT_ENGINE_VIEWPORT_HEIGHT,
  DEFAULT_ENGINE_VIEWPORT_WIDTH,
  type CaliperEngineDefaultViewport,
  type CaliperEnginePageWaitUntil,
} from "@oyerinde/caliper-schema";

export function readEngineDefaultViewport(): CaliperEngineDefaultViewport {
  const width = readPositiveInt(
    process.env.CALIPER_ENGINE_DEFAULT_VIEWPORT_WIDTH,
    DEFAULT_ENGINE_VIEWPORT_WIDTH
  );
  const height = readPositiveInt(
    process.env.CALIPER_ENGINE_DEFAULT_VIEWPORT_HEIGHT,
    DEFAULT_ENGINE_VIEWPORT_HEIGHT
  );
  const deviceScaleFactor = readPositiveFloat(
    process.env.CALIPER_ENGINE_DEFAULT_VIEWPORT_DEVICE_SCALE_FACTOR,
    DEFAULT_ENGINE_VIEWPORT_DEVICE_SCALE_FACTOR
  );

  return { width, height, deviceScaleFactor };
}

export function readEngineNavigationTimeoutMs(waitUntil: CaliperEnginePageWaitUntil): number {
  const envDom = process.env.CALIPER_ENGINE_NAVIGATION_TIMEOUT_DOM_MS;
  const envLoad = process.env.CALIPER_ENGINE_NAVIGATION_TIMEOUT_LOAD_MS;
  const envDefault = process.env.CALIPER_ENGINE_NAVIGATION_TIMEOUT_MS;

  if (waitUntil === "load") {
    return readPositiveInt(envLoad ?? envDefault, DEFAULT_ENGINE_NAVIGATION_TIMEOUT_LOAD_MS);
  }

  return readPositiveInt(envDom ?? envDefault, DEFAULT_ENGINE_NAVIGATION_TIMEOUT_DOM_MS);
}

export function readEngineMaxPages(): number {
  const raw = process.env.CALIPER_ENGINE_MAX_PAGES;
  if (!raw) {
    return 8;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveFloat(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
