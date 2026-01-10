import type { Reader } from "./reader.js";
import { MAX_FRAME_TIMES, DEFAULT_READ_INTERVAL } from "../shared/constants/index.js";

export interface FrequencyControlledReader extends Reader {
  adaptToFrameRate: (fps: number) => void;
  recordFrameTime: (timestamp: number) => void;
}

export function createFrequencyControlledReader(baseReader: Reader): FrequencyControlledReader {
  let lastReadTime = 0;
  let readInterval = DEFAULT_READ_INTERVAL;
  const frameTimes: number[] = [];
  let trailingTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingTask: { callback: () => void; urgent: boolean } | null = null;

  function adaptToFrameRate(fps: number) {
    readInterval = Math.ceil(1000 / (fps / 2));
  }

  function recordFrameTime(timestamp: number) {
    frameTimes.push(timestamp);
    if (frameTimes.length > MAX_FRAME_TIMES) {
      frameTimes.shift();
    }

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

  function executeNow() {
    if (!pendingTask) return;
    const { callback, urgent } = pendingTask;
    pendingTask = null;

    lastReadTime = performance.now();
    baseReader.scheduleRead(callback, urgent);
  }

  function scheduleRead(callback: () => void, urgent = false): void {
    pendingTask = { callback, urgent };

    const now = performance.now();
    const timeSinceLastRead = now - lastReadTime;

    if (urgent || timeSinceLastRead >= readInterval) {
      if (trailingTimeoutId !== null) {
        clearTimeout(trailingTimeoutId);
        trailingTimeoutId = null;
      }
      executeNow();
      return;
    }

    if (trailingTimeoutId === null) {
      trailingTimeoutId = setTimeout(() => {
        trailingTimeoutId = null;
        executeNow();
      }, readInterval - timeSinceLastRead);
    }
  }

  function cancel() {
    baseReader.cancel();
    pendingTask = null;
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
