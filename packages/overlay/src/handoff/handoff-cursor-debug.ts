const LOG_PREFIX = "[handoff-cursor]";

export function flattenHandoffCursorLog(
  event: string,
  data: Record<string, unknown> = {},
  level: "log" | "warn" = "log"
): void {
  const line = JSON.stringify({ event, ts: Date.now(), ...data });
  if (level === "warn") {
    console.warn(`${LOG_PREFIX} ${event}`, line);
    return;
  }
  console.log(`${LOG_PREFIX} ${event}`, line);
}
