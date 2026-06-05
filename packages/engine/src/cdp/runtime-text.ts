const TRUNCATION_SUFFIX = "…[truncated]";

export function truncateRuntimeText(text: string, maxBytes: number): string {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= maxBytes) {
    return text;
  }

  const suffixBytes = Buffer.byteLength(TRUNCATION_SUFFIX, "utf8");
  const budget = Math.max(0, maxBytes - suffixBytes);
  return `${encoded.subarray(0, budget).toString("utf8")}${TRUNCATION_SUFFIX}`;
}

export function readMaxRuntimeLineBytesFromEnvironment(defaultBytes: number): number {
  const raw = process.env.CALIPER_RUNTIME_MAX_LINE_BYTES;
  if (!raw) {
    return defaultBytes;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultBytes;
}
