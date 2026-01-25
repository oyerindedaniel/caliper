import { CaliperMcpServer } from "./services/mcp-server.js";
import { DEFAULT_BRIDGE_PORT } from "./shared/constants.js";

function parseArgs(): { port: number } {
    const args = process.argv.slice(2);
    let port = DEFAULT_BRIDGE_PORT;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--port" || args[i] === "-p") {
            const nextArg = args[i + 1];
            if (nextArg) {
                const val = parseInt(nextArg, 10);
                if (!isNaN(val) && val > 0 && val < 65536) {
                    port = val;
                }
            }
            i++;
        } else if (args[i] === "--help" || args[i] === "-h") {
            console.error(`
Caliper MCP Server - AI-powered UI measurement tool

Usage:
  npx @oyerinde/caliper-mcp [options]

Options:
  -p, --port <number>  WebSocket relay port (default: ${DEFAULT_BRIDGE_PORT})
  -d, --docs           Open documentation: https://caliper.danieloyerinde.com/
  -h, --help           Show this help message
`);
            process.exit(0);
        } else if (args[i] === "--docs" || args[i] === "-d") {
            console.log("\n📚 View Documentation: https://caliper.danieloyerinde.com/\n");
            process.exit(0);
        }
    }

    return { port };
}

const { port } = parseArgs();
const server = new CaliperMcpServer(port);
server.start();

const shutdown = async () => {
    await server.stop();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("end", shutdown);
