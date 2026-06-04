import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

const execFileAsync = promisify(execFile);

/**
 * Substrings that identify a Caliper MCP relay process (case-insensitive).
 * Verified on Windows (Cursor global MCP): the process listening on 9876 is typically
 * `node .../@oyerinde/caliper/dist/mcp.js --port 9876` (npx cache path), not the parent
 * `npx-cli.js -y @oyerinde/caliper` wrapper.
 */
const CALIPER_MCP_COMMAND_MARKERS = [
  "@oyerinde/caliper/dist/mcp",
  "@oyerinde/caliper-mcp",
  "caliper-mcp",
  "packages/mcp-server",
  "mcp-server/dist",
  "dist/mcp.js",
  "/mcp.js",
] as const;

const NON_MCP_CALIPER_MARKERS = ["caliper-engine", "engine-cli", "dist/engine-cli"] as const;

export type PortHolderPreemptResult =
  | { ok: true; pid: number; commandLine: string }
  | {
      ok: false;
      reason: "no_holder" | "not_caliper" | "self" | "disabled" | "terminate_failed";
      detail: string;
    };

export function isBridgePreemptDisabled(): boolean {
  const flag = process.env.CALIPER_BRIDGE_NO_PREEMPT;
  return flag === "1" || flag?.toLowerCase() === "true";
}

export function isCaliperMcpProcess(commandLine: string): boolean {
  const normalized = commandLine.replace(/\\/g, "/").toLowerCase();

  if (NON_MCP_CALIPER_MARKERS.some((marker) => normalized.includes(marker))) {
    return false;
  }

  return CALIPER_MCP_COMMAND_MARKERS.some((marker) => normalized.includes(marker));
}

export async function findListeningProcessId(port: number): Promise<number | null> {
  const pids =
    platform() === "win32"
      ? await findListeningPidsWindows(port)
      : await findListeningPidsUnix(port);

  const selfPid = process.pid;
  for (const pid of pids) {
    if (pid !== selfPid) {
      return pid;
    }
  }

  return null;
}

async function findListeningPidsWindows(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      windowsHide: true,
    });

    return parseWindowsNetstatListening(stdout, port);
  } catch {
    return [];
  }
}

export function parseWindowsNetstatListening(output: string, port: number): number[] {
  const pids = new Set<number>();

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("TCP") || !trimmed.includes("LISTENING")) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) {
      continue;
    }

    const localAddress = parts[1] ?? "";
    const pid = Number.parseInt(parts[parts.length - 1] ?? "", 10);
    const portSuffix = `:${port}`;
    const listensOnPort =
      localAddress.endsWith(portSuffix) || localAddress.endsWith(`]${portSuffix}`);

    if (listensOnPort && Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  return [...pids];
}

async function findListeningPidsUnix(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });

    return stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

export async function readProcessCommandLine(pid: number): Promise<string | null> {
  if (platform() === "win32") {
    return readProcessCommandLineWindows(pid);
  }

  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    });
    const commandLine = stdout.trim();
    return commandLine.length > 0 ? commandLine : null;
  } catch {
    return null;
  }
}

async function readProcessCommandLineWindows(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
      { encoding: "utf8", windowsHide: true }
    );

    const commandLine = stdout.trim();
    return commandLine.length > 0 ? commandLine : null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function terminateProcessGracefully(
  pid: number,
  options: { termTimeoutMs?: number } = {}
): Promise<boolean> {
  const termTimeoutMs = options.termTimeoutMs ?? 1500;

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "ESRCH") {
      return true;
    }
    return false;
  }

  const deadline = Date.now() + termTimeoutMs;
  while (Date.now() < deadline) {
    if (!(await isProcessAlive(pid))) {
      return true;
    }
    await delay(100);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    return errno.code === "ESRCH";
  }

  await delay(200);
  return !(await isProcessAlive(pid));
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    return errno.code !== "ESRCH";
  }
}

export async function preemptCaliperBridgePortHolder(
  port: number
): Promise<PortHolderPreemptResult> {
  if (isBridgePreemptDisabled()) {
    return {
      ok: false,
      reason: "disabled",
      detail: "CALIPER_BRIDGE_NO_PREEMPT is set",
    };
  }

  const pid = await findListeningProcessId(port);
  if (pid === null) {
    return { ok: false, reason: "no_holder", detail: `No listener found on port ${port}` };
  }

  if (pid === process.pid) {
    return { ok: false, reason: "self", detail: `Port ${port} is held by this process` };
  }

  const commandLine = (await readProcessCommandLine(pid)) ?? "";
  if (!isCaliperMcpProcess(commandLine)) {
    return {
      ok: false,
      reason: "not_caliper",
      detail: `Port ${port} is in use by pid ${pid} (not Caliper MCP): ${commandLine || "<unknown command>"}`,
    };
  }

  const terminated = await terminateProcessGracefully(pid);
  if (!terminated) {
    return {
      ok: false,
      reason: "terminate_failed",
      detail: `Failed to terminate prior Caliper MCP on port ${port} (pid ${pid})`,
    };
  }

  return { ok: true, pid, commandLine };
}
