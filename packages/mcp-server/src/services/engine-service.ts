import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ENGINE_HOST,
  DEFAULT_ENGINE_PORT,
  EngineHealthSchema,
  RpcFactory,
  isCaliperActionResult,
  isJSONRPCErrorResponse,
  isJSONRPCResultResponse,
  type CaliperActionResult,
  type CaliperRpcMethod,
  type CaliperRpcParams,
  type EngineHealth,
  type JsonRpcResponse,
} from "@oyerinde/caliper-schema";
import { generateId } from "../utils/id.js";
import { createLogger } from "../utils/logger.js";
import { pollUntil } from "../utils/poll-until.js";

const logger = createLogger("engine-service");

export type EngineServiceOptions = {
  engineUrl: string;
  targetUrl?: string | null;
};

export class EngineService {
  private readonly engineUrl: string;
  private readonly targetUrl: string | null;
  private spawnedProcess: ChildProcess | null = null;

  constructor(options: EngineServiceOptions) {
    this.engineUrl = options.engineUrl.replace(/\/$/, "");
    this.targetUrl = options.targetUrl ?? null;
  }

  get url(): string {
    return this.engineUrl;
  }

  async ensureReady(): Promise<EngineHealth> {
    const existingHealth = await this.fetchHealth();
    if (existingHealth) {
      return existingHealth;
    }

    await this.spawnEngine();
    return pollUntil(async () => this.fetchHealth(), {
      intervalMs: 250,
      timeoutMs: 45_000,
      errorMessage: `Caliper engine did not become ready at ${this.engineUrl}`,
    });
  }

  async call(
    method: CaliperRpcMethod,
    params: CaliperRpcParams<CaliperRpcMethod>
  ): Promise<CaliperActionResult> {
    const requestId = generateId("engine-call");
    const request = RpcFactory.request(method, params, requestId);
    const response = await fetch(`${this.engineUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    const payload = (await response.json()) as JsonRpcResponse;

    if (isJSONRPCErrorResponse(payload)) {
      throw new Error(payload.error.message);
    }

    if (!isJSONRPCResultResponse(payload)) {
      throw new Error("Engine RPC returned an unexpected response shape");
    }

    if (!isCaliperActionResult(payload.result)) {
      throw new Error("Engine RPC returned an invalid result shape");
    }

    return payload.result;
  }

  async stop(): Promise<void> {
    if (!this.spawnedProcess || this.spawnedProcess.exitCode !== null) {
      return;
    }

    this.spawnedProcess.kill();
    this.spawnedProcess = null;
  }

  private async fetchHealth(): Promise<EngineHealth | null> {
    try {
      const response = await fetch(`${this.engineUrl}/health`);
      if (!response.ok) {
        return null;
      }

      return EngineHealthSchema.parse(await response.json());
    } catch {
      return null;
    }
  }

  private async spawnEngine(): Promise<void> {
    if (this.spawnedProcess && this.spawnedProcess.exitCode === null) {
      return;
    }

    const engineUrl = new URL(this.engineUrl);
    const host = engineUrl.hostname || DEFAULT_ENGINE_HOST;
    const port = engineUrl.port ? Number.parseInt(engineUrl.port, 10) : DEFAULT_ENGINE_PORT;
    const cliPath = resolveEngineCliPath();
    const args = ["start", "--host", host, "--port", String(port)];

    if (this.targetUrl) {
      args.push("--url", this.targetUrl);
    }

    logger.info(`Starting caliper-engine at ${this.engineUrl}`);

    this.spawnedProcess = spawn(process.execPath, [cliPath, ...args], {
      stdio: "ignore",
      env: process.env,
    });

    this.spawnedProcess.on("exit", (code) => {
      logger.warn(`caliper-engine exited with code ${code ?? "unknown"}`);
      this.spawnedProcess = null;
    });
  }
}

function resolveEngineCliPath(): string {
  const envPath = process.env.CALIPER_ENGINE_CLI;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  const moduleDirectory = dirname(fileURLToPath(import.meta.url));

  const bundledCliPath = join(moduleDirectory, "engine-cli.js");
  if (existsSync(bundledCliPath)) {
    return bundledCliPath;
  }

  if (process.env.NODE_ENV !== "production") {
    const monorepoCliPath = join(moduleDirectory, "../../../engine/dist/cli.js");
    if (existsSync(monorepoCliPath)) {
      return monorepoCliPath;
    }
  }

  throw new Error(
    "Could not locate caliper-engine CLI. Reinstall @oyerinde/caliper or set CALIPER_ENGINE_CLI."
  );
}
