import type {
  CaliperRuntimeChannel,
  CaliperRuntimeTrip,
  CaliperRuntimeTripCode,
} from "@oyerinde/caliper-schema";

const DEFAULT_RATE_WINDOW_MS = 10_000;
const DEFAULT_RATE_MAX_EVENTS = 2_000;
const DEFAULT_SESSION_MAX_LINES = 50_000;
const DEFAULT_SESSION_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_DUPLICATE_STREAK_COUNT = 100;
const DEFAULT_DUPLICATE_STREAK_WINDOW_MS = 30_000;
const RATE_BUCKET_MS = 1_000;

export type RuntimeCaptureGuardOptions = {
  rateWindowMs?: number;
  rateMaxEvents?: number;
  sessionMaxLines?: number;
  sessionMaxBytes?: number;
  duplicateStreakCount?: number;
  duplicateStreakWindowMs?: number;
};

export type RuntimeCaptureGuardSnapshot = {
  flushedLines: number;
  flushedBytes: number;
  pendingLines: number;
};

export type RuntimeCaptureGuardIngest = {
  channel: CaliperRuntimeChannel;
  text?: string;
  snapshot: RuntimeCaptureGuardSnapshot;
};

export class RuntimeCaptureGuard {
  private readonly rateWindowMs: number;
  private readonly rateMaxEvents: number;
  private readonly sessionMaxLines: number;
  private readonly sessionMaxBytes: number;
  private readonly duplicateStreakCount: number;
  private readonly duplicateStreakWindowMs: number;
  private readonly rateBuckets = new Map<number, number>();
  private duplicateKey: string | null = null;
  private duplicateCount = 0;
  private duplicateWindowStartedAt = 0;
  private tripped = false;

  constructor(options: RuntimeCaptureGuardOptions = {}) {
    this.rateWindowMs =
      options.rateWindowMs ?? readIntEnv("CALIPER_RUNTIME_RATE_WINDOW_MS", DEFAULT_RATE_WINDOW_MS);
    this.rateMaxEvents =
      options.rateMaxEvents ??
      readIntEnv("CALIPER_RUNTIME_RATE_MAX_EVENTS", DEFAULT_RATE_MAX_EVENTS);
    this.sessionMaxLines =
      options.sessionMaxLines ??
      readIntEnv("CALIPER_RUNTIME_SESSION_MAX_LINES", DEFAULT_SESSION_MAX_LINES);
    this.sessionMaxBytes =
      options.sessionMaxBytes ??
      readIntEnv("CALIPER_RUNTIME_SESSION_MAX_BYTES", DEFAULT_SESSION_MAX_BYTES);
    this.duplicateStreakCount = options.duplicateStreakCount ?? DEFAULT_DUPLICATE_STREAK_COUNT;
    this.duplicateStreakWindowMs =
      options.duplicateStreakWindowMs ?? DEFAULT_DUPLICATE_STREAK_WINDOW_MS;
  }

  isTripped(): boolean {
    return this.tripped;
  }

  reset(): void {
    this.rateBuckets.clear();
    this.duplicateKey = null;
    this.duplicateCount = 0;
    this.duplicateWindowStartedAt = 0;
    this.tripped = false;
  }

  evaluateIngest(input: RuntimeCaptureGuardIngest): CaliperRuntimeTrip | null {
    if (this.tripped) {
      return null;
    }

    const now = Date.now();
    this.recordRateEvent(now);

    const totalLines = input.snapshot.flushedLines + input.snapshot.pendingLines + 1;
    if (totalLines > this.sessionMaxLines) {
      return this.trip(
        "session_lines_exceeded",
        now,
        `Session line budget exceeded (${this.sessionMaxLines})`
      );
    }

    if (input.snapshot.flushedBytes > this.sessionMaxBytes) {
      return this.trip(
        "session_bytes_exceeded",
        now,
        `Session byte budget exceeded (${this.sessionMaxBytes} bytes flushed)`
      );
    }

    const windowEvents = this.countRateEvents(now);
    if (windowEvents > this.rateMaxEvents) {
      return this.trip(
        "rate_exceeded",
        now,
        `Ingest rate exceeded (${windowEvents} events in ${this.rateWindowMs}ms)`
      );
    }

    if (input.text !== undefined) {
      const duplicateTrip = this.evaluateDuplicateStreak(input.channel, input.text, now);
      if (duplicateTrip) {
        return duplicateTrip;
      }
    }

    return null;
  }

  private trip(code: CaliperRuntimeTripCode, at: number, message: string): CaliperRuntimeTrip {
    this.tripped = true;
    return { code, at, message };
  }

  private recordRateEvent(now: number): void {
    const bucket = Math.floor(now / RATE_BUCKET_MS);
    this.rateBuckets.set(bucket, (this.rateBuckets.get(bucket) ?? 0) + 1);

    const oldestBucket = Math.floor((now - this.rateWindowMs) / RATE_BUCKET_MS);
    for (const bucketKey of [...this.rateBuckets.keys()]) {
      if (bucketKey < oldestBucket) {
        this.rateBuckets.delete(bucketKey);
      }
    }
  }

  private countRateEvents(now: number): number {
    const oldestBucket = Math.floor((now - this.rateWindowMs) / RATE_BUCKET_MS);
    let total = 0;
    for (const [bucketKey, count] of this.rateBuckets) {
      if (bucketKey >= oldestBucket) {
        total += count;
      }
    }
    return total;
  }

  private evaluateDuplicateStreak(
    channel: CaliperRuntimeChannel,
    text: string,
    now: number
  ): CaliperRuntimeTrip | null {
    const key = `${channel}:${text}`;
    if (
      this.duplicateKey !== key ||
      now - this.duplicateWindowStartedAt > this.duplicateStreakWindowMs
    ) {
      this.duplicateKey = key;
      this.duplicateCount = 1;
      this.duplicateWindowStartedAt = now;
      return null;
    }

    this.duplicateCount += 1;
    if (this.duplicateCount < this.duplicateStreakCount) {
      return null;
    }

    return this.trip(
      "duplicate_streak",
      now,
      `Duplicate log streak exceeded (${this.duplicateStreakCount} identical lines on ${channel})`
    );
  }
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
