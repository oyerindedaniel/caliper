import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { z } from "zod";
import {
  DEFAULT_ENGINE_HOST,
  DEFAULT_ENGINE_PORT,
  EngineHealthSchema,
  EngineRpcRequestSchema,
  RpcFactory,
  buildEngineHttpUrl,
  isId,
  type EngineHealth,
  type EngineRpcRequest,
  type EngineSessionState,
  type NullableId,
  type RpcErrorInput,
  type RpcResultInput,
} from "@oyerinde/caliper-schema";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(packageRoot, "..", "package.json");

function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}

export type CaliperEngineServerOptions = {
  host?: string;
  port?: number;
  version?: string;
  targetUrl?: string | null;
};

type EngineHttpErrorBody = {
  error: "not_found" | "internal_error";
  message?: string;
};

type EngineHttpJsonBody =
  | EngineHealth
  | ReturnType<typeof RpcFactory.error>
  | ReturnType<typeof RpcFactory.response>
  | EngineHttpErrorBody;

type RpcHandler = (request: EngineRpcRequest) => Promise<unknown>;
type CaptureHandler = (fileName: string) => string | null;

export class CaliperEngineServer {
  readonly host: string;
  readonly version: string;
  readonly sessionId: string;
  readonly startedAt: number;

  private boundPort: number;
  private server: Server | null = null;
  private activeUrl: string | null;
  private chromeConnected = false;
  private rpcHandler: RpcHandler | null = null;
  private captureHandler: CaptureHandler | null = null;

  constructor(options: CaliperEngineServerOptions = {}) {
    this.host = options.host ?? DEFAULT_ENGINE_HOST;
    this.boundPort = options.port ?? DEFAULT_ENGINE_PORT;
    this.version = options.version ?? readPackageVersion();
    this.sessionId = randomUUID();
    this.startedAt = Date.now();
    this.activeUrl = options.targetUrl ?? null;
  }

  get port(): number {
    return this.boundPort;
  }

  setRpcHandler(handler: RpcHandler | null): void {
    this.rpcHandler = handler;
  }

  setCaptureHandler(handler: CaptureHandler | null): void {
    this.captureHandler = handler;
  }

  setActiveUrl(activeUrl: string | null): void {
    this.activeUrl = activeUrl;
  }

  setChromeConnected(chromeConnected: boolean): void {
    this.chromeConnected = chromeConnected;
  }

  getHealth(): EngineHealth {
    return EngineHealthSchema.parse({
      ok: true,
      runtime: "engine",
      version: this.version,
      sessionId: this.sessionId,
      activeUrl: this.activeUrl,
      chromeConnected: this.chromeConnected,
      startedAt: this.startedAt,
    });
  }

  getState(): EngineSessionState {
    return {
      sessionId: this.sessionId,
      activeUrl: this.activeUrl,
      chromeConnected: this.chromeConnected,
      startedAt: this.startedAt,
    };
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = createServer((incoming, outgoing) => {
      void this.handleRequest(incoming, outgoing);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.boundPort, this.host, () => {
        const address = this.server!.address();
        if (address && typeof address === "object") {
          this.boundPort = address.port;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const currentServer = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      currentServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleRequest(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    try {
      const requestUrl = new URL(
        incoming.url ?? "/",
        buildEngineHttpUrl(this.host, this.boundPort)
      );

      if (incoming.method === "GET" && requestUrl.pathname === "/health") {
        this.writeJson(outgoing, 200, this.getHealth());
        return;
      }

      if (incoming.method === "GET" && requestUrl.pathname.startsWith("/captures/")) {
        await this.handleCapture(requestUrl.pathname, outgoing);
        return;
      }

      if (incoming.method === "POST" && requestUrl.pathname === "/rpc") {
        await this.handleRpc(incoming, outgoing);
        return;
      }

      this.writeHttpError(outgoing, 404, { error: "not_found" });
    } catch (error) {
      this.writeHttpError(outgoing, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleCapture(pathname: string, outgoing: ServerResponse): Promise<void> {
    const fileName = basename(decodeURIComponent(pathname.slice("/captures/".length)));
    if (!fileName || fileName.includes("..") || !this.captureHandler) {
      this.writeHttpError(outgoing, 404, { error: "not_found" });
      return;
    }

    const filePath = this.captureHandler(fileName);
    if (!filePath || !existsSync(filePath)) {
      this.writeHttpError(outgoing, 404, { error: "not_found" });
      return;
    }

    const fileBuffer = readFileSync(filePath);
    const contentType = fileName.endsWith(".jpeg") ? "image/jpeg" : "image/png";
    outgoing.writeHead(200, {
      "content-type": contentType,
      "content-length": fileBuffer.byteLength,
    });
    outgoing.end(fileBuffer);
  }

  private async handleRpc(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    let parsedBody: unknown = null;

    try {
      const bodyText = await readRequestBody(incoming);
      parsedBody = bodyText.length > 0 ? JSON.parse(bodyText) : null;
    } catch {
      this.writeRpcError(outgoing, 400, { id: null, code: -32700, message: "Parse error" });
      return;
    }

    const parsedRequest = EngineRpcRequestSchema.safeParse(parsedBody);

    if (!parsedRequest.success) {
      this.writeRpcError(outgoing, 400, {
        id: readRpcRequestId(parsedBody),
        code: -32600,
        message: "Invalid Caliper RPC request",
        data: z.treeifyError(parsedRequest.error),
      });
      return;
    }

    if (!this.rpcHandler) {
      this.writeRpcError(outgoing, 501, {
        id: parsedRequest.data.id,
        code: -32000,
        message: "Engine RPC handlers are not configured yet",
      });
      return;
    }

    const result = await this.rpcHandler(parsedRequest.data);
    this.writeRpcResult(outgoing, {
      id: parsedRequest.data.id,
      result: result as Record<string, unknown>,
    });
  }

  private writeJson(
    outgoing: ServerResponse,
    statusCode: number,
    payload: EngineHttpJsonBody
  ): void {
    const body = JSON.stringify(payload);
    outgoing.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    outgoing.end(body);
  }

  private writeHttpError(
    outgoing: ServerResponse,
    statusCode: number,
    body: EngineHttpErrorBody
  ): void {
    this.writeJson(outgoing, statusCode, body);
  }

  private writeRpcError(outgoing: ServerResponse, statusCode: number, error: RpcErrorInput): void {
    this.writeJson(outgoing, statusCode, RpcFactory.error(error));
  }

  private writeRpcResult(outgoing: ServerResponse, payload: RpcResultInput): void {
    this.writeJson(outgoing, 200, RpcFactory.response(payload));
  }
}

function readRpcRequestId(body: unknown): NullableId {
  if (typeof body !== "object" || body === null || !("id" in body)) {
    return null;
  }

  const candidateId = body["id"];
  return isId(candidateId) ? candidateId : null;
}

async function readRequestBody(incoming: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of incoming) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function createStartedEngineServer(
  options: CaliperEngineServerOptions = {}
): Promise<CaliperEngineServer> {
  const engineServer = new CaliperEngineServer(options);
  await engineServer.start();
  return engineServer;
}
