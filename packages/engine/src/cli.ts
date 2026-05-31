#!/usr/bin/env node
import { DEFAULT_ENGINE_HOST, DEFAULT_ENGINE_PORT } from "@oyerinde/caliper-schema";
import { createEngineRuntime } from "./engine-runtime.js";

type CliOptions = {
  host: string;
  port: number;
  targetUrl: string | null;
};

type CliParseResult = { ok: true; options: CliOptions } | { ok: false; message: string };

function parsePositivePort(value: string): number | null {
  const parsedPort = Number.parseInt(value, 10);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort >= 65536) {
    return null;
  }
  return parsedPort;
}

function parseHttpUrl(value: string): string | null {
  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl.toString();
  } catch {
    return null;
  }
}

function parseCliOptions(argv: string[]): CliParseResult {
  let host = DEFAULT_ENGINE_HOST;
  let port = DEFAULT_ENGINE_PORT;
  let targetUrl: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === "start") {
      continue;
    }

    if (token === "--port" || token === "-p") {
      const portValue = argv[index + 1];
      if (!portValue) {
        return { ok: false, message: "Missing value for --port" };
      }

      const parsedPort = parsePositivePort(portValue);
      if (parsedPort === null) {
        return { ok: false, message: `Invalid port: ${portValue}` };
      }

      port = parsedPort;
      index += 1;
      continue;
    }

    if (token === "--host" || token === "-H") {
      const hostValue = argv[index + 1];
      if (!hostValue) {
        return { ok: false, message: "Missing value for --host" };
      }

      host = hostValue;
      index += 1;
      continue;
    }

    if (token === "--url" || token === "-u") {
      const urlValue = argv[index + 1];
      if (!urlValue) {
        return { ok: false, message: "Missing value for --url" };
      }

      const parsedUrl = parseHttpUrl(urlValue);
      if (parsedUrl === null) {
        return { ok: false, message: `Invalid URL: ${urlValue}` };
      }

      targetUrl = parsedUrl;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }

    if (token.startsWith("-")) {
      return { ok: false, message: `Unknown option: ${token}` };
    }

    return { ok: false, message: `Unexpected argument: ${token}` };
  }

  return { ok: true, options: { host, port, targetUrl } };
}

function printHelp(): void {
  process.stdout.write(`
Caliper Engine

Usage:
  caliper-engine start [options]

Options:
  -u, --url <url>      Target page URL for the dedicated audit Chrome session
  -H, --host <host>    Bind host (default: ${DEFAULT_ENGINE_HOST})
  -p, --port <number>  Bind port (default: ${DEFAULT_ENGINE_PORT})
  -h, --help           Show this help message
`);
}

function writeCliError(message: string): void {
  process.stderr.write(`caliper-engine: ${message}\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command !== "start") {
    printHelp();
    process.exit(command ? 1 : 0);
  }

  const parsedCli = parseCliOptions(process.argv.slice(3));
  if (!parsedCli.ok) {
    writeCliError(parsedCli.message);
    printHelp();
    process.exit(1);
  }

  let engineRuntime;
  try {
    engineRuntime = await createEngineRuntime({
      host: parsedCli.options.host,
      port: parsedCli.options.port,
      targetUrl: parsedCli.options.targetUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeCliError(`Failed to start: ${message}`);
    process.exit(1);
  }

  const healthUrl = `http://${parsedCli.options.host}:${engineRuntime.server.port}/health`;
  process.stdout.write(`Caliper engine listening on ${healthUrl}\n`);

  if (engineRuntime.browserSession) {
    process.stdout.write(`Dedicated Chrome session: ${engineRuntime.browserSession.url}\n`);
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    try {
      await engineRuntime.stop();
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeCliError(`Failed to stop cleanly: ${message}`);
      process.exit(1);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  writeCliError(message);
  process.exit(1);
});
