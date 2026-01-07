type ReadStrategy = "post-raf" | "idle" | "scheduler" | "timeout";

export interface Reader {
  /**
   * Schedules a read. Only the latest scheduled read will be executed.
   */
  scheduleRead: (callback: () => void, urgent?: boolean) => void;
  cancel: () => void;
}

export function createReader(): Reader {
  let rafId: number | null = null;
  let idleId: number | null = null;
  let schedulerSignal: AbortSignal | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function detectBestStrategy(): ReadStrategy {
    // Prefer scheduler if available
    if ("scheduler" in globalThis) {
      return "scheduler";
    }
    // Fallback to idle callback
    if ("requestIdleCallback" in window) {
      return "idle";
    }
    // Last resort: post-RAF
    return "post-raf";
  }

  function scheduleWithScheduler(callback: () => void, urgent: boolean) {
    if (!("scheduler" in globalThis)) {
      scheduleWithIdle(callback, urgent);
      return;
    }

    const Scheduler = (globalThis as any).scheduler;
    const TaskController = (globalThis as any).TaskController;

    if (!TaskController) {
      scheduleWithIdle(callback, urgent);
      return;
    }

    const controller = new TaskController({
      priority: urgent ? "user-visible" : "background",
    });

    schedulerSignal = controller.signal;

    Scheduler.postTask(
      () => {
        callback();
      },
      {
        signal: controller.signal,
        priority: urgent ? "user-visible" : "background",
      }
    );
  }

  function scheduleWithIdle(callback: () => void, urgent: boolean) {
    if (!("requestIdleCallback" in window)) {
      scheduleWithRAF(callback);
      return;
    }

    idleId = requestIdleCallback(
      (deadline) => {
        if (deadline.timeRemaining() > 0 || deadline.didTimeout) {
          callback();
        } else if (!urgent) {
          // Reschedule if not urgent
          scheduleWithIdle(callback, false);
        } else {
          // Urgent: fallback to RAF
          scheduleWithRAF(callback);
        }
      },
      { timeout: urgent ? 5 : 50 }
    );
  }

  function scheduleWithRAF(callback: () => void) {
    rafId = requestAnimationFrame(() => {
      // Use microtask to run after app's RAF
      Promise.resolve().then(() => {
        callback();
      });
    });
  }

  function scheduleWithTimeout(callback: () => void) {
    timeoutId = setTimeout(() => {
      callback();
    }, 0);
  }

  function scheduleRead(callback: () => void, urgent = false): void {
    cancel();

    const strategy = detectBestStrategy();

    switch (strategy) {
      case "scheduler":
        scheduleWithScheduler(callback, urgent);
        break;
      case "idle":
        scheduleWithIdle(callback, urgent);
        break;
      case "post-raf":
        scheduleWithRAF(callback);
        break;
      case "timeout":
        scheduleWithTimeout(callback);
        break;
    }
  }

  function cancel() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (idleId !== null && "cancelIdleCallback" in window) {
      cancelIdleCallback(idleId);
      idleId = null;
    }
    if (schedulerSignal) {
      // Note: We don't abort the signal here to avoid complex controller management.
      // Simply nulling it out is enough for the "latest wins" logic as scheduleRead will cancel the next one.
      schedulerSignal = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  return { scheduleRead, cancel };
}
