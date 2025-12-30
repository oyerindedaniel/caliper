import type { Reader } from "./reader.js";
import {
  MAX_FRAME_TIMES,
  DEFAULT_READ_INTERVAL,
} from "../shared/constants/index.js";

export interface FrequencyControlledReader extends Reader {
  adaptToFrameRate: (fps: number) => void;
  recordFrameTime: (timestamp: number) => void;
}

export function createFrequencyControlledReader(
  baseReader: Reader
): FrequencyControlledReader {
  let lastReadTime = 0;
  let readInterval = DEFAULT_READ_INTERVAL;
  const frameTimes: number[] = [];

  function adaptToFrameRate(fps: number) {
    // If app is running at 60fps, read at 30fps
    // If app is running at 30fps, read at 15fps
    // This ensures we don't consume more than half the frame budget
    readInterval = Math.ceil(1000 / (fps / 2));
  }

  function recordFrameTime(timestamp: number) {
    frameTimes.push(timestamp);
    if (frameTimes.length > MAX_FRAME_TIMES) {
      frameTimes.shift();
    }

    // Calculate current FPS and adapt
    if (frameTimes.length >= 2) {
      const last = frameTimes[frameTimes.length - 1];
      const first = frameTimes[0];
      if (last !== undefined && first !== undefined) {
        const duration = last - first;
        const fps = (frameTimes.length / duration) * 1000;
        adaptToFrameRate(fps);
      }
    }
  }

  let trailingTimeoutId: ReturnType<typeof setTimeout> | null = null;

  function scheduleRead(callback: () => void, urgent = false): boolean {
    const now = performance.now();
    const timeSinceLastRead = now - lastReadTime;

    if (!urgent && timeSinceLastRead < readInterval) {
      if (trailingTimeoutId !== null) {
        clearTimeout(trailingTimeoutId);
      }
      trailingTimeoutId = setTimeout(() => {
        trailingTimeoutId = null;
        scheduleRead(callback, false);
      }, readInterval - timeSinceLastRead);
      return false;
    }

    if (trailingTimeoutId !== null) {
      clearTimeout(trailingTimeoutId);
      trailingTimeoutId = null;
    }

    const scheduled = baseReader.scheduleRead(callback, urgent);
    if (scheduled) {
      lastReadTime = now;
    }
    return scheduled;
  }

  function cancel() {
    baseReader.cancel();
    if (trailingTimeoutId !== null) {
      clearTimeout(trailingTimeoutId);
      trailingTimeoutId = null;
    }
  }

  return {
    scheduleRead,
    cancel,
    adaptToFrameRate,
    recordFrameTime,
  };
}
