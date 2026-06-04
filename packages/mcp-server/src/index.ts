import { CaliperMcpServer } from "./services/mcp-server.js";
import { DEFAULT_BRIDGE_PORT } from "./shared/constants.js";
import {
  CALIPER_MEASUREMENT_ROUTING,
  CaliperMeasurementRoutingSchema,
  DEFAULT_ENGINE_URL,
  type CaliperMeasurementRouting,
} from "@oyerinde/caliper-schema";

type CliOptions = {
  port: number;
  engineUrl: string | null;
  engineTargetUrl: string | null;
  runtimeRouting: CaliperMeasurementRouting;
  allowScriptEval: boolean;
};

function parseRuntimeRouting(value: string): CaliperMeasurementRouting | null {
  const parsed = CaliperMeasurementRoutingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let port = DEFAULT_BRIDGE_PORT;
  let engineUrl: string | null = null;
  let engineTargetUrl: string | null = null;
  let runtimeRouting: CaliperMeasurementRouting = CALIPER_MEASUREMENT_ROUTING.AUTO;
  let allowScriptEval = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--port" || token === "-p") {
      const nextArg = args[index + 1];
      if (nextArg) {
        const parsedPort = Number.parseInt(nextArg, 10);
        if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536) {
          port = parsedPort;
        }
      }
      index += 1;
      continue;
    }

    if (token === "--runtime") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        console.error("Missing value for --runtime. Expected auto, attached, or engine.");
        process.exit(1);
      }

      const parsedRouting = parseRuntimeRouting(nextArg);
      if (!parsedRouting) {
        console.error(`Invalid --runtime value: ${nextArg}. Expected auto, attached, or engine.`);
        process.exit(1);
      }

      runtimeRouting = parsedRouting;
      index += 1;
      continue;
    }

    if (token === "--engine") {
      const nextArg = args[index + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        engineUrl = nextArg;
        index += 1;
      } else {
        engineUrl = DEFAULT_ENGINE_URL;
      }
      continue;
    }

    if (token === "--engine-url") {
      const nextArg = args[index + 1];
      if (nextArg) {
        engineUrl = nextArg;
      }
      index += 1;
      continue;
    }

    if (token === "--engine-target-url") {
      const nextArg = args[index + 1];
      if (nextArg) {
        engineTargetUrl = nextArg;
      }
      index += 1;
      continue;
    }

    if (token === "--allow-script-eval") {
      allowScriptEval = true;
      continue;
    }

    if (token === "--help" || token === "-h") {
      console.error(`
Caliper MCP Server - AI-powered UI measurement tool

Usage:
  npx @oyerinde/caliper-mcp [options]

Options:
  -p, --port <number>              WebSocket relay port (default: ${DEFAULT_BRIDGE_PORT})
      --runtime <mode>             Measurement routing: auto, attached, or engine (default: auto)
      --engine [url]               Enable engine routing (default: ${DEFAULT_ENGINE_URL})
      --engine-url <url>           Explicit caliper-engine base URL
      --engine-target-url <url>    Page URL for MCP to spawn caliper-engine against
      --allow-script-eval          Pass --allow-script-eval to spawned caliper-engine
  -d, --docs                       Open documentation: https://caliper.danieloyerinde.com/
  -h, --help                       Show this help message
`);
      process.exit(0);
    }

    if (token === "--docs" || token === "-d") {
      console.error("\n📚 View Documentation: https://caliper.danieloyerinde.com/\n");
      process.exit(0);
    }
  }

  return { port, engineUrl, engineTargetUrl, runtimeRouting, allowScriptEval };
}

const cliOptions = parseArgs();
const server = new CaliperMcpServer({
  port: cliOptions.port,
  engineUrl: cliOptions.engineUrl,
  engineTargetUrl: cliOptions.engineTargetUrl,
  runtimeRouting: cliOptions.runtimeRouting,
  allowScriptEval: cliOptions.allowScriptEval,
});
server.start();

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("end", shutdown);
