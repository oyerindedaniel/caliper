import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ENGINE_HOST, buildEngineHttpUrl } from "@oyerinde/caliper-schema";
import { pollUntil } from "@engine/utils/poll-until.js";
import { resolveChromeExecutable } from "./resolve-chrome-paths.js";

export type ChromeLaunchOptions = {
  debugPort: number;
  targetUrl: string;
  userDataDir?: string;
  executablePath?: string;
  headless?: boolean;
};

export type ChromeLaunchResult = {
  process: ChildProcessWithoutNullStreams;
  debugPort: number;
  userDataDir: string;
  executablePath: string;
  readStderrTail: () => string;
};

const STDERR_TAIL_LIMIT = 4_000;

export async function launchChrome(options: ChromeLaunchOptions): Promise<ChromeLaunchResult> {
  const executablePath = resolveChromeExecutable(options.executablePath);
  const userDataDir = options.userDataDir ?? (await mkdtemp(join(tmpdir(), "caliper-engine-")));
  const stderrChunks: string[] = [];

  const chromeArgs = [
    `--remote-debugging-port=${options.debugPort}`,
    `--remote-debugging-address=${DEFAULT_ENGINE_HOST}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-translate",
    "--metrics-recording-only",
    "--new-window",
    options.targetUrl,
  ];

  if (options.headless) {
    chromeArgs.push("--headless=new", "--hide-scrollbars", "--mute-audio");
  }

  const chromeProcess = spawn(executablePath, chromeArgs, {
    stdio: "pipe",
    windowsHide: false,
  });

  chromeProcess.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString("utf8"));
  });

  const readStderrTail = (): string => {
    const combined = stderrChunks.join("");
    return combined.length > STDERR_TAIL_LIMIT
      ? combined.slice(combined.length - STDERR_TAIL_LIMIT)
      : combined;
  };

  return {
    process: chromeProcess,
    debugPort: options.debugPort,
    userDataDir,
    executablePath,
    readStderrTail,
  };
}

export async function stopChrome(launch: ChromeLaunchResult): Promise<void> {
  if (!launch.process.killed) {
    launch.process.kill();
  }

  await new Promise<void>((resolve) => {
    if (launch.process.exitCode !== null) {
      resolve();
      return;
    }

    launch.process.once("exit", () => resolve());
    setTimeout(() => {
      if (!launch.process.killed) {
        launch.process.kill("SIGKILL");
      }
      resolve();
    }, 5_000);
  });

  await rm(launch.userDataDir, { recursive: true, force: true });
}

export async function waitForChromeDebugPort(
  debugPort: number,
  launch?: ChromeLaunchResult,
  timeoutMs = 30_000
): Promise<{ webSocketDebuggerUrl: string }> {
  if (launch) {
    const earlyExit = new Promise<never>((_, reject) => {
      launch.process.once("exit", (code) => {
        reject(
          new Error(
            `Chrome exited before the debug port opened (code ${code ?? "unknown"}).\n${launch.readStderrTail()}`
          )
        );
      });
    });

    try {
      return await Promise.race([pollForDebugPort(debugPort, timeoutMs), earlyExit]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stderrTail = launch.readStderrTail();
      if (stderrTail.length > 0 && !message.includes(stderrTail)) {
        throw new Error(`${message}\n${stderrTail}`);
      }
      throw error;
    }
  }

  return pollForDebugPort(debugPort, timeoutMs);
}

async function pollForDebugPort(
  debugPort: number,
  timeoutMs: number
): Promise<{ webSocketDebuggerUrl: string }> {
  return pollUntil(
    async () => {
      try {
        const response = await fetch(
          buildEngineHttpUrl(DEFAULT_ENGINE_HOST, debugPort, "/json/version")
        );
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as { webSocketDebuggerUrl: string };
      } catch {
        return null;
      }
    },
    {
      intervalMs: 250,
      timeoutMs,
      errorMessage: `Chrome did not expose a debug endpoint on port ${debugPort}`,
    }
  );
}
