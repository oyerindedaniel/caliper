export type PollUntilOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  /** Used only when the deadline passes without a truthy result. Throws from tryLoad abort immediately with that error. */
  errorMessage?: string;
};

export async function pollUntil<T>(
  tryLoad: () => Promise<T | null | undefined | false>,
  options: PollUntilOptions = {}
): Promise<T> {
  const intervalMs = options.intervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let value: T | null | undefined | false;
    try {
      value = await tryLoad();
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }

  throw new Error(options.errorMessage ?? "Timed out while polling");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
