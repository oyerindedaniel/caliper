import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeCaptureGuard, type RuntimeCaptureGuardSnapshot } from "./runtime-capture-guard.js";

function snapshot(
  overrides: Partial<RuntimeCaptureGuardSnapshot> = {}
): RuntimeCaptureGuardSnapshot {
  return {
    flushedLines: 0,
    flushedBytes: 0,
    pendingLines: 0,
    ...overrides,
  };
}

describe("RuntimeCaptureGuard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("below all thresholds", () => {
    it("returns null while ingest stays within every budget", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10,
        sessionMaxLines: 100,
        sessionMaxBytes: 10_000,
        duplicateStreakCount: 5,
      });

      for (let index = 0; index < 5; index += 1) {
        const trip = guard.evaluateIngest({
          channel: "console",
          text: `line-${index}`,
          snapshot: snapshot({ flushedLines: index }),
        });
        expect(trip).toBeNull();
      }
    });
  });

  describe("rate_exceeded", () => {
    it("trips when ingest exceeds the rolling window budget", () => {
      vi.useFakeTimers();
      const guard = new RuntimeCaptureGuard({
        rateWindowMs: 10_000,
        rateMaxEvents: 3,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 1_000,
      });
      vi.setSystemTime(1_000);

      for (const text of ["a", "b", "c"]) {
        expect(guard.evaluateIngest({ channel: "console", text, snapshot: snapshot() })).toBeNull();
      }

      const trip = guard.evaluateIngest({
        channel: "console",
        text: "d",
        snapshot: snapshot(),
      });

      expect(trip?.code).toBe("rate_exceeded");
      expect(guard.isTripped()).toBe(true);
    });

    it("does not trip on the event that exactly hits the limit", () => {
      vi.useFakeTimers();
      const guard = new RuntimeCaptureGuard({
        rateWindowMs: 10_000,
        rateMaxEvents: 3,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 1_000,
      });
      vi.setSystemTime(2_000);

      for (let index = 0; index < 3; index += 1) {
        expect(
          guard.evaluateIngest({
            channel: "console",
            text: `event-${index}`,
            snapshot: snapshot(),
          })
        ).toBeNull();
      }
    });

    it("stops evaluating new trips after the guard has tripped", () => {
      vi.useFakeTimers();
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 1,
        sessionMaxLines: 1,
        sessionMaxBytes: 1,
        duplicateStreakCount: 1,
      });
      vi.setSystemTime(3_000);

      guard.evaluateIngest({ channel: "console", text: "first", snapshot: snapshot() });
      expect(
        guard.evaluateIngest({ channel: "console", text: "second", snapshot: snapshot() })
      ).toMatchObject({
        code: "rate_exceeded",
      });

      expect(
        guard.evaluateIngest({ channel: "console", text: "third", snapshot: snapshot() })
      ).toBeNull();
    });

    it("expires old second-buckets so prior bursts do not trip a later quiet period", () => {
      vi.useFakeTimers();
      const guard = new RuntimeCaptureGuard({
        rateWindowMs: 10_000,
        rateMaxEvents: 3,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 1_000,
      });
      vi.setSystemTime(10_000);

      for (let index = 0; index < 3; index += 1) {
        guard.evaluateIngest({
          channel: "console",
          text: `burst-${index}`,
          snapshot: snapshot(),
        });
      }

      vi.setSystemTime(10_000 + 11_000);

      expect(
        guard.evaluateIngest({
          channel: "console",
          text: "after-window",
          snapshot: snapshot(),
        })
      ).toBeNull();
    });

    it("counts events across channels toward the same rate budget", () => {
      vi.useFakeTimers();
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 2,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 1_000,
      });
      vi.setSystemTime(20_000);

      expect(
        guard.evaluateIngest({ channel: "console", text: "c1", snapshot: snapshot() })
      ).toBeNull();
      expect(
        guard.evaluateIngest({ channel: "logs", text: "l1", snapshot: snapshot() })
      ).toBeNull();

      const trip = guard.evaluateIngest({
        channel: "exceptions",
        text: "e1",
        snapshot: snapshot(),
      });

      expect(trip?.code).toBe("rate_exceeded");
    });
  });

  describe("session_lines_exceeded", () => {
    it("trips when flushed plus pending plus the current event would exceed the cap", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 4,
        duplicateStreakCount: 1_000,
      });

      const trip = guard.evaluateIngest({
        channel: "console",
        text: "overflow",
        snapshot: snapshot({ flushedLines: 3, pendingLines: 1 }),
      });

      expect(trip?.code).toBe("session_lines_exceeded");
    });

    it("does not trip when totals sit exactly on the line budget", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 4,
        duplicateStreakCount: 1_000,
      });

      expect(
        guard.evaluateIngest({
          channel: "console",
          text: "boundary",
          snapshot: snapshot({ flushedLines: 2, pendingLines: 1 }),
        })
      ).toBeNull();
    });

    it("treats pending lines from every channel as part of one session total", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 2,
        duplicateStreakCount: 1_000,
      });

      const trip = guard.evaluateIngest({
        channel: "networkFailures",
        snapshot: snapshot({ flushedLines: 1, pendingLines: 1 }),
      });

      expect(trip?.code).toBe("session_lines_exceeded");
    });
  });

  describe("session_bytes_exceeded", () => {
    it("trips when flushed bytes already exceed the session byte cap", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 10_000,
        sessionMaxBytes: 128,
        duplicateStreakCount: 1_000,
      });

      const trip = guard.evaluateIngest({
        channel: "logs",
        text: "big",
        snapshot: snapshot({ flushedBytes: 200 }),
      });

      expect(trip?.code).toBe("session_bytes_exceeded");
    });

    it("does not trip when flushed bytes equal the cap", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 10_000,
        sessionMaxBytes: 128,
        duplicateStreakCount: 1_000,
      });

      expect(
        guard.evaluateIngest({
          channel: "logs",
          text: "boundary",
          snapshot: snapshot({ flushedBytes: 128 }),
        })
      ).toBeNull();
    });

    it("prefers the byte trip before rate when both would fire", () => {
      vi.useFakeTimers();
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 1,
        sessionMaxLines: 10_000,
        sessionMaxBytes: 64,
        duplicateStreakCount: 1_000,
      });
      vi.setSystemTime(30_000);

      guard.evaluateIngest({ channel: "console", text: "rate-1", snapshot: snapshot() });

      const trip = guard.evaluateIngest({
        channel: "console",
        text: "rate-2",
        snapshot: snapshot({ flushedBytes: 128 }),
      });

      expect(trip?.code).toBe("session_bytes_exceeded");
    });
  });

  describe("duplicate_streak", () => {
    it("trips on repeated identical channel+text pairs", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 4,
        duplicateStreakWindowMs: 30_000,
      });

      for (let index = 0; index < 3; index += 1) {
        expect(
          guard.evaluateIngest({
            channel: "console",
            text: "same",
            snapshot: snapshot({ flushedLines: index }),
          })
        ).toBeNull();
      }

      const trip = guard.evaluateIngest({
        channel: "console",
        text: "same",
        snapshot: snapshot({ flushedLines: 3 }),
      });

      expect(trip?.code).toBe("duplicate_streak");
    });

    it("resets the streak when text changes", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 4,
      });

      guard.evaluateIngest({ channel: "console", text: "a", snapshot: snapshot() });
      guard.evaluateIngest({ channel: "console", text: "a", snapshot: snapshot() });
      expect(
        guard.evaluateIngest({ channel: "console", text: "b", snapshot: snapshot() })
      ).toBeNull();
      expect(
        guard.evaluateIngest({ channel: "console", text: "b", snapshot: snapshot() })
      ).toBeNull();
      expect(
        guard.evaluateIngest({ channel: "console", text: "b", snapshot: snapshot() })
      ).toBeNull();
    });

    it("does not merge duplicate streaks across channels with the same text", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 3,
      });

      guard.evaluateIngest({ channel: "console", text: "shared", snapshot: snapshot() });
      guard.evaluateIngest({ channel: "logs", text: "shared", snapshot: snapshot() });
      guard.evaluateIngest({ channel: "console", text: "shared", snapshot: snapshot() });

      expect(
        guard.evaluateIngest({ channel: "logs", text: "shared", snapshot: snapshot() })
      ).toBeNull();
    });

    it("trips duplicate streak within a single channel before the threshold is shared elsewhere", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 3,
      });

      guard.evaluateIngest({ channel: "logs", text: "shared", snapshot: snapshot() });
      guard.evaluateIngest({ channel: "logs", text: "shared", snapshot: snapshot() });

      expect(
        guard.evaluateIngest({ channel: "logs", text: "shared", snapshot: snapshot() })
      ).toMatchObject({ code: "duplicate_streak" });
    });

    it("restarts duplicate counting after the streak window elapses", () => {
      vi.useFakeTimers();
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 3,
        duplicateStreakWindowMs: 5_000,
      });
      vi.setSystemTime(40_000);

      guard.evaluateIngest({ channel: "console", text: "loop", snapshot: snapshot() });
      guard.evaluateIngest({ channel: "console", text: "loop", snapshot: snapshot() });

      vi.setSystemTime(40_000 + 6_000);

      expect(
        guard.evaluateIngest({ channel: "console", text: "loop", snapshot: snapshot() })
      ).toBeNull();
      expect(
        guard.evaluateIngest({ channel: "console", text: "loop", snapshot: snapshot() })
      ).toBeNull();
      expect(
        guard.evaluateIngest({ channel: "console", text: "loop", snapshot: snapshot() })
      ).toMatchObject({ code: "duplicate_streak" });
    });

    it("skips duplicate detection when the entry has no comparable text", () => {
      const guard = new RuntimeCaptureGuard({
        rateMaxEvents: 10_000,
        sessionMaxLines: 10_000,
        duplicateStreakCount: 2,
      });

      for (let index = 0; index < 5; index += 1) {
        expect(
          guard.evaluateIngest({
            channel: "networkFailures",
            snapshot: snapshot(),
          })
        ).toBeNull();
      }
    });
  });

  describe("reset", () => {
    it("clears tripped state and rate buckets for a fresh subscribe session", () => {
      vi.useFakeTimers();
      const guard = new RuntimeCaptureGuard({ rateMaxEvents: 2, sessionMaxLines: 100 });
      vi.setSystemTime(50_000);

      guard.evaluateIngest({ channel: "console", snapshot: snapshot() });
      guard.evaluateIngest({ channel: "console", snapshot: snapshot() });
      expect(guard.evaluateIngest({ channel: "console", snapshot: snapshot() })).toMatchObject({
        code: "rate_exceeded",
      });

      guard.reset();
      expect(guard.isTripped()).toBe(false);
      expect(guard.evaluateIngest({ channel: "console", snapshot: snapshot() })).toBeNull();
      expect(guard.evaluateIngest({ channel: "console", snapshot: snapshot() })).toBeNull();
      expect(guard.evaluateIngest({ channel: "console", snapshot: snapshot() })).toMatchObject({
        code: "rate_exceeded",
      });
    });
  });
});
