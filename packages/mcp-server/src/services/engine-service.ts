import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ENGINE_HOST,
  DEFAULT_ENGINE_PORT,
  EngineHealthSchema,
  RpcFactory,
  parseCaliperActionResult,
  rehydrateWalkAndMeasureResult,
  isWalkAndMeasureSuccess,
  isCaliperActionResultMethod,
  isJSONRPCErrorResponse,
  isJSONRPCResultResponse,
  type CaliperActionResultFor,
  type CaliperBaseMethod,
  type CaliperEngineMethod,
  type CaliperEngineParams,
  type CaliperParams,
  type CaliperRpcMethod,
  type CaliperRpcParams,
  type EngineHealth,
  type JSONRPCResponse,
} from "@oyerinde/caliper-schema";
import { resolveCaliperProjectRoot } from "@oyerinde/caliper-schema/node";
import { generateId } from "../utils/id.js";
import { createLogger } from "../utils/logger.js";
import { pollUntil } from "@oyerinde/caliper-schema";
import { EngineStateSseClient, type EngineStateSseCallback } from "./engine-state-sse-client.js";

const logger = createLogger("engine-service");

export type EngineServiceOptions = {
  engineUrl: string;
  targetUrl?: string | null;
  allowScriptEval?: boolean;
};

export class EngineService {
  private readonly engineUrl: string;
  private readonly targetUrl: string | null;
  private readonly allowScriptEval: boolean;
  private readonly stateSseClient: EngineStateSseClient;
  private spawnedProcess: ChildProcess | null = null;

  constructor(options: EngineServiceOptions) {
    this.engineUrl = options.engineUrl.replace(/\/$/, "");
    this.targetUrl = options.targetUrl ?? null;
    this.allowScriptEval = options.allowScriptEval ?? false;
    this.stateSseClient = new EngineStateSseClient(this.engineUrl);
  }

  get url(): string {
    return this.engineUrl;
  }

  setStateSseCallback(callback: EngineStateSseCallback | null): void {
    this.stateSseClient.setCallback(callback);
  }

  startStateSse(): void {
    this.stateSseClient.start();
  }

  stopStateSse(): void {
    this.stateSseClient.stop();
  }

  async isHealthy(): Promise<boolean> {
    const health = await this.fetchHealth();
    return health?.ok === true;
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

  async call<M extends CaliperBaseMethod>(
    method: M,
    params: CaliperParams<M>
  ): Promise<CaliperActionResultFor<M>>;
  async call<M extends CaliperEngineMethod>(
    method: M,
    params: CaliperEngineParams<M>
  ): Promise<CaliperActionResultFor<M>>;
  async call<M extends CaliperRpcMethod>(
    method: M,
    params: CaliperRpcParams<M>
  ): Promise<CaliperActionResultFor<M>> {
    const requestId = generateId("engine-call");
    const request = RpcFactory.request(method, params, requestId);
    const response = await fetch(`${this.engineUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    const payload = (await response.json()) as JSONRPCResponse;

    if (isJSONRPCErrorResponse(payload)) {
      throw new Error(payload.error.message);
    }

    if (!isJSONRPCResultResponse(payload)) {
      throw new Error("Engine RPC returned an unexpected response shape");
    }

    return this.parseRpcResult(method, payload.result);
  }

  async stop(): Promise<void> {
    this.stopStateSse();

    if (!this.spawnedProcess || this.spawnedProcess.exitCode !== null) {
      return;
    }

    this.spawnedProcess.kill();
    this.spawnedProcess = null;
  }

  private parseRpcResult<M extends CaliperRpcMethod>(
    method: M,
    result: unknown
  ): CaliperActionResultFor<M> {
    const parsed = parseCaliperActionResult(result);
    if (!parsed || !isCaliperActionResultMethod(parsed, method)) {
      throw new Error("Engine RPC returned an invalid result shape");
    }

    if (isWalkAndMeasureSuccess(parsed)) {
      const rehydrated = rehydrateWalkAndMeasureResult(parsed);
      if (!rehydrated.ok) {
        throw new Error(rehydrated.error);
      }
      if (!isCaliperActionResultMethod(rehydrated.result, method)) {
        throw new Error("Engine RPC returned an invalid result shape");
      }
      return rehydrated.result;
    }

    return parsed;
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

    if (this.allowScriptEval) {
      args.push("--allow-script-eval");
    }

    logger.info(`Starting caliper-engine at ${this.engineUrl}`);

    this.spawnedProcess = spawn(process.execPath, [cliPath, ...args], {
      stdio: "ignore",
      env: {
        ...process.env,
        CALIPER_PROJECT_ROOT: resolveCaliperProjectRoot(),
      },
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
