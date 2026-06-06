import type { ServerResponse } from "node:http";
import type { CaliperEngineStateSnapshot } from "@oyerinde/caliper-schema";

export class EngineStateSseHub {
  private readonly clients = new Set<ServerResponse>();

  publish(snapshot: CaliperEngineStateSnapshot): void {
    const event = formatSseData(snapshot);

    for (const client of [...this.clients]) {
      if (client.writableEnded || client.destroyed) {
        this.clients.delete(client);
        continue;
      }

      client.write(event);
    }
  }

  attachClient(outgoing: ServerResponse, initialSnapshot: CaliperEngineStateSnapshot): void {
    outgoing.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    outgoing.write(formatSseData(initialSnapshot));
    this.clients.add(outgoing);

    outgoing.on("close", () => {
      this.clients.delete(outgoing);
    });
  }

  close(): void {
    for (const client of [...this.clients]) {
      if (!client.writableEnded) {
        client.end();
      }
    }
    this.clients.clear();
  }
}

function formatSseData(snapshot: CaliperEngineStateSnapshot): string {
  return `data: ${JSON.stringify(snapshot)}\n\n`;
}
